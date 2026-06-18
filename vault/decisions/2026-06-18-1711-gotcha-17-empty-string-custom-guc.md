---
type: adr
status: accepted
date: 2026-06-18
tags: [adr, gotcha, supabase, postgres, triggers]
related:
  - "[[2026-06-18-phase-5a-automations-design]]"
  - "[[2026-06-18-1711-phase5a-automations]]"
---

# Gotcha 17 — `current_setting(name, true)` returns `''` (not NULL) for a custom GUC on a pooled connection

## Context

The Phase 5a automation engine (`tg_run_automations`) uses a transaction-local custom GUC,
`pulse.aut_depth`, as a cascade depth counter to bound automation loops:

```sql
v_depth int := coalesce(current_setting('pulse.aut_depth', true)::int, 0);
...
perform set_config('pulse.aut_depth', (v_depth + 1)::text, true);
```

The intent: read the depth (NULL → 0 on first entry), increment before running actions, bail at ≥ 5.

## The trap

`current_setting('custom.name', true)` (the `missing_ok` form) does **not** reliably return `NULL`.
For a **custom/placeholder GUC** (a name with a dot, not a built-in), once that GUC has been
referenced/`set_config`'d on a connection, PostgreSQL registers it as a placeholder and subsequent
reads on that connection return an **empty string `''`** when it is "unset" — not `NULL`.

So `coalesce(current_setting(...)::int, 0)` does **not** save you: the value is `''`, not `NULL`, and
`''::int` raises `22P02 invalid input syntax for type integer: ""`. Because Supabase uses
**connection pooling**, the placeholder persists across transactions on a reused connection, so after
the first automation fired (calling `set_config`), every later `cell_values` write on that pooled
connection hit `''::int` and **aborted the whole write**. Net effect: a board-wide (effectively
global) breakage of cell editing the moment any automation row existed. Unit tests passed; the
**cloud integration test** caught it (it also regressed the existing `boards` cell-upsert test).

## Decision / fix

Guard the empty string with `nullif` before casting:

```sql
v_depth int := coalesce(nullif(current_setting('pulse.aut_depth', true), '')::int, 0);
```

`nullif(x, '')` turns both the `''` (placeholder-registered) and the genuinely-unset cases into
`NULL`, which `coalesce` then maps to `0`. Applied via a corrective `create or replace` migration
(`20260618150001_automations_engine_depth_fix.sql`) — the original migration was already applied, so
editing it in place would not re-run; a new migration is the correct path.

## How to apply (general rule)

When reading a **custom GUC** with `current_setting(name, true)` in any trigger/function, always wrap
it: `nullif(current_setting(name, true), '')`. Never cast the raw result to a numeric/typed value.
This matters most under connection pooling (Supabase/PgBouncer), where placeholder registration
survives across transactions. Lean on **cloud integration tests** for trigger logic — pure unit tests
cannot surface pooled-connection GUC behavior. See [[2026-06-18-1711-phase5a-automations]].
