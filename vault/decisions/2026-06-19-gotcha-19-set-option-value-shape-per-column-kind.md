---
type: adr
status: accepted
date: 2026-06-19
tags: [adr, gotcha, supabase, postgres, automations, cell-values]
related:
  - "[[2026-06-19-0957-phase5c1-run-history]]"
  - "[[2026-06-19-gotcha-18-create-or-replace-function-overload]]"
---

# Gotcha 19 — `cell_values.value` shape is per column-kind; server-side writers must match it

## Context

Board cell values are stored as `jsonb` whose shape depends on the column **kind**
(`src/lib/validations/boards.ts`, `src/components/boards/cells/index.tsx`):

| kind     | value shape               | renderer reads    |
| -------- | ------------------------- | ----------------- |
| status   | `{ optionId: string }`    | `value.optionId`  |
| dropdown | `{ optionIds: string[] }` | `value.optionIds` |
| people   | `{ userIds: string[] }`   | `value.userIds`   |
| date     | `{ date, end? }`          | …                 |

The client write path validates against the per-kind Zod schema, so manual edits always
store the right shape. The automation engine writes `cell_values` directly (via the
`SECURITY DEFINER` `_automation_run`), **bypassing** that validation.

## The trap

The 5a engine's `set_option` action wrote the **status** shape unconditionally:

```sql
insert into public.cell_values (...) values (..., jsonb_build_object('optionId', v_opt)) ...
```

That is correct for a status target but **wrong for a dropdown target** (which needs
`{optionIds: [v_opt]}`). The builder offers **both** status and dropdown columns as
`set_option` targets (`statusColumns = columns.filter(kind === 'status' || 'dropdown')`),
so dropdown targets are reachable. The failure is **silent**: the row inserts fine (correct
org/board/column → passes RLS, FK, read), and run-history logs `set` — but `DropdownCell`
reads `value.optionIds` → `undefined` → `[]` → renders a **blank cell**. "The automation
didn't work," with no error anywhere. Found on 5c-1 run-history's first live test (the run
said `set`, the cell was blank → the data was inspected → wrong shape).

## Resolution / rule

- **Any server-side writer of `cell_values` (trigger/RPC/automation) must build the value in
  the target column's native per-kind shape** — never hardcode one kind's shape. The engine
  now looks up `columns.kind` and branches (`dropdown → {optionIds:[x]}`, else `{optionId:x}`),
  and compares equality on the full `value` (migration `20260619120000`; in-place replace, same
  signature — [[2026-06-19-gotcha-18-create-or-replace-function-overload]]). A backfill repaired
  the already-corrupted dropdown cells.
- **Test the written shape, not just the outcome.** The original `set_option` integration test
  asserted only the run `outcome='set'` (which was true!). Add an assertion on the actual
  `cell_values.value` for each target kind. A "ran/set" log is not proof the cell is renderable.
- General lesson: a status badge that says success (`set`) is observability, not verification —
  it confirms the engine _acted_, not that it wrote something the client can read.
