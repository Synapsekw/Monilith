# Status Intelligence (Descoped) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-03-status-intelligence-design.md` — read it first
(including its "Descoped by product decision (2026-07-03)" section: NO health columns, NO
health\_\* trigger family, NO evaluator/sweep/badge/filter — this plan is the reduced scope only).

**Goal:** Overdue items _look_ overdue — a render-time red tint on past-due date cells of
incomplete items in the Table view (and item panel) — plus a minimal, loop-guarded
Completed⇔100% two-way sync shipped as two automation recipes.

**Architecture:** The tint is a pure client derivation (`src/lib/boards/overdue.ts`) over the
board payload already in the cache — zero schema, zero queries. The sync is one migration that
`create or replace`s the two existing engine functions to add a `percent_reached` trigger
(crossing semantics) and a `set_percent` action (idempotent), exposed via two Zod members, two
recipe factories, and builder sentences.

**Tech Stack:** Postgres (plpgsql), Supabase, Next.js 16 App Router, Zod, Vitest (+ serial
integration project), pulse-ui tokens.

## Global Constraints

- **The migration is applied to cloud dev MANUALLY BY THE USER** (the agent's classifier blocks
  DDL — memory note "migration apply blocked by classifier"). Task 1 ends at "hand SQL to user";
  the verify + `pnpm db:types` no-op check happens inside Task 1 after the user confirms.
- Never hand-edit `src/types/database.types.ts` (this migration changes no tables — `pnpm
db:types` after apply is expected to be a **no-op**; run it to confirm, commit only if it drifts).
- New SQL keeps engine conventions: `security definer set search_path = ''`, fully-qualified
  names, copy current function bodies verbatim and add branches only.
- Trigger/action field names (Zod ⇄ SQL contract, verbatim): `percent_reached { columnId,
percent (default 100) }`, `set_percent { columnId, percent (0..100) }`.
- Completeness rule (spec §1, verbatim): complete ⇔ the board's **first `status` column** value
  is an option whose label matches `/done|complete/i`. Overdue ⇔ `(value.end ?? value.date) <
viewer-local today` (ISO string compare, strict) AND incomplete.
- Tint styling: `bg-destructive/10 text-destructive rounded-md` + `aria-label`/`title`
  "Overdue" — semantic tokens only, color never the sole carrier.
- The tint adds **no** server round-trips, no state, no effects — pure render derivation
  (gotcha-09 compliant by construction).
- No `any`; validate at boundaries with Zod. Commit subjects lowercase after `type(scope):`,
  descriptive body, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`, stage by
  path.
- Gates before finish: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

## File structure

| File                                                              | Task | Responsibility                                         |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------ |
| `supabase/migrations/20260703091000_automations_percent_sync.sql` | 1    | `percent_reached` trigger match + `set_percent` action |
| `src/lib/validations/automations.ts` (+ `.test.ts`)               | 2    | two new Zod members                                    |
| `src/components/boards/automations/recipes.ts` (+ `.test.ts`)     | 2    | two recipe factories                                   |
| `src/components/boards/automations/AutomationBuilder.tsx`         | 3    | sentences for `percent_reached` / `set_percent`        |
| `src/components/boards/automations/AutomationsDialog.tsx`         | 3    | two recipe buttons + status+percent gating             |
| `src/lib/boards/overdue.ts` (+ `.test.ts`)                        | 4    | pure overdue/completeness helpers                      |
| `src/components/boards/cells/index.tsx`, `BoardTable.tsx`         | 4    | tinted date cell in the table                          |
| `src/components/boards/item-panel/ItemPanel.tsx`                  | 4    | same tint on the panel date field (if nearly free)     |
| `src/lib/boards/automations.percent-sync.integration.test.ts`     | 5    | sync behavior + loop guard                             |

---

### Task 1: Migration — `percent_reached` trigger + `set_percent` action (incl. user apply gate)

**Files:**

- Create: `supabase/migrations/20260703091000_automations_percent_sync.sql`

**Interfaces:**

- Consumes: current bodies of `public.tg_run_automations()` (latest in
  `supabase/migrations/20260619100000_automations_5c1_run_history.sql`) and
  `public._automation_run(...)` (latest in
  `supabase/migrations/20260622130000_automation_move_to_group.sql`). This migration
  `create or replace`s both — **copy each current body verbatim and add only the new branches**.
- Produces: engine understands trigger `{"type":"percent_reached","columnId":…,"percent":100}`
  (fires only on threshold-crossing percent writes) and action
  `{"type":"set_percent","columnId":…,"percent":0..100}` (idempotent, logs `skipped_equal`).
  Task 5's integration tests and Task 2's shapes rely on these exact jsonb fields.

- [ ] **Step 1: Write the migration**

In the copied `tg_run_automations` body, extend the rule-matching `where` clause's trigger-type
disjunction with (adapt alias names to the body's conventions):

```sql
      or ( trigger->>'type' = 'percent_reached'
           and (new.value->>'percent') is not null
           and (new.value->>'percent')::numeric
                 >= coalesce((trigger->>'percent')::numeric, 100)
           and ( tg_op = 'INSERT'
                 or old.value->>'percent' is null
                 or (old.value->>'percent')::numeric
                      < coalesce((trigger->>'percent')::numeric, 100) ) )
```

(The existing `trigger->>'columnId' = new.column_id::text` guard already scopes it to the right
percent column; crossing semantics — the INSERT/old-below arm — are what prevent re-fires.)

In the copied `_automation_run` body, add a branch after `set_option`, mirroring its structure
and local variable names (upsert path, `skipped_equal` log entry, run-log append):

```sql
    elsif v_action->>'type' = 'set_percent' then
      select cv.value into v_current
      from public.cell_values cv
      where cv.item_id = p_item_id
        and cv.column_id = (v_action->>'columnId')::uuid;
      if v_current is not null
         and (v_current->>'percent')::numeric = (v_action->>'percent')::numeric then
        v_action_log := v_action_log
          || jsonb_build_object('type','set_percent','result','skipped_equal');
      else
        insert into public.cell_values (org_id, board_id, item_id, column_id, value)
        values (p_org_id, p_board_id, p_item_id,
                (v_action->>'columnId')::uuid,
                jsonb_build_object('percent', (v_action->>'percent')::numeric))
        on conflict (item_id, column_id)
          do update set value = excluded.value, updated_at = now();
        v_action_log := v_action_log
          || jsonb_build_object('type','set_percent','result','ok');
      end if;
```

Header comment must state the loop analysis: Done → `set_percent 100` (the write re-enters
`tg_run_automations`, depth+1) → `percent_reached` rule → `set_option` Done → `skipped_equal`,
chain ends at depth 2; `pulse.aut_depth` (bail ≥5) is the backstop.

- [ ] **Step 2: Diff-check against the source bodies**

Manually compare the copied portions against the two source migrations — the ONLY deltas must be
the two new branches and the header comment.

- [ ] **Step 3: Commit the migration file**

```bash
git add supabase/migrations/20260703091000_automations_percent_sync.sql
git commit -m "feat(automations): percent_reached trigger and set_percent action" \
  -m "Minimal engine extension for the Completed<->100% two-way sync (feedback F6):
percent_reached fires only on threshold-crossing percent writes; set_percent
writes {percent:n} with skipped_equal idempotence so the Done->100->Done chain
terminates at depth 2 (pulse.aut_depth remains the backstop). Living at the
cell_values trigger level covers direct edits, spreadsheet imports, and
automation writes alike.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: USER GATE — hand the SQL to the user**

The agent cannot apply DDL. Post the file path and ask the user to apply it to **cloud dev**
(hjqca… — the `.mcp.json` labels are inverted per memory note "supabase env labels inverted").

- [ ] **Step 5: Verify + types no-op check (after user confirms)**

Read-only verify via dev MCP `execute_sql`:
`select prosrc like '%percent_reached%' from pg_proc where proname = 'tg_run_automations';` →
expect `true` (and the same for `_automation_run` / `set_percent`).
Then run `pnpm db:types` — expected **no diff** (no table changes). If it drifts, commit the
regenerated file:

```bash
git add src/types/database.types.ts
git commit -m "chore(types): regenerate after percent-sync migration" \
  -m "No table changes expected; committed because db:types drifted.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Zod members + two recipe factories

**Files:**

- Modify: `src/lib/validations/automations.ts`
- Modify: `src/components/boards/automations/recipes.ts`
- Test: `src/lib/validations/automations.test.ts` (extend or create, matching existing layout),
  `src/components/boards/automations/recipes.test.ts` (extend)

**Interfaces:**

- Consumes: nothing from other tasks (pure TS — parallel with Task 1; field names copied from
  Global Constraints).
- Produces (Tasks 3 and 5 rely on these exact names):
  - `automationTriggerSchema` gains the `"percent_reached"` member;
    `automationActionSchema` gains the `"set_percent"` member.
  - `recipeCompletedSetsPercent(statusColumnId: string, doneOptionId: string,
percentColumnId: string): Draft`
  - `recipePercentSetsCompleted(percentColumnId: string, statusColumnId: string,
doneOptionId: string): Draft`

- [ ] **Step 1: Write the failing tests**

`automations.test.ts` (follow the file's existing parse-style assertions):

```ts
it("defaults percent_reached to 100 and bounds set_percent", () => {
  expect(
    automationTriggerSchema.parse({ type: "percent_reached", columnId: COL }),
  ).toMatchObject({ percent: 100 });
  expect(() =>
    automationActionSchema.parse({
      type: "set_percent",
      columnId: COL,
      percent: 101,
    }),
  ).toThrow();
  expect(() =>
    automationTriggerSchema.parse({
      type: "percent_reached",
      columnId: "not-a-uuid",
    }),
  ).toThrow();
});
```

`recipes.test.ts`: both factories' drafts round-trip `createAutomationSchema`;
`recipeCompletedSetsPercent` yields trigger `{ type: "status_changed", columnId: statusCol,
toOptionId: doneOpt }` + actions `[{ type: "set_percent", columnId: percentCol, percent: 100 }]`;
`recipePercentSetsCompleted` yields trigger `{ type: "percent_reached", columnId: percentCol,
percent: 100 }` + actions `[{ type: "set_option", columnId: statusCol, optionId: doneOpt }]`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/validations/automations.test.ts src/components/boards/automations/recipes.test.ts`
Expected: FAIL — unknown discriminator values / missing exports.

- [ ] **Step 3: Implement**

Trigger union addition (match the file's uuid/string conventions):

```ts
z.object({
  type: z.literal("percent_reached"),
  columnId: z.string().uuid(),
  percent: z.number().int().min(1).max(100).default(100),
}),
```

Action union addition:

```ts
z.object({
  type: z.literal("set_percent"),
  columnId: z.string().uuid(),
  percent: z.number().int().min(0).max(100),
}),
```

`recipes.ts` factories (existing `Draft` pattern):

```ts
export function recipeCompletedSetsPercent(
  statusColumnId: string,
  doneOptionId: string,
  percentColumnId: string,
): Draft {
  return {
    name: "Completed sets 100%",
    trigger: {
      type: "status_changed",
      columnId: statusColumnId,
      toOptionId: doneOptionId,
    },
    actions: [{ type: "set_percent", columnId: percentColumnId, percent: 100 }],
  };
}

export function recipePercentSetsCompleted(
  percentColumnId: string,
  statusColumnId: string,
  doneOptionId: string,
): Draft {
  return {
    name: "100% sets Completed",
    trigger: {
      type: "percent_reached",
      columnId: percentColumnId,
      percent: 100,
    },
    actions: [
      { type: "set_option", columnId: statusColumnId, optionId: doneOptionId },
    ],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/validations/automations.test.ts src/components/boards/automations/recipes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/automations.ts src/lib/validations/automations.test.ts \
        src/components/boards/automations/recipes.ts \
        src/components/boards/automations/recipes.test.ts
git commit -m "feat(automations): percent-sync trigger/action schemas and recipes" \
  -m "Adds percent_reached and set_percent to the Zod unions plus the two
completed<->100% recipe factories (vocabulary-aware: the user picks the done
option per board).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Builder sentences + recipe buttons

**Files:**

- Modify: `src/components/boards/automations/AutomationBuilder.tsx`
- Modify: `src/components/boards/automations/AutomationsDialog.tsx`
- Test: extend the components' existing test files (same directory)

**Interfaces:**

- Consumes: Task 2's recipe factories and trigger/action types.
- Produces: user-visible rule sentences and two "Start from a recipe" buttons. No new exports.

- [ ] **Step 1: Write the failing tests**

Extend the dialog/builder tests (existing render-with-columns fixtures):

- "Completed sets 100%" and "100% sets Completed" buttons render when the board has BOTH a
  status and a percent column (`canPercentSync`); hidden otherwise.
- Builder renders a readable sentence for a `percent_reached` draft ("When {Progress} reaches
  100%") and for `set_percent` ("set {Progress} to 100%").

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/components/boards/automations`
Expected: FAIL — buttons/sentences absent.

- [ ] **Step 3: Implement**

`AutomationsDialog.tsx`: follow the existing availability-gate pattern (`canNotifyOwner` etc.):
`canPercentSync = hasStatus && hasPercent`. Each button builds its draft with the first status
column, its first `/done|complete/i`-labeled option (fallback: first option — the builder's
existing option picker lets the user correct it), and the first percent column, then calls
`startBuild(draft)` exactly like the existing recipes.

`AutomationBuilder.tsx`: add sentence segments for `percent_reached` (percent-column picker +
threshold display) and `set_percent` (percent-column picker + bounded numeric input), composing
the existing `columnOptions` picker primitives.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/components/boards/automations`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/automations/AutomationsDialog.tsx \
        src/components/boards/automations/AutomationBuilder.tsx \
        src/components/boards/automations/*.test.tsx
git commit -m "feat(automations): builder ui and recipe buttons for percent sync" \
  -m "Two recipe buttons gated on status+percent column presence, plus builder
sentences and pickers for the percent_reached trigger and set_percent action.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Overdue helpers + date-cell tint (table + item panel)

**Files:**

- Create: `src/lib/boards/overdue.ts`
- Test: `src/lib/boards/overdue.test.ts`
- Modify: `src/components/boards/cells/index.tsx` (date cell renderer gains an `overdue` prop),
  `src/components/boards/BoardTable.tsx` (compute + pass the prop at the row-render site)
- Modify (only if nearly free — same helper, context already in scope):
  `src/components/boards/item-panel/ItemPanel.tsx` (fields-tab date value)

**Interfaces:**

- Consumes: `CacheColumn`/`CacheCellValue` types from `@/lib/boards/cache`; the date-value shape
  `{ date, end? }` (`src/lib/boards/dates.ts` conventions). Nothing from Tasks 1–3 — fully
  parallel.
- Produces (exported from `@/lib/boards/overdue`; item 8 reuses these predicates):
  - `localTodayISO(now?: Date): string` — viewer-local `YYYY-MM-DD`.
  - `isItemComplete(itemId: string, columns: Pick<CacheColumn, "id" | "kind" | "position" |
"settings">[], cellValues: CacheCellValue[]): boolean` — first status column by position,
    option label matches `/done|complete/i`.
  - `isOverdue(value: unknown, todayISO: string): boolean` — due = `end ?? date`, strict `<`,
    false for missing/malformed values.

- [ ] **Step 1: Write the failing tests**

```ts
import { isItemComplete, isOverdue, localTodayISO } from "./overdue";

describe("isOverdue", () => {
  it("is true strictly before today, false today/after/missing", () => {
    expect(isOverdue({ date: "2026-07-02" }, "2026-07-03")).toBe(true);
    expect(isOverdue({ date: "2026-07-03" }, "2026-07-03")).toBe(false);
    expect(isOverdue({ date: "2026-07-04" }, "2026-07-03")).toBe(false);
    expect(isOverdue({}, "2026-07-03")).toBe(false);
    expect(isOverdue(null, "2026-07-03")).toBe(false);
  });
  it("uses end when present (end ?? date)", () => {
    expect(
      isOverdue({ date: "2026-06-01", end: "2026-07-04" }, "2026-07-03"),
    ).toBe(false);
    expect(
      isOverdue({ date: "2026-07-04", end: "2026-07-01" }, "2026-07-03"),
    ).toBe(true);
  });
});

describe("isItemComplete", () => {
  const statusCol = {
    id: "c1",
    kind: "status",
    position: 0,
    settings: {
      options: [
        { id: "o1", label: "Working on it", color: "#fdab3d" },
        { id: "o2", label: "Done", color: "#00c875" },
      ],
    },
  };
  const cell = (optionId: string | null) =>
    ({ item_id: "i1", column_id: "c1", value: { optionId } }) as never;

  it("done-labeled option => complete (case-insensitive, 'Completed' too)", () => {
    expect(isItemComplete("i1", [statusCol] as never, [cell("o2")])).toBe(true);
  });
  it("non-done option, empty cell, or no status column => incomplete", () => {
    expect(isItemComplete("i1", [statusCol] as never, [cell("o1")])).toBe(
      false,
    );
    expect(isItemComplete("i1", [statusCol] as never, [])).toBe(false);
    expect(isItemComplete("i1", [], [])).toBe(false);
  });
});

it("localTodayISO formats the local date", () => {
  expect(localTodayISO(new Date(2026, 6, 3, 23, 30))).toBe("2026-07-03");
});
```

Cell-render test (extend the cells/table test file): an overdue incomplete item's date cell has
the `text-destructive` class and `aria-label` containing "Overdue"; a done item's past date and
a future date do not.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/boards/overdue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

```ts
// src/lib/boards/overdue.ts — pure render-time predicates. Spec: complete ⇔
// the board's FIRST status column holds an option labeled /done|complete/i;
// overdue ⇔ (end ?? date) < viewer-local today (strict ISO compare) AND
// incomplete. Zero-schema by product decision (2026-07-03) — no persistence.
import type { CacheCellValue, CacheColumn } from "@/lib/boards/cache";

const DONE_LABEL = /done|complete/i;

export function localTodayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isItemComplete(
  itemId: string,
  columns: Pick<CacheColumn, "id" | "kind" | "position" | "settings">[],
  cellValues: CacheCellValue[],
): boolean {
  const statusCol = columns
    .filter((c) => c.kind === "status")
    .sort((a, b) => a.position - b.position)[0];
  if (!statusCol) return false;
  const cell = cellValues.find(
    (v) => v.item_id === itemId && v.column_id === statusCol.id,
  );
  const optionId =
    cell && typeof cell.value === "object" && cell.value !== null
      ? (cell.value as { optionId?: string | null }).optionId
      : null;
  if (!optionId) return false;
  const options =
    (statusCol.settings as { options?: { id: string; label: string }[] })
      ?.options ?? [];
  const option = options.find((o) => o.id === optionId);
  return option ? DONE_LABEL.test(option.label) : false;
}

export function isOverdue(value: unknown, todayISO: string): boolean {
  if (typeof value !== "object" || value === null) return false;
  const { date, end } = value as { date?: unknown; end?: unknown };
  const due =
    typeof end === "string" ? end : typeof date === "string" ? date : null;
  return due !== null && due < todayISO;
}
```

- [ ] **Step 4: Wire the tint**

In `BoardTable.tsx`, at the row-render site (item + cache in scope): compute `todayISO` once per
render pass (`localTodayISO()` — plain call, no state/effect), `complete = isItemComplete(...)`
once per row, and pass `overdue={!complete && isOverdue(cellValue, todayISO)}` into the date
cell renderer. In `cells/index.tsx`, the date cell accepts `overdue?: boolean` and, when true,
adds `cn("bg-destructive/10 text-destructive rounded-md")` to its content span plus
`aria-label="Overdue"`/`title="Overdue"` (keep the rendered date text unchanged — no layout
shift). Item panel: apply the same helper + classes to the fields-tab date value ONLY if the
panel already has columns + cellValues in scope (it does — same cache); if it needs new
plumbing, skip it and note that in the PR/wrapup (spec open question 4).

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm vitest run src/lib/boards/overdue.test.ts src/components/boards && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/boards/overdue.ts src/lib/boards/overdue.test.ts \
        src/components/boards/cells/index.tsx src/components/boards/BoardTable.tsx \
        src/components/boards/item-panel/ItemPanel.tsx
git commit -m "feat(boards): red tint on overdue date cells" \
  -m "Past-due date cells of incomplete items (first status column not on a
/done|complete/i-labeled option) get bg-destructive/10 + text-destructive and
an Overdue aria-label in the table and item panel. Pure render-time derivation
over the loaded board payload - zero schema, zero queries, viewer-local today.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Integration tests — percent sync

**Files:**

- Create: `src/lib/boards/automations.percent-sync.integration.test.ts`

**Interfaces:**

- Consumes: applied migration (Task 1 user gate), Zod/recipe shapes (Task 2). Follow the
  provisioning + serial-project conventions of
  `src/lib/boards/automations.engine.5b1.integration.test.ts`.
- Produces: the behavioral spec of the sync.

- [ ] **Step 1: Write the tests** (each seeds a board with a status column — options incl. a
      "Done" — and a percent column, inserts the recipe-shaped automation rows, then asserts cell
      state):

  1. "Completed sets 100%": status → done option ⇒ percent cell becomes `{percent:100}`.
  2. "100% sets Completed": percent write 40→100 ⇒ status cell becomes the done option.
  3. Loop guard: with BOTH rules enabled, one status→Done write settles (percent 100, status
     Done) and the run history shows a `skipped_equal` hop — no depth exhaustion.
  4. No re-fire: a 100→100 percent rewrite does not fire `percent_reached` (crossing semantics —
     assert no new `automation_runs` row).

- [ ] **Step 2: Run**

Run: `pnpm vitest run src/lib/boards/automations.percent-sync.integration.test.ts`
Expected: PASS (runs against cloud dev like the existing engine tests; flakes are covered by the
serial project + signInWithRetry per memory note "integration-test provisioning flake").

- [ ] **Step 3: Commit**

```bash
git add src/lib/boards/automations.percent-sync.integration.test.ts
git commit -m "test(automations): percent-sync integration coverage" \
  -m "Pins both sync directions, the skipped_equal loop termination with both
recipes enabled, and crossing semantics (no re-fire on a non-crossing 100->100
rewrite).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Execution DAG (working agreement #6)

**Dependency graph:**

- Task 1 (migration + user apply gate) — no deps
- Task 2 (Zod + recipes) — no deps
- Task 3 (builder/dialog UI) — depends on 2
- Task 4 (overdue tint) — no deps (fully independent of the sync work)
- Task 5 (integration tests) — depends on 1 (applied) and 2

**Parallel batches** (≥2 tasks in a batch → dispatch per
`superpowers:dispatching-parallel-agents` / parallel subagent-driven-development):

| Batch | Tasks   | Note                                                               |
| ----- | ------- | ------------------------------------------------------------------ |
| A     | 1, 2, 4 | independent files; surface Task 1's user-apply request immediately |
| B     | 3, 5    | 3 after 2; 5 after 1 (user has applied) + 2; disjoint files        |

**Critical path:** 1 (user apply turnaround) → 5. The tint slice (4) has no dependencies at all
and can land first.

**Finish:** `scripts/finish-task.sh` from the worktree (gates: typecheck, lint, test incl.
integration, build), then the "How to test this" walkthrough per AGENTS.md.

## What item 8 (health summary + alerts) can consume from this plan

The original 9 → 8 edge (persisted health flags) is **gone with the descope** — item 8 must
source its flagged/structurally-incomplete signal itself (see the spec's "Impact on item 8"
section; the descoped health-flag design recorded there is the starting point). Still reusable
from this slice:

- `isItemComplete` / `isOverdue` / `localTodayISO` (`src/lib/boards/overdue.ts`, Task 4) — the
  shared completeness/overdue predicates.
- The `percent_reached` / `set_percent` engine vocabulary (Task 1) and their Zod members
  (Task 2), should item 8's rules need percent thresholds.
