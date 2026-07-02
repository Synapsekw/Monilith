# Spec: Robustness & error-surfacing pass

**Date:** 2026-07-02 · **Branch:** `task/robustness-error-surfacing` · **Status:** awaiting review

## 1. Problem

A codebase sweep found five places where failures are invisible — pages white-screen, optimistic
UI silently reverts, or writes silently vanish. Each finding was **re-verified against the code
in this worktree** before speccing:

| #   | Finding (verified location)                                                                                                                                                                       | Failure mode today                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Zero `error.tsx` / `not-found.tsx` anywhere under `src/app/` (glob-confirmed)                                                                                                                     | Any server-render throw hits Next's default overlay-less production error page; `notFound()` calls render the unbranded default |
| F2  | `src/lib/boards/use-board-mutations.ts` — ~15 optimistic mutations roll back the cache in `onError` with **no user feedback**; non-optimistic ones (timers, uploads) fail silently too            | Edit visually reverts (or nothing happens) with no explanation — reads as data loss                                             |
| F3  | Unchecked notification inserts: `src/lib/collaboration/actions.ts:65` (`addUpdate` mention fan-out) and `src/lib/boards/actions.ts:580` (`upsertCell` assigned fan-out) — insert result discarded | Mention/assignment notifications silently never created; no log, no error                                                       |
| F4  | `src/lib/boards/actions.ts` — `deleteBoard` (l.172) and `duplicateBoard` (l.202) go Zod-parse → DB with RLS as the only check                                                                     | A non-owner calling `deleteBoard` gets `ok: true` while RLS filtered the delete to 0 rows — a **lying success**                 |
| F5  | `src/lib/boards/queries.ts` `getBoardPayload` — the two mirror-column follow-up reads (~l.261–275) use `.data ?? []` with no error check; the nine parallel primary reads do the same             | A transient DB error renders an **empty board** (no groups/items/cells) — indistinguishable from deleted data                   |

## 2. Goals / non-goals

**Goals:** every server-render failure shows a branded, recoverable error page; every board
mutation failure tells the user; every silent write/read failure becomes either an explicit
error or a server log. **Additive only** — RLS remains the security boundary (AGENTS.md);
app-level checks improve _feedback_, not security.

**Non-goals:** retry/queue infrastructure for notifications; error-reporting SaaS integration;
covering `admin/*` segments with bespoke boundaries (the root boundary covers them); success
toasts; refactoring the mutation hook.

## 3. Design

### 3.1 F1 — Error boundaries & not-found pages (Next.js 16 conventions)

Verified against `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/{error,not-found}.md`
(installed Next **16.2.9**): `error.tsx` must be a client component and receives
`{ error: Error & { digest?: string }, unstable_retry: () => void }` — `unstable_retry`
(added v16.2.0) re-fetches and re-renders the segment and is preferred over `reset`.
`not-found.tsx` is a server component, no props; `error.tsx` in a segment wraps that segment's
`page` + children but **not** the same segment's `layout` — so a boundary at `(app)/` renders
its fallback _inside_ the `AuthenticatedShell`, exactly what we want.

New files (all thin wrappers around two shared components):

- `src/components/shell/error-fallback.tsx` — client `ErrorFallback` component:
  `{ error, retry, title?, description? }`. Renders segment-scoped copy, a "Try again"
  button wired to `unstable_retry`, the `error.digest` (muted, for support), and logs the error
  via `console.error` in a `useEffect`. Styled per **pulse-ui** (monochromatic + single accent;
  builders must load the `pulse-ui` + `frontend-design` skills).
- `src/components/shell/not-found-fallback.tsx` — server-renderable `NotFoundFallback`
  component: `{ title, description, backHref, backLabel }`.
- Boundaries: `src/app/error.tsx` (root catch-all: covers `admin/`, `home/`, `onboarding/`,
  `updates/`, `landing/`, `(auth)/`), `src/app/(app)/error.tsx` (in-shell catch-all: also covers
  `settings/`, `workload/`), and per-segment `error.tsx` in `(app)/boards/`, `(app)/dashboards/`,
  `(app)/portfolios/`, `(app)/goals/`, `(app)/time/` with segment-specific copy/back-links.
- Not-found: `src/app/not-found.tsx` (branded global 404 — also catches all unmatched URLs) and
  per-dynamic-segment `not-found.tsx` in `(app)/boards/[boardId]/`,
  `(app)/dashboards/[dashboardId]/`, `(app)/portfolios/[portfolioId]/` ("Board not found — it may
  have been deleted or you may not have access", back to the section index). All three pages
  already call `notFound()` (verified), so these light up with no page changes.

No `global-error.tsx` (root layout is trivial; YAGNI) and no experimental `global-not-found`.

### 3.2 F2 — Mutation error toasts

No toast library exists (`package.json` verified; `BoardTable.tsx:456` comment: "the project has
no toast primitive yet" — the existing pattern is inline `role="alert"` banners where a caller
opts in via `onError` callbacks). Decision: **add `sonner`** (the shadcn-standard toaster, small,
works with `next-themes`), mount `<Toaster />` once in `src/app/(app)/layout.tsx`, themed with
pulse-ui tokens.

In `use-board-mutations.ts`, add a module-level helper
`showMutationError(action: string, err: Error)` → `toast.error(...)` with copy like
"Couldn't save the cell — your change was undone." + the server message, and call it from the
`onError` of every mutation that currently gives **no** feedback: all optimistic-rollback
mutations (setCell, clearCell, rename/reorder/delete item·group·column, resize, group color,
column settings, remove option, remove dependency, relation links, delete attachment, delete
time entry, set estimate, rename board, name-column resize) **and** the silent non-optimistic
ones (startTimer, stopTimer, addManualEntry, editEntry, uploadColumnFile). Mutations whose
callers already surface errors inline via `onError` callbacks (addItem, addSubitem, addGroup,
addColumn, addDependency — e.g. BoardTable's banner) keep the inline pattern: **no double
feedback**, hook-level toast is not added for those.

### 3.3 F3 — Unchecked notification inserts

In both fan-outs, capture `const { error } = await supabase.from("notifications").insert(...)`
and on error `console.error("[notifications] <kind> fan-out failed", { itemId, recipients:
n, error: error.message })`. **Do not fail the parent action** — the primary write (update
posted / cell saved) succeeded; notifications are best-effort and failing the whole action would
be worse UX. The log makes the loss observable in server/Vercel logs.

### 3.4 F4 — Defense-in-depth membership checks

`getBoardAccess(boardId)` already exists in `src/lib/boards/queries.ts:99` (returns
`"owner" | "editor" | "viewer" | null`; `queries.ts` is `server-only`, importable from the
`"use server"` actions module). Add explicit checks **before** the DB call:

- `deleteBoard`: require `access === "owner"` → else `fail("Only the board owner can delete this board.")`.
  This also fixes the lying-success (RLS-filtered delete of 0 rows returns `ok: true` today).
- `duplicateBoard`: require `access !== null` → else `fail("Board not found.")` (don't leak
  existence to non-members; owner/editor/viewer may all duplicate — they can already read the data).

RLS stays authoritative; these checks are additive feedback (AGENTS.md invariant honored).

### 3.5 F5 — `getBoardPayload` error checks

In `getBoardPayload`: check `.error` on the nine parallel reads, the linked-item-names read, and
the two mirror follow-up reads; on any error **`throw new Error(...)`** naming the failed read.
The new boards `error.tsx` catches it → user sees "Couldn't load this board" + Try again instead
of a convincingly empty board. The board head query keeps its split semantics: `boardErr` (real
DB failure) → throw; row missing/RLS-hidden → `null` → `notFound()` (today `boardErr` is
conflated into `notFound()` — wrong signal). This extends the brief's mirror-only finding to the
whole function — same file, same pattern, same failure mode (recorded as decision D6).

## 4. Performance & data-fetching budget (AGENTS.md rule #5)

- **First paint:** unchanged. Error/not-found pages are static leaves rendered only on failure;
  `<Toaster />` mounts once in the (app) layout (sonner ≈ a few KB gz, client-only, no fetch).
- **Interactions:** 0 new server round-trips anywhere. Toasts are client-side; `unstable_retry`
  re-fetches only the failed segment, only on explicit click.
- **Hot paths:** no new queries. `getBoardAccess` adds ≤2 indexed point-reads to `deleteBoard`/
  `duplicateBoard` — rare, non-hot mutations. `getBoardPayload` gains only error checks.

## 5. Testing (per feature — see plan for exact files)

Unit tests via existing patterns (mocked Supabase builder as in `src/lib/boards/actions.test.ts`;
`renderHook` + QueryClientProvider as in `use-board-mutations.test.tsx`; RTL component tests):
fallback components render + retry wiring; segment `error.tsx`/`not-found.tsx` files export
correctly; failed mutation → rollback **and** toast (sonner mocked), callback-driven mutations
don't double-toast; notification-insert failure → `ok: true` + `console.error`; success path →
no log; `deleteBoard`/`duplicateBoard` access-denied and lying-success cases; `getBoardPayload`
throws on read errors, `null` only when the board row is genuinely absent.

## 6. Independent units (for the execution DAG)

(A) shared fallback components; (B) boundary/not-found files (needs A); (C) sonner + hook
toasts; (D) notification-insert checks; (E) membership checks; (F) `getBoardPayload` checks.
D and E touch `src/lib/boards/actions.ts` → serialized. All else disjoint.

## 7. Open questions / decisions taken (non-interactive scoping)

- **D1 — Toast lib:** none present; **add `sonner`** rather than growing the ad-hoc inline-banner
  pattern to ~20 call sites. Existing inline `role="alert"` surfaces are kept (no double feedback).
- **D2 — Boundary topology:** root + `(app)` + 5 named segments, all thin wrappers over one
  shared component. `settings`/`workload`/`admin` ride the catch-alls; no `global-error.tsx`.
- **D3 — Not-found topology:** root 404 + the three dynamic segments from the brief only.
- **D4 — Notification failures log, don't fail the action** (primary write already succeeded).
- **D5 — Access levels:** delete = owner-only; duplicate = any member; non-member sees
  "Board not found." (no existence leak).
- **D6 — F5 scope widened** from the mirror reads to all reads in `getBoardPayload` (same
  file/pattern; a silently-empty board is the worst failure mode in the app).
- **D7 — Server-thrown error messages are generic in prod** (Next strips messages, keeps
  `digest`) — fallback copy doesn't depend on `error.message`; digest is displayed for support.
