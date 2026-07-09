# Boards Trash follow-ups — Design Spec

**Date:** 2026-07-09 · **Size:** S · **Branch:** `task/trash-followups`

Two small, independent-in-intent follow-ups on the existing boards "Trash" (archived
boards) surface at `/boards`:

- **(a) Top-level nav link to the Trash.** The workspace Trash lives on `/boards` and is
  reached via the `#archived` hash. Add a top-level sidebar link that navigates there.
- **(b) Surface `archived_by`.** In the Trash list, render each row as
  "archived by {name}, {timeAgo}". The `archived_by` column already exists, is written on
  archive / cleared on restore, and is typed in `database.types.ts` — this is purely a
  read + resolve-name + render change.

This is a read/render + navigation change. No schema migration, no new mutation, no new
Server Action.

---

## 1. Context verified against the live worktree

- **`archived_by` is populated.** `src/lib/boards/actions.ts:605` writes
  `archived_by: user?.id ?? null` on archive; the restore path (line 626) sets
  `archived_at: null, archived_by: null`. Board archive is **owner-only**, and
  `getArchivedBoards()` already scopes to `created_by = me`, so in practice `archived_by`
  resolves to the current user today. We still resolve the name generically (future-proof,
  and correct if an admin/collaborator archive path is ever added), falling back cleanly
  when null.
- **`boards.archived_by` is typed** (`string | null`) in
  `src/types/database.types.ts` (boards Row). No `pnpm db:types` regeneration needed.
- **Name-resolution pattern already exists** in `src/lib/boards/queries.ts`
  (`listSharedBoards`, ~lines 84–89): collect distinct ids → one
  `profiles.select("id, full_name").in("id", ids)` query → build a `Map` → look up. Reuse it
  verbatim.
- **`timeAgo(iso)` helper** lives in `src/lib/boards/automation-runs.ts` and is already used
  by `src/components/boards/trash/BoardTrashDialog.tsx` for the phrasing
  `· archived ${timeAgo(archivedAt)}`. Reuse it for wording consistency.
- **No `#archived` anchor exists yet.** `ArchivedBoardsSection.tsx` renders a
  `<section className="bg-surface rounded-md border">` with no `id`. A hash target must be
  added for the nav link to land.
- **The Trash list is collapsible and defaults closed** (`ArchivedBoardsSection`,
  `useState(false)`); landing on `#archived` on a collapsed header is a poor experience, so
  auto-expand on hash is part of the design (§4).
- **Mobile nav does not consume the sidebar `NavLink` consts** (`mobile-nav.tsx` /
  `mobile-nav-data.tsx` are separate) — no mirror edit required.

---

## 2. Sub-task (a): top-level nav link

**File:** `src/components/shell/sidebar-nav.tsx` only (plus the `id` anchor in
sub-task (b)'s file — see §3, the shared file).

The sidebar renders two ways:

- **Collapsed rail** iterates `ALL_LINKS` (a flat `NavLink[]`) as icon-only `CollapsedLink`s.
- **Expanded** renders groups individually: a standalone `HOME` link, then the `Planning`
  `NavSection`, `BoardsNav`, `DashboardsNav`, and the `Personal` `NavSection`.

**Design:**

- Add a `TRASH` const: `{ label: "Trash", href: "/boards#archived", icon: Trash2 }`
  (`Trash2` from `lucide-react` — reads unambiguously as "Trash" at a glance; the section's
  own header uses `ArchiveX`, but the nav label is the clearer signifier).
- Append `TRASH` to `ALL_LINKS` so it appears at the **bottom** of the collapsed rail.
- In expanded mode, render a standalone `<ExpandedLink item={TRASH} … />` at the **bottom**
  of the nav (after `Personal`), so placement matches the collapsed rail. Trash belongs at
  the bottom, wastebasket-style.

**Active state:** `useActive()` compares against `usePathname()`, which strips the hash, so
`/boards#archived` never matches — Trash never shows an active highlight. That is acceptable
and arguably correct for a jump target (a size-S non-goal to highlight it; see §6).

## 3. Sub-task (b): surface `archived_by`

Two files own the data and the render; a third is a type-only passthrough.

### 3.1 `src/lib/boards/trash-queries.ts` — `getArchivedBoards()`

- Add `archived_by` to the select list (`"id, name, workspace_id, archived_at, archived_by"`).
- After the boards read, collect distinct non-null `archived_by` ids, run **one**
  `profiles.select("id, full_name").in("id", ids)` query, build a `Map<string, string|null>`,
  and attach `archived_by_name: string | null` to each row. Skip the profiles query entirely
  when there are no non-null ids (0 extra round-trips in that case).
- Widen the return type from the current `Pick<…>` to an explicit exported shape that adds
  `archived_by` and `archived_by_name`.

### 3.2 `src/components/boards/ArchivedBoardsSection.tsx`

- Extend the `ArchivedBoard` type (lines ~22–27) with `archived_by: string | null` and
  `archived_by_name: string | null`.
- In the row markup (lines ~116–118), replace the single-line name span with a two-line cell
  (name + muted caption), mirroring `BoardTrashDialog`'s `TrashRow`:
  - Name: `truncate text-sm` (unchanged emphasis).
  - Caption: `text-muted-foreground text-xs`, content built as:
    - if `archived_at` and `archived_by_name`: `archived by {name}, {timeAgo(archived_at)}`
    - if `archived_at` only (name null): `archived {timeAgo(archived_at)}`
    - if no `archived_at`: caption omitted.
- Also add the **hash target** here (serves sub-task (a)): `id="archived"` and
  `scroll-mt-*` on the `<section>` so the browser anchors to it below any sticky chrome.

### 3.3 `src/app/(app)/boards/page.tsx`

- Type-only passthrough. `getArchivedBoards()` already feeds `ArchivedBoardsSection`; the
  wider row shape flows through unchanged. Verify no local `ArchivedBoard`-shaped annotation
  needs widening.

## 4. Auto-expand on `#archived`

`ArchivedBoardsSection` starts collapsed. Add a small client effect so a hash landing opens
the list:

- On mount: `if (window.location.hash === "#archived") setOpen(true)`.
- Add a `hashchange` listener (cleaned up on unmount) so clicking "Trash" while already on
  `/boards` (a same-page hash change that does not remount the RSC) also expands it.

This is ~6 lines and is the one UX judgment call; it is included because otherwise the hash
lands on a collapsed header showing nothing. Reduced-motion is respected globally
(`globals.css`); native hash scroll is instantaneous, no custom animation.

---

## 5. Data-fetching budget (working-agreement #5)

- **Nav link (a):** clicking "Trash" is a legitimate **page navigation** to the `/boards`
  route (not an in-page toggle over already-loaded data), so an RSC navigation via `<Link>`
  is correct — the "0 new round-trips" rule targets in-page view toggles, not real page
  navs. When the user is **already on `/boards`** and clicks Trash, it is a same-pathname
  hash-only change: Next.js does **not** re-run the RSC (hash/scroll only) — 0 round-trips,
  handled by the `hashchange` listener in §4.
- **`archived_by` surfacing (b):** `archived_by` is added to the **existing**
  `getArchivedBoards()` select — **0 extra round-trips** for the column. Name resolution adds
  **exactly one** `profiles` query, and only when ≥1 non-null `archived_by` exists. This runs
  on the `/boards` **cold page load** (not a hot board/list read), is **bounded** (the boards
  read is already `limit 200`; distinct owner ids ≤ that), and served by the `profiles` PK.
  This mirrors `listSharedBoards`, which already does the same one-extra-query resolve.
- **First paint vs interaction:** everything is server-rendered on first paint of `/boards`.
  Expand/collapse of the section and the auto-open effect are pure **client state** — no
  server round-trip. Restore/purge remain the existing Server Actions (unchanged).

---

## 6. Non-goals (YAGNI)

- No active-state highlight for the Trash nav link (hash targets don't participate in
  pathname active matching; not worth special-casing at size S).
- No mobile-nav entry (mobile nav doesn't consume these consts).
- No per-board trash dialog changes (`BoardTrashDialog` already shows `archived …`; this spec
  is scoped to the **workspace** archived-boards list).
- No schema/migration/types work (`archived_by` already exists and is typed).
- No "archived by you" special-casing — resolve the display name generically.

---

## 7. Testing strategy

Unit tests only (Vitest + Testing Library); no integration/DB test needed (pure read/render).

1. **`src/lib/boards/trash-queries.test.ts`** (extend): assert `getArchivedBoards()` selects
   `archived_by`, issues **one** `profiles` lookup keyed by the distinct `archived_by` ids,
   and attaches the resolved `archived_by_name`; assert **no** profiles query when all
   `archived_by` are null. **Test-harness note:** the existing mock's `then` returns
   `calls.rows` for _every_ table and the chain has **no `in()`** method — extend the mock to
   (i) add `in()`, and (ii) return board rows vs profile rows based on the captured table name
   (`calls.from`). This is the only non-trivial test wiring.
2. **`src/components/boards/ArchivedBoardsSection.test.tsx`** (extend): with fixtures carrying
   `archived_by`/`archived_by_name`/`archived_at`, assert the caption renders
   "archived by {name}," + a relative time; assert the null-name fallback renders
   "archived {timeAgo}"; assert the section carries `id="archived"`.
3. **`src/components/shell/sidebar-nav.test.tsx`** (extend): assert a "Trash" link with
   `href="/boards#archived"` renders in expanded mode, and an icon link appears in the
   collapsed rail.
4. Optional: an auto-open assertion (set `window.location.hash = "#archived"`, render, expect
   the list expanded).

**Gates (must all pass):** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

## 8. Independent units / parallelization (working-agreement #6)

The two sub-tasks read as independent in intent, but they **share a file**:
`ArchivedBoardsSection.tsx` is edited by **both** — sub-task (b) for the caption/type, and
sub-task (a) for the `id="archived"` anchor + auto-open. Because of that shared file they are
**one sequential unit**, not a parallel batch. The concrete edit set:

- `sidebar-nav.tsx` (a only)
- `trash-queries.ts`, `page.tsx` (b only)
- `ArchivedBoardsSection.tsx` (a + b) ← the serialization point

Given size S and the shared file, this is a single sequential thread of work (the plan splits
it into two ordered tasks purely for reviewability). Full DAG in the plan.

---

## Decisions (assumptions — flag on review if any is wrong)

1. Nav icon `Trash2`, label "Trash", placed at the **bottom** of both rail and expanded nav.
2. Caption wording matches `BoardTrashDialog`: "archived by {name}, {timeAgo}" with a
   name-less fallback of "archived {timeAgo}".
3. Auto-expand the collapsed list on the `#archived` hash (mount + `hashchange`).
4. Resolve `archived_by` → display name generically via the `profiles` pattern (no
   "you" special-case), even though today it is always the current user.
5. No active-state highlight for the Trash link.
