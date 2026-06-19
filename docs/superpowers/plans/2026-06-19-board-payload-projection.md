# Board Payload Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the board's first-paint payload by projecting the `cell_values` read to only the three fields the client uses, with zero behavior change.

**Architecture:** Replace `select("*")` on the `cell_values` hot read with `select("item_id, column_id, value")`, and retype `CacheCellValue` to that projection so the compiler enforces no consumer depends on the dropped columns. All board views (Table/Kanban/Calendar/Timeline) and realtime already use only those three fields.

**Tech Stack:** Next.js 16 (RSC), Supabase JS client, TanStack Query, Vitest, Playwright.

## Global Constraints

- Boards expected ≤ ~200 items (~2,000 cell rows). No pagination/windowing in this plan — YAGNI at this scale.
- No behavior change. The compile of the narrowed type + existing test suites is the safety net.
- TypeScript strict; no `any`.
- `src/lib/boards/queries.ts` and `src/lib/boards/cache.ts` are being edited by a concurrent session in this shared checkout. **Do not start implementation until those edits land** (or implement in an isolated git worktree via `superpowers:using-git-worktrees`, then reconcile). Each step's `git add` lists exact files — never `git add -A` in this shared checkout.
- Verification suite for "done": `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. Note `develop` currently has unrelated red typecheck from the `call_webhook` automation work and the concurrent boards edits — judge this change by the `cell_values`/cache files being clean, not the global exit code.

---

### Task 1: Project `cell_values` to (item_id, column_id, value)

**Files:**

- Modify: `src/lib/boards/cache.ts:7` (retype `CacheCellValue`)
- Modify: `src/lib/boards/queries.ts:74` (narrow the select)
- Test: `src/lib/boards/cache.test.ts`

**Interfaces:**

- Produces: `CacheCellValue = Pick<Tables<"cell_values">, "item_id" | "column_id" | "value">`. Consumed by `buildCellMap`, `upsertCellValue`, `removeCellValue` (cache.ts), `use-board-realtime.ts` (`onCell`), and all view builders (`kanban.ts`, `calendar.ts`, `gantt.ts`, `BoardTable.tsx`). All already read only these three fields.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/boards/cache.test.ts` (near the existing cell-value tests). This constructs a cell value with ONLY the three projected fields — which does not compile against the current full-row `CacheCellValue`, so it fails at typecheck (the RED state for a type-narrowing refactor):

```ts
import { buildCellMap, cellKey, type CacheCellValue } from "./cache";

describe("CacheCellValue projection", () => {
  it("buildCellMap works from only item_id, column_id, value", () => {
    // A projected row — the shape returned by the narrowed select.
    const projected: CacheCellValue = {
      item_id: "i1",
      column_id: "c1",
      value: { text: "hi" },
    };
    const map = buildCellMap([projected]);
    expect(map.get(cellKey("i1", "c1"))).toEqual({ text: "hi" });
  });
});
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `npx tsc --noEmit 2>&1 | Select-String "cache.test.ts"`
Expected: a TS error on the `projected` literal — missing properties `id`, `org_id`, `board_id`, `created_at`, `updated_at` (current `CacheCellValue` is the full row).

- [ ] **Step 3: Narrow the cache type**

In `src/lib/boards/cache.ts`, replace line 7:

```ts
export type CacheCellValue = Pick<
  Tables<"cell_values">,
  "item_id" | "column_id" | "value"
>;
```

- [ ] **Step 4: Run typecheck + cache tests to verify green**

Run: `npx tsc --noEmit 2>&1 | Select-String -Pattern "boards/cache","boards/queries","use-board-realtime","kanban","calendar","gantt","BoardTable" `
Expected: no matches (these files compile under the narrowed type).
Run: `pnpm test --run src/lib/boards/cache.test.ts`
Expected: PASS (all cache tests, including the new projection test).

If any view builder or `BoardTable.tsx` now errors, it was reading a dropped column — that is the refactor surfacing a real coupling; stop and report rather than widening the type back.

- [ ] **Step 5: Narrow the select**

In `src/lib/boards/queries.ts`, change the `cell_values` read (currently line 74):

```ts
supabase.from("cell_values").select("item_id, column_id, value").eq("board_id", boardId),
```

- [ ] **Step 6: Verify the projected query typechecks against BoardPayload**

Run: `npx tsc --noEmit 2>&1 | Select-String "boards/queries"`
Expected: no matches. (`cellsRes.data` is now `Pick<...>[]`, assignable to `cellValues: CacheCellValue[]`.)
Run: `npx eslint src/lib/boards/queries.ts src/lib/boards/cache.ts src/lib/boards/cache.test.ts`
Expected: no output (clean).

- [ ] **Step 7: Commit**

```bash
git add src/lib/boards/cache.ts src/lib/boards/queries.ts src/lib/boards/cache.test.ts
git commit -m "perf(boards): project cell_values read to (item_id, column_id, value)"
```

---

### Task 2: Verify all views render after projection (manual/e2e gate)

**Files:**

- Test: `e2e/boards.spec.ts` (existing — run, do not rewrite)

**Interfaces:**

- Consumes: the projected `CacheCellValue` from Task 1.

- [ ] **Step 1: Run the existing board e2e suite**

Run: `pnpm e2e e2e/boards.spec.ts` (skips gracefully if Supabase secrets absent — if skipped, do the manual check in Step 2).
Expected: PASS — boards render, cells edit, views switch.

- [ ] **Step 2: Manual verification (if e2e skipped)**

Start the app (`pnpm dev`), open a board with items in each view and confirm:

- Table: cells display and edit.
- Kanban: items grouped by their status cell.
- Calendar: items placed on their date cell.
- Timeline: bars + dependency arrows render.
  Expected: identical to pre-change behavior (no missing cells).

- [ ] **Step 3: Commit (only if e2e file changed; otherwise skip)**

No commit expected — this task is a verification gate.

---

### Task 3: Document the >500-item revisit trigger

**Files:**

- Modify: `vault/decisions/2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Append a revisit note**

Add a short section to the gotcha-09 ADR recording: (a) `cell_values` is now projected to three fields (link this plan); (b) all views need all items' cells, so the fetch cannot be windowed to the table viewport; (c) when boards routinely exceed ~500 items, reopen per-view column projection (fetch only the active view's required columns on first paint, lazy-load the rest) or item pagination.

```markdown
## Update 2026-06-19 — cell_values projected, windowing deferred

The `cell_values` first-paint read is now projected to `(item_id, column_id, value)`
(see `docs/superpowers/plans/2026-06-19-board-payload-projection.md`). True windowing
was rejected: every view needs all _items'_ cells (Kanban groups by status, Calendar/
Timeline place by date), so the fetch can't be bounded to the visible table rows — only
its per-row payload was reduced. **Revisit trigger:** when boards routinely exceed ~500
items, reopen per-view column projection or item pagination.
```

- [ ] **Step 2: Commit**

```bash
git add vault/decisions/2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch.md
git commit -m "docs(adr): record cell_values projection + windowing revisit trigger"
```

---

## Self-Review

**Spec coverage:**

- Narrow `cell_values` select → Task 1, Step 5. ✓
- Retype `CacheCellValue` → Task 1, Step 3. ✓
- "Audit other `select(*)` reads" → intentionally **out of scope** for this plan: the spec gated it on "provably safe per consumer audit", and `items`/`columns` rows are broadly consumed. Left as a documented follow-up rather than a speculative task (avoids placeholder work). Noted here so the gap is deliberate, not missed.
- Keep dashboard-page waterfall fix → already shipped, not re-touched. ✓
- Document >500-item revisit trigger → Task 3. ✓
- Performance budget (rule 5) → satisfied by design (parallel indexed reads, 0 round-trips on toggles); no code added that changes round-trip counts. ✓
- Testing (compile gate + cache test + e2e) → Tasks 1–2. ✓

**Placeholder scan:** No TBD/TODO; every code step shows the exact change.

**Type consistency:** `CacheCellValue` projection name/shape identical across Task 1 steps and the realtime/view consumers it lists.
