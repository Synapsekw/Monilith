# Dashboards D3b — List-widget multi-condition filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a flat, multi-condition AND/OR filter to the dashboard **List** widget, executed by one bounded, indexed, membership-checked Postgres RPC.

**Architecture:** A new `dashboard_list_rows` SECURITY DEFINER RPC translates a jsonb filter (`{combinator, conditions[]}`) into per-condition `EXISTS(cell_values …)` predicates, joins them with AND/OR, and applies `ORDER BY created_at DESC LIMIT N` **after** filtering. `getWidgetRows` swaps its first query for this RPC; the cells/display query is unchanged. A `FilterBuilder` UI component feeds the filter into both the add-widget dialog and a new per-widget List config editor (reusing the existing `editWidget`/`updateWidgetConfig` path).

**Tech Stack:** Next.js 16 RSC + Server Actions, Supabase (plpgsql RPC, RLS), Zod, TanStack Query, shadcn/Tailwind v4, Vitest, Playwright.

**Process guardrail (gotcha-15):** Subagent-driven, **one file per agent, confirm the previous agent is idle before dispatching the next** — no two agents editing the same file concurrently in this shared checkout.

**Spec:** `docs/superpowers/specs/2026-06-18-dashboards-d3b-list-filter-design.md`

---

## File structure

| File                                                                  | Responsibility                                                              | Task |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---- |
| `src/lib/validations/dashboards.ts` (modify)                          | `filterOperator`/`filterCondition` schemas + `filter` on `listConfigSchema` | 1    |
| `src/lib/validations/dashboards.test.ts` (modify)                     | Zod tests for the filter shape                                              | 1    |
| `src/lib/dashboards/filter-meta.ts` (create)                          | Pure: operators-per-kind, value-control kind, operator labels               | 2    |
| `src/lib/dashboards/filter-meta.test.ts` (create)                     | Unit tests for the metadata helper                                          | 2    |
| `supabase/migrations/20260618120000_dashboard_list_rows.sql` (create) | `dashboard_list_rows` + `_dashboard_list_predicate` RPC                     | 3    |
| `src/types/database.types.ts` (regen)                                 | Regenerated types incl. the new RPC                                         | 3    |
| `src/lib/dashboards/dashboards.rls.integration.test.ts` (modify)      | Live cross-org RPC tests                                                    | 3    |
| `src/lib/dashboards/actions.ts` (modify)                              | `getWidgetRows` calls the RPC for its first query                           | 4    |
| `src/components/dashboards/FilterBuilder.tsx` (create)                | Reusable filter-builder UI (combinator + condition rows)                    | 5    |
| `src/components/dashboards/FilterBuilder.test.tsx` (create)           | Component tests for the builder                                             | 5    |
| `src/components/dashboards/AddWidgetDialog.tsx` (modify)              | Mount `FilterBuilder` in the List branch; include `filter` in config        | 6    |
| `src/components/dashboards/EditListWidgetDialog.tsx` (create)         | Per-widget List config editor (columns/limit/filter) via `editWidget`       | 7    |
| `src/components/dashboards/DashboardWidget.tsx` (modify)              | Add an "Edit" menu item that opens the editor for List widgets              | 7    |
| `e2e/dashboards.spec.ts` (modify)                                     | e2e: add List widget + a status filter, verify rows + persistence           | 8    |

---

## Task 1: Filter Zod schema

**Files:**

- Modify: `src/lib/validations/dashboards.ts:31-35` (the `listConfigSchema` block)
- Test: `src/lib/validations/dashboards.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/validations/dashboards.test.ts` (import `listConfigSchema` alongside the existing imports):

```ts
describe("listConfigSchema filter", () => {
  it("accepts an empty config (D3a backward-compat)", () => {
    const r = listConfigSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.filter).toBeUndefined();
  });

  it("accepts a flat AND/OR condition list", () => {
    const r = listConfigSchema.safeParse({
      columnIds: [UUID_A],
      limit: 25,
      filter: {
        combinator: "or",
        conditions: [
          { columnId: UUID_A, operator: "is", value: UUID_B },
          { columnId: UUID_A, operator: "is_empty" },
        ],
      },
    });
    expect(r.success).toBe(true);
  });

  it("defaults combinator to 'and'", () => {
    const r = listConfigSchema.safeParse({ filter: { conditions: [] } });
    expect(r.success && r.data.filter?.combinator).toBe("and");
  });

  it("rejects an unknown operator", () => {
    const r = listConfigSchema.safeParse({
      filter: { conditions: [{ columnId: UUID_A, operator: "matches" }] },
    });
    expect(r.success).toBe(false);
  });

  it("rejects more than 10 conditions", () => {
    const many = Array.from({ length: 11 }, () => ({
      columnId: UUID_A,
      operator: "not_empty" as const,
    }));
    const r = listConfigSchema.safeParse({ filter: { conditions: many } });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/lib/validations/dashboards.test.ts`
Expected: FAIL — `listConfigSchema` has no `filter` key / `filter` undefined when provided.

- [ ] **Step 3: Implement the schema**

In `src/lib/validations/dashboards.ts`, replace the `listConfigSchema` block (lines 31-35) with:

```ts
export const filterOperatorSchema = z.enum([
  "is",
  "is_not", // status
  "contains",
  "eq", // text
  "num_eq",
  "num_ne",
  "gt",
  "lt", // numbers
  "before",
  "after",
  "on", // date
  "is_empty",
  "not_empty", // any kind
]);
export type FilterOperator = z.infer<typeof filterOperatorSchema>;

export const filterConditionSchema = z.object({
  columnId: uuid,
  operator: filterOperatorSchema,
  // unused for is_empty / not_empty
  value: z.union([z.string(), z.number(), z.null()]).optional(),
});
export type FilterCondition = z.infer<typeof filterConditionSchema>;

export const listFilterSchema = z.object({
  combinator: z.enum(["and", "or"]).default("and"),
  conditions: z.array(filterConditionSchema).max(10).default([]),
});
export type ListFilter = z.infer<typeof listFilterSchema>;

export const listConfigSchema = z.object({
  columnIds: z.array(uuid).max(8).default([]),
  limit: z.number().int().min(1).max(100).default(25),
  filter: listFilterSchema.optional(),
});
export type ListConfig = z.infer<typeof listConfigSchema>;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/lib/validations/dashboards.test.ts`
Expected: PASS (all, including the existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/dashboards.ts src/lib/validations/dashboards.test.ts
git commit -m "feat(dashboards): list filter zod schema (d3b)"
```

---

## Task 2: Filter metadata helper (operators per kind)

**Files:**

- Create: `src/lib/dashboards/filter-meta.ts`
- Test: `src/lib/dashboards/filter-meta.test.ts`

This pure module drives the UI: which operators a column kind offers, what value control each operator needs, and human labels. Keeping it pure (no React) makes it unit-testable and reusable by both the add and edit dialogs.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/dashboards/filter-meta.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  operatorsForKind,
  valueControlFor,
  OPERATOR_LABEL,
} from "./filter-meta";

describe("operatorsForKind", () => {
  it("status offers is / is_not / empties only", () => {
    expect(operatorsForKind("status")).toEqual([
      "is",
      "is_not",
      "is_empty",
      "not_empty",
    ]);
  });
  it("numbers offers numeric comparisons + empties", () => {
    expect(operatorsForKind("numbers")).toEqual([
      "num_eq",
      "num_ne",
      "gt",
      "lt",
      "is_empty",
      "not_empty",
    ]);
  });
  it("dropdown/people only offer empties (value match deferred)", () => {
    expect(operatorsForKind("dropdown")).toEqual(["is_empty", "not_empty"]);
    expect(operatorsForKind("people")).toEqual(["is_empty", "not_empty"]);
  });
  it("unknown kind offers empties only", () => {
    expect(operatorsForKind("mystery")).toEqual(["is_empty", "not_empty"]);
  });
});

describe("valueControlFor", () => {
  it("empties need no value control", () => {
    expect(valueControlFor("status", "is_empty")).toBe("none");
    expect(valueControlFor("numbers", "not_empty")).toBe("none");
  });
  it("status non-empty → option picker", () => {
    expect(valueControlFor("status", "is")).toBe("option");
  });
  it("numbers → number; date → date; text → text", () => {
    expect(valueControlFor("numbers", "gt")).toBe("number");
    expect(valueControlFor("date", "before")).toBe("date");
    expect(valueControlFor("text", "contains")).toBe("text");
  });
});

describe("OPERATOR_LABEL", () => {
  it("labels every operator", () => {
    for (const op of [
      "is",
      "is_not",
      "contains",
      "eq",
      "num_eq",
      "num_ne",
      "gt",
      "lt",
      "before",
      "after",
      "on",
      "is_empty",
      "not_empty",
    ] as const) {
      expect(OPERATOR_LABEL[op]).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/lib/dashboards/filter-meta.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/dashboards/filter-meta.ts`:

```ts
import type { FilterOperator } from "@/lib/validations/dashboards";

const EMPTIES: FilterOperator[] = ["is_empty", "not_empty"];

/** Operators offered for a column kind (lean tier — see D3b spec §2). */
export function operatorsForKind(kind: string): FilterOperator[] {
  switch (kind) {
    case "status":
      return ["is", "is_not", ...EMPTIES];
    case "text":
      return ["contains", "eq", ...EMPTIES];
    case "numbers":
      return ["num_eq", "num_ne", "gt", "lt", ...EMPTIES];
    case "date":
      return ["before", "after", "on", ...EMPTIES];
    // dropdown/people value-matching is deferred; empties still work.
    default:
      return [...EMPTIES];
  }
}

export type ValueControl = "none" | "option" | "number" | "date" | "text";

/** Which value input a (kind, operator) pair needs. */
export function valueControlFor(
  kind: string,
  op: FilterOperator,
): ValueControl {
  if (op === "is_empty" || op === "not_empty") return "none";
  if (kind === "status") return "option";
  if (kind === "numbers") return "number";
  if (kind === "date") return "date";
  return "text";
}

export const OPERATOR_LABEL: Record<FilterOperator, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  eq: "equals",
  num_eq: "=",
  num_ne: "≠",
  gt: ">",
  lt: "<",
  before: "before",
  after: "after",
  on: "on",
  is_empty: "is empty",
  not_empty: "is not empty",
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/lib/dashboards/filter-meta.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboards/filter-meta.ts src/lib/dashboards/filter-meta.test.ts
git commit -m "feat(dashboards): filter operator metadata helper (d3b)"
```

---

## Task 3: `dashboard_list_rows` RPC + types + integration tests

**Files:**

- Create: `supabase/migrations/20260618120000_dashboard_list_rows.sql`
- Regen: `src/types/database.types.ts`
- Test: `src/lib/dashboards/dashboards.rls.integration.test.ts`

**Authorization note:** applying the migration to the linked cloud project requires explicit per-session authorization from Danijel (no local stack). Do not run `supabase db push --linked` without it.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260618120000_dashboard_list_rows.sql`:

```sql
-- D3b: bounded, indexed, membership-checked row fetch for the List widget.
-- Translates a flat filter {combinator, conditions[]} into per-condition
-- EXISTS(cell_values) predicates joined by AND/OR, applies LIMIT *after*
-- filtering. Predicate construction is isolated in a helper; all condition
-- values are bound via format(%L) (injection-safe). Numeric/date values are
-- regex-guarded so a malformed value yields no match (not a widget error).

-- Helper: build one EXISTS/NOT EXISTS predicate string for a condition.
-- `i` is the items alias in the caller's dynamic query.
create or replace function public._dashboard_list_predicate(
  p_col uuid,
  p_op  text,
  p_val text
) returns text
language plpgsql
immutable
set search_path = '' as $$
declare
  e_open text := format(
    'exists (select 1 from public.cell_values cv '
    || 'where cv.item_id = i.id and cv.column_id = %L and ', p_col);
  n_open text := format(
    'not exists (select 1 from public.cell_values cv '
    || 'where cv.item_id = i.id and cv.column_id = %L and ', p_col);
begin
  -- guard numeric/date casts: bad value → always-false predicate
  if p_op in ('num_eq', 'num_ne', 'gt', 'lt')
     and (p_val is null or p_val !~ '^\s*-?\d+(\.\d+)?\s*$') then
    return 'false';
  end if;
  if p_op in ('before', 'after', 'on')
     and (p_val is null or p_val !~ '^\d{4}-\d{2}-\d{2}') then
    return 'false';
  end if;
  if p_op in ('is', 'is_not', 'contains', 'eq') and p_val is null then
    return 'false';
  end if;

  return case p_op
    when 'is'        then e_open || format('cv.value->>''optionId'' = %L)', p_val)
    when 'is_not'    then e_open || format('cv.value->>''optionId'' is distinct from %L)', p_val)
    when 'contains'  then e_open || format('cv.value->>''text'' ilike %L)', '%' || p_val || '%')
    when 'eq'        then e_open || format('cv.value->>''text'' = %L)', p_val)
    when 'num_eq'    then e_open || format('(cv.value->>''n'')::numeric = %L::numeric)', p_val)
    when 'num_ne'    then e_open || format('(cv.value->>''n'')::numeric <> %L::numeric)', p_val)
    when 'gt'        then e_open || format('(cv.value->>''n'')::numeric > %L::numeric)', p_val)
    when 'lt'        then e_open || format('(cv.value->>''n'')::numeric < %L::numeric)', p_val)
    when 'before'    then e_open || format('(cv.value->>''date'')::date < %L::date)', p_val)
    when 'after'     then e_open || format('(cv.value->>''date'')::date > %L::date)', p_val)
    when 'on'        then e_open || format('(cv.value->>''date'')::date = %L::date)', p_val)
    when 'not_empty' then e_open || 'cv.value is not null)'
    when 'is_empty'  then n_open || 'cv.value is not null)'
    else null
  end;
end; $$;

create or replace function public.dashboard_list_rows(
  p_board_id uuid,
  p_filter   jsonb default '{}'::jsonb,
  p_limit    int   default 25
) returns table (item_id uuid, name text, created_at timestamptz)
language plpgsql
security definer
set search_path = '' as $$
declare
  v_org_id     uuid;
  v_combinator text;
  v_cond       jsonb;
  v_pred       text;
  v_preds      text[] := '{}';
  v_where      text;
  v_limit      int := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  select org_id into v_org_id from public.boards where id = p_board_id;
  if v_org_id is null then
    raise exception 'board not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  v_combinator := lower(coalesce(p_filter->>'combinator', 'and'));
  if v_combinator not in ('and', 'or') then
    v_combinator := 'and';
  end if;

  for v_cond in
    select value
    from jsonb_array_elements(coalesce(p_filter->'conditions', '[]'::jsonb))
  loop
    v_pred := public._dashboard_list_predicate(
      (v_cond->>'columnId')::uuid,
      v_cond->>'operator',
      v_cond->>'value'
    );
    if v_pred is not null then
      v_preds := array_append(v_preds, v_pred);
    end if;
  end loop;

  if array_length(v_preds, 1) is null then
    v_where := 'true';
  else
    v_where := array_to_string(v_preds, ' ' || v_combinator || ' ');
  end if;

  return query execute format(
    'select i.id, i.name, i.created_at from public.items i '
    || 'where i.board_id = %L and (%s) '
    || 'order by i.created_at desc limit %L',
    p_board_id, v_where, v_limit
  );
end; $$;

grant execute on function public.dashboard_list_rows(uuid, jsonb, int) to authenticated;
```

- [ ] **Step 2: Apply the migration (with authorization)**

Confirm authorization, then:
Run: `supabase db push --linked`
Expected: the new migration applies cleanly (no error).

- [ ] **Step 3: Regenerate types**

Run: `pnpm db:types`
Then verify no stray PostHog telemetry line leaked into the file (known gotcha): `grep -n '"_tag"' src/types/database.types.ts` → expect **no output**. If present, remove that line and re-run prettier.
Expected: `dashboard_list_rows` now appears under `Functions` in `src/types/database.types.ts`.

- [ ] **Step 4: Write the integration tests**

In `src/lib/dashboards/dashboards.rls.integration.test.ts`, add inside the existing `describe` block (the harness's `provisionUser` already creates a board with a seeded Status column `statusColumnId` + `doneOptionId`). Add a helper to seed items and a new test group. Use the existing `userA` / `userB` and `admin` clients:

```ts
// Seed N items on a board, optionally giving each a status cell.
async function seedItem(
  user: TestUser,
  opts: { name: string; statusOptionId?: string | null },
) {
  const { data: item } = await user.anon
    .from("items")
    .insert({
      board_id: user.boardId,
      org_id: user.orgId,
      name: opts.name,
      created_by: user.id,
    })
    .select("id")
    .single();
  const itemId = (item as { id: string }).id;
  if (opts.statusOptionId !== undefined && opts.statusOptionId !== null) {
    await user.anon.from("cell_values").insert({
      item_id: itemId,
      column_id: user.statusColumnId,
      board_id: user.boardId,
      org_id: user.orgId,
      value: { optionId: opts.statusOptionId },
    });
  }
  return itemId;
}

describe("dashboard_list_rows (D3b filter)", () => {
  it("filters by status 'is' and includes the empty-status item only via is_empty", async () => {
    await seedItem(userA, {
      name: "Done one",
      statusOptionId: userA.doneOptionId,
    });
    await seedItem(userA, { name: "No status", statusOptionId: null });

    const isDone = await userA.anon.rpc("dashboard_list_rows", {
      p_board_id: userA.boardId,
      p_filter: {
        combinator: "and",
        conditions: [
          {
            columnId: userA.statusColumnId,
            operator: "is",
            value: userA.doneOptionId,
          },
        ],
      },
      p_limit: 50,
    });
    expect(isDone.error).toBeNull();
    const doneNames = (isDone.data ?? []).map((r) => r.name);
    expect(doneNames).toContain("Done one");
    expect(doneNames).not.toContain("No status");

    const empties = await userA.anon.rpc("dashboard_list_rows", {
      p_board_id: userA.boardId,
      p_filter: {
        conditions: [{ columnId: userA.statusColumnId, operator: "is_empty" }],
      },
      p_limit: 50,
    });
    expect(empties.error).toBeNull();
    const emptyNames = (empties.data ?? []).map((r) => r.name);
    expect(emptyNames).toContain("No status");
    expect(emptyNames).not.toContain("Done one");
  });

  it("applies the limit AFTER filtering (newest first)", async () => {
    // Seed 3 matching items; limit 2 ⇒ exactly 2 rows.
    for (const n of ["A", "B", "C"])
      await seedItem(userA, {
        name: `lim-${n}`,
        statusOptionId: userA.doneOptionId,
      });
    const res = await userA.anon.rpc("dashboard_list_rows", {
      p_board_id: userA.boardId,
      p_filter: {
        conditions: [
          {
            columnId: userA.statusColumnId,
            operator: "is",
            value: userA.doneOptionId,
          },
        ],
      },
      p_limit: 2,
    });
    expect(res.error).toBeNull();
    expect((res.data ?? []).length).toBe(2);
  });

  it("empty filter returns latest-N of the board (D3a parity)", async () => {
    const res = await userA.anon.rpc("dashboard_list_rows", {
      p_board_id: userA.boardId,
      p_filter: {},
      p_limit: 5,
    });
    expect(res.error).toBeNull();
    expect((res.data ?? []).length).toBeGreaterThan(0);
  });

  it("denies running against another org's board (42501)", async () => {
    const res = await userB.anon.rpc("dashboard_list_rows", {
      p_board_id: userA.boardId, // B is not a member of A's org
      p_filter: {},
      p_limit: 10,
    });
    expect(res.error).not.toBeNull();
    expect(res.error?.code).toBe("42501");
  });
});
```

- [ ] **Step 5: Run the integration tests**

Run: `pnpm test src/lib/dashboards/dashboards.rls.integration.test.ts`
Expected: PASS — all four cases (the suite `skipIf`s without a service-role key; ensure `.env.local` is present so it runs).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260618120000_dashboard_list_rows.sql src/types/database.types.ts src/lib/dashboards/dashboards.rls.integration.test.ts
git commit -m "feat(dashboards): dashboard_list_rows filter rpc + types + rls tests (d3b)"
```

---

## Task 4: `getWidgetRows` uses the RPC

**Files:**

- Modify: `src/lib/dashboards/actions.ts:234-311` (`getWidgetRows`)

The only change is the **first query**: replace the direct `items` select with the RPC, passing the filter from config. Everything downstream (`itemIds`, the columns query, the cells query, row shaping) is unchanged — it already keys off `itemIds` and `columnIds`.

- [ ] **Step 1: Modify the first query**

In `getWidgetRows`, change the config destructure and the items fetch.

Replace:

```ts
const config = (widget.config ?? {}) as {
  columnIds?: string[];
  limit?: number;
};
const columnIds = Array.isArray(config.columnIds) ? config.columnIds : [];
const limit = Math.min(Math.max(config.limit ?? 25, 1), 100);

const { data: items } = await supabase
  .from("items")
  .select("id, name")
  .eq("board_id", widget.source_board_id)
  .order("created_at", { ascending: false })
  .limit(limit);
const itemIds = (items ?? []).map((i) => i.id);
```

With:

```ts
const config = (widget.config ?? {}) as {
  columnIds?: string[];
  limit?: number;
  filter?: unknown;
};
const columnIds = Array.isArray(config.columnIds) ? config.columnIds : [];
const limit = Math.min(Math.max(config.limit ?? 25, 1), 100);

// Bounded, indexed, membership-checked row fetch — LIMIT applied after the
// filter inside the RPC (D3b). Empty/absent filter ⇒ latest-N (D3a parity).
const { data: items } = await supabase.rpc("dashboard_list_rows", {
  p_board_id: widget.source_board_id,
  p_filter: (config.filter ?? {}) as Json,
  p_limit: limit,
});
const itemIds = (items ?? []).map((i) => i.item_id);
```

Then update the two later references that read `it.id` from the items list. In the cells query block and the final `rows` map, the items rows now expose `item_id`/`name` (not `id`/`name`). Change the final map:

Replace:

```ts
const rows = (items ?? []).map((it) => ({
  itemId: it.id,
  name: it.name,
  cells: Object.fromEntries(
    columnIds.map((cid) => [cid, cellMap.get(`${it.id}:${cid}`) ?? null]),
  ),
}));
```

With:

```ts
const rows = (items ?? []).map((it) => ({
  itemId: it.item_id,
  name: it.name,
  cells: Object.fromEntries(
    columnIds.map((cid) => [cid, cellMap.get(`${it.item_id}:${cid}`) ?? null]),
  ),
}));
```

(`Json` is already imported at the top of `actions.ts`.)

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS — `dashboard_list_rows` is typed (Task 3 regen); `it.item_id` resolves.

- [ ] **Step 3: Run the existing dashboards unit tests**

Run: `pnpm test src/lib/dashboards`
Expected: PASS (no unit test mocks the removed `.from("items")` shape; `list-rows.test.ts` tests `formatCell`, untouched).

- [ ] **Step 4: Commit**

```bash
git add src/lib/dashboards/actions.ts
git commit -m "feat(dashboards): getWidgetRows fetches via dashboard_list_rows (d3b)"
```

---

## Task 5: `FilterBuilder` UI component

**Files:**

- Create: `src/components/dashboards/FilterBuilder.tsx`
- Test: `src/components/dashboards/FilterBuilder.test.tsx`

A controlled component: given the board's columns and the current `ListFilter`, it renders the combinator toggle + condition rows and calls `onChange` with the next filter. Pure presentation over the value passed in — no data fetching.

**UI/design:** load `pulse-ui` + `frontend-design` before styling (working-agreement rule 3). Reuse the `selectClass` pattern + shadcn `Input`/`Button` already used in `AddWidgetDialog`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/dashboards/FilterBuilder.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterBuilder, type FilterColumn } from "./FilterBuilder";
import type { ListFilter } from "@/lib/validations/dashboards";

const COLS: FilterColumn[] = [
  {
    id: "c-status",
    name: "Status",
    kind: "status",
    options: [{ id: "o1", label: "Done", color: "#16a34a" }],
  },
  { id: "c-num", name: "Score", kind: "numbers", options: [] },
];
const EMPTY: ListFilter = { combinator: "and", conditions: [] };

describe("FilterBuilder", () => {
  it("adds a condition when '+ Add condition' is clicked", () => {
    const onChange = vi.fn();
    render(<FilterBuilder columns={COLS} value={EMPTY} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /add condition/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        conditions: [expect.objectContaining({ columnId: "c-status" })],
      }),
    );
  });

  it("offers only the selected column kind's operators", () => {
    const value: ListFilter = {
      combinator: "and",
      conditions: [{ columnId: "c-num", operator: "num_eq", value: "" }],
    };
    render(<FilterBuilder columns={COLS} value={value} onChange={vi.fn()} />);
    const opSelect = screen.getByLabelText(/operator/i);
    const opts = Array.from(opSelect.querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    expect(opts).toContain(">");
    expect(opts).not.toContain("contains");
  });

  it("hides the value control for is_empty", () => {
    const value: ListFilter = {
      combinator: "and",
      conditions: [{ columnId: "c-status", operator: "is_empty" }],
    };
    render(<FilterBuilder columns={COLS} value={value} onChange={vi.fn()} />);
    expect(screen.queryByLabelText(/value/i)).toBeNull();
  });

  it("removes a condition", () => {
    const onChange = vi.fn();
    const value: ListFilter = {
      combinator: "and",
      conditions: [{ columnId: "c-status", operator: "is_empty" }],
    };
    render(<FilterBuilder columns={COLS} value={value} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /remove condition/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ conditions: [] }),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/components/dashboards/FilterBuilder.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `src/components/dashboards/FilterBuilder.tsx`:

```tsx
"use client";

import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  operatorsForKind,
  valueControlFor,
  OPERATOR_LABEL,
} from "@/lib/dashboards/filter-meta";
import type {
  FilterCondition,
  FilterOperator,
  ListFilter,
} from "@/lib/validations/dashboards";

export type FilterColumn = {
  id: string;
  name: string;
  kind: string;
  options: { id: string; label: string; color?: string }[];
};

const selectClass =
  "bg-background w-full rounded-md border px-2 py-1.5 text-sm";

export function FilterBuilder({
  columns,
  value,
  onChange,
}: {
  columns: FilterColumn[];
  value: ListFilter;
  onChange: (next: ListFilter) => void;
}) {
  const conditions = value.conditions ?? [];

  function update(next: Partial<ListFilter>) {
    onChange({ combinator: value.combinator ?? "and", conditions, ...next });
  }

  function addCondition() {
    const first = columns[0];
    if (!first) return;
    const op = operatorsForKind(first.kind)[0];
    update({
      conditions: [...conditions, { columnId: first.id, operator: op }],
    });
  }

  function patchAt(i: number, patch: Partial<FilterCondition>) {
    update({
      conditions: conditions.map((c, idx) =>
        idx === i ? { ...c, ...patch } : c,
      ),
    });
  }

  function removeAt(i: number) {
    update({ conditions: conditions.filter((_, idx) => idx !== i) });
  }

  if (columns.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        This board has no columns to filter on.
      </p>
    );
  }

  return (
    <fieldset className="text-sm">
      <legend className="mb-1">Filter</legend>
      {conditions.length >= 2 ? (
        <div className="mb-2 inline-flex overflow-hidden rounded-md border text-xs">
          {(["and", "or"] as const).map((c) => (
            <button
              key={c}
              type="button"
              className={
                value.combinator === c
                  ? "bg-primary text-primary-foreground px-2.5 py-1"
                  : "px-2.5 py-1"
              }
              onClick={() => update({ combinator: c })}
            >
              {c.toUpperCase()}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {conditions.map((cond, i) => {
          const col = columns.find((c) => c.id === cond.columnId);
          const kind = col?.kind ?? "text";
          const control = valueControlFor(kind, cond.operator);
          return (
            <div key={i} className="flex items-center gap-1.5">
              <select
                aria-label="Filter column"
                className={selectClass}
                value={cond.columnId}
                onChange={(e) => {
                  const nextCol = columns.find((c) => c.id === e.target.value)!;
                  patchAt(i, {
                    columnId: nextCol.id,
                    operator: operatorsForKind(nextCol.kind)[0],
                    value: undefined,
                  });
                }}
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter operator"
                className={selectClass}
                value={cond.operator}
                onChange={(e) =>
                  patchAt(i, {
                    operator: e.target.value as FilterOperator,
                    value: undefined,
                  })
                }
              >
                {operatorsForKind(kind).map((op) => (
                  <option key={op} value={op}>
                    {OPERATOR_LABEL[op]}
                  </option>
                ))}
              </select>

              {control === "none" ? null : control === "option" ? (
                <select
                  aria-label="Filter value"
                  className={selectClass}
                  value={typeof cond.value === "string" ? cond.value : ""}
                  onChange={(e) => patchAt(i, { value: e.target.value })}
                >
                  <option value="">Select…</option>
                  {(col?.options ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  aria-label="Filter value"
                  type={
                    control === "number"
                      ? "number"
                      : control === "date"
                        ? "date"
                        : "text"
                  }
                  value={
                    cond.value === undefined || cond.value === null
                      ? ""
                      : String(cond.value)
                  }
                  onChange={(e) =>
                    patchAt(i, {
                      value:
                        control === "number"
                          ? e.target.value === ""
                            ? undefined
                            : Number(e.target.value)
                          : e.target.value,
                    })
                  }
                />
              )}

              <button
                type="button"
                aria-label="Remove condition"
                className="text-muted-foreground hover:text-foreground shrink-0 p-1"
                onClick={() => removeAt(i)}
              >
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="mt-2"
        onClick={addCondition}
      >
        <Plus className="mr-1.5 size-4" /> Add condition
      </Button>
    </fieldset>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/components/dashboards/FilterBuilder.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboards/FilterBuilder.tsx src/components/dashboards/FilterBuilder.test.tsx
git commit -m "feat(dashboards): filter-builder ui component (d3b)"
```

---

## Task 6: Mount `FilterBuilder` in the add-widget dialog

**Files:**

- Modify: `src/components/dashboards/AddWidgetDialog.tsx`

`BoardOption.allColumns` is `{id,name,kind}[]` but `FilterColumn` needs `options` for status pickers. Extend the page loader's `allColumns` to carry options. (Confirm the loader: `src/app/.../dashboards/[dashboardId]/page.tsx` — the query that builds `allColumns`. Add `settings`→`options` like `getWidgetRows` does, using `optionSchema`.)

- [ ] **Step 1: Extend `BoardOption.allColumns` with options**

In `AddWidgetDialog.tsx`, change the type (line 23):

```ts
  allColumns: {
    id: string;
    name: string;
    kind: string;
    options: { id: string; label: string; color?: string }[];
  }[];
```

Then update the page loader that constructs `boards: BoardOption[]` to include `options` per column (parse `settings.options` with `optionSchema` from `@/lib/validations/boards`, mapping to `{id,label,color}`). Locate it:

Run: `grep -rn "allColumns" src/app`
Expected: one RSC loader building `allColumns`. Add the parsed `options` array to each column object there (mirror the parse in `actions.ts:281-285`).

- [ ] **Step 2: Add filter state + render the builder in the List branch**

In `AddWidgetDialog.tsx`:

Add the import and state:

```ts
import { FilterBuilder } from "@/components/dashboards/FilterBuilder";
import type { ListFilter } from "@/lib/validations/dashboards";
```

```ts
const [filter, setFilter] = useState<ListFilter>({
  combinator: "and",
  conditions: [],
});
```

Add `setFilter({ combinator: "and", conditions: [] })` to `reset()` and to the source-board `onChange` reset block (filter columns belong to the old board otherwise).

In `submit()`, change the list config line:

```ts
    } else if (kind === "list") {
      config =
        filter.conditions.length > 0
          ? { columnIds, limit, filter }
          : { columnIds, limit };
    } else {
```

In the List JSX branch (after the "Max rows" label, before the closing `</>`), add:

```tsx
<FilterBuilder
  columns={board?.allColumns ?? []}
  value={filter}
  onChange={setFilter}
/>
```

- [ ] **Step 3: Typecheck + run dashboards component tests**

Run: `pnpm typecheck && pnpm test src/components/dashboards`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboards/AddWidgetDialog.tsx src/app
git commit -m "feat(dashboards): add-widget list filter + columns carry options (d3b)"
```

---

## Task 7: Per-widget List config editor

**Files:**

- Create: `src/components/dashboards/EditListWidgetDialog.tsx`
- Modify: `src/components/dashboards/DashboardWidget.tsx`

The editor reuses the existing `editWidget` mutation (`use-dashboard-mutations.ts`) → `updateWidgetConfig`, which re-validates config against the widget kind. It needs the source board's columns; `DashboardWidget` doesn't currently receive board options, so pass them down from the canvas.

- [ ] **Step 1: Thread board options to `DashboardWidget`**

`DashboardCanvas.tsx` already renders `DashboardWidget` and has access to the dashboard's boards (it renders `AddWidgetDialog boards={...}`). Add a `boards: BoardOption[]` prop to `DashboardWidget` and pass it through from the canvas. (Reuse the `BoardOption` type exported from `AddWidgetDialog`.)

Run: `grep -n "DashboardWidget\|boards" src/components/dashboards/DashboardCanvas.tsx`
Confirm the boards array is in scope; add `boards={boards}` to the `<DashboardWidget … />` render and `boards: BoardOption[]` to `DashboardWidget`'s props.

- [ ] **Step 2: Create the editor dialog**

Create `src/components/dashboards/EditListWidgetDialog.tsx`:

```tsx
"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FilterBuilder } from "@/components/dashboards/FilterBuilder";
import type { BoardOption } from "@/components/dashboards/AddWidgetDialog";
import { useDashboardMutations } from "@/lib/dashboards/use-dashboard-mutations";
import type { CacheWidget } from "@/lib/dashboards/cache";
import type { ListFilter } from "@/lib/validations/dashboards";

export function EditListWidgetDialog({
  widget,
  board,
  dashboardId,
  open,
  onOpenChange,
}: {
  widget: CacheWidget;
  board: BoardOption | undefined;
  dashboardId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { editWidget } = useDashboardMutations(dashboardId);
  const cfg = (widget.config ?? {}) as {
    columnIds?: string[];
    limit?: number;
    filter?: ListFilter;
  };
  const [columnIds, setColumnIds] = useState<string[]>(cfg.columnIds ?? []);
  const [limit, setLimit] = useState(cfg.limit ?? 25);
  const [filter, setFilter] = useState<ListFilter>(
    cfg.filter ?? { combinator: "and", conditions: [] },
  );
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    const config =
      filter.conditions.length > 0
        ? { columnIds, limit, filter }
        : { columnIds, limit };
    editWidget.mutate(
      { widgetId: widget.id, config },
      {
        onSuccess: () => onOpenChange(false),
        onError: (e) => setError(e.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit list widget</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <fieldset className="text-sm">
            <legend className="mb-1">Columns to show</legend>
            <div className="flex flex-col gap-1 rounded-md border p-2">
              {(board?.allColumns ?? []).map((c) => (
                <label key={c.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-primary size-4"
                    checked={columnIds.includes(c.id)}
                    onChange={(e) =>
                      setColumnIds((prev) =>
                        e.target.checked
                          ? [...prev, c.id]
                          : prev.filter((id) => id !== c.id),
                      )
                    }
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="text-sm">
            Max rows
            <Input
              type="number"
              min={1}
              max={100}
              className="mt-1"
              value={limit}
              onChange={(e) =>
                setLimit(
                  Math.min(Math.max(Number(e.target.value) || 1, 1), 100),
                )
              }
            />
          </label>
          <FilterBuilder
            columns={board?.allColumns ?? []}
            value={filter}
            onChange={setFilter}
          />
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={editWidget.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Add an "Edit" menu item for List widgets**

In `DashboardWidget.tsx`: import `useState`, `Pencil` (lucide), `EditListWidgetDialog`, and `BoardOption`. Accept the new `boards` prop. Add `const [editOpen, setEditOpen] = useState(false);`. In the dropdown menu, **above** the Delete item, render (List only):

```tsx
{
  widget.kind === "list" ? (
    <DropdownMenuItem onClick={() => setEditOpen(true)}>
      <Pencil className="mr-2 size-4" /> Edit
    </DropdownMenuItem>
  ) : null;
}
```

After the menu (still inside the root `div`), render the dialog for List widgets:

```tsx
{
  widget.kind === "list" ? (
    <EditListWidgetDialog
      widget={widget}
      board={boards.find((b) => b.id === widget.source_board_id)}
      dashboardId={dashboardId}
      open={editOpen}
      onOpenChange={setEditOpen}
    />
  ) : null;
}
```

- [ ] **Step 4: Typecheck + run dashboards component tests**

Run: `pnpm typecheck && pnpm test src/components/dashboards`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboards/EditListWidgetDialog.tsx src/components/dashboards/DashboardWidget.tsx src/components/dashboards/DashboardCanvas.tsx
git commit -m "feat(dashboards): per-widget list config editor with filter (d3b)"
```

---

## Task 8: e2e — add a List widget with a status filter

**Files:**

- Modify: `e2e/dashboards.spec.ts`

Follow the existing spec's patterns (sign-in helper, creating a dashboard, adding a widget). Add a case that adds a List widget, adds one status condition in the builder, asserts only matching rows render, reloads, and asserts the filter persists.

- [ ] **Step 1: Read the existing spec to reuse helpers**

Run: `sed -n '1,60p' e2e/dashboards.spec.ts`
Identify the sign-in + create-dashboard + open-add-widget-dialog helpers already used by the D3a List test.

- [ ] **Step 2: Add the filtered-list test**

Append a test mirroring the existing List test but: after selecting kind=List and choosing a column to show, click **Add condition**, set the column select to the Status column, set the operator to `is`, pick a status option in the value select, submit, and assert the rendered rows are limited to matching items. Then `page.reload()` and assert the widget still shows the filtered rows (config persisted).

```ts
test("list widget with a status filter shows only matching rows and persists", async ({
  page,
}) => {
  // ... reuse: sign in, open a dashboard, open Add widget dialog ...
  await page.getByLabel("Widget type").selectOption("list");
  // choose a column to show (first checkbox)
  await page.getByRole("checkbox").first().check();
  // add one filter condition
  await page.getByRole("button", { name: /add condition/i }).click();
  await page.getByLabel("Filter column").selectOption({ label: "Status" });
  await page.getByLabel("Filter operator").selectOption("is");
  await page.getByLabel("Filter value").selectOption({ index: 1 }); // first real option
  await page.getByRole("button", { name: "Add widget" }).click();

  const widget =
    page.getByText(/* the widget title or a known matching item name */);
  await expect(widget).toBeVisible();

  await page.reload();
  await expect(widget).toBeVisible(); // filter persisted via config
});
```

(Fill the sign-in/setup lines by copying the existing List test's preamble verbatim — do not invent new auth flow.)

- [ ] **Step 3: Run the e2e suite**

Run: `pnpm test:e2e e2e/dashboards.spec.ts`
Expected: PASS (all dashboards e2e, including the new case).

- [ ] **Step 4: Commit**

```bash
git add e2e/dashboards.spec.ts
git commit -m "test(dashboards): e2e list widget with a status filter (d3b)"
```

---

## Task 9: Full gate + advisors

- [ ] **Step 1: Run the full verification gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 2: Check Supabase advisors**

Use the Supabase MCP `get_advisors` (security + performance) for the linked project.
Expected: no new warnings introduced by `dashboard_list_rows` (it's SECURITY DEFINER with `set search_path = ''` + membership check — the same shape advisors already accept for `dashboard_aggregate`).

- [ ] **Step 3: Final commit (if any lint/format fixups)**

```bash
git add -A
git commit -m "chore(dashboards): d3b gate green + advisors clean"
```

- [ ] **Step 4: Push**

```bash
git push origin develop
```

---

## Self-review notes (author)

- **Spec coverage:** §2 schema → Task 1; per-kind operators → Task 2; §3 RPC (incl. cast guards, AND/OR, post-filter LIMIT, 42501) → Task 3; §4 Server Action + budget → Task 4; §5 builder UI → Task 5–6; per-widget List config editing → Task 7; §6 testing → Tasks 1–3,5,8 + gate Task 9.
- **Deferred-by-design (logged):** dropdown/people value-matching (empties only) — Task 2 encodes this; no task implements array-contains, matching spec §2/§8.
- **Type consistency:** `ListFilter`/`FilterCondition`/`FilterOperator` exported from `dashboards.ts` (Task 1) and consumed unchanged in Tasks 2,5,6,7. RPC return `item_id` propagated through Task 4's row map. `FilterColumn.options` (Task 5) is fed by `allColumns.options` added in Task 6.
- **Process:** one file per task/agent; Task 6 touches `AddWidgetDialog.tsx` + the page loader (both add-flow); Task 7 touches the editor + `DashboardWidget` + canvas (edit-flow) — no overlap with other in-flight tasks.
