---
type: spec
status: approved
date: 2026-06-19
phase: 5c-1
title: Automations — run-history (Phase 5c-1)
tags: [project/pulse, spec, phase-5, automations, observability]
related:
  - "[[2026-06-18-phase-5b2-automations-design]]"
  - "[[2026-06-18-phase-5b1-automations-design]]"
  - "[[2026-06-18-phase-5a-automations-design]]"
  - "[[2026-06-14-pulse-design]]"
  - "[[00-north-star]]"
---

# Phase 5c-1 — Automations: run-history

## 1. Goal & context

Phase 5 (master spec §7, PRD F-9) is no-code **When / If / Then** automations. **5a** shipped the
in-DB engine (status/dropdown triggers → notify / set_option). **5b-1** added more triggers + the
"If" condition gate. **5b-2** added date-based triggers via a `pg_cron` sweep. Across all of these,
**there is no record of what an automation actually did** — a user can build a rule but cannot see
whether it fired, on which item, when, or why it did (or didn't) act. Automations are a black box.

This slice (**5c-1**) makes automations **observable**: every rule execution writes a **run-history**
row, surfaced per-rule in the builder dialog. It is **entirely in-DB** (no new infrastructure) and
sets up 5c-2 (external actions), whose webhook outcomes will land in the same history.

**Phase 5c decomposition** (decided 2026-06-19):

- **5c-1 (this spec):** run-history — an audit log of every automation execution + a per-rule
  "Recent runs" view. In-DB only. No outbound HTTP.
- **5c-2 (next spec):** external/HTTP **actions** (webhook via `pg_net`, which is available) with
  SSRF guards + async outcome capture, recording outcomes into this run-history.

**Non-goals for 5c-1:** external/HTTP actions, `pg_net`, Edge Functions (→ 5c-2); a board-level
cross-rule activity feed (per-rule view only — board-wide feed deferred); Realtime on the run list
(refetch-on-expand suffices); new trigger or action **types**; editing/retrying past runs.

### Decisions locked in brainstorming

- **Granularity:** one row per **rule-fire** (one `_automation_run` execution), with **per-action
  outcomes** in a jsonb column — not one row per action, not status-only.
- **UI surface:** **per-rule**, inside the existing `AutomationsDialog` ("Recent runs" disclosure) —
  not a board-level feed.
- **Retention:** keep the **last ~50 runs per rule**, pruned daily by `pg_cron` — bounds table size
  by rule count, not fire volume, and matches the per-rule UI exactly.
- **Where logging lives:** inside **`_automation_run`** (the single execution chokepoint all four
  trigger paths funnel through) — not duplicated per caller.
- **Fault-isolation (deliberate behavior change):** wrap the condition-check + action loop in
  `begin/exception`; an action that raises is rolled back atomically, logged as `status='error'`,
  and **swallowed** so it no longer aborts the user's triggering edit.

## 2. Data model

New table `public.automation_runs`:

```sql
create table public.automation_runs (
  id            uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations (id)    on delete cascade,
  org_id        uuid not null references public.organizations (id)  on delete cascade,
  board_id      uuid not null references public.boards (id)         on delete cascade,
  item_id       uuid          references public.items (id)          on delete set null,
  trigger_type  text not null,   -- status_changed | item_created | person_assigned | date_reached
  status        text not null,   -- 'ran' | 'blocked' | 'error'
  actions       jsonb not null default '[]'::jsonb,  -- per-action outcomes
  error         text,            -- sqlerrm when status='error', else null
  created_at    timestamptz not null default now()
);
```

- **`item_id` is `on delete set null`** (history outlives a deleted item); **`automation_id` is
  cascade** (deleting a rule discards its history).
- **`status`:** `blocked` = the If-condition gate failed (no actions run); `ran` = condition passed
  and the action loop executed (per-action outcomes in `actions`, including skips); `error` = an
  action raised (rolled back atomically; `sqlerrm` captured; swallowed).
- **`actions` outcome vocabulary** (per action): `notify` → `sent` / `skipped_dup` /
  `skipped_no_recipient` / `skipped_self`; `set_option` → `set` / `skipped_equal`. Shape:
  `[{ "type": "notify", "outcome": "sent" }, { "type": "set_option", "outcome": "skipped_equal" }]`.
  (5c-2 adds `webhook` outcomes here.)
- **RLS:** enabled; org-scoped `select` only (`is_org_member(org_id)`, mirrors
  `automation_date_fires`); **no client insert/update/delete policy** — written only by the
  `SECURITY DEFINER` engine.
- **Index:** `automation_runs_rule_recent_idx on public.automation_runs (automation_id, created_at desc)`
  — serves the per-rule "recent runs" query and the prune window scan.
- A `status` `CHECK (status in ('ran','blocked','error'))` constraint.

## 3. Engine (Postgres, in-DB)

All functions stay `SECURITY DEFINER set search_path = ''`. The depth-cap loop guard, the gotcha-17
empty-string GUC fix, and `actor` handling are preserved verbatim.

**`_automation_run` gains `p_trigger_type text`** (new final parameter) and is restructured to log:

```sql
create or replace function public._automation_run(
  p_automation_id uuid, p_actions jsonb, p_condition jsonb,
  p_item_id uuid, p_org_id uuid, p_board_id uuid, p_actor uuid,
  p_trigger_type text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a          jsonb;
  v_outcomes jsonb := '[]'::jsonb;
  v_rid uuid; v_target uuid; v_opt text; v_outcome text;
begin
  begin
    if not public._automation_conditions_pass(p_condition, p_item_id) then
      insert into public.automation_runs
        (automation_id, org_id, board_id, item_id, trigger_type, status)
        values (p_automation_id, p_org_id, p_board_id, p_item_id, p_trigger_type, 'blocked');
      return;
    end if;

    for a in select * from jsonb_array_elements(p_actions) loop
      -- existing notify / set_option logic, UNCHANGED in effect, but each branch
      -- computes v_outcome (sent | skipped_dup | skipped_no_recipient | skipped_self |
      -- set | skipped_equal) and appends { type, outcome } to v_outcomes.
      v_outcomes := v_outcomes || jsonb_build_object('type', a->>'type', 'outcome', v_outcome);
    end loop;

    insert into public.automation_runs
      (automation_id, org_id, board_id, item_id, trigger_type, status, actions)
      values (p_automation_id, p_org_id, p_board_id, p_item_id, p_trigger_type, 'ran', v_outcomes);
  exception when others then
    insert into public.automation_runs
      (automation_id, org_id, board_id, item_id, trigger_type, status, error)
      values (p_automation_id, p_org_id, p_board_id, p_item_id, p_trigger_type, 'error', sqlerrm);
  end;
end; $$;
```

- The notify/set_option branches keep their **existing behavior** (owner = first `userIds[0]`;
  member = fixed userId; self-actor excluded; unread-dupe guard for notify; skip-if-equal for
  set_option) — they additionally record the outcome they took.
- The `exception when others` rolls the action loop back to the implicit savepoint and inserts the
  `error` row in the clean handler subtransaction → **fault isolation**: a broken action logs an
  `error` run and the caller's transaction (the user's edit / the sweep) proceeds.

**Callers pass `p_trigger_type`** (the engine migration recreates these — see §1's trigger lineage):

- `tg_run_automations` (cell_values `after insert/update`): add `trigger->>'type' as trigger_type`
  to its matched-rules `select`; pass `r.trigger_type` (`status_changed` or `person_assigned`).
- `tg_run_item_automations` (items `after insert`): pass `'item_created'`.
- `_automation_date_sweep` (5b-2): pass `'date_reached'` in its `perform _automation_run(...)`.

**Prune** — keep the last 50 runs per rule, daily via `pg_cron` (extension already installed in
5b-2):

```sql
create or replace function public._automation_runs_prune() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.automation_runs ar
  using (
    select id, row_number() over (
      partition by automation_id order by created_at desc, id desc
    ) as rn
    from public.automation_runs
  ) ranked
  where ar.id = ranked.id and ranked.rn > 50;
end; $$;

select cron.schedule('automation-runs-prune', '30 3 * * *',
  $cron$ select public._automation_runs_prune() $cron$);
```

`cron.schedule` upserts by job name (idempotent migration). `50` is a literal constant (tunable
later). Tests invoke `_automation_runs_prune()` directly.

## 4. Queries + client

**Query** — `getAutomationRuns(automationId, limit = 50)` (in `src/lib/boards/queries.ts` or a
sibling): RLS-scoped, bounded `select ... where automation_id = $1 order by created_at desc limit N`,
returning typed `Tables<"automation_runs">` rows.

**Client** — extend `AutomationsDialog`: each rule row gets an expandable **"Recent runs"**
disclosure. On **expand** (not on dialog open), a TanStack `useQuery` keyed
`["automation-runs", automationId]` with `enabled` gated on the expanded state fetches the bounded
list and renders, per run: relative time, a **status badge** (`ran` / `blocked` / `error`, pulse-ui
colors), the item (resolved name if available, else id), and the per-action outcomes as human text.
Empty state: "No runs yet." A small pure **formatter** maps `trigger_type` + `status` + `actions[]`
→ a sentence (e.g. "Ran · notified owner · status unchanged"), unit-tested in isolation.

UI built with the `pulse-ui` skill (badges, disclosure, density consistent with the dialog).

## 5. Realtime

None. Run-history is reviewed on demand; expanding a rule (or collapsing/re-expanding) refetches.
Adding Realtime to the run list is out of scope (deferred, low value).

## 6. Testing

- **Integration (cloud; extend the engine integration suite):**
  - Each trigger type fires → a run row with correct `trigger_type`, `status='ran'`, and expected
    `actions` outcomes (notify `sent`; set_option `set` then `skipped_equal` on a repeat).
  - Condition-blocked → `status='blocked'`, no action effect, empty `actions`.
  - **Fault-isolation** → an action forced to raise logs `status='error'` (with `error` text) and
    does **not** abort the triggering write (the cell write still commits). Force via a deliberately
    invalid action (e.g. `set_option` targeting a since-deleted column id); if not cleanly forceable
    in-suite, document the gap and cover the error-row shape via a direct unit on the function.
  - **Prune** → insert >50 runs for one rule, run `_automation_runs_prune()`, assert exactly 50
    newest remain.
  - **RLS** → org member reads own rule's runs; cross-org member denied (0 rows); no client INSERT.
  - **Regression** → 5a/5b-1/5b-2 effects unchanged (notify/set_option/date sweep still act); depth
    cap intact.
- **Unit:** `getAutomationRuns` query shape; the run-formatter; the dialog "Recent runs" rendering
  (status badges, empty state, lazy fetch-on-expand).
- **e2e (Playwright):** build a rule, trigger it, open the dialog, expand the rule, assert the run
  appears with the right status + outcome text.

## 7. Non-functional

- **Performance & data-fetching budget:** dialog open unchanged (0 new round-trips); the runs query
  fires only on user-initiated **expand**, is **bounded** (≤50) over the **indexed**
  `(automation_id, created_at desc)`, and is genuinely new server data (not an in-page toggle over
  already-loaded data) → fetch-on-expand is correct. The prune keeps the table bounded by rule
  count. No unbounded `select *` on a growing table.
- **Security:** RLS is the boundary — `automation_runs` default-deny, org-scoped read, definer-only
  write; every new/changed function is `SECURITY DEFINER set search_path = ''`. No new outbound
  surface (that is 5c-2).
- **Behavior change:** automations become **fault-isolated** — a raising action no longer aborts the
  user's edit; it logs an `error` run. Documented in §8.
- **Schema discipline:** all via versioned migrations in `supabase/migrations/`; after applying,
  regenerate `src/types/database.types.ts` (`pnpm db:types`, filtering the PostHog `"_tag"`
  telemetry line) and run advisors; **pin `search_path`** on every function (advisor parity); RLS
  enabled on the new table.
- **Done gate:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all green + the
  integration + e2e evidence in §6, before any completion claim.

## 8. Risks / notes

- **Fault-isolation is a real behavior change.** Pre-5c-1, a raising action aborted the whole
  triggering transaction (rare, since notify/set_option are simple inserts). Post-5c-1, it is caught,
  logged as `error`, and swallowed. This is intended (a buggy rule shouldn't block a user's edit) but
  must be flagged in the session note. The date sweep already swallowed per-org; this extends the
  same robustness to the reactive paths. Re-tested: a forced error logs a row and the edit succeeds.
- **`_automation_run` signature change** ripples to 4 call sites across the 5a/5b-1/5b-2 migrations
  (the engine migration recreates the affected functions). Mechanical but must update all callers in
  the same migration or the function call fails to resolve.
- **Volume.** A high-frequency rule writes a run per fire; the per-rule×50 prune bounds the table.
  The prune runs daily — between prunes a hot rule can exceed 50 transiently (acceptable; the UI
  query is `limit 50` regardless).
- **Migrations:** one migration — `automation_runs` table + RLS + index + the `status` CHECK, the
  `_automation_run` restructure + the 3 caller updates, `_automation_runs_prune` +
  `cron.schedule`. Keep `actions` jsonb open so 5c-2 (webhook outcomes) extends without DDL.
