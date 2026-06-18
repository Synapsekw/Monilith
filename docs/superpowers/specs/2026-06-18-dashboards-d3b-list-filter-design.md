---
type: spec
status: draft
date: 2026-06-18
phase: 8 (slice D3b)
tags: [spec, dashboards, phase-8, filter]
related:
  - "[[2026-06-17-dashboards-cross-board-design]]"
  - "[[2026-06-17-2155-dashboards-d3a-list-widget]]"
  - "[[2026-06-17-2155-gotcha-15-subagent-scope-overstep-shared-checkout]]"
  - "[[00-north-star]]"
---

# Dashboards D3b — List-widget multi-condition filter — design

> Phase 8, final dashboards slice. Adds a **multi-condition filter** to the **List** widget shipped
> in D3a. A flat list of conditions joined by a single AND/OR toggle, translated into one bounded,
> indexed, membership-checked SQL query that applies `LIMIT` **after** filtering. Closes the
> dashboards widget subsystem (Number, Chart, Battery, List + filter).

## 1. Goal & scope

D3a delivered the List widget — bounded latest-N rows of one source board (item name + chosen
columns). D3b makes that list **filterable**: the user composes conditions over the board's columns
and sees only matching rows (still bounded by the existing `limit`).

Locked in brainstorming (`2026-06-18`):

- **Lean, flat AND/OR.** A flat list of conditions joined by a single `combinator` toggle
  (Monday-style). **No nested condition groups.** Tight per-kind operator set (§2). Covers the
  common cases and closes the subsystem fast.
- **List widget only.** Aggregate widgets (Number/Chart/Battery) continue to aggregate the whole
  source board — filters on aggregate widgets remain out of scope (as in the subsystem spec).
- **Approach A — a dedicated filter RPC** (`dashboard_list_rows`), the only option that keeps the
  read bounded+indexed on a growing `cell_values` table. Mirrors the `dashboard_aggregate` spine.
- **Per-widget config editing** is introduced **for the List kind only** — enough to edit a list's
  columns/limit/filter. A general config editor for all widget kinds stays deferred.

### Out of scope (YAGNI)

- Nested condition groups (`(A AND B) OR C`); relative date ranges (this week / overdue);
  Numbers `between`; multi-value `is one of` pickers. (Future "rich filter" tier if asked for.)
- Filters on aggregate widgets (Number/Chart/Battery).
- A general per-widget config editor for non-List kinds.
- Saved/named filters, filter sharing.

## 2. Condition model & config (Zod, boundary-validated)

Extend `listConfigSchema` (`src/lib/validations/dashboards.ts`) with an optional `filter`. Absent
`filter`, or `conditions: []`, behaves **exactly like D3a** (latest-N, fully backward-compatible).

```ts
const filterOperator = z.enum([
  "is",
  "is_not", // status
  "contains",
  "eq", // text (eq = exact match)
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

const filterCondition = z.object({
  columnId: z.string().uuid(),
  operator: filterOperator,
  // unused for is_empty / not_empty
  value: z.union([z.string(), z.number(), z.null()]).optional(),
});

// inside listConfigSchema:
filter: z.object({
  combinator: z.enum(["and", "or"]).default("and"),
  conditions: z.array(filterCondition).max(10).default([]),
}).optional();
```

- Status condition `value` = the **optionId**; People (if a `people` operator is later added) =
  **userId** — string ids, never labels. The builder supplies the right picker so the stored value
  is an id.
- Operators are **offered per column kind** in the UI (§4); the schema accepts the union, the UI
  constrains which appear. An operator that is semantically wrong for a kind simply won't be
  offered, and the RPC's value test is keyed off the **column's kind**, not the operator name alone.

### Per-kind operator availability (UI)

| Kind     | Operators offered                                  |
| -------- | -------------------------------------------------- |
| status   | is, is_not, is_empty, not_empty                    |
| text     | contains, eq, is_empty, not_empty                  |
| numbers  | num_eq, num_ne, gt, lt, is_empty, not_empty        |
| date     | before, after, on, is_empty, not_empty             |
| dropdown | is_empty, not_empty (value match deferred — array) |
| people   | is_empty, not_empty (value match deferred — array) |

> Dropdown/People value-matching (array-contains) is deferred to keep the lean tier small; their
> empty/not-empty checks still work. This is an explicit, logged cut, not an oversight.

## 3. Filter RPC — `dashboard_list_rows` (the bounded engine)

New migration. `SECURITY DEFINER`, `set search_path = ''`, membership-checked by deriving `org_id`
from `p_board_id` and raising `42501` if `auth.uid()` is not a member — the same guard shape as
`dashboard_aggregate`.

```sql
create function public.dashboard_list_rows(
  p_board_id uuid,
  p_filter   jsonb default '{}'::jsonb,   -- { combinator, conditions: [...] }
  p_limit    int   default 25
) returns table (item_id uuid, name text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$ ... $$;
```

Behaviour:

- Clamp `p_limit` to `[1, 100]`.
- Parse `p_filter->'conditions'`; if empty/absent → return latest-N items of the board (D3a parity).
- For each condition build a predicate against the item `i`:
  - **non-empty operators:** `EXISTS (select 1 from public.cell_values cv where cv.item_id = i.id
and cv.column_id = <cid> and <value-test>)`.
  - **is_empty:** `NOT EXISTS (… cv with a non-null field …)` — items lacking a `cell_values` row
    entirely count as empty (mirrors the aggregate's LEFT-JOIN "None" handling).
  - **not_empty:** the corresponding `EXISTS (… non-null field …)`.
- Join predicates with `AND` or `OR` per `combinator` (default `and`).
- `ORDER BY i.created_at DESC LIMIT p_limit` — **LIMIT applied after filtering, in SQL.** This is
  what keeps the read bounded regardless of how many rows match.

Value-test per **column kind** (jsonb shapes confirmed from `src/lib/dashboards/list-rows.ts`):

| Operator           | Test on `cv.value`                                       |
| ------------------ | -------------------------------------------------------- |
| is / is_not        | `cv.value->>'optionId'` equals / not-equals `v` (status) |
| contains           | `cv.value->>'text'` ILIKE-wraps `v` with `%…%`           |
| eq                 | `cv.value->>'text' = v`                                  |
| num_eq/ne/gt/lt    | `(cv.value->>'n')::numeric =,<>,>,< v::numeric`          |
| before/after/on    | `(cv.value->>'date')::date <,>,= v::date`                |
| is_empty/not_empty | invert/keep EXISTS on the kind's non-null field          |

**Safety:** condition values are bound as **typed parameters** inside the predicate (e.g. via
`format(..., %L)` only for the cast-target text, or dynamic SQL with `USING` params) — never raw
string-concatenated into the statement. Invalid numeric/date casts are guarded (a malformed value
yields no match rather than erroring the whole widget).

## 4. Server Action & data-fetching budget

`getWidgetRows` (`src/lib/dashboards/actions.ts`) changes its **first query only**:

- D3a: `from("items").select("id,name").eq("board_id",…).order(created_at desc).limit(N)`.
- D3b: `rpc("dashboard_list_rows", { p_board_id, p_filter: config.filter ?? {}, p_limit })`
  → `{ item_id, name, created_at }[]` (already ordered + bounded).

The **second query is unchanged**: fetch `cell_values` for the chosen **display** columns over just
the returned item ids (`.in("item_id", ids).in("column_id", columnIds)`), then shape rows exactly as
D3a does. Display columns and filter columns are independent (you can filter on a column you don't
display). Cache key is unchanged — `filter` lives in `config`, so the existing
`["dashboard-widget-rows", id, configHash]` already varies on it.

### Data-fetching budget (working-agreement rule 5)

| Moment                        | What loads                                                     | Round-trips                         |
| ----------------------------- | -------------------------------------------------------------- | ----------------------------------- |
| **First paint / refresh**     | `dashboard_list_rows` (bounded ≤ N) + cells `.in` over ≤ N ids | 1 RPC + 1 cells query (same as D3a) |
| **Edit this widget's filter** | re-run **only this widget's** rows query (new configHash)      | 1 (scoped to the edited widget)     |
| **Other widgets**             | nothing                                                        | 0                                   |
| **Drag / resize / reorder**   | nothing — client layout state, debounced `saveLayout`          | **0 data refetch**                  |

- **Bounded:** LIMIT is applied post-filter inside the RPC; the cells query is `.in` over ≤ N ids.
- **Indexed:** `cell_values.board_id` (`cell_values_board_id_idx`) + `column_id`
  (`cell_values_column_id_idx`); `items.board_id` (`items_board_id_idx`). No unbounded `select *`.
- Filtering is **server data shaping**, fetched via the RPC on mount/refresh — not an in-page
  client toggle over already-loaded data. Editing the filter is a config mutation → re-query that
  one widget (correct under rule 5(b): it changes what server rows the widget shows).

## 5. Filter-builder UI

List-kind only, in **both** the add-widget dialog and a new **per-widget config editor** (List
kind). Below the existing column multi-select + max-rows, a **Filter** section:

- An **AND / OR** segmented toggle (the `combinator`). Hidden/disabled until ≥ 2 conditions exist.
- A list of **condition rows**, each: **column** select (source board's columns) → **operator**
  select (constrained to the column's kind, §2) → **value** control that switches by kind:
  - status → option picker (the column's status options); numbers → number input; date → date
    input; text → text input; `is_empty`/`not_empty` → **no value control**.
- **+ Add condition** appends a row (max 10); each row has a remove ✕.
- Empty condition list → no filter applied, no filter chip.

Per-widget config editing for the List kind reuses `updateWidgetConfig` (already exists from D1) —
D3b only adds the List config editor surface + the filter sub-form. Built with existing shadcn
primitives and pulse-ui tokens; the `pulse-ui` + `frontend-design` skills are loaded at build time
(working-agreement rule 3).

## 6. Testing (mandatory — written + executed)

- **Unit / pure:**
  - `filterCondition` / `listConfigSchema` Zod — valid + invalid per operator; default combinator;
    `conditions: []` and absent `filter` both equal D3a behaviour (backward-compat).
  - operator → value-test mapping helper (per kind); `configHash` varies on `filter`.
- **RPC integration (live, cross-org):**
  - each operator returns the correct item ids (`is`, `is_not`, `contains`, `eq`, numeric compares,
    date compares, `is_empty`, `not_empty`);
  - **AND vs OR** combinator over two conditions;
  - `is_empty` catches items with **no** `cell_values` row for the column;
  - **LIMIT is applied after filtering** (more matches than the limit → exactly `limit` rows, newest
    first);
  - **RLS denies** calling `dashboard_list_rows` against another org's board → `42501`.
- **Component:** builder adds/removes conditions; operator list reacts to the selected column's
  kind; value control switches by kind; editing a List widget's filter re-queries only that widget.
- **e2e (Playwright):** add a List widget → add a `Status is Done` condition → only matching rows
  render → reload → filter persists → **0 data refetch on drag** still holds.
- **Gate (slice):** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green + advisors clean
  before "done".

## 7. Build approach & process guardrail

- **Migration:** new `dashboard_list_rows` function + regenerate `src/types/database.types.ts`
  (`pnpm db:types`, filter the PostHog `"_tag"` telemetry line before prettier — known gotcha), both
  committed in the same PR. Apply via `supabase db push --linked` only with explicit per-session
  authorization.
- **Subagent-driven, one file per agent, confirmed idle before dispatching the next** — explicitly
  heeding [[2026-06-17-2155-gotcha-15-subagent-scope-overstep-shared-checkout]] (the shared-checkout
  scope-overstep seen in D3a). No two agents editing the same file concurrently in this one checkout.

## 8. Risks / open questions

- **Dynamic SQL in the RPC.** Building per-condition predicates needs careful parameter binding to
  stay injection-safe and type-safe; malformed values must degrade to "no match", not error the
  widget. Covered by the RPC integration tests; verify the binding approach in the first build step.
- **Dropdown/People value-matching deferred** — only empty/not-empty for those kinds in v1. Logged
  cut (§2); revisit if a "rich filter" tier is requested.
- **Date storage is text** (`value->>'date'` ISO string) — `::date` cast assumes well-formed ISO;
  the cast guard (§3 safety) handles stragglers.
