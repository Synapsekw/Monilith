# Perf Tier-3 Leftovers — Design

**Status:** spec written, awaiting review
**Date:** 2026-07-03
**Source:** `vault/sessions/2026-07-02-1902-perf-pass-four-parallel-worktrees.md` → "Audit tier-3 items not built this session"

## Summary

Six deferred perf-audit items, each small and mostly independent. They are grouped
here into one spec because they share a theme (last-mile perceived-speed and payload
hygiene) and a parallelization opportunity, not because they share code. Each ships
with tests written and executed, and honors the AGENTS.md invariants (Server Components
default, bounded/indexed hot-path reads, Zod at boundaries where a boundary is touched).

The six items:

| ID  | Item                                        | Primary files                                                    |
| --- | ------------------------------------------- | ---------------------------------------------------------------- |
| A   | `unstable_instant` on `(app)` page segments | `src/app/(app)/**/page.tsx` (+ `loading.tsx` for indexes)        |
| B   | Landing WebGL deferral                      | `src/components/landing/monolith-scene.tsx`, `light-rays.tsx`    |
| C   | `next/image` + dimensions for avatars       | `PresenceAvatarStack.tsx`, `cells/created.tsx`, `next.config.ts` |
| D   | Bundle analyzer + `optimizePackageImports`  | `next.config.ts`, `package.json`                                 |
| E   | TimeCard optimistic totals                  | `src/components/time/TimeCard.tsx`                               |
| F   | Bound `items`/`cell_values` payload reads   | `src/lib/boards/queries.ts` (+ type consumers)                   |

## Verified Next.js 16 API facts (read from `node_modules/next/dist/docs/`)

This is Next.js 16.2.9 — the following were confirmed against the bundled docs, not
assumed from training data:

- **`unstable_instant`** is a **route segment config export** (`export const unstable_instant = …`),
  NOT an import or function call. Union type `InstantConfig`: `false`
  | `{ prefetch: 'static'; from?: string[]; unstable_disableValidation?: boolean }`
  | `{ prefetch: 'runtime'; samples; … }`. It **requires `cacheComponents: true`** (this repo
  has it), **throws in Client Components**, and only **validates** (dev-time on page load/HMR +
  build-time) that the caching/Suspense structure yields an instant static shell at every entry
  point. It changes no runtime output. Under `prefetch: 'static'`, **components that read cookies
  or headers are treated as dynamic and must be behind a `<Suspense>` boundary** or the
  validation fails. Fix for a flagged read: cache it with `use cache` or wrap it in Suspense.
  `unstable_instant = false` exempts a segment. It **does not conflict with `use cache`** — they
  are designed to compose.
- **`next/image`**: `import Image from 'next/image'`. `src` + `alt` required; `width`+`height`
  required unless statically imported or `fill`. Next 16 **deprecated `priority` in favor of
  `preload`**, and `qualities` now defaults to `[75]`. Remote hosts must be allowlisted via
  `images.remotePatterns` (array of `{ protocol, hostname, port, pathname, search }` or `URL`
  objects; `**` wildcard for trailing path / leading subdomain). `unoptimized` (per-image or
  `images.unoptimized`) serves the source as-is with no allowlist requirement.
- **`experimental.optimizePackageImports`**: string array under `experimental`. `"radix-ui"`
  is a valid entry and is **NOT** in the default-optimized set (defaults include `lucide-react`,
  `recharts`, etc. — both already dependencies here, already optimized by default).
- **`@next/bundle-analyzer`**: `withBundleAnalyzer({ enabled: process.env.ANALYZE === 'true' })`
  wraps the exported config; run with `ANALYZE=true pnpm build`.

## Current-state findings (the gap analysis)

**A — `unstable_instant`.** `src/app/(app)/layout.tsx` already declares
`export const unstable_instant = false` with a comment that prescribes this exact task:
_"cookie-bound page-load entry is dynamic; sibling client-nav is validated via
`{ prefetch: 'static' }` on the page segments."_ So the intended design already exists on
paper. **Every** `(app)` page reads auth cookies directly in its body (`requireUser()` /
`getUser()` / `getUserOrgs()`), i.e. each page body is dynamic. **7 routes already have a
`loading.tsx`** (`boards/[boardId]`, `dashboards/[dashboardId]`, `goals`,
`portfolios/[portfolioId]`, `settings`, `time`, `workload`) — a `loading.tsx` creates the
route-level Suspense boundary that lets a dynamic page body stream behind a static shell, which
is what `{ prefetch: 'static' }` validation needs. **3 index routes have no `loading.tsx`**:
`boards/page.tsx` (a pure `redirect()` dispatcher — no shell rendered), `dashboards/page.tsx`,
`portfolios/page.tsx`. These need a decision, not a blind add.

Consequence: A is **not** a mechanical "add one export × 10." It is "opt each segment into
validation, then satisfy the validator." Expected outcomes per segment:

- The 7 routes with a `loading.tsx`: add `export const unstable_instant = { prefetch: 'static' }`;
  they should validate because their dynamic body already streams behind the `loading.tsx`
  boundary. If any still flags, wrap the offending read in an explicit inner `<Suspense>`
  (the `src/app/landing/page.tsx` `LandingInner`-behind-`<Suspense>` pattern is the template).
- `dashboards/page.tsx`, `portfolios/page.tsx`: add a matching `loading.tsx` (reusing the
  existing `*GridSkeleton`/`*Skeleton` components), then the `{ prefetch: 'static' }` export.
- `boards/page.tsx`: it renders no shell (redirect-only). Leave it `unstable_instant = false`
  with a one-line comment, OR omit the export. Do **not** contort a redirect dispatcher to
  satisfy shell validation.

The gate for A is **`pnpm build` passing** (validation runs at build) plus a clean `pnpm dev`
HMR load of each route with no overlay error. This is a validation/config task with **zero
runtime behavior change** — there is no new user-facing behavior; correctness = the build is
green with the exports in place.

**B — Landing WebGL deferral.** `light-rays.tsx` is a `"use client"` component that
imports `ogl` (WebGL) at module top and constructs a `Renderer` in `useEffect`. It is imported
statically by `monolith-scene.tsx` (also `"use client"`), so `ogl` ships in the landing route's
initial client bundle even though the canvas only matters after paint and is purely decorative
(`aria-hidden`). Goal: keep `ogl` out of the critical path — load `LightRays` via
`next/dynamic({ ssr: false })` (the established repo pattern in `BoardViews.tsx` /
`DashboardWidget.tsx`) and defer the import to idle so first paint of the hero text/CTA is not
blocked by the WebGL chunk. The component already self-guards SSR/jsdom (renderer construction
is `try/catch`ed) and reduced-motion, so `ssr: false` is safe and loses nothing.

**C — Avatars via `next/image`.** Raw `<img>` avatar sites: `PresenceAvatarStack.tsx`
(`AvatarChip`, `size-7` = 28px) and `cells/created.tsx` (`CreatedByCell`, `size-5` = 20px).
Both render `profiles.avatar_url`. Non-avatar `<img>` sites (`FilesCell`, `AttachmentCard`,
`FilePreviewLightbox`, `apple-icon`) are **out of scope** — those are user file attachments from
arbitrary hosts/sizes, a different concern. Avatar URLs are Supabase Storage public URLs
(`https://<project-ref>.supabase.co/storage/v1/object/public/avatars/…`); the project ref
differs dev↔prod, so the `remotePatterns` host must be a subdomain wildcard. **Design decision:**
OAuth providers (e.g. Google) can also populate `avatar_url` with non-Supabase hosts, so a strict
Supabase-only allowlist would break those avatars. Use `next/image` with explicit `width`/`height`
(the real win: no layout shift, correct intrinsic sizing) **and `unoptimized`** on the avatar
images, so no host allowlist is required and arbitrary avatar hosts keep working. Still add a
`remotePatterns` entry for the Supabase storage host (so a later switch to optimized avatars is
one-flag away and any optimized avatar path is covered), but do not depend on it for correctness.
`sizes` is unnecessary at fixed 20–28px. This keeps the `no-img-element` eslint-disable removals
honest and eliminates the CLS the raw `<img>` causes.

**D — Bundle analyzer + `optimizePackageImports`.** Add `@next/bundle-analyzer` as a
devDependency and wrap `next.config.ts`'s export in `withBundleAnalyzer({ enabled: ANALYZE ===
'true' })`; add `experimental: { optimizePackageImports: ["radix-ui"] }`. `radix-ui` is a single
barrel dependency (`radix-ui@^1.5.0`) used across the shadcn `ui/` primitives — barrel-optimizing
it trims the imported surface. `lucide-react` and `recharts` are already optimized by default (no
action). The analyzer is a dev tool (opt-in via `ANALYZE=true`), so it must be inert in normal
builds. **C and D both edit `next.config.ts`** — see the DAG (they must not run simultaneously in
separate worktrees).

**E — TimeCard optimistic totals.** In `TimeCard.tsx`, `dayTotals`/`weekTotal` (footer) and
each `row.totalSecs` are computed from **server** data (`data.rows`). On a cell commit,
`commitCell` fires the Server Action then `router.refresh()`; the `TimeCell` input shows the new
value locally, but the **footer totals and row totals lag** until the refresh round-trips — a
visible inconsistency (edited cell says 3h, daily total still shows the old sum for ~a request).
Goal: fold an optimistic overlay of pending cell edits into `dayTotals`, `weekTotal`, and
`row.totalSecs` so they update instantly on commit and reconcile when the server value lands. Use
React 19 `useOptimistic` keyed by `(rowKey, day)` over the server rows, applied inside the
existing `startNav` transition (an in-page optimistic update — **0 extra server round-trips**; the
Server Action already runs). Clearing a cell is the same overlay with a 0 value.

**F — Bound `items`/`cell_values` reads.** In `getBoardPayload` (`queries.ts`), the sibling
reads are bounded (`attachments` 200, `time_entries` 1000, `relation_links` 2000, mirror cells 4000) **except `items` and `cell_values`, which are unbounded `.select("*")`** on the two
fastest-growing per-board tables. This violates the AGENTS.md invariant "no unbounded `select *`
on growing tables." Two sub-goals, in risk order:

1. **Bound (low risk, high value):** add explicit `.limit(...)` to the `items` and `cell_values`
   reads over their existing indexes (`board_id`), matching the documented first-paint budget of
   the other reads. Pick limits consistent with the board being a bounded first-paint read
   (proposed: `items` 5000, `cell_values` 20000 — large enough to be a non-event for real boards,
   bounded enough to cap a pathological one; final numbers set in the plan with the same
   "documented follow-up: server-side aggregate if exceeded" comment the other reads carry).
2. **Narrow columns (higher risk — the "ripple"):** replace `.select("*")` with an explicit
   column list. This is only safe after auditing every consumer of `payload.items` /
   `payload.cellValues` (the board cache, cells, mirror/relation/rollup logic) for which columns
   they actually read, then narrowing `BoardPayload.items`/`cellValues` from `Item[]`/`CellValue[]`
   to `Pick<…>` types and updating consumers. If the audit shows every column is used (plausible
   for `items`), narrowing yields nothing and is skipped for that table — bounding alone is the
   deliverable. The plan treats bounding as the committed scope and column-narrowing as a
   conditional, audit-gated extension so F cannot balloon.

## Performance & data-fetching budget (AGENTS.md #5)

- **A:** In-page interactions were already 0-refetch (History-API view state); this task only
  _proves_ the static shell is instant via build-time validation. No new reads.
- **B:** Removes `ogl` from the landing critical path; first paint no longer waits on the WebGL
  chunk. No data reads (landing is static + one auth check behind Suspense already).
- **C:** No new reads; removes avatar CLS.
- **E:** Optimistic totals are **client-only** over already-loaded data — 0 extra round-trips.
  The only server call is the pre-existing `upsertTimeAllocation`/`deleteTimeAllocation` action.
- **F:** Keeps the hot-path board read **bounded** over the **indexed** `board_id` column;
  strictly reduces worst-case payload.
- **D:** Build-time only; no runtime data path.

## Testing approach (per item — all written AND executed)

- **A:** Primary evidence is `pnpm build` green (validation is a build gate) + `pnpm dev` HMR
  load per route with no error overlay. Add/keep any `page.test.tsx` render smoke where one
  exists; new `loading.tsx` files get a trivial render test mirroring existing
  `*Skeleton.test.tsx`. Optional: a `@next/playwright` `instant()` smoke on one route (only if
  the e2e harness is cheap to extend — not required for the gate).
- **B:** Extend `light-rays.test.tsx` / add a `monolith-scene` test asserting `LightRays` is a
  `next/dynamic` import with `ssr: false` (same source-assertion style as
  `BoardViews.test.tsx` / `DashboardWidget.test.tsx`, which grep the compiled loader), and that
  the scene still renders its wordmark/CTA without the WebGL chunk resolved.
- **C:** Extend `PresenceAvatarStack.test.tsx` + add/extend a `created` test: assert avatar
  renders via `next/image` (a real `<img>` with non-empty `width`/`height` attributes) and that
  the initials fallback still shows when `avatarUrl` is null. Mock `next/image` to a plain `<img>`
  in jsdom (standard).
- **D:** `next.config` change is verified by `pnpm build` staying green and `ANALYZE=true pnpm
build` emitting the report without error. A tiny unit test can assert `next.config` exports a
  function-wrapped config and includes the `radix-ui` entry (config is a `.ts` module — importable
  in Vitest); keep it lightweight.
- **E:** New `TimeCard.test.tsx` (there is only `TimeCell.test.tsx` today): render with fixture
  rows, commit a cell edit, assert the daily total, week total, and row total reflect the new
  value **synchronously** (before the mocked action resolves), and that they reconcile to the
  server value after. Mock the time actions.
- **F:** Extend the existing `getBoardPayload` test coverage (or add one) asserting the `items`
  and `cell_values` queries carry a `.limit(...)`, and — if column-narrowing is done — that the
  returned shape still satisfies every consumer (typecheck is the ripple gate; add a shape
  assertion for the narrowed `Pick` types).

## Independent units (for the plan's Execution DAG)

- Fully independent (no shared files): **A**, **B**, **E**, **F**.
- **C** and **D** both edit `next.config.ts` → soft-coupled; must be serialized (or combined into
  one owner of that file). C also does component work; D is config-only.

The plan's Execution DAG section makes the batches explicit.
