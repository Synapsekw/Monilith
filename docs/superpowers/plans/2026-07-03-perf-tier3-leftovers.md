# Perf Tier-3 Leftovers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement task-by-task. Steps use checkbox
> (`- [ ]`) syntax. Each task is TDD: write the failing test first, then the change.

**Goal:** Land the six deferred tier-3 perf items from
`vault/sessions/2026-07-02-1902-perf-pass-four-parallel-worktrees.md` with tests, honoring the
AGENTS.md invariants.

**Spec:** `docs/superpowers/specs/2026-07-03-perf-tier3-leftovers-design.md` — **read it first**;
it contains the verified Next.js 16 API facts and the per-item gap analysis that make several of
these tasks smaller (or subtler) than they look.

**Tech stack:** Next.js 16.2.9 (`cacheComponents: true`), React 19, Tailwind v4, Supabase,
Vitest + Testing Library.

## Global constraints

- **This is NOT the Next.js in your training data.** Re-read the relevant `node_modules/next/dist/docs/`
  guide before touching any Next API. The spec quotes the load-bearing lines; trust it over memory.
- **Server Components by default; Server Actions for mutations.** No task adds a client mutation
  path outside the existing Server Actions.
- **Bounded/indexed hot-path reads.** Task F is specifically about this; do not regress it elsewhere.
- **pulse-ui tokens** for any visual change (C, and any skeleton added in A) — no raw Tailwind
  colors. Load the `pulse-ui` skill before UI work.
- **Tests written AND executed.** A task is done only when
  `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass.
- **Commit hygiene:** stage **by path**, never `git add -A`. Author identity is pinned by
  `start-task.sh` (`Danijel Jovanovic <info@synapse-solutions.ai>`) — do not override. Lowercase
  conventional subject after `type(scope):`, descriptive body + Co-Authored-By trailer.
- **`next.config.ts` is a contended file** (Tasks C and D). Honor the DAG — never run C and D in
  parallel worktrees.

---

### Task A — `unstable_instant` on `(app)` page segments

**Files:**

- Modify: `src/app/(app)/boards/[boardId]/page.tsx`, `dashboards/[dashboardId]/page.tsx`,
  `goals/page.tsx`, `portfolios/[portfolioId]/page.tsx`, `settings/page.tsx`, `time/page.tsx`,
  `workload/page.tsx` (add `export const unstable_instant = { prefetch: "static" }`)
- Create: `src/app/(app)/dashboards/loading.tsx`, `src/app/(app)/portfolios/loading.tsx`
  (+ their trivial render tests), then add the export to `dashboards/page.tsx` /
  `portfolios/page.tsx`
- Decide (comment, don't contort): `src/app/(app)/boards/page.tsx` (redirect-only dispatcher) —
  keep `unstable_instant = false` with a one-line reason, or omit
- Reference only (do not edit its intent): `src/app/(app)/layout.tsx` already has
  `unstable_instant = false` with the prescribing comment; `src/app/landing/page.tsx` is the
  `<Suspense>`-inner-async-component template if a page still flags

**Interfaces:**

- Consumes: `cacheComponents: true` (already in `next.config.ts`); existing `loading.tsx`
  boundaries and `*Skeleton` components (`DashboardCanvasSkeleton`, `PortfolioGridSkeleton`,
  `GoalTreeSkeleton`, `TimeCardSkeleton`, `WorkloadGridSkeleton`)
- Produces: **nothing consumed by other tasks** (independent). Output is build-validated instant
  shells.

**Approach:** This is validation-driven. Enable the export on one route, run `pnpm build`, read
what the validator says, satisfy it (usually: the route already streams behind its `loading.tsx`
and passes; if not, wrap the dynamic read in an explicit `<Suspense fallback={<Skeleton/>}>` per
the landing template). Repeat per route. For the two index routes lacking a `loading.tsx`, add one
first. Do **not** force the redirect-only `boards/page.tsx` to satisfy shell validation.

- [ ] **Step 1 (test-first):** For each new `loading.tsx`, add a render smoke test mirroring
      existing `*Skeleton.test.tsx`. For pages, rely on the build-validation gate + existing
      `page.test.tsx` renders where present; add a render smoke only where none exists and the file
      is easily testable.
- [ ] **Step 2:** Add `export const unstable_instant = { prefetch: "static" }` route-by-route,
      running `pnpm build` after each to catch validation failures early. Add the two `loading.tsx`
      files before enabling their pages.
- [ ] **Step 3:** Resolve any flagged page by wrapping the cookie/data read in a `<Suspense>`
      inner-component (landing template) — NOT by removing the export.
- [ ] **Step 4:** Gates. `pnpm build` green is the primary evidence; `pnpm dev`-load each route,
      confirm no error overlay. Record which routes are `{ prefetch: "static" }` vs exempted `false`
      and why, in the closing note.

**Budget:** No new reads; in-page interactions already 0-refetch. Runtime behavior unchanged.

---

### Task B — Landing WebGL deferral

**Files:**

- Modify: `src/components/landing/monolith-scene.tsx` (import `LightRays` via `next/dynamic`,
  `ssr: false`, idle-deferred)
- Possibly modify: `src/components/landing/light-rays.tsx` (only if a named→default export shim is
  needed for `dynamic()`; keep the GLSL and logic verbatim)
- Test: extend `src/components/landing/light-rays.test.tsx` and/or add
  `src/components/landing/monolith-scene.test.tsx`

**Interfaces:**

- Consumes: existing `LightRays` component + `LightRaysProps`; the `next/dynamic` pattern from
  `src/components/boards/BoardViews.tsx` (`dynamic(() => import(...), { ssr: false, loading })`)
- Produces: nothing consumed by other tasks (independent)

**Approach:** Replace the static `import { LightRays }` in `monolith-scene.tsx` with
`const LightRays = dynamic(() => import("./light-rays").then(m => m.LightRays), { ssr: false })`.
The backdrop is `aria-hidden` decoration, so no `loading` fallback is needed (empty is fine) — the
hero text/CTA render immediately and the WebGL chunk streams in after. `ssr: false` is safe:
`light-rays.tsx` already `try/catch`es renderer construction and handles reduced-motion. If a
further idle defer is wanted, gate the dynamic mount behind a `useEffect`+`requestIdleCallback`
flag so the chunk is fetched at idle, not on mount — keep this minimal.

- [ ] **Step 1 (test-first):** Add the source/behavior assertion — `monolith-scene.tsx` imports
      `LightRays` via `next/dynamic` with `ssr: false` (mirror the `dynamic(` source-grep assertion in
      `BoardViews.test.tsx`), and the scene still renders `MONOLITH` + CTA children when the WebGL
      chunk is unresolved.
- [ ] **Step 2:** Implement the dynamic import; keep `light-rays.tsx` logic byte-identical.
- [ ] **Step 3:** Gates. Confirm `light-rays.test.tsx` still passes (SSR/jsdom degrade path intact).

**Budget:** Removes `ogl` from the landing initial client bundle; first paint no longer blocks on
the WebGL chunk. No data reads.

---

### Task C — `next/image` + dimensions for avatars ⚠ shares `next.config.ts` with D

**Files:**

- Modify: `src/components/boards/presence/PresenceAvatarStack.tsx` (`AvatarChip`),
  `src/components/boards/cells/created.tsx` (`CreatedByCell`)
- Modify: `next.config.ts` (add `images.remotePatterns` for the Supabase storage host)
- Test: extend `src/components/boards/presence/PresenceAvatarStack.test.tsx`; add/extend a
  `created` test

**Interfaces:**

- Consumes: `next/image` (`Image`), `profiles.avatar_url` values (Supabase Storage public URLs +
  possibly OAuth-provider hosts)
- Produces (D depends on this): the `next.config.ts` now contains an `images` block. **D must
  rebase onto C's `next.config.ts` and add its keys alongside `images`, not replace the file.**

**Approach (per spec design decision):** Use `<Image>` with explicit `width`/`height` matching the
avatar box (28px for `PresenceAvatarStack` `size-7`; 20px for `created` `size-5`) and
**`unoptimized`**, so arbitrary avatar hosts (Supabase + OAuth) keep working with no host
allowlist dependency. Remove the `no-img-element` eslint-disable lines. Still add a
`remotePatterns` entry for the Supabase storage host (subdomain-wildcard hostname, e.g.
`{ protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" }`) so a
future switch to optimized avatars needs only dropping `unoptimized`. Keep the initials fallback
for null `avatar_url`. No `sizes` needed at fixed size. Use pulse-ui tokens for the wrapper span
(unchanged).

- [ ] **Step 1 (test-first):** Assert avatar renders through `next/image` with non-empty
      `width`/`height` (mock `next/image` → plain `<img>` passing props through, standard jsdom
      pattern), and initials fallback still renders when `avatarUrl` is null, in both components.
- [ ] **Step 2:** Swap the raw `<img>` for `<Image ... width height unoptimized />`; remove the
      eslint-disable comments. Add the `images.remotePatterns` block to `next.config.ts`.
- [ ] **Step 3:** Gates. Confirm no CLS regression visually; `pnpm lint` (no dangling
      eslint-disable), `pnpm build`.

**Budget:** No new reads; removes avatar layout shift.

---

### Task D — Bundle analyzer + `optimizePackageImports` ⚠ shares `next.config.ts` with C (runs AFTER C)

**Files:**

- Modify: `package.json` (add `@next/bundle-analyzer` to `devDependencies`; `pnpm install`)
- Modify: `next.config.ts` (wrap export in `withBundleAnalyzer`; add
  `experimental.optimizePackageImports: ["radix-ui"]`)
- Test: lightweight `next.config` assertion (importable `.ts`) + build gates

**Interfaces:**

- Consumes: C's `next.config.ts` (with the `images` block) — **rebase onto C first**; add
  `experimental` + the `withBundleAnalyzer` wrapper without disturbing `images`, `cacheComponents`,
  `cacheLife`, `turbopack`, `devIndicators`
- Produces: nothing consumed downstream

**Approach:** `const withBundleAnalyzer = require("@next/bundle-analyzer")({ enabled:
process.env.ANALYZE === "true" })` (or ESM interop equivalent that typechecks under this repo's
`NextConfig` typing) and `export default withBundleAnalyzer(nextConfig)`. Add
`experimental: { optimizePackageImports: ["radix-ui"] }` to `nextConfig` (`lucide-react`/`recharts`
are already default-optimized — do not add them). The analyzer must stay inert unless
`ANALYZE=true`.

- [ ] **Step 1 (test-first):** Assert `next.config` still exports a valid config object and that
      it carries `experimental.optimizePackageImports` including `"radix-ui"` (import the `.ts` in
      Vitest; if wrapping makes it a function-of-config, assert on the pre-wrap `nextConfig` or a small
      extracted constant).
- [ ] **Step 2:** Add the devDep (`pnpm install`), wrap the export, add the experimental key.
- [ ] **Step 3:** Gates. `pnpm build` green (analyzer inert); `ANALYZE=true pnpm build` emits the
      report without error (manual confirmation, note it in the closing message).

**Budget:** Build-time only; no runtime data path.

---

### Task E — TimeCard optimistic totals

**Files:**

- Modify: `src/components/time/TimeCard.tsx`
- Test: add `src/components/time/TimeCard.test.tsx` (only `TimeCell.test.tsx` exists today)

**Interfaces:**

- Consumes: `TimeCardData`/`TimeCardRow` (`@/lib/time/types`), existing `upsertTimeAllocation` /
  `deleteTimeAllocation` actions, `formatHours` (`@/lib/time/hours`), React 19 `useOptimistic`
- Produces: nothing consumed by other tasks (independent, single file)

**Approach:** Introduce an optimistic overlay of pending `(rowKey, day) → manualSecs` edits and
apply it when computing `row.totalSecs`, `dayTotals`, and `weekTotal`, so a committed edit updates
all three synchronously and reconciles when `router.refresh()` lands. Use React 19 `useOptimistic`
seeded from `data.rows`, dispatched inside the existing `startNav` transition in `commitCell` /
`clearCell` (clear = optimistic 0). Do not add any server round-trip — the Server Action already
runs; this is a pure client overlay over already-loaded data. Keep the `TimeCell`'s own local input
state as-is (it already resyncs on server change); the fix is at the totals layer.

- [ ] **Step 1 (test-first):** `TimeCard.test.tsx` — render with fixture rows; mock the time
      actions (resolve on a controllable promise). Commit a cell edit; assert the row total, daily
      total, and week total reflect the new value **before** the action resolves; then resolve + rerun
      with updated `data` and assert reconciliation. Cover clear-to-zero.
- [ ] **Step 2:** Implement the `useOptimistic` overlay; fold it into the three total computations.
- [ ] **Step 3:** Gates.

**Budget:** 0 extra server round-trips (client overlay over loaded data); the only server call is
the pre-existing mutation.

---

### Task F — Bound `items`/`cell_values` payload reads (widest-reaching)

**Files:**

- Modify: `src/lib/boards/queries.ts` (`getBoardPayload`)
- Conditionally modify (only if column-narrowing is done): `BoardPayload` types in `queries.ts`
  and every consumer of `payload.items` / `payload.cellValues` (board cache, cells, mirror/
  relation/rollup logic) — audit first
- Test: extend/add coverage for `getBoardPayload` bounds

**Interfaces:**

- Consumes: existing `board_id` indexes on `items` / `cell_values`; the `BoardPayload` contract
- Produces: nothing consumed by A–E (independent). **Widest blast radius if column-narrowing is
  attempted** — hence run solo, not co-scheduled with another risky change.

**Approach (committed scope = bounding):** Add explicit `.limit(...)` to the `items` and
`cell_values` reads (proposed `items` 5000, `cell_values` 20000 — confirm against real board
sizes; err large), each with the same "documented follow-up: server-side aggregate if a board
exceeds this" comment the sibling reads carry. **Conditional extension = column-narrowing:** only
after auditing which `items`/`cell_values` columns consumers actually read; if the audit finds
unused wide columns (e.g. a heavy `cell_values` payload column), narrow the `.select(...)` to the
used set, change `BoardPayload.items`/`cellValues` to `Pick<…>`, and ripple through consumers
(typecheck is the ripple gate). If every column is used, skip narrowing for that table — bounding
alone is the deliverable. Do not let narrowing balloon the task; bounding is the floor.

- [ ] **Step 1 (test-first):** Assert the `items` and `cell_values` queries carry a `.limit(...)`
      (mock the Supabase builder as existing `queries` tests do, or assert on the query chain). If
      narrowing: add a shape assertion for the narrowed types.
- [ ] **Step 2:** Add the limits. If (and only if) the consumer audit justifies it, narrow the
      selects + types and fix consumers.
- [ ] **Step 3:** Gates — `pnpm typecheck` is the critical ripple gate; then lint/test/build.

**Budget:** Keeps the hot-path board read bounded over the indexed `board_id`; strictly reduces
worst-case payload. No behavior change for real-sized boards.

---

## Execution DAG

**Dependency edges** (from the `Produces`/`Consumes` blocks):

- A: no deps.
- B: no deps.
- C: no deps. Produces the `images` block in `next.config.ts`.
- D: **depends on C** (shared `next.config.ts`; D rebases onto C and adds keys alongside `images`).
- E: no deps.
- F: no deps.

```
A ─┐
B ─┤
E ─┼─ (all independent, wave 1)
F ─┤
C ─┴─▶ D   (C then D; shared next.config.ts)
```

**Parallel batches (waves of concurrent agents):**

- **Batch 1 (5 agents, parallel):** **A, B, C, E, F.** No two share a file. Each runs in its own
  git worktree (`superpowers:using-git-worktrees`) off `develop` and merges independently via
  `finish-task.sh`. C is included here (nothing else in wave 1 touches `next.config.ts`).
- **Batch 2 (1 agent, after C merges):** **D.** Start D only once C is merged to `develop`; D's
  worktree is cut from (or rebased onto) the post-C `develop` so it edits the `next.config.ts` that
  already contains C's `images` block. Running D concurrently with C would conflict on
  `next.config.ts`.

**Critical path:** C → D (two waves). Everything else (A, B, E, F) completes within wave 1, so the
wall-clock floor is `time(C) + time(D)` — both are small config-plus-tests tasks.

**Alternative (if you prefer one wave):** combine C and D into a single task/worktree that owns
`next.config.ts` end-to-end (avatars + images + analyzer + optimizePackageImports). This collapses
the DAG to a single 5-agent batch (A, B, CD, E, F) at the cost of a slightly larger combined task.
Either is acceptable; the two-wave split keeps tasks minimal and is the default recommendation.

**Dispatch:** For Batch 1 use `superpowers:dispatching-parallel-agents` (or parallel
`subagent-driven-development` subagents), one worktree per task. Do not one-at-a-time a batch of
independent tasks.
