---
type: adr
status: accepted
date: 2026-06-19
tags: [adr, gotcha, supabase, triggers, testing, cascade-delete]
---

# Gotcha 23 — AFTER-DELETE cell-activity trigger blocked cascade deletes (and tests leaked cloud data)

## Context

`public.tg_log_cell_activity` is an AFTER INSERT/UPDATE/DELETE trigger on `cell_values` that logs
into `item_activities`. The DELETE branch unconditionally re-inserted an `item_activities` row.

## The trap

Deleting an org/board/item cascades to `cell_values`. The DELETE trigger then fired and tried to
insert into `item_activities (org_id, board_id, item_id, …)` — but those parents were mid-cascade
and gone, so the insert hit `item_activities`' FKs → **FK violation aborts the whole cascade.** Net
effect: **any org/board with cell history was undeletable.** That blocked test-data cleanup and any
future delete-org feature.

Compounding it: `*.integration.test.ts` run against the **live cloud project** (no local Supabase
stack), provisioning throwaway `@example.com` users + orgs. With deletes blocked, cleanup silently
no-op'd and the project leaked ~3,400 users/orgs.

## The fix / rule

- Migration `20260619230000_fix_cell_activity_cascade_delete.sql` guards the DELETE branch:
  `if exists (select 1 from public.items where id = old.item_id)` — log only a real user cell-clear
  (item survives); skip during a cascade. Verified: a temp org+board+group+item+cell_value now
  `delete from organizations` cascades with no FK error.
- Vitest `globalSetup` (`src/test/global-teardown.ts`) runs once post-run: lists `@example.com`
  users (service role, paginated), deletes their orgs (now cascading), deletes `admin_audit_log`
  rows referencing them, then deletes the users. Keeps the cloud project clean after every run.

## Manual purge recipe (one-off cleanups)

```sql
alter table public.cell_values disable trigger tg_log_cell_activity;  -- + any other activity trigger
-- delete @example.com orgs (by created_by) and any platform audit rows, then auth users
alter table public.cell_values enable trigger tg_log_cell_activity;
```

With the trigger now cascade-safe, disabling triggers is no longer required — prefer the automated
teardown.
