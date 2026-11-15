# Command Center "Tower" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the folder Overview so every headline number shows its direction, the burn chart forecasts a finish date, a heat map shows where late and upcoming work sits, and attention is summarised per board.

**Architecture:** Everything stays inside the existing layout system (sections on the Overview canvas, presets, Customize). One migration widens `folder_burn` with two per-week columns and adds a bounded `folder_load` RPC; `_folder_item_flags` and `folder_rollup` are not touched. All trend, forecast and grid maths are pure functions in `src/lib/folders/tower.ts`, fed by rows the page already loads plus the one new read. Sparklines and the heat map are plain SVG and CSS; Recharts stays behind the existing lazy boundary.

**Tech Stack:** Next.js 16 App Router, React 19 client components, Supabase Postgres (security-definer RPCs), Zod, TanStack Query, Tailwind v4 semantic tokens, Vitest + Testing Library.

Spec: `docs/superpowers/specs/2026-11-14-command-center-tower-design.md`
Prototype (visual reference only): https://claude.ai/artifact/MdLjAYXX6cahHAgK75gdJA, option "B · Tower"

## Global Constraints

- The live deployment (`www.monolith.works`) runs the **DEV** database `hjqcahbbbdaknbbnfnvl`. A migration applied to DEV is live for real users at once.
- Migrations are minted only with `scripts/new-migration.sh <slug>`. Never hand-write a version stamp.
- Only the orchestrator applies a migration, through the `supabase-dev` MCP `apply_migration`, with the **same version and name** as the committed file, then verifies with `pnpm db:ledger-check`. Implementers never call `apply_migration` and never run DDL through `execute_sql`.
- The `supabase-dev` MCP asks the owner to confirm write statements and the confirmation **expires after 2 minutes**. The dry run and the apply (Task 2) are scheduled with the owner present.
- A rolled-back dry run is sent as **one** `execute_sql` call with **no explicit `begin`**, ending in a raised exception whose message carries the results, so Postgres rolls back the implicit transaction.
- In a worktree `pnpm db:types` fails. Regenerate types with the MCP `generate_typescript_types`, write the result to `src/types/database.types.ts`, then `pnpm prettier --write src/types/database.types.ts`. Never hand-edit that file.
- Every new SQL function: `revoke execute ... from public, anon`. Functions whose name starts with `_` are also revoked from `authenticated`.
- `ActionResult` / `fail` come from `src/lib/actions/result.ts`; RPC calls go through `typedRpc` from `src/lib/supabase/typed-rpc.ts`. Never redeclare either.
- UI tasks (5, 6, 7, 8, 9, 10) load the `pulse-ui` and `frontend-design` skills before writing a component. Semantic tokens only: no raw Tailwind colours, no box shadows, hairlines brighten on hover.
- The product is called Monolith. The word "Pulse" never appears in user-facing copy.
- Recharts stays out of first paint: `no-recharts-in-first-paint.test.ts` and `no-gantt-in-first-paint.test.ts` must pass unchanged. Sparklines and the heat map are plain SVG and CSS.
- Do not edit `src/components/folders/tabs/Timeline*.tsx`, `src/lib/folders/timeline.ts`, `src/components/boards/gantt/*`, `src/components/folders/HeaderActions.tsx`, `src/components/folders/FilterBar.tsx`.
- Commit subjects are lower-case conventional commits, header under 100 characters. Stage by path only; never `git add -A`, `git add .`, `git commit -a`.
- Implementers never run `scripts/finish-task.sh`, never merge, never push, never apply.
- Run tests in the foreground with a 600000 ms timeout. Never background `pnpm test`.
- One worktree per parallel implementer, cut from `task/command-center-tower`. Start every Bash call with `cd <absolute worktree path>`; one plain git command per call.

## Branch state and merge order

- This plan was written against `origin/develop` at `6b2ed19c`, which includes "Merge task/timeline-readability into develop" (`8e657170`). **Before Task 1 the orchestrator rebases `task/command-center-tower` onto `origin/develop` and runs `pnpm install`.** The plan's author could not do this: the authoring session was sandboxed to another worktree.
- `task/folder-invites` merges first. It replaces `_assert_folder_member`'s body for guests, adds `public.can_see_folder(uuid)`, changes `HeaderActions.tsx` and adds a folder access head to the folder payload. This plan depends on none of those: `folder_load` gates through `_assert_folder_member` and `_folder_item_flags` (which reads `_folder_readable_boards`), so it inherits the guest rule when that branch lands.
- **The one rebase risk:** both branches edit `src/lib/folders/payload.ts` and regenerate `src/types/database.types.ts`. Resolve `payload.ts` by keeping both additions; resolve the types file by regenerating it from DEV after both migrations are applied, never by hand-merging.

## Deviations from spec

1. **Spec section 3 (a real completion date) is dropped; nothing in `_folder_item_flags` changes.** The activity trigger `tg_log_cell_activity` (`supabase/migrations/20260619230000_fix_cell_activity_cascade_delete.sql:5-27`) writes an `item_activities` row on every status cell insert and every value change, so the activity timestamp and the status cell's `updated_at` are the same instant. Measured on DEV on 2026-11-14 for the DAAS folder: 663 done items, 663 with a status-to-done activity row, 663 on the same day as the cell's `updated_at`, 0 different. All 663 fall on 2026-11-14, which is also each item's creation day: the boards were imported already done. The flat step in the chart is real data, not a wrong date.
2. **Instead, `folder_burn` reports imported completions separately.** New column `imported_done` counts completions whose done date equals the item's creation date. The forecast pace leaves them out and the reading line says so. This fixes what the spec was after (a pace that is not inflated by a bulk import) with no change to shared helpers.
3. **`folder_rollup` is not touched**, so its measured 614 ms on DAAS cannot regress from this work. The timing gate moves to the two functions that do change or appear: `folder_burn` and `folder_load` (Task 2).
4. **`folder_load` returns `(board_id, stage_key, week_start, open_due)`**, non-zero rows only, capped at 5,000, where the spec gave `(board_id, week_start, open_due)` and "at most 700 rows". The stage key lets the stage filter apply to the heat map like every other section.
5. **The heat map's first column folds everything older than three weeks into it** ("≤ −3w"). DAAS's oldest overdue item is 46 days old; a strict three-week window would hide it.
6. **The heat map buckets on `planned_on`** (the latest date on an item), the same date "Due this week" and the burn chart use, not on `due_on`. Its past cells therefore need not add up to the Overdue card, which uses the earliest date. The legend says "still open", not "overdue".
7. **Trends are hidden while a board filter is set.** `folder_burn` has no board dimension (the existing `BurnScopeNote` says the same about the chart).
8. **The Overdue trend counts an item only from the week it existed** (`items.created_at`). Without this, a folder imported today would show eight weeks of invented history.
9. **The gap marker is the existing red wedge plus the gap figure in the reading line** above the chart, not a new labelled segment inside Recharts. `BurnChartInner.test.tsx` pins the chart's structure by class name.
10. **Attention group headlines show four property counts from the rollup (overdue, blocked, unassigned, stale), which can overlap.** `folder_attention` assigns each item one reason by priority; the rollup counts each property independently (`20260915142403…sql:262-270`). The headline is labelled as counts of each property, and the expanded list keeps the per-item reason.
11. **The milestone count's field is renamed `openBefore` → `open`** (`src/lib/folders/rollup.ts:45`), because it no longer means "open before this date".
12. **Tests pinned to the old project preset are updated** (Task 10 lists each one). The spec already accepts that an untouched folder gets the new layout.

## Facts verified on 2026-11-14

- **Status activity shape:** `action = 'cell_changed'`, `column_id` = the status column, `new_value = {"optionId": "<id>"}`, `old_value` null on first set or `{"optionId": …}` on a change (10,646 first-set rows and 16 change rows in the last 30 days on DEV). A done option is one whose label in `columns.settings -> 'options'` matches `(done|complete)` case-insensitively, the rule `_board_health_flags` uses (`20260707140000_soft_delete_archived_at.sql:427-436`).
- **DAAS done dates:** 663 done, 663 (100%) with a usable activity row, all on 2026-11-14 by both measures (see Deviation 1).
- **`folder_workload` already returns a late count:** `overdue_items` per person × board × stage (`20260915142403…sql:441-477`), mapped to `WorkloadRow.overdue`. `WorkloadBars` already prints "N late".
- **Latest definitions** (file wins, confirmed unchanged by later migrations): `_folder_item_flags`, `folder_rollup`, `folder_attention`, `folder_burn`, `folder_workload` in `20260915142403_folder_planned_on_and_rpc_review_fixes.sql`; `_folder_readable_boards` and `_assert_folder_member` in `20260915091205_folder_rollup_rpcs_review_fixes.sql`.
- `burnRowSchema` in `src/lib/folders/resolve.ts:56-61` is a plain `z.object`, which strips unknown keys, so the code deployed today keeps working once `folder_burn` returns two more columns. The migration can go live before the code.
- Baseline, as the board creator through RLS: `folder_rollup` on DAAS 613.7 ms (lowest of three).

## Performance and data-fetching budget

- **First paint:** one new read, `folder_load`, in wave B next to `folder_burn`. It is skipped when the layout has no `load` section or the rollup has no dated rows. `folder_burn` returns two more integer columns and the same number of rows.
- **Lazy:** the people section calls the existing `getFolderWorkload` action through TanStack Query when it nears the viewport, sharing the People tab's cache key.
- **Interactions with 0 server round-trips:** board sort, attention expand, Cumulative/Weekly, stage and board filters, Customize drafts, "See all" to the People tab.
- **Bounded:** `folder_load` returns at most 5,000 rows over a clamped window (≤ 12 weeks each way); the overdue-by-week pass in `folder_burn` is limited to the last 12 weeks.
- **Timing gate (Task 2, orchestrator):** `explain analyze` of the old `folder_burn`, the new `folder_burn` and `folder_load` on DAAS, lowest of three each. Stop if new `folder_burn` is more than 20% and more than 50 ms slower than old, or if `folder_load` is more than 20% slower than old `folder_burn`. Fallback if the gate trips: drop the `ovd` CTE from `folder_burn` and compute `overdue_open` for the current week only (one extra `count(*) filter`), which removes the item × week join; the Overdue card then shows no sparkline.

## File Structure

| File                                                                                                                     | Responsibility                                                           |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `supabase/migrations/<minted>_folder_tower.sql`                                                                          | `folder_burn` with `imported_done` and `overdue_open`; new `folder_load` |
| `docs/superpowers/plans/command-center-tower-dry-run.sql`                                                                | Rolled-back totals comparison and timings                                |
| `src/lib/folders/types.ts`                                                                                               | `BurnRow` fields, `LoadRow`, `FolderPayload.load`                        |
| `src/lib/folders/tower.ts` (new)                                                                                         | Trends, change text, forecast, load grid, attention groups, stage bars   |
| `src/lib/folders/rollup.ts`                                                                                              | `BurnPoint.importedDone`, milestone `open`                               |
| `src/lib/folders/resolve.ts`                                                                                             | burn row mapping, `resolveFolderLoad`                                    |
| `src/lib/folders/layout.ts`                                                                                              | `layoutNeedsLoad`                                                        |
| `src/lib/folders/payload.ts`                                                                                             | wave-B `folder_load` read                                                |
| `src/components/folders/charts/Sparkline.tsx` (new)                                                                      | SVG line or bars                                                         |
| `src/components/folders/charts/KpiCard.tsx`                                                                              | optional trend row                                                       |
| `src/components/folders/panels/KpisPanel.tsx`                                                                            | trends, zero-card chips                                                  |
| `src/components/folders/charts/StageBars.tsx` (new)                                                                      | "Items by stage" bars                                                    |
| `src/components/folders/panels/BurnPanel.tsx`, `charts/BurnChartInner.tsx`                                               | forecast line, reading line, no-dates fallback                           |
| `src/components/folders/charts/LoadHeat.tsx`, `panels/LoadPanel.tsx` (new)                                               | heat map                                                                 |
| `src/components/folders/panels/PeoplePanel.tsx` (new)                                                                    | lazy people load                                                         |
| `src/components/folders/panels/BoardStatusPanel.tsx`, `AttentionPanel.tsx`, `MilestonesPanel.tsx`                        | health + sort + legend, grouped attention, milestone count               |
| `src/lib/validations/folder-layout.ts`, `src/lib/folders/presets.ts`, `edit/SectionChrome.tsx`, `edit/SectionsSheet.tsx` | `load` and `people` panels                                               |
| `src/components/folders/tabs/Overview.tsx`, `CommandCenter.tsx`                                                          | wiring                                                                   |

## Execution DAG

Spec units: U1 SQL = Tasks 1–2; U2 pure logic = Task 3; U3 KPI row = Task 5; U4 burn = Task 6; U5 load = Tasks 4 and 7; U6 people = Task 8; U7 boards, attention, milestones = Task 9; U8 presets and schema = Task 10.

```
1 ──► 2 ──► 4 ──┐
3 ──┬──────────►├──► 10 ──► 11 ──► 12 ──► 13
    ├─► 5 ──────┤
    ├─► 6 ──────┤
    ├─► 7 ──────┤
    ├─► 8 ──────┤
    └─► 9 ──────┘
```

| Batch | Tasks                                                               | Worktrees                                                                      |
| ----- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| A     | 1 and 3 in parallel                                                 | two, cut from `task/command-center-tower`                                      |
| B     | 2 (orchestrator, owner present) alongside 5, 6, 7, 8, 9 in parallel | task branch for 2; one worktree each for 5–9, cut after batch A is merged back |
| C     | 4                                                                   | task branch, after Task 2 commits the regenerated types                        |
| D     | 10                                                                  | task branch, after B and C are merged back                                     |
| E     | 11, 12, 13 in order                                                 | task branch                                                                    |

Tasks 5–9 touch disjoint files. The orchestrator rebases and fast-forward-merges each back, one at a time. **Critical path:** 1 → 2 → 4 → 10 → 11 → 12 → 13. Task 2 waits on the owner, so batch B's panel work is what keeps the clock moving.

---

### Task 1: Migration — `folder_burn` columns and `folder_load`

**Files:**

- Create: `supabase/migrations/<minted>_folder_tower.sql`
- Create: `docs/superpowers/plans/command-center-tower-dry-run.sql`

**Interfaces:**

- Consumes: `public._assert_folder_member(uuid)`, `public._folder_item_flags(uuid)` (unchanged).
- Produces: `public.folder_burn(p_folder_id uuid) returns table (stage_key text, week_start date, planned integer, completed integer, imported_done integer, overdue_open integer)`; `public.folder_load(p_folder_id uuid, p_weeks_back integer default 3, p_weeks_ahead integer default 3) returns table (board_id uuid, stage_key text, week_start date, open_due integer)`.

- [ ] **Step 1: Mint the file**

Run: `scripts/new-migration.sh folder_tower`
Expected: prints the new path under `supabase/migrations/`. Use that file; do not rename it.

- [ ] **Step 2: Confirm the body you are replacing**

Read `supabase/migrations/20260915142403_folder_planned_on_and_rpc_review_fixes.sql:358-434`. The `folder_burn` below must keep its `ev`, `bounds`, `span`, `win`, `clamped`, `stages` and `weeks` logic unchanged apart from the two added measures. If that file's `folder_burn` differs from what Step 3 preserves, stop and report NEEDS_CONTEXT.

- [ ] **Step 3: Write the migration**

Replace the minted file's body (keep its header comment line) with:

```sql
-- Command Center "Tower": per-week overdue and imported-done counts on
-- folder_burn, and a bounded board x week load grid.
--
-- _folder_item_flags and folder_rollup are NOT changed.
--
-- folder_burn gains two columns, so it is dropped and recreated in this one
-- transaction. The deployed client parses rows with a plain z.object, which
-- strips unknown keys, so the code live today keeps working.
--
--   imported_done  completions whose done date is the item's creation date:
--                  an item that arrived already done (an import). The forecast
--                  pace leaves these out.
--   overdue_open   items overdue as of the end of that week (or as of yesterday
--                  for the current week): earliest date passed, not done by
--                  then, and the item already existed. Zero for future weeks
--                  and for weeks more than 12 back.

drop function if exists public.folder_burn(uuid);

create function public.folder_burn(p_folder_id uuid)
returns table (
  stage_key text,
  week_start date,
  planned integer,
  completed integer,
  imported_done integer,
  overdue_open integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._assert_folder_member(p_folder_id);
  return query
  with flags as (
    select f.*, i.created_at::date as created_on
    from public._folder_item_flags(p_folder_id) f
    join public.items i on i.id = f.item_id
  ),
  ev as (
    select lower(trim(f.group_name)) as sk,
           date_trunc('week', f.planned_on)::date as wk,
           1 as planned, 0 as completed, 0 as imported
    from flags f
    where f.planned_on is not null
    union all
    select lower(trim(f.group_name)),
           date_trunc('week', f.done_on)::date,
           0, 1,
           case when f.done_on = f.created_on then 1 else 0 end
    from flags f
    where f.is_done and f.done_on is not null
  ),
  bounds as (
    select min(e.wk) as min_wk, max(e.wk) as max_wk from ev e
  ),
  span as (
    select
      b.min_wk,
      least(
        greatest(b.max_wk, date_trunc('week', current_date)::date),
        (date_trunc('week', current_date) + interval '52 weeks')::date
      ) as hi
    from bounds b
  ),
  win as (
    select s.hi,
           least(greatest(s.min_wk, (s.hi - interval '103 weeks')::date), s.hi) as lo
    from span s
  ),
  clamped as (
    select e.sk, least(greatest(e.wk, w.lo), w.hi) as wk,
           e.planned, e.completed, e.imported
    from ev e cross join win w
  ),
  stages as (
    select distinct c.sk from clamped c
  ),
  weeks as (
    select generate_series(w.lo, w.hi, interval '1 week')::date as wk
    from win w
    where w.lo is not null
  ),
  agg as (
    select c.sk, c.wk,
           sum(c.planned)::int as planned,
           sum(c.completed)::int as completed,
           sum(c.imported)::int as imported
    from clamped c
    group by c.sk, c.wk
  ),
  ovd as (
    select lower(trim(f.group_name)) as sk, wks.wk, count(*)::int as n
    from flags f
    cross join weeks wks
    where wks.wk <= date_trunc('week', current_date)::date
      and wks.wk >= (date_trunc('week', current_date) - interval '12 weeks')::date
      and f.due_on is not null
      and f.due_on < least(wks.wk + 7, current_date)
      and f.created_on < wks.wk + 7
      and not (f.is_done and f.done_on is not null and f.done_on < wks.wk + 7)
    group by 1, 2
  )
  select st.sk,
         wks.wk,
         coalesce(a.planned, 0),
         coalesce(a.completed, 0),
         coalesce(a.imported, 0),
         coalesce(o.n, 0)
  from stages st
  cross join weeks wks
  left join agg a on a.sk = st.sk and a.wk = wks.wk
  left join ovd o on o.sk = st.sk and o.wk = wks.wk
  order by st.sk asc, wks.wk asc;
end; $$;

revoke execute on function public.folder_burn(uuid) from public, anon;
grant execute on function public.folder_burn(uuid) to authenticated;

-- ── folder_load: open items by board, stage and the week they are planned ────
-- Rows older than the window fold into its first week, so nothing late is
-- hidden; rows beyond the window are left out. Zero cells are not returned.
create function public.folder_load(
  p_folder_id uuid,
  p_weeks_back integer default 3,
  p_weeks_ahead integer default 3
)
returns table (
  board_id uuid,
  stage_key text,
  week_start date,
  open_due integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_back integer := least(greatest(coalesce(p_weeks_back, 3), 0), 12);
  v_ahead integer := least(greatest(coalesce(p_weeks_ahead, 3), 0), 12);
  v_this date := date_trunc('week', current_date)::date;
  v_lo date := v_this - v_back * 7;
  v_hi date := v_this + v_ahead * 7;
begin
  perform public._assert_folder_member(p_folder_id);
  return query
  select f.board_id,
         lower(trim(f.group_name)),
         greatest(date_trunc('week', f.planned_on)::date, v_lo),
         count(*)::int
  from public._folder_item_flags(p_folder_id) f
  where not f.is_done
    and f.planned_on is not null
    and date_trunc('week', f.planned_on)::date <= v_hi
  group by 1, 2, 3
  order by 1, 2, 3
  limit 5000;
end; $$;

revoke execute on function public.folder_load(uuid, integer, integer) from public, anon;
grant execute on function public.folder_load(uuid, integer, integer) to authenticated;
```

- [ ] **Step 4: Write the dry-run script**

Create `docs/superpowers/plans/command-center-tower-dry-run.sql`. It contains the marker line `-- <<MIGRATION>>` where Task 2 pastes the migration text.

```sql
-- Rolled-back dry run for the folder_tower migration.
-- Send as ONE execute_sql call. No explicit BEGIN: the closing RAISE aborts the
-- implicit transaction, so nothing persists. The message starts "TOWER_DRY ".
select set_config('lock_timeout', '4s', true), set_config('statement_timeout', '120s', true);

create temp table tower_dry (k text primary key, v jsonb) on commit drop;

do $before$
declare
  f uuid; v_uid uuid; v_plan json; v_ms numeric; v_best numeric; i int;
begin
  foreach f in array array[
    'bb2b3010-65d1-4ac7-8c47-474c415e78d7'::uuid,
    '2fee1041-c6c1-4064-b6a5-b14e965f40c3'::uuid
  ] loop
    select b.created_by into v_uid
    from public.folder_boards fb join public.boards b on b.id = fb.board_id
    where fb.folder_id = f and b.created_by is not null
    limit 1;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    insert into tower_dry values ('burn_before:' || f, (
      select jsonb_build_object('rows', count(*),
        'planned', coalesce(sum(planned), 0), 'completed', coalesce(sum(completed), 0))
      from public.folder_burn(f)));
    insert into tower_dry values ('rollup:' || f, (
      select jsonb_build_object('total', coalesce(sum(total), 0),
        'done', coalesce(sum(done), 0), 'overdue', coalesce(sum(overdue), 0))
      from public.folder_rollup(f)));
    v_best := null;
    for i in 1..3 loop
      execute format('explain (analyze, format json) select count(*) from public.folder_burn(%L)', f) into v_plan;
      v_ms := (v_plan -> 0 ->> 'Execution Time')::numeric;
      if v_best is null or v_ms < v_best then v_best := v_ms; end if;
    end loop;
    insert into tower_dry values ('t_burn_before_ms:' || f, to_jsonb(v_best));
  end loop;
end
$before$;

-- <<MIGRATION>>

do $after$
declare
  f uuid; v_uid uuid; v_plan json; v_ms numeric; v_best numeric; i int;
  v_this date := date_trunc('week', current_date)::date;
begin
  foreach f in array array[
    'bb2b3010-65d1-4ac7-8c47-474c415e78d7'::uuid,
    '2fee1041-c6c1-4064-b6a5-b14e965f40c3'::uuid
  ] loop
    select b.created_by into v_uid
    from public.folder_boards fb join public.boards b on b.id = fb.board_id
    where fb.folder_id = f and b.created_by is not null
    limit 1;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    insert into tower_dry values ('burn_after:' || f, (
      select jsonb_build_object('rows', count(*),
        'planned', coalesce(sum(planned), 0), 'completed', coalesce(sum(completed), 0),
        'imported_done', coalesce(sum(imported_done), 0),
        'overdue_now', coalesce(sum(overdue_open) filter (where week_start = v_this), 0))
      from public.folder_burn(f)));
    insert into tower_dry values ('load:' || f, (
      select jsonb_build_object('rows', count(*), 'open_due', coalesce(sum(open_due), 0),
        'boards', count(distinct board_id), 'weeks', count(distinct week_start))
      from public.folder_load(f)));
    v_best := null;
    for i in 1..3 loop
      execute format('explain (analyze, format json) select count(*) from public.folder_burn(%L)', f) into v_plan;
      v_ms := (v_plan -> 0 ->> 'Execution Time')::numeric;
      if v_best is null or v_ms < v_best then v_best := v_ms; end if;
    end loop;
    insert into tower_dry values ('t_burn_after_ms:' || f, to_jsonb(v_best));
    v_best := null;
    for i in 1..3 loop
      execute format('explain (analyze, format json) select count(*) from public.folder_load(%L)', f) into v_plan;
      v_ms := (v_plan -> 0 ->> 'Execution Time')::numeric;
      if v_best is null or v_ms < v_best then v_best := v_ms; end if;
    end loop;
    insert into tower_dry values ('t_load_ms:' || f, to_jsonb(v_best));
  end loop;
  insert into tower_dry values ('grants', jsonb_build_object(
    'anon_burn', has_function_privilege('anon', 'public.folder_burn(uuid)', 'execute'),
    'anon_load', has_function_privilege('anon', 'public.folder_load(uuid, integer, integer)', 'execute'),
    'authed_load', has_function_privilege('authenticated', 'public.folder_load(uuid, integer, integer)', 'execute')));
  raise exception 'TOWER_DRY %', (select jsonb_object_agg(k, v) from tower_dry)::text;
end
$after$;
```

- [ ] **Step 5: Run the suite (conformance covers grants)**

Run: `pnpm test` (foreground, timeout 600000)
Expected: PASS, same counts as before the task.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/<minted>_folder_tower.sql docs/superpowers/plans/command-center-tower-dry-run.sql
git commit -m "feat(folders): add weekly overdue, imported-done and load grid to folder rpcs"
```

---

### Task 2: Dry run, apply to DEV, regenerate types (ORCHESTRATOR ONLY, owner present)

No subagent performs this task. Tell the owner beforehand: two confirmations are needed, each within 2 minutes.

**Files:**

- Modify: `src/types/database.types.ts` (regenerated)

**Interfaces:**

- Consumes: Task 1's two files.
- Produces: generated types containing `folder_load` and the six-column `folder_burn`.

- [ ] **Step 1: Pre-check (read-only)**

```sql
select to_regprocedure('public.folder_load(uuid, integer, integer)') is null as absent;
```

Expected: `absent = true`. If false, someone already applied it: stop and report.

- [ ] **Step 2: Dry run in one rolled-back call**

Build one string: the dry-run script with the line `-- <<MIGRATION>>` replaced by the full text of the migration file. Send it as a single `execute_sql` call (the owner confirms).

Expected: an error whose message starts `TOWER_DRY {`. An error that does not start with `TOWER_DRY` means the migration or the script failed part-way and nothing persisted: read it, fix through the Task 1 implementer, re-run. A lock timeout: wait a minute and retry, at most three attempts.

Re-run Step 1's query afterwards. Expected: `absent = true` (rolled back).

- [ ] **Step 3: Read the result**

For each of the two folder ids:

- `burn_after.rows = burn_before.rows`, `burn_after.planned = burn_before.planned`, `burn_after.completed = burn_before.completed`. Any difference is a stop.
- `burn_after.imported_done <= burn_after.completed`.
- `burn_after.overdue_now = rollup.overdue`. A difference is a stop: the two overdue rules have drifted and the cards would disagree. (For DAAS expect 601 and `imported_done = 663`.)
- `load.boards` ≤ the folder's board count and `load.weeks` ≤ 7. For the CRM folder (no dates) expect `load.rows = 0` and `burn_after.overdue_now = 0`.
- `grants`: `anon_burn = false`, `anon_load = false`, `authed_load = true`.

- [ ] **Step 4: Timing gate**

Using the DAAS values: stop if `t_burn_after_ms` is more than 20% **and** more than 50 ms above `t_burn_before_ms`, or if `t_load_ms` is more than 20% above `t_burn_before_ms`. On a stop, do not apply; apply the fallback in "Performance and data-fetching budget" through the Task 1 implementer and repeat from Step 2. Record all three numbers in the session note.

- [ ] **Step 5: Apply to DEV (live)**

State to the owner in one line what is about to be applied and that it is live on apply. Call `apply_migration` with `name` = `folder_tower` and `query` = the migration file's full text (the owner confirms).

Run: `pnpm db:ledger-check`
Expected: no diff either way. If the ledger stamped its own version, run `scripts/reconcile-migration-version.sh` as its usage describes and re-check.

- [ ] **Step 6: Regenerate types**

Call `generate_typescript_types`, write the result over `src/types/database.types.ts`, then:

Run: `pnpm prettier --write src/types/database.types.ts`
Run: `grep -c "folder_load\|imported_done\|overdue_open" src/types/database.types.ts`
Expected: 3 or more.

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm typecheck`
Expected: PASS.

```bash
git add src/types/database.types.ts
git commit -m "chore(types): regenerate for folder_load and folder_burn columns"
```

---

### Task 3: Data contract and pure logic

**Files:**

- Modify: `src/lib/folders/types.ts`, `src/lib/folders/rollup.ts`, `src/lib/folders/resolve.ts`, `src/lib/folders/payload.ts`, `src/lib/folders/fixture.ts`, `src/components/folders/panels/MilestonesPanel.tsx`
- Create: `src/lib/folders/tower.ts`, `src/lib/folders/tower.test.ts`
- Test: `src/lib/folders/rollup.test.ts`, `src/lib/folders/resolve.test.ts`

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces (exact names later tasks import):
  - `types.ts`: `BurnRow` gains `importedDone?: number; overdueOpen?: number`; `export type LoadRow = { boardId: string; stageKey: string; weekStart: string; openDue: number }`; `FolderPayload.load: LoadRow[] | null`.
  - `rollup.ts`: `BurnPoint.importedDone: number`; `Milestone.open: number` (replaces `openBefore`).
  - `tower.ts`: `Tone`, `Trend`, `addDays`, `mondayOf`, `kpiTrends`, `trendChange`, `Forecast`, `burnForecast`, `forecastReading`, `LoadGrid`, `loadGrid`, `AttentionGroup`, `attentionGroups`, `StageBar`, `stageBars`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/folders/tower.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildStages } from "./stages";
import type { BurnPoint } from "./rollup";
import { FIXTURE_TODAY, folderFixture } from "./fixture";
import {
  addDays,
  attentionGroups,
  burnForecast,
  forecastReading,
  kpiTrends,
  loadGrid,
  mondayOf,
  stageBars,
  trendChange,
} from "./tower";
import type { BurnRow, LoadRow } from "./types";

const wk = (
  weekStart: string,
  planned: number,
  completed: number,
  overdueOpen = 0,
  importedDone = 0,
): BurnRow => ({
  stageKey: "build",
  weekStart,
  planned,
  completed,
  overdueOpen,
  importedDone,
});

describe("date helpers", () => {
  it("adds days across a month boundary and finds the Monday", () => {
    expect(addDays("2026-09-28", 7)).toBe("2026-10-05");
    expect(mondayOf("2026-09-15")).toBe("2026-09-14"); // a Tuesday
    expect(mondayOf("2026-09-14")).toBe("2026-09-14");
    expect(mondayOf("2026-09-20")).toBe("2026-09-14"); // a Sunday
  });
});

describe("kpiTrends", () => {
  const rows = [
    wk("2026-08-24", 2, 1, 0),
    wk("2026-08-31", 3, 1, 1),
    wk("2026-09-07", 2, 1, 2),
    wk("2026-09-14", 3, 1, 4),
    wk("2026-09-21", 5, 0, 0),
    wk("2026-09-28", 1, 0, 0),
  ];

  it("builds past series up to the current week and a forward series for due", () => {
    const t = kpiTrends(rows, null, "2026-09-15", 20);
    expect(t.complete?.points).toEqual([5, 10, 15, 20]);
    expect(t.complete?.delta).toBe(5);
    expect(t.gap?.points).toEqual([-1, -3, -4, -6]);
    expect(t.gap?.delta).toBe(-2);
    expect(t.overdue?.points).toEqual([0, 1, 2, 4]);
    expect(t.dueThisWeek).toEqual({
      kind: "bars",
      points: [3, 5, 1],
      delta: 2,
    });
  });

  it("keeps at most eight past weeks", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      wk(addDays("2026-06-29", i * 7), 1, 1, i),
    );
    const t = kpiTrends(many, null, "2026-09-15", 12);
    expect(t.overdue?.points).toHaveLength(8);
    expect(t.overdue?.points.at(-1)).toBe(11);
  });

  it("returns nothing for a folder younger than two weeks or with no rows", () => {
    expect(kpiTrends([], null, "2026-09-15", 5)).toEqual({});
    expect(kpiTrends([wk("2026-09-14", 1, 0)], null, "2026-09-15", 5)).toEqual(
      {},
    );
  });

  it("filters by stage and omits complete when the total is zero", () => {
    const mixed = [...rows, { ...wk("2026-09-07", 9, 9), stageKey: "qa" }];
    expect(kpiTrends(mixed, "build", "2026-09-15", 20).gap?.points).toEqual([
      -1, -3, -4, -6,
    ]);
    expect(kpiTrends(rows, null, "2026-09-15", 0).complete).toBeUndefined();
  });
});

describe("trendChange", () => {
  it("colours by meaning, not by sign, and always states the direction", () => {
    expect(
      trendChange("overdue", { kind: "line", points: [1, 4], delta: 3 }),
    ).toEqual({
      text: "+3 this week",
      tone: "red",
    });
    expect(
      trendChange("overdue", { kind: "line", points: [4, 1], delta: -3 }),
    ).toEqual({
      text: "−3 this week",
      tone: "green",
    });
    expect(
      trendChange("complete", { kind: "line", points: [10, 12], delta: 2 }),
    ).toEqual({
      text: "+2 pts this week",
      tone: "green",
    });
    expect(
      trendChange("gap", { kind: "line", points: [-10, -58], delta: -48 }),
    ).toEqual({
      text: "48 wider",
      tone: "red",
    });
    expect(
      trendChange("gap", { kind: "line", points: [-10, -4], delta: 6 }),
    ).toEqual({
      text: "6 closer",
      tone: "green",
    });
    expect(
      trendChange("overdue", { kind: "line", points: [2, 2], delta: 0 }),
    ).toEqual({
      text: "flat",
      tone: "gray",
    });
    expect(
      trendChange("dueThisWeek", { kind: "bars", points: [3, 5], delta: 2 }),
    ).toEqual({
      text: "5 next week",
      tone: "blue",
    });
  });
});

const pt = (
  weekStart: string,
  planned: number,
  completed: number,
  plannedCum: number,
  completedCum: number,
  isPast: boolean,
  importedDone = 0,
): BurnPoint => ({
  weekStart,
  planned,
  completed,
  plannedCum,
  completedCum,
  isPast,
  importedDone,
});

describe("burnForecast", () => {
  const points = [
    pt("2026-08-17", 4, 2, 4, 2, true),
    pt("2026-08-24", 4, 2, 8, 4, true),
    pt("2026-08-31", 4, 4, 12, 8, true),
    pt("2026-09-07", 4, 4, 16, 12, true),
    pt("2026-09-14", 4, 1, 20, 13, true),
    pt("2026-09-21", 4, 0, 24, 13, false),
    pt("2026-09-28", 0, 0, 24, 13, false),
  ];

  it("paces on the four full weeks before the current one", () => {
    const f = burnForecast(points, 24)!;
    expect(f.pace).toBe(3);
    expect(f.remaining).toBe(11);
    expect(f.gapNow).toBe(-7);
    expect(f.finishWeek).toBe("2026-10-12"); // ceil(11 / 3) = 4 weeks after 09-14
    expect(f.lastPlannedWeek).toBe("2026-09-21");
    expect(f.weeksLate).toBe(3);
    expect(f.line.map((p) => p.value)).toEqual([13, 16, 19]);
    expect(forecastReading(f)).toBe(
      "At 3 a week the folder finishes around Oct 12, 3 weeks after its last planned date.",
    );
  });

  it("leaves imported completions out of the pace and says so", () => {
    const imported = points.map((p) =>
      p.weekStart === "2026-09-07" ? { ...p, importedDone: 4 } : p,
    );
    const f = burnForecast(imported, 24)!;
    expect(f.pace).toBe(2);
    expect(f.importedDone).toBe(4);
    expect(forecastReading(f)).toContain(
      "4 items arrived already done and are left out of the pace.",
    );
  });

  it("reports a zero pace instead of a date", () => {
    const flat = points.map((p) => ({
      ...p,
      completed: p.isPast && p.weekStart !== "2026-09-14" ? 0 : p.completed,
    }));
    const f = burnForecast(flat, 24)!;
    expect(f.pace).toBe(0);
    expect(f.finishWeek).toBeNull();
    expect(forecastReading(f)).toBe(
      "No items completed in the last four weeks.",
    );
  });

  it("handles a finished scope, a capped line and no past week", () => {
    expect(forecastReading(burnForecast(points, 13)!)).toBe(
      "Everything in scope is done.",
    );
    expect(burnForecast(points, 15)!.line.map((p) => p.value)).toEqual([
      13, 15, 15,
    ]);
    expect(
      burnForecast(
        points.map((p) => ({ ...p, isPast: false })),
        24,
      ),
    ).toBeNull();
  });
});

describe("loadGrid", () => {
  const boards = [
    { id: "b2", name: "Mobile", position: 1 },
    { id: "b1", name: "Backend", position: 0 },
  ];
  const rows: LoadRow[] = [
    { boardId: "b1", stageKey: "build", weekStart: "2026-08-24", openDue: 5 },
    { boardId: "b1", stageKey: "qa", weekStart: "2026-08-24", openDue: 2 },
    { boardId: "b1", stageKey: "build", weekStart: "2026-09-14", openDue: 3 },
    { boardId: "b2", stageKey: "build", weekStart: "2026-10-05", openDue: 4 },
    { boardId: "b2", stageKey: "build", weekStart: "2026-11-30", openDue: 9 }, // outside the window
  ];

  it("lays seven weeks around today with boards in position order", () => {
    const g = loadGrid(
      rows,
      boards,
      { stageKey: null, boardId: null },
      "2026-09-15",
    );
    expect(g.weeks.map((w) => w.label)).toEqual([
      "≤ −3w",
      "−2w",
      "−1w",
      "now",
      "+1w",
      "+2w",
      "+3w",
    ]);
    expect(g.weeks.map((w) => w.past)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(g.weeks[0]!.weekStart).toBe("2026-08-24");
    expect(g.rows.map((r) => r.name)).toEqual(["Backend", "Mobile"]);
    expect(g.rows[0]!.cells).toEqual([7, 0, 0, 3, 0, 0, 0]);
    expect(g.rows[1]!.cells).toEqual([0, 0, 0, 0, 0, 0, 4]);
    expect(g.max).toBe(7);
  });

  it("applies the stage and board filters", () => {
    const g = loadGrid(
      rows,
      boards,
      { stageKey: "qa", boardId: "b1" },
      "2026-09-15",
    );
    expect(g.rows).toHaveLength(1);
    expect(g.rows[0]!.cells).toEqual([2, 0, 0, 0, 0, 0, 0]);
  });

  it("returns zero rows of zeros for a board with nothing due", () => {
    const g = loadGrid(
      [],
      boards,
      { stageKey: null, boardId: null },
      "2026-09-15",
    );
    expect(g.max).toBe(0);
    expect(g.rows[0]!.cells).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("attentionGroups and stageBars", () => {
  const fx = folderFixture();

  it("groups by board with totals taken from the rollup, worst first", () => {
    const groups = attentionGroups(fx.rollup!, fx.attention!, FIXTURE_TODAY);
    for (const g of groups) {
      const rows = fx.rollup!.filter((r) => r.boardId === g.boardId);
      expect(g.overdue).toBe(rows.reduce((s, r) => s + r.overdue, 0));
      expect(g.blocked).toBe(rows.reduce((s, r) => s + r.blocked, 0));
      expect(g.items.every((a) => a.boardId === g.boardId)).toBe(true);
    }
    const overdue = groups.map((g) => g.overdue);
    expect(overdue).toEqual([...overdue].sort((a, b) => b - a));
    expect(groups.flatMap((g) => g.items)).toHaveLength(fx.attention!.length);
  });

  it("drops boards with nothing to report", () => {
    const clean = fx.rollup!.map((r) => ({
      ...r,
      overdue: 0,
      blocked: 0,
      unassigned: 0,
      stale: 0,
      oldestOverdue: null,
    }));
    expect(attentionGroups(clean, [], FIXTURE_TODAY)).toEqual([]);
  });

  it("turns stages into bars with totals, done and stale", () => {
    const stages = buildStages(fx.rollup!, FIXTURE_TODAY);
    const bars = stageBars(stages);
    expect(bars.map((b) => b.name)).toEqual(
      stages.filter((s) => s.total > 0).map((s) => s.name),
    );
    expect(bars[0]).toMatchObject({
      total: stages[0]!.total,
      done: stages[0]!.done,
      stale: stages[0]!.stale,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/folders/tower.test.ts`
Expected: FAIL, cannot resolve `./tower`.

- [ ] **Step 3: Extend the types**

In `src/lib/folders/types.ts`, replace the `BurnRow` type and add `LoadRow` directly under it:

```ts
export type BurnRow = {
  stageKey: string;
  weekStart: string;
  planned: number;
  completed: number;
  /** Completions that happened on the item's creation day (arrived done). */
  importedDone?: number;
  /** Items overdue as of the end of that week; 0 for future weeks. */
  overdueOpen?: number;
};

/** Open items by board, stage and the week they are planned for. Weeks older
 *  than the window are folded into its first week by the RPC. */
export type LoadRow = {
  boardId: string;
  stageKey: string;
  weekStart: string;
  openDue: number;
};
```

In `FolderPayload`, add under `burn`:

```ts
  /** Board × week load grid. Null when not requested or the read failed. */
  load: LoadRow[] | null;
```

- [ ] **Step 4: Carry the new burn fields and the milestone count in `rollup.ts`**

In `src/lib/folders/rollup.ts`:

Add `importedDone: number;` to `BurnPoint` after `completedCum`. Replace `openBefore: number;` in `Milestone` with `open: number;`.

In `nextMilestones`, replace the loop body's `idx` / `openBefore` computation and the pushed object with:

```ts
for (const s of upcoming.slice(0, n)) {
  out.push({
    stageKey: s.key,
    name: s.name,
    endDate: s.maxDue as string,
    open: s.total - s.done,
  });
}
```

and update its doc comment to: `/** Next `n` stage end dates on/after today, with the open items in that stage. */`. The `ordered` constant is still used by `upcoming`; keep it.

In `burnSeries`, change the accumulator and the mapped object:

```ts
const weeks = new Map<
  string,
  { planned: number; completed: number; importedDone: number }
>();
for (const r of rows) {
  if (stage !== null && r.stageKey !== stage) continue;
  const w = weeks.get(r.weekStart) ?? {
    planned: 0,
    completed: 0,
    importedDone: 0,
  };
  w.planned += r.planned;
  w.completed += r.completed;
  w.importedDone += r.importedDone ?? 0;
  weeks.set(r.weekStart, w);
}
```

and add `importedDone: w.importedDone,` to the returned point after `completedCum: cc,`.

In `src/components/folders/panels/MilestonesPanel.tsx:35`, change `{m.openBefore} open` to `{m.open} open`.

- [ ] **Step 5: Map the burn columns in `resolve.ts`**

In `src/lib/folders/resolve.ts`, replace `burnRowSchema` with:

```ts
/** `imported_done` / `overdue_open` default to 0 so this still parses against
 *  a database that has not had the folder_tower migration yet. */
const burnRowSchema = z.object({
  stage_key: z.string(),
  week_start: z.string(),
  planned: z.number(),
  completed: z.number(),
  imported_done: z.number().default(0),
  overdue_open: z.number().default(0),
});
```

and in `resolveFolderBurn`'s row mapping add after `completed: r.completed,`:

```ts
      importedDone: r.imported_done,
      overdueOpen: r.overdue_open,
```

In `src/lib/folders/resolve.test.ts`, inside the `resolveFolderBurn` describe, add `importedDone: 0, overdueOpen: 0` to every expected row object (the mocked RPC rows stay as they are, which proves the defaults).

- [ ] **Step 6: Keep the payload and fixture compiling**

In `src/lib/folders/payload.ts`, add `load: null,` after the `burn:` line of the returned object (Task 4 replaces it).

In `src/lib/folders/fixture.ts`, add after the `burn: [...]` array, before `attention:`:

```ts
    load: [
      { boardId: "b1", stageKey: "build", weekStart: "2026-08-24", openDue: 2 },
      { boardId: "b1", stageKey: "build", weekStart: "2026-09-14", openDue: 3 },
      { boardId: "b2", stageKey: "build", weekStart: "2026-09-21", openDue: 4 },
    ],
```

- [ ] **Step 7: Write `tower.ts`**

Create `src/lib/folders/tower.ts`:

```ts
import type { KpiKey } from "@/lib/validations/folder-layout";
import { daysBetween, type BurnPoint } from "./rollup";
import type { StageSummary } from "./stages";
import type {
  AttentionRow,
  BurnRow,
  FolderBoardRef,
  LoadRow,
  RollupRow,
} from "./types";

/** A subset of the status palette; assignable to `StatusColor`. */
export type Tone = "green" | "red" | "blue" | "gray";

export type Trend = {
  kind: "line" | "bars";
  points: number[];
  /** Last point minus the one before it (bars: next week minus this week). */
  delta: number;
};

export const TREND_WEEKS = 8;
export const LOAD_BACK = 3;
export const LOAD_AHEAD = 3;

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
}

/** The Monday on or before `iso`, matching Postgres `date_trunc('week', …)`. */
export function mondayOf(iso: string): string {
  const dow = (new Date(Date.parse(iso)).getUTCDay() + 6) % 7;
  return addDays(iso, -dow);
}

type Wk = {
  weekStart: string;
  planned: number;
  completed: number;
  overdueOpen: number;
  plannedCum: number;
  completedCum: number;
};

function weekly(rows: BurnRow[], stage: string | null): Wk[] {
  const m = new Map<
    string,
    { planned: number; completed: number; overdueOpen: number }
  >();
  for (const r of rows) {
    if (stage !== null && r.stageKey !== stage) continue;
    const w = m.get(r.weekStart) ?? {
      planned: 0,
      completed: 0,
      overdueOpen: 0,
    };
    w.planned += r.planned;
    w.completed += r.completed;
    w.overdueOpen += r.overdueOpen ?? 0;
    m.set(r.weekStart, w);
  }
  let pc = 0;
  let cc = 0;
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, w]) => {
      pc += w.planned;
      cc += w.completed;
      return { weekStart, ...w, plannedCum: pc, completedCum: cc };
    });
}

/**
 * Weekly series behind each KPI card. Complete, gap and overdue look BACK over
 * up to eight weeks ending in the current one; due looks FORWARD from it. A
 * card with no entry draws no sparkline. `total` is the item count in scope.
 */
export function kpiTrends(
  rows: BurnRow[],
  stage: string | null,
  todayISO: string,
  total: number,
): Partial<Record<KpiKey, Trend>> {
  const ws = weekly(rows, stage);
  let cur = -1;
  for (let i = 0; i < ws.length; i++) if (ws[i]!.weekStart <= todayISO) cur = i;
  if (cur < 1) return {};
  const past = ws.slice(Math.max(0, cur - (TREND_WEEKS - 1)), cur + 1);
  const ahead = ws.slice(cur, cur + TREND_WEEKS);
  const line = (points: number[]): Trend => ({
    kind: "line",
    points,
    delta: points[points.length - 1]! - points[points.length - 2]!,
  });
  const out: Partial<Record<KpiKey, Trend>> = {
    gap: line(past.map((w) => w.completedCum - w.plannedCum)),
    overdue: line(past.map((w) => w.overdueOpen)),
  };
  if (total > 0)
    out.complete = line(
      past.map((w) => Math.round((w.completedCum / total) * 100)),
    );
  if (ahead.length >= 2)
    out.dueThisWeek = {
      kind: "bars",
      points: ahead.map((w) => w.planned),
      delta: ahead[1]!.planned - ahead[0]!.planned,
    };
  return out;
}

/** The change pill. Colour follows meaning (more overdue is red); the text
 *  always states the direction, so colour is never the only signal. */
export function trendChange(
  key: KpiKey,
  t: Trend,
): { text: string; tone: Tone } {
  if (key === "dueThisWeek")
    return { text: `${t.points[1] ?? 0} next week`, tone: "blue" };
  if (t.delta === 0) return { text: "flat", tone: "gray" };
  const up = t.delta > 0;
  const n = Math.abs(t.delta);
  if (key === "complete")
    return {
      text: `${up ? "+" : "−"}${n} pts this week`,
      tone: up ? "green" : "red",
    };
  if (key === "gap")
    return up
      ? { text: `${n} closer`, tone: "green" }
      : { text: `${n} wider`, tone: "red" };
  return {
    text: `${up ? "+" : "−"}${n} this week`,
    tone: up ? "red" : "green",
  };
}

export type Forecast = {
  /** Mean weekly completions over the four full weeks before the current one,
   *  not counting items that arrived already done. */
  pace: number;
  importedDone: number;
  remaining: number;
  /** Completed minus planned, cumulative, at the current week. */
  gapNow: number;
  finishWeek: string | null;
  lastPlannedWeek: string | null;
  weeksLate: number | null;
  line: { weekStart: string; value: number }[];
};

export function burnForecast(
  points: BurnPoint[],
  total: number,
): Forecast | null {
  let cur = -1;
  for (let i = 0; i < points.length; i++) if (points[i]!.isPast) cur = i;
  if (cur === -1) return null;
  const here = points[cur]!;
  const window = points.slice(Math.max(0, cur - 4), cur);
  const organic = window.reduce(
    (s, p) => s + Math.max(0, p.completed - p.importedDone),
    0,
  );
  const pace = window.length === 0 ? 0 : organic / window.length;
  const remaining = Math.max(0, total - here.completedCum);
  let lastPlannedWeek: string | null = null;
  for (const p of points) if (p.planned > 0) lastPlannedWeek = p.weekStart;
  const finishWeek =
    remaining === 0
      ? here.weekStart
      : pace > 0
        ? addDays(here.weekStart, Math.ceil(remaining / pace) * 7)
        : null;
  const weeksLate =
    finishWeek !== null && lastPlannedWeek !== null
      ? Math.max(0, Math.round(daysBetween(lastPlannedWeek, finishWeek) / 7))
      : null;
  return {
    pace,
    importedDone: points.reduce((s, p) => s + p.importedDone, 0),
    remaining,
    gapNow: here.completedCum - here.plannedCum,
    finishWeek,
    lastPlannedWeek,
    weeksLate,
    line: points.slice(cur).map((p, i) => ({
      weekStart: p.weekStart,
      value: Math.min(total, Math.round(here.completedCum + pace * i)),
    })),
  };
}

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function forecastReading(f: Forecast): string {
  if (f.remaining === 0) return "Everything in scope is done.";
  const imported =
    f.importedDone > 0
      ? ` ${f.importedDone} items arrived already done and are left out of the pace.`
      : "";
  if (f.pace === 0 || f.finishWeek === null)
    return `No items completed in the last four weeks.${imported}`;
  const pace =
    f.pace >= 10
      ? String(Math.round(f.pace))
      : f.pace.toFixed(1).replace(/\.0$/, "");
  const late =
    f.weeksLate !== null && f.weeksLate > 0
      ? `, ${f.weeksLate} ${f.weeksLate === 1 ? "week" : "weeks"} after its last planned date`
      : "";
  return `At ${pace} a week the folder finishes around ${fmtDay(f.finishWeek)}${late}.${imported}`;
}

export type LoadGrid = {
  weeks: { weekStart: string; label: string; past: boolean }[];
  rows: { boardId: string; name: string; cells: number[] }[];
  max: number;
};

export function loadGrid(
  rows: LoadRow[],
  boards: FolderBoardRef[],
  f: { stageKey: string | null; boardId: string | null },
  todayISO: string,
): LoadGrid {
  const now = mondayOf(todayISO);
  const weeks: LoadGrid["weeks"] = [];
  for (let o = -LOAD_BACK; o <= LOAD_AHEAD; o++)
    weeks.push({
      weekStart: addDays(now, o * 7),
      label:
        o === -LOAD_BACK
          ? `≤ −${LOAD_BACK}w`
          : o < 0
            ? `−${-o}w`
            : o === 0
              ? "now"
              : `+${o}w`,
      past: o < 0,
    });
  const idx = new Map(weeks.map((w, i) => [w.weekStart, i]));
  const byBoard = new Map<string, number[]>();
  for (const r of rows) {
    if (f.boardId !== null && r.boardId !== f.boardId) continue;
    if (f.stageKey !== null && r.stageKey !== f.stageKey) continue;
    const i = idx.get(r.weekStart);
    if (i === undefined) continue;
    const cells = byBoard.get(r.boardId) ?? weeks.map(() => 0);
    cells[i] = (cells[i] ?? 0) + r.openDue;
    byBoard.set(r.boardId, cells);
  }
  const out = boards
    .filter((b) => f.boardId === null || b.id === f.boardId)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((b) => ({
      boardId: b.id,
      name: b.name,
      cells: byBoard.get(b.id) ?? weeks.map(() => 0),
    }));
  return { weeks, rows: out, max: Math.max(0, ...out.flatMap((r) => r.cells)) };
}

export type AttentionGroup = {
  boardId: string;
  boardName: string;
  overdue: number;
  blocked: number;
  unassigned: number;
  stale: number;
  oldestOverdueDays: number | null;
  /** The slice of the attention sample that belongs to this board. */
  items: AttentionRow[];
};

/**
 * Attention by board. The four counts come from the rollup, so they are
 * totals, not a sample; they count each property independently and can
 * overlap. `items` is whatever part of the top-N sample sits on that board.
 */
export function attentionGroups(
  rows: RollupRow[],
  attention: AttentionRow[],
  todayISO: string,
): AttentionGroup[] {
  const acc = new Map<string, AttentionGroup & { oldest: string | null }>();
  for (const r of rows) {
    const g = acc.get(r.boardId) ?? {
      boardId: r.boardId,
      boardName: r.boardName,
      overdue: 0,
      blocked: 0,
      unassigned: 0,
      stale: 0,
      oldestOverdueDays: null,
      items: [],
      oldest: null,
    };
    g.overdue += r.overdue;
    g.blocked += r.blocked;
    g.unassigned += r.unassigned;
    g.stale += r.stale;
    if (
      r.oldestOverdue !== null &&
      (g.oldest === null || r.oldestOverdue < g.oldest)
    )
      g.oldest = r.oldestOverdue;
    acc.set(r.boardId, g);
  }
  for (const a of attention) acc.get(a.boardId)?.items.push(a);
  return [...acc.values()]
    .filter(
      (g) =>
        g.overdue + g.blocked + g.unassigned + g.stale > 0 ||
        g.items.length > 0,
    )
    .map(({ oldest, ...g }) => ({
      ...g,
      oldestOverdueDays: oldest === null ? null : daysBetween(oldest, todayISO),
    }))
    .sort(
      (a, b) =>
        b.overdue - a.overdue ||
        b.blocked +
          b.unassigned +
          b.stale -
          (a.blocked + a.unassigned + a.stale) ||
        a.boardName.localeCompare(b.boardName),
    );
}

export type StageBar = {
  key: string;
  name: string;
  color: string;
  total: number;
  done: number;
  stale: number;
};

/** One bar per non-empty stage, in stage order: the no-dates burn fallback. */
export function stageBars(stages: StageSummary[]): StageBar[] {
  return stages
    .filter((s) => s.total > 0)
    .map((s) => ({
      key: s.key,
      name: s.name,
      color: s.color,
      total: s.total,
      done: s.done,
      stale: s.stale,
    }));
}
```

- [ ] **Step 8: Update the milestone assertion in `rollup.test.ts`**

Run: `grep -n "openBefore" src/lib/folders/rollup.test.ts`
For every hit: rename the property to `open`, and replace its expected value with the stage's own `total - done`, looked up from the `stages` constant at the top of that file, in this form:

```ts
const stage = stages.find((s) => s.key === m.stageKey)!;
expect(m.open).toBe(stage.total - stage.done);
```

If grep prints nothing, the test never pinned the field and there is nothing to change.

- [ ] **Step 9: Run the tests**

Run: `pnpm vitest run src/lib/folders`
Expected: PASS, including `tower.test.ts`, `rollup.test.ts`, `resolve.test.ts`, `payload.test.ts`.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/folders/types.ts src/lib/folders/rollup.ts src/lib/folders/rollup.test.ts src/lib/folders/resolve.ts src/lib/folders/resolve.test.ts src/lib/folders/payload.ts src/lib/folders/fixture.ts src/lib/folders/tower.ts src/lib/folders/tower.test.ts src/components/folders/panels/MilestonesPanel.tsx
git commit -m "feat(folders): add trend, forecast and load grid logic for the overview"
```

---

### Task 4: Read `folder_load` on first paint

**Files:**

- Modify: `src/lib/folders/resolve.ts`, `src/lib/folders/layout.ts`, `src/lib/folders/payload.ts`
- Test: `src/lib/folders/resolve.test.ts`, `src/lib/folders/layout.test.ts`, `src/lib/folders/payload.test.ts`

**Interfaces:**

- Consumes: Task 2's generated types (`folder_load`), Task 3's `LoadRow` and `FolderPayload.load`.
- Produces: `resolveFolderLoad(supabase, folderId): Promise<Resolved<LoadRow>>`; `layoutNeedsLoad(config: FolderLayoutConfig): boolean`; `buildFolderPayload` fills `load`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/folders/resolve.test.ts` (add `resolveFolderLoad` to the import from `./resolve`):

```ts
describe("resolveFolderLoad", () => {
  it("calls folder_load and camel-cases the row", async () => {
    const client = clientWith(async () => ({
      data: [
        {
          board_id: "b1",
          stage_key: "build",
          week_start: "2026-09-14",
          open_due: 3,
        },
      ],
      error: null,
    }));
    const res = await resolveFolderLoad(client, "f1");
    expect(client.rpc).toHaveBeenCalledWith("folder_load", {
      p_folder_id: "f1",
    });
    expect(res).toEqual({
      ok: true,
      rows: [
        {
          boardId: "b1",
          stageKey: "build",
          weekStart: "2026-09-14",
          openDue: 3,
        },
      ],
    });
  });

  it("maps P0002 to the folder-gone message and a bad row to the data error", async () => {
    const gone = await resolveFolderLoad(
      clientWith(async () => ({
        data: null,
        error: { code: "P0002", message: "x" },
      })),
      "f1",
    );
    expect(gone).toEqual({ ok: false, error: FOLDER_GONE_ERROR });
    const bad = await resolveFolderLoad(
      clientWith(async () => ({ data: [{ board_id: "b1" }], error: null })),
      "f1",
    );
    expect(bad).toEqual({ ok: false, error: FOLDER_DATA_ERROR });
  });
});
```

Append to `src/lib/folders/layout.test.ts` (add `layoutNeedsLoad` to the import from `./layout`):

```ts
describe("layoutNeedsLoad", () => {
  it("is true only when a canvas tab holds a load section", () => {
    const withLoad = {
      v: 1 as const,
      tabs: [
        {
          id: "overview",
          label: "Overview",
          kind: "canvas" as const,
          sections: [
            {
              id: "load",
              type: "builtin" as const,
              panel: "load" as never,
              layout: { x: 8, y: 2, w: 4, h: 4 },
            },
          ],
        },
      ],
    };
    expect(layoutNeedsLoad(withLoad)).toBe(true);
    expect(layoutNeedsLoad(PRESETS.blank)).toBe(false);
  });
});
```

(`"load" as never` keeps this compiling before Task 10 adds `load` to the panel enum; Task 10 removes the cast.)

In `src/lib/folders/payload.test.ts`:

1. In the `vi.mock("./resolve", …)` factory add:

```ts
  resolveFolderLoad: vi.fn(async () => {
    order.push("start:load");
    await tick();
    order.push("end:load");
    return { ok: true, rows: [{ boardId: "b1", stageKey: "build", weekStart: "2026-09-14", openDue: 3 }] };
  }),
```

2. Change the `./resolve` import below the mocks to also import `resolveFolderLoad` and `resolveFolderRollup`, and the `./layout` module must be mockable per test, so add at the top with the other `vi.mock` calls:

```ts
const needs = { load: false };
vi.mock("./layout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./layout")>();
  return { ...actual, layoutNeedsLoad: () => needs.load };
});
```

and in `beforeEach` add `needs.load = false;`.

3. Add these cases inside the `describe`:

```ts
it("skips folder_load when the layout has no load section", async () => {
  const p = await buildFolderPayload(supabase, "f1", "u1");
  expect(resolveFolderLoad).not.toHaveBeenCalled();
  expect(p!.load).toBeNull();
});

it("skips folder_load when the folder has no dated items", async () => {
  needs.load = true;
  const p = await buildFolderPayload(supabase, "f1", "u1"); // rollup mock returns []
  expect(resolveFolderLoad).not.toHaveBeenCalled();
  expect(p!.load).toBeNull();
});

it("reads folder_load in wave B when the layout wants it and dates exist", async () => {
  needs.load = true;
  vi.mocked(resolveFolderRollup).mockResolvedValueOnce({
    ok: true,
    rows: [{ minDue: "2026-09-01", maxDue: "2026-09-30" }] as never,
  });
  const p = await buildFolderPayload(supabase, "f1", "u1");
  expect(resolveFolderLoad).toHaveBeenCalledWith(supabase, "f1");
  expect(p!.load).toHaveLength(1);
  expect(order.indexOf("start:load")).toBeGreaterThan(
    order.indexOf("end:head"),
  );
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/lib/folders/resolve.test.ts src/lib/folders/layout.test.ts src/lib/folders/payload.test.ts`
Expected: FAIL, `resolveFolderLoad` / `layoutNeedsLoad` not exported.

- [ ] **Step 3: Implement**

In `src/lib/folders/resolve.ts`: add `LoadRow` to the type import from `./types`, then add under `resolveFolderBurn`:

```ts
const loadRowSchema = z.object({
  board_id: z.string(),
  stage_key: z.string(),
  week_start: z.string(),
  open_due: z.number(),
});

/** Board × stage × week load grid (folder_tower migration). The RPC's window
 *  defaults (three weeks back, three ahead) are the only ones the UI draws. */
export async function resolveFolderLoad(
  supabase: DB,
  folderId: string,
): Promise<Resolved<LoadRow>> {
  const { data, error } = await typedRpc(supabase, "folder_load", {
    p_folder_id: folderId,
  });
  if (error) return { ok: false, error: mapRpcError(error, "folder_load") };
  const parsed = z.array(loadRowSchema).safeParse(data ?? []);
  if (!parsed.success)
    return { ok: false, error: mapZodError(parsed.error, "folder_load") };
  return {
    ok: true,
    rows: parsed.data.map((r) => ({
      boardId: r.board_id,
      stageKey: r.stage_key,
      weekStart: r.week_start,
      openDue: r.open_due,
    })),
  };
}
```

In `src/lib/folders/layout.ts` add at the end:

```ts
/** Whether `folder_load` must run: only the Overview's load section reads it.
 *  Compared as a string so a config saved before the panel existed, or parsed
 *  by an older build, never throws here. */
export function layoutNeedsLoad(config: FolderLayoutConfig): boolean {
  return config.tabs.some((t) =>
    (t.sections ?? []).some(
      (s) => s.type === "builtin" && (s.panel as string) === "load",
    ),
  );
}
```

In `src/lib/folders/payload.ts`: import `layoutNeedsLoad` beside `layoutNeedsBurn` and `resolveFolderLoad` beside `resolveFolderBurn`, then replace wave B and the `load:` line:

```ts
// `folder_load` is skipped for a folder with no dated items: the section
// hides itself there, and the read would return nothing.
const hasDates =
  rollup.ok && rollup.rows.some((r) => r.minDue !== null || r.maxDue !== null);
const [briefs, members, burn, load] = await Promise.all([
  listLatestBriefs(supabase, head.boards, userId),
  listOrgMembersCached(head.folder.orgId),
  layoutNeedsBurn(layout.config)
    ? resolveFolderBurn(supabase, folderId)
    : Promise.resolve(null),
  layoutNeedsLoad(layout.config) && hasDates
    ? resolveFolderLoad(supabase, folderId)
    : Promise.resolve(null),
]);
```

and in the returned object: `load: load && load.ok ? load.rows : null,`.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/lib/folders`
Expected: PASS.
Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/folders/resolve.ts src/lib/folders/resolve.test.ts src/lib/folders/layout.ts src/lib/folders/layout.test.ts src/lib/folders/payload.ts src/lib/folders/payload.test.ts
git commit -m "feat(folders): read the load grid in the payload's second wave"
```

---

### Task 5: KPI cards with trend, zero cards as chips

**Files:**

- Create: `src/components/folders/charts/Sparkline.tsx`, `src/components/folders/charts/Sparkline.test.tsx`, `src/components/folders/panels/KpisPanel.test.tsx`
- Modify: `src/components/folders/charts/KpiCard.tsx`, `src/components/folders/charts/KpiCard.test.tsx`, `src/components/folders/panels/KpisPanel.tsx`

**Interfaces:**

- Consumes: `kpiTrends`, `trendChange`, `Trend`, `Tone` from `@/lib/folders/tower`; `BurnRow`.
- Produces: `<Sparkline points kind color label />`; `KpiCard` optional prop `trend?: { points: number[]; kind: "line" | "bars"; color: StatusColor; label: string; change: { text: string; color: StatusColor } }`; `KpisPanel` optional props `burn?: BurnRow[] | null`, `stage?: string | null`, `board?: string | null`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/folders/charts/Sparkline.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("draws a line with an emphasised end point and a text alternative", () => {
    const { container } = render(
      <Sparkline
        points={[1, 3, 2, 6]}
        color="red"
        label="Overdue, last 4 weeks: 1, 3, 2, 6"
      />,
    );
    expect(
      screen.getByRole("img", { name: /Overdue, last 4 weeks/ }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("polyline")).toHaveLength(1);
    expect(container.querySelectorAll("circle")).toHaveLength(1);
  });

  it("draws one bar per point in bars mode", () => {
    const { container } = render(
      <Sparkline
        kind="bars"
        points={[3, 5, 1]}
        color="blue"
        label="Due per week"
      />,
    );
    expect(container.querySelectorAll("rect")).toHaveLength(3);
  });

  it("renders nothing for fewer than two points and survives a flat series", () => {
    const { container, rerender } = render(
      <Sparkline points={[4]} color="green" label="x" />,
    );
    expect(container.firstChild).toBeNull();
    rerender(<Sparkline points={[4, 4, 4]} color="green" label="x" />);
    expect(
      container.querySelector("polyline")?.getAttribute("points"),
    ).not.toContain("NaN");
  });
});
```

Append to `src/components/folders/charts/KpiCard.test.tsx` inside its `describe`:

```tsx
it("shows a change pill and a sparkline instead of the bar when a trend is given", () => {
  render(
    <KpiCard
      label="Overdue"
      value="601"
      progress={30}
      trend={{
        points: [540, 564, 601],
        kind: "line",
        color: "red",
        label: "Overdue, last 3 weeks",
        change: { text: "+37 this week", color: "red" },
      }}
    />,
  );
  expect(screen.getByText("+37 this week")).toBeInTheDocument();
  expect(
    screen.getByRole("img", { name: "Overdue, last 3 weeks" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).toBeNull();
});
```

(If that file does not already import `screen`, add it to the `@testing-library/react` import.)

Create `src/components/folders/panels/KpisPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FIXTURE_TODAY, folderFixture } from "@/lib/folders/fixture";
import { KpisPanel } from "./KpisPanel";

const fx = folderFixture();
const all = [
  "complete",
  "gap",
  "overdue",
  "dueThisWeek",
  "blocked",
  "stale",
] as const;

function renderPanel(patch: Partial<Parameters<typeof KpisPanel>[0]> = {}) {
  render(
    <KpisPanel
      cards={[...all]}
      rows={fx.rollup!}
      todayISO={FIXTURE_TODAY}
      failed={false}
      onRetry={vi.fn()}
      {...patch}
    />,
  );
}

describe("KpisPanel", () => {
  it("draws sparklines from the burn rows when no board filter is set", () => {
    renderPanel({ burn: fx.burn, stage: null, board: null });
    expect(screen.getAllByRole("img").length).toBeGreaterThanOrEqual(2);
  });

  it("draws no sparkline while a board filter is set or burn is missing", () => {
    renderPanel({ burn: fx.burn, stage: null, board: "b1" });
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("collapses zero cards into chips and keeps their labels findable", () => {
    const rows = fx.rollup!.map((r) => ({ ...r, blocked: 0, stale: 0 }));
    renderPanel({ rows });
    const chips = screen.getAllByTestId("kpi-chip").map((c) => c.textContent);
    expect(chips).toEqual(expect.arrayContaining(["Blocked0", "Stale0"]));
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    const cardLabels = screen
      .getAllByTestId("kpi-label")
      .map((n) => n.textContent);
    expect(cardLabels).not.toContain("Blocked");
    expect(cardLabels).toContain("Complete");
  });

  it("says so when the folder has no due dates", () => {
    const rows = fx.rollup!.map((r) => ({
      ...r,
      minDue: null,
      maxDue: null,
      plannedByToday: 0,
      overdue: 0,
      dueThisWeek: 0,
      dueThisWeekNotStarted: 0,
      oldestOverdue: null,
    }));
    renderPanel({ rows });
    expect(screen.getByText("No due dates set")).toBeInTheDocument();
    const cardLabels = screen
      .getAllByTestId("kpi-label")
      .map((n) => n.textContent);
    expect(cardLabels).not.toContain("Gap to plan");
    expect(cardLabels).not.toContain("Overdue");
  });

  it("only considers the cards the layout names", () => {
    const rows = fx.rollup!.map((r) => ({ ...r, stale: 0 }));
    renderPanel({ rows, cards: ["complete", "overdue"] });
    expect(screen.queryByText("Stale")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/components/folders/charts/Sparkline.test.tsx src/components/folders/charts/KpiCard.test.tsx src/components/folders/panels/KpisPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write `Sparkline.tsx`**

```tsx
import type { StatusColor } from "@/components/ui/status-pill";

const W = 84;
const H = 28;
const PAD = 3;

/** A tiny trend mark for a KPI card: plain SVG, no chart library, so it costs
 *  nothing on first paint. Colour comes from the status token; `label` is the
 *  text alternative and should state the series in words. */
export function Sparkline({
  points,
  kind = "line",
  color,
  label,
}: {
  points: number[];
  kind?: "line" | "bars";
  color: StatusColor;
  label: string;
}) {
  if (points.length < 2) return null;
  const min = Math.min(...points, kind === "bars" ? 0 : Infinity);
  const max = Math.max(...points);
  const span = max - min || 1;
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);
  const style = { color: `var(--status-${color})` };
  if (kind === "bars") {
    const bw = (W - 2 * PAD) / points.length;
    return (
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${W} ${H}`}
        className="h-7 w-[5.25rem] shrink-0"
        style={style}
      >
        {points.map((v, i) => (
          <rect
            key={i}
            x={PAD + i * bw + 1}
            y={y(v)}
            width={Math.max(1, bw - 2)}
            height={Math.max(1, H - PAD - y(v))}
            rx={1}
            fill="currentColor"
            opacity={i === 0 ? 1 : 0.45}
          />
        ))}
      </svg>
    );
  }
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - 2 * PAD);
  const last = points.length - 1;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${W} ${H}`}
      className="h-7 w-[5.25rem] shrink-0"
      style={style}
    >
      <polyline
        points={points.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={x(last)} cy={y(points[last]!)} r={2.6} fill="currentColor" />
    </svg>
  );
}
```

- [ ] **Step 4: Add the trend row to `KpiCard.tsx`**

Add the import `import { Sparkline } from "@/components/folders/charts/Sparkline";`, add the prop

```ts
  trend?: {
    points: number[];
    kind: "line" | "bars";
    color: StatusColor;
    label: string;
    change: { text: string; color: StatusColor };
  };
```

to both the destructuring and the props type, and replace the final `{pct === null ? null : (…progress bar…)}` block with:

```tsx
{
  trend ? (
    <div className="flex items-end justify-between gap-2">
      <StatusPill color={trend.change.color} variant="soft">
        {trend.change.text}
      </StatusPill>
      <Sparkline
        points={trend.points}
        kind={trend.kind}
        color={trend.color}
        label={trend.label}
      />
    </div>
  ) : pct === null ? null : (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
      className="bg-surface-muted h-1 w-full overflow-hidden rounded-sm"
    >
      <div
        className={cn("h-full rounded-sm", STATUS_BG[barColor])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
```

Update the component's doc comment to: `/** One dense KPI card: value, badge, one sub-fact, then either a trend row (change pill + sparkline) or a thin progress bar. */`

- [ ] **Step 5: Rewrite `KpisPanel.tsx`**

Replace the whole file with:

```tsx
import { Fragment, type ReactNode } from "react";
import { KpiCard } from "@/components/folders/charts/KpiCard";
import type { StatusColor } from "@/components/ui/status-pill";
import { computeKpis, type Kpis } from "@/lib/folders/rollup";
import { kpiTrends, trendChange, type Trend } from "@/lib/folders/tower";
import type { KpiKey } from "@/lib/validations/folder-layout";
import type { BurnRow, RollupRow } from "@/lib/folders/types";
import { Failed } from "./Panel";

type TrendProp = Parameters<typeof KpiCard>[0]["trend"];

const LABEL: Record<KpiKey, string> = {
  complete: "Complete",
  gap: "Gap to plan",
  overdue: "Overdue",
  dueThisWeek: "Due this week",
  blocked: "Blocked",
  stale: "Stale",
};

const TREND_COLOR: Partial<Record<KpiKey, StatusColor>> = {
  complete: "green",
  gap: "red",
  overdue: "red",
  dueThisWeek: "blue",
};

function trendProp(key: KpiKey, t: Trend | undefined): TrendProp {
  if (!t) return undefined;
  const change = trendChange(key, t);
  const span =
    t.kind === "bars"
      ? `next ${t.points.length} weeks`
      : `last ${t.points.length} weeks`;
  return {
    points: t.points,
    kind: t.kind,
    color: TREND_COLOR[key] ?? "blue",
    label: `${LABEL[key]}, ${span}: ${t.points.join(", ")}`,
    change: { text: change.text, color: change.tone },
  };
}

/** A card with nothing to say is drawn as a chip instead. Complete and a gap
 *  of exactly zero stay cards: 0% and "on plan" are information. */
const IS_ZERO: Record<KpiKey, (k: Kpis) => boolean> = {
  complete: (k) => k.donePct === null,
  gap: (k) => k.gap === null,
  overdue: (k) => k.overdue === 0,
  dueThisWeek: (k) => k.dueThisWeek === 0,
  blocked: (k) => k.blocked === 0,
  stale: (k) => k.stale === 0,
};

const CHIP_VALUE: Record<KpiKey, (k: Kpis) => string> = {
  complete: () => "—",
  gap: () => "—",
  overdue: (k) => String(k.overdue),
  dueThisWeek: (k) => String(k.dueThisWeek),
  blocked: (k) => String(k.blocked),
  stale: (k) => String(k.stale),
};

const CARD: Record<KpiKey, (k: Kpis, trend: TrendProp) => ReactNode> = {
  complete: (k, trend) => (
    <KpiCard
      label={LABEL.complete}
      value={k.donePct === null ? "—" : `${k.donePct}%`}
      badge={{ text: `${k.done} done`, color: "green" }}
      subFact={`${k.plannedByToday} planned by today`}
      progress={k.donePct}
      barColor="green"
      trend={trend}
    />
  ),
  gap: (k, trend) => (
    <KpiCard
      label={LABEL.gap}
      value={k.gap === null ? "—" : `${k.gap > 0 ? "+" : ""}${k.gap}`}
      badge={
        k.gap === null
          ? undefined
          : {
              text: k.gap < 0 ? "behind" : "ahead",
              color: k.gap < 0 ? "red" : "green",
            }
      }
      subFact="done − planned"
      progress={
        k.gap === null || k.total === 0
          ? null
          : Math.min(100, (Math.abs(k.gap) / k.total) * 100)
      }
      barColor={k.gap !== null && k.gap < 0 ? "red" : "green"}
      trend={trend}
    />
  ),
  overdue: (k, trend) => (
    <KpiCard
      label={LABEL.overdue}
      value={String(k.overdue)}
      badge={
        k.oldestOverdueDays === null
          ? undefined
          : { text: `oldest ${k.oldestOverdueDays}d`, color: "red" }
      }
      subFact="open items past due"
      progress={k.total === 0 ? null : (k.overdue / k.total) * 100}
      barColor="red"
      trend={trend}
    />
  ),
  dueThisWeek: (k, trend) => (
    <KpiCard
      label={LABEL.dueThisWeek}
      value={String(k.dueThisWeek)}
      subFact={`${k.dueThisWeekNotStarted} not yet started`}
      progress={
        k.dueThisWeek === 0
          ? null
          : ((k.dueThisWeek - k.dueThisWeekNotStarted) / k.dueThisWeek) * 100
      }
      barColor="blue"
      trend={trend}
    />
  ),
  blocked: (k) => (
    <KpiCard
      label={LABEL.blocked}
      value={String(k.blocked)}
      subFact="status blocked or stuck"
      progress={k.total === 0 ? null : (k.blocked / k.total) * 100}
      barColor="red"
    />
  ),
  stale: (k) => (
    <KpiCard
      label={LABEL.stale}
      value={String(k.stale)}
      subFact="untouched > 14 days"
      progress={k.total === 0 ? null : (k.stale / k.total) * 100}
      barColor="yellow"
    />
  ),
};

/**
 * The KPI row. `cards` is the folder's chosen subset, in its chosen order.
 * Cards with a value get a trend when the burn rows are on the page and no
 * board filter is set (the burn RPC has no board dimension); cards at zero
 * collapse into one row of chips so they stop competing for attention.
 */
export function KpisPanel({
  cards,
  rows,
  todayISO,
  failed,
  onRetry,
  burn = null,
  stage = null,
  board = null,
}: {
  cards: KpiKey[];
  rows: RollupRow[];
  todayISO: string;
  failed: boolean;
  onRetry: () => void;
  burn?: BurnRow[] | null;
  stage?: string | null;
  board?: string | null;
}) {
  const k = computeKpis(rows, todayISO);
  if (failed) return <Failed onRetry={onRetry} />;
  const trends =
    burn === null || board !== null
      ? {}
      : kpiTrends(burn, stage, todayISO, k.total);
  const live = cards.filter((key) => !IS_ZERO[key](k));
  const quiet = cards.filter((key) => IS_ZERO[key](k));
  const anyDue = rows.some((r) => r.minDue !== null || r.maxDue !== null);
  return (
    <div className="flex flex-col gap-3">
      {live.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {live.map((key) => (
            <Fragment key={key}>
              {CARD[key](k, trendProp(key, trends[key]))}
            </Fragment>
          ))}
        </div>
      ) : null}
      {quiet.length > 0 || !anyDue ? (
        <ul
          aria-label="Nothing to report"
          className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs"
        >
          {quiet.map((key) => (
            <li
              key={key}
              data-testid="kpi-chip"
              className="inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono"
            >
              <span>{LABEL[key]}</span>
              <span className="tabular-nums">{CHIP_VALUE[key](k)}</span>
            </li>
          ))}
          {!anyDue && rows.length > 0 ? (
            <li className="inline-flex items-center rounded-sm border px-2 py-0.5 font-mono">
              No due dates set
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run src/components/folders/charts src/components/folders/panels src/components/folders/tabs/Overview.test.tsx`
Expected: PASS. `Overview.test.tsx`'s "renders the six KPI cards" still passes because a chip keeps its label as its own text node.

- [ ] **Step 7: Commit**

```bash
git add src/components/folders/charts/Sparkline.tsx src/components/folders/charts/Sparkline.test.tsx src/components/folders/charts/KpiCard.tsx src/components/folders/charts/KpiCard.test.tsx src/components/folders/panels/KpisPanel.tsx src/components/folders/panels/KpisPanel.test.tsx
git commit -m "feat(folders): show a trend on each kpi card and collapse zero cards"
```

---

### Task 6: Burn chart forecast and the no-dates fallback

**Files:**

- Create: `src/components/folders/charts/StageBars.tsx`, `src/components/folders/charts/StageBars.test.tsx`
- Modify: `src/components/folders/charts/BurnChartInner.tsx`, `src/components/folders/charts/BurnChartInner.test.tsx`, `src/components/folders/panels/BurnPanel.tsx`
- Create: `src/components/folders/panels/BurnPanel.test.tsx`

**Interfaces:**

- Consumes: `Forecast`, `forecastReading`, `StageBar` from `@/lib/folders/tower`; `BurnPoint`.
- Produces: `BurnChartInner` / `BurnChart` optional prop `forecast?: { weekStart: string; value: number }[]`; `BurnPanel` optional props `forecast?: Forecast | null`, `stageBars?: StageBar[]`; `<StageBars bars />`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/folders/charts/StageBars.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StageBars } from "./StageBars";

const bars = [
  {
    key: "leads",
    name: "Leads",
    color: "#0073ea",
    total: 9,
    done: 0,
    stale: 0,
  },
  {
    key: "poc",
    name: "POC Stage",
    color: "#a25ddc",
    total: 5,
    done: 0,
    stale: 4,
  },
];

describe("StageBars", () => {
  it("draws one row per stage with its count and stale share", () => {
    render(<StageBars bars={bars} />);
    expect(screen.getByText("Leads")).toBeInTheDocument();
    expect(screen.getByText("5 · 4 stale")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "POC Stage: 5 items, 4 stale" }),
    ).toBeInTheDocument();
    const stale = screen.getAllByTestId("stage-bar-stale");
    // Widths are shares of the largest stage (9), so bars compare across rows.
    expect(stale[1]!.style.width).toBe(`${(4 / 9) * 100}%`);
  });

  it("shows an empty state with no stages", () => {
    render(<StageBars bars={[]} />);
    expect(screen.getByText("No items yet.")).toBeInTheDocument();
  });
});
```

Create `src/components/folders/panels/BurnPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/folders/charts/BurnChart", () => ({
  BurnChart: (p: { mode: string; forecast?: unknown[] }) => (
    <div
      data-testid="burn-chart"
      data-mode={p.mode}
      data-forecast={p.forecast?.length ?? 0}
    />
  ),
}));
import { BurnPanel } from "./BurnPanel";

const points = [
  {
    weekStart: "2026-09-07",
    planned: 4,
    completed: 4,
    plannedCum: 16,
    completedCum: 12,
    isPast: true,
    importedDone: 0,
  },
  {
    weekStart: "2026-09-14",
    planned: 4,
    completed: 1,
    plannedCum: 20,
    completedCum: 13,
    isPast: true,
    importedDone: 0,
  },
];
const forecast = {
  pace: 3,
  importedDone: 0,
  remaining: 11,
  gapNow: -7,
  finishWeek: "2026-10-12",
  lastPlannedWeek: "2026-09-21",
  weeksLate: 3,
  line: [{ weekStart: "2026-09-14", value: 13 }],
};

describe("BurnPanel", () => {
  it("prints the reading and the gap above the chart and passes the forecast line down", () => {
    render(
      <BurnPanel
        kicker="02"
        board={null}
        burn={points}
        anyDue
        onRetry={vi.fn()}
        forecast={forecast}
      />,
    );
    expect(screen.getByTestId("burn-reading")).toHaveTextContent(
      "7 behind plan today. At 3 a week the folder finishes around Oct 12, 3 weeks after its last planned date.",
    );
    expect(screen.getByTestId("burn-chart")).toHaveAttribute(
      "data-forecast",
      "1",
    );
  });

  it("says ahead when the gap is positive and nothing when it is zero", () => {
    const { rerender } = render(
      <BurnPanel
        kicker="02"
        board={null}
        burn={points}
        anyDue
        onRetry={vi.fn()}
        forecast={{ ...forecast, gapNow: 4 }}
      />,
    );
    expect(screen.getByTestId("burn-reading")).toHaveTextContent(
      "4 ahead of plan today.",
    );
    rerender(
      <BurnPanel
        kicker="02"
        board={null}
        burn={points}
        anyDue
        onRetry={vi.fn()}
        forecast={{ ...forecast, gapNow: 0 }}
      />,
    );
    expect(screen.getByTestId("burn-reading")).not.toHaveTextContent(
      "plan today",
    );
  });

  it("shows items by stage instead of the chart when the folder has no dates", () => {
    render(
      <BurnPanel
        kicker="02"
        board={null}
        burn={[]}
        anyDue={false}
        onRetry={vi.fn()}
        stageBars={[
          {
            key: "leads",
            name: "Leads",
            color: "#0073ea",
            total: 9,
            done: 0,
            stale: 2,
          },
        ]}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Items by stage" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Leads")).toBeInTheDocument();
    expect(screen.queryByTestId("burn-chart")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("keeps the old empty state when no stage bars are supplied", () => {
    render(
      <BurnPanel
        kicker="02"
        board={null}
        burn={[]}
        anyDue={false}
        onRetry={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Add due dates to see planned vs completed"),
    ).toBeInTheDocument();
  });
});
```

Append to `src/components/folders/charts/BurnChartInner.test.tsx`, inside its `describe`, reusing whatever points constant the first test in that file passes (named `points` below; if the file names it differently, use that name):

```tsx
it("draws a second, dotted line for the forecast in cumulative mode", () => {
  const { container } = render(
    <BurnChartInner
      points={points}
      mode="cumulative"
      forecast={[
        { weekStart: points[points.length - 2]!.weekStart, value: 3 },
        { weekStart: points[points.length - 1]!.weekStart, value: 5 },
      ]}
    />,
  );
  expect(container.querySelectorAll(".recharts-line").length).toBe(2);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/components/folders/charts/StageBars.test.tsx src/components/folders/panels/BurnPanel.test.tsx src/components/folders/charts/BurnChartInner.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write `StageBars.tsx`**

```tsx
import { EmptyState } from "@/components/ui/empty-state";
import { STATUS_BG } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import type { StageBar } from "@/lib/folders/tower";

/** Items per stage with the stale share marked: what the burn section shows
 *  for a folder that has no dates to plot (a pipeline, a backlog). */
export function StageBars({ bars }: { bars: StageBar[] }) {
  if (bars.length === 0)
    return <EmptyState variant="inline">No items yet.</EmptyState>;
  const max = Math.max(...bars.map((b) => b.total));
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {bars.map((b) => (
          <li
            key={b.key}
            className="grid grid-cols-[8rem_minmax(0,1fr)_auto] items-center gap-3 text-xs"
          >
            <span className="truncate font-medium" title={b.name}>
              {b.name}
            </span>
            <div
              role="img"
              aria-label={`${b.name}: ${b.total} items, ${b.stale} stale`}
              className="bg-surface-muted flex h-3 overflow-hidden rounded-sm"
            >
              <div
                className={cn("h-full", STATUS_BG.blue)}
                style={{ width: `${((b.total - b.stale) / max) * 100}%` }}
              />
              <div
                data-testid="stage-bar-stale"
                className={cn("h-full", STATUS_BG.yellow)}
                style={{ width: `${(b.stale / max) * 100}%` }}
              />
            </div>
            <span className="text-muted-foreground font-mono tabular-nums">
              {b.stale > 0 ? `${b.total} · ${b.stale} stale` : b.total}
            </span>
          </li>
        ))}
      </ul>
      <div className="text-muted-foreground flex gap-4 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("size-2 rounded-sm", STATUS_BG.blue)} /> Active
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("size-2 rounded-sm", STATUS_BG.yellow)} /> Stale
          (untouched &gt; 14 days)
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the forecast line to `BurnChartInner.tsx`**

Add to `CONFIG`: `forecast: { label: "Forecast", color: "var(--primary)" },`.

Add the prop `forecast?: { weekStart: string; value: number }[];` to the destructuring and the props type.

Replace the `const data = points.map(...)` statement with:

```ts
const forecastByWeek = new Map(
  (mode === "cumulative" ? (forecast ?? []) : []).map((f) => [
    f.weekStart,
    f.value,
  ]),
);
const data = points.map((p) => ({
  week: p.weekStart,
  planned: mode === "cumulative" ? p.plannedCum : p.planned,
  completed: mode === "cumulative" ? p.completedCum : p.completed,
  gap:
    mode === "cumulative" && p.isPast
      ? Math.max(0, p.plannedCum - p.completedCum)
      : 0,
  gapBase: mode === "cumulative" && p.isPast ? p.completedCum : 0,
  forecast: forecastByWeek.get(p.weekStart) ?? null,
}));
```

and inside the cumulative fragment, after the planned `<Line … />`, add:

```tsx
{
  forecastByWeek.size > 1 ? (
    <Line
      type="linear"
      dataKey="forecast"
      stroke="var(--color-forecast)"
      strokeDasharray="2 5"
      dot={false}
      strokeWidth={1.5}
      connectNulls={false}
      isAnimationActive={false}
    />
  ) : null;
}
```

Update the doc comment's first sentence to mention "and a dotted forecast line from today when one is supplied".

- [ ] **Step 5: Rewrite `BurnPanel.tsx`**

```tsx
"use client";

import { useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { BurnChart } from "@/components/folders/charts/BurnChart";
import { BurnScopeNote } from "@/components/folders/charts/BurnScopeNote";
import { StageBars } from "@/components/folders/charts/StageBars";
import type { BurnMode } from "@/components/folders/charts/BurnChartInner";
import type { BurnPoint } from "@/lib/folders/rollup";
import {
  forecastReading,
  type Forecast,
  type StageBar,
} from "@/lib/folders/tower";
import { cn } from "@/lib/utils";
import { Failed, Panel } from "./Panel";

function gapSentence(gap: number): string {
  if (gap === 0) return "";
  return gap < 0
    ? `${-gap} behind plan today. `
    : `${gap} ahead of plan today. `;
}

/**
 * "Planned vs completed" with a forecast, or, for a folder with no dates,
 * "Items by stage". `mode` is local UI state (cumulative/weekly), not folder
 * data, so it lives here rather than being threaded through Overview.
 */
export function BurnPanel({
  kicker,
  title,
  board,
  burn,
  anyDue,
  onRetry,
  forecast = null,
  stageBars,
}: {
  kicker: string;
  title?: string;
  /** The active board filter, for the scope caption only — the burn RPC has
   *  no board dimension. */
  board: string | null;
  burn: BurnPoint[] | null;
  anyDue: boolean;
  onRetry: () => void;
  forecast?: Forecast | null;
  /** Supplied by Overview; when the folder has no dates these replace the chart. */
  stageBars?: StageBar[];
}) {
  const [mode, setMode] = useState<BurnMode>("cumulative");
  const noDates = !anyDue && stageBars !== undefined;
  if (noDates)
    return (
      <Panel kicker={kicker} title={title ?? "Items by stage"}>
        <StageBars bars={stageBars} />
      </Panel>
    );
  const charted = burn !== null && anyDue && burn.length > 0;
  return (
    <Panel kicker={kicker} title={title ?? "Planned vs completed"}>
      <div
        role="radiogroup"
        aria-label="Chart mode"
        data-print-hide
        className="flex gap-1 self-end"
      >
        {(["cumulative", "weekly"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              // Hand-rolled control: it has to buy its own 44px coarse
              // touch target, the app primitives get it for free.
              "inline-flex items-center rounded-sm border px-2 py-0.5 text-xs pointer-coarse:min-h-11 pointer-coarse:px-3",
              mode === m
                ? "border-border-bright text-foreground"
                : "text-muted-foreground hover:border-border-hover",
            )}
          >
            {m === "cumulative" ? "Cumulative" : "Weekly"}
          </button>
        ))}
      </div>
      <BurnScopeNote board={board} />
      {charted && forecast ? (
        <p data-testid="burn-reading" className="text-muted-foreground text-xs">
          {gapSentence(forecast.gapNow)}
          {forecastReading(forecast)}
        </p>
      ) : null}
      {burn === null ? (
        <Failed onRetry={onRetry} />
      ) : !charted ? (
        <EmptyState variant="inline">
          Add due dates to see planned vs completed
        </EmptyState>
      ) : (
        <BurnChart points={burn} mode={mode} forecast={forecast?.line} />
      )}
    </Panel>
  );
}
```

`BurnChart.tsx` is a `dynamic()` wrapper that forwards props, so it needs no change.

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run src/components/folders/charts src/components/folders/panels src/components/folders/tabs/Overview.test.tsx src/components/folders/no-recharts-in-first-paint.test.ts`
Expected: PASS. Overview still passes `anyDue` without `stageBars`, so its "Add due dates…" test is unaffected until Task 10.

- [ ] **Step 7: Commit**

```bash
git add src/components/folders/charts/StageBars.tsx src/components/folders/charts/StageBars.test.tsx src/components/folders/charts/BurnChartInner.tsx src/components/folders/charts/BurnChartInner.test.tsx src/components/folders/panels/BurnPanel.tsx src/components/folders/panels/BurnPanel.test.tsx
git commit -m "feat(folders): forecast the finish on the burn chart and chart stages without dates"
```

---

### Task 7: Load heat map

**Files:**

- Create: `src/components/folders/charts/LoadHeat.tsx`, `src/components/folders/charts/LoadHeat.test.tsx`, `src/components/folders/panels/LoadPanel.tsx`

**Interfaces:**

- Consumes: `LoadGrid` from `@/lib/folders/tower`.
- Produces: `<LoadHeat grid />`; `<LoadPanel kicker title? grid failed onRetry />` where `grid: LoadGrid | null` (null = the read was not made or failed).

- [ ] **Step 1: Write the failing test**

Create `src/components/folders/charts/LoadHeat.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { loadGrid } from "@/lib/folders/tower";
import { LoadPanel } from "@/components/folders/panels/LoadPanel";
import { LoadHeat } from "./LoadHeat";

const boards = [
  { id: "b1", name: "Backend", position: 0 },
  { id: "b2", name: "Mobile", position: 1 },
];
const grid = loadGrid(
  [
    { boardId: "b1", stageKey: "build", weekStart: "2026-08-24", openDue: 7 },
    { boardId: "b1", stageKey: "build", weekStart: "2026-09-14", openDue: 3 },
    { boardId: "b2", stageKey: "build", weekStart: "2026-10-05", openDue: 4 },
  ],
  boards,
  { stageKey: null, boardId: null },
  "2026-09-15",
);

describe("LoadHeat", () => {
  it("renders a labelled table with one row per board and seven week columns", () => {
    render(<LoadHeat grid={grid} />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(8);
    expect(
      screen.getByRole("rowheader", { name: "Backend" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("links a filled cell to its board and describes it in words", () => {
    render(<LoadHeat grid={grid} />);
    const cell = screen.getByRole("link", {
      name: "Backend, 3 weeks ago or earlier: 7 still open",
    });
    expect(cell).toHaveAttribute("href", "/boards/b1");
    expect(cell).toHaveAttribute("data-tone", "late");
    expect(
      screen.getByRole("link", { name: "Mobile, in 3 weeks: 4 due" }),
    ).toHaveAttribute("data-tone", "ahead");
    expect(
      screen.getByRole("link", { name: "Backend, this week: 3 due" }),
    ).toHaveAttribute("data-tone", "ahead");
  });

  it("draws an empty cell as a dot with no link", () => {
    render(<LoadHeat grid={grid} />);
    expect(screen.getAllByText("·").length).toBe(14 - 3);
  });
});

describe("LoadPanel", () => {
  it("shows the retry state when the read failed and nothing when there is no load", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <LoadPanel kicker="03" grid={null} failed onRetry={onRetry} />,
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    rerender(
      <LoadPanel
        kicker="03"
        grid={{
          ...grid,
          max: 0,
          rows: grid.rows.map((r) => ({ ...r, cells: r.cells.map(() => 0) })),
        }}
        failed={false}
        onRetry={onRetry}
      />,
    );
    expect(
      screen.getByText("Nothing open in this window."),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/components/folders/charts/LoadHeat.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write `LoadHeat.tsx`**

```tsx
import Link from "next/link";
import type { LoadGrid } from "@/lib/folders/tower";

function weekWords(index: number, total: number): string {
  const back = Math.floor(total / 2);
  const o = index - back;
  if (index === 0) return `${back} weeks ago or earlier`;
  if (o < 0) return o === -1 ? "last week" : `${-o} weeks ago`;
  if (o === 0) return "this week";
  return o === 1 ? "next week" : `in ${o} weeks`;
}

/**
 * Open items by board and week. Past weeks (still open) are tinted with the
 * destructive colour, this week and the weeks ahead with the brand colour;
 * intensity follows the count against the grid's maximum. Every filled cell
 * prints its number and links to the board, so colour is never the only
 * signal. Plain CSS, no chart library.
 */
export function LoadHeat({ grid }: { grid: LoadGrid }) {
  const max = grid.max || 1;
  return (
    <table className="w-full table-fixed border-separate border-spacing-0.5 text-xs">
      <thead>
        <tr>
          <th scope="col" className="w-[38%] text-left font-normal">
            <span className="sr-only">Board</span>
          </th>
          {grid.weeks.map((w) => (
            <th
              key={w.weekStart}
              scope="col"
              className="text-kicker text-2xs font-mono font-medium"
            >
              {w.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {grid.rows.map((r) => (
          <tr key={r.boardId}>
            <th
              scope="row"
              title={r.name}
              className="text-muted-foreground truncate pr-2 text-left font-normal"
            >
              {r.name}
            </th>
            {r.cells.map((n, i) => {
              const past = grid.weeks[i]!.past;
              if (n === 0)
                return (
                  <td
                    key={i}
                    className="bg-surface-muted text-muted-foreground h-6 rounded-sm text-center"
                  >
                    ·
                  </td>
                );
              const mix = Math.round(14 + 36 * (n / max));
              return (
                <td key={i} className="p-0">
                  <Link
                    href={`/boards/${r.boardId}`}
                    data-tone={past ? "late" : "ahead"}
                    aria-label={`${r.name}, ${weekWords(i, grid.weeks.length)}: ${n} ${past ? "still open" : "due"}`}
                    title={`${r.name}, week of ${grid.weeks[i]!.weekStart}: ${n} ${past ? "still open" : "due"}`}
                    className="text-foreground hover:ring-border-bright flex h-6 items-center justify-center rounded-sm font-mono tabular-nums hover:ring-1"
                    style={{
                      backgroundColor: `color-mix(in oklab, var(${past ? "--status-red" : "--primary"}) ${mix}%, transparent)`,
                    }}
                  >
                    {n}
                  </Link>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Write `LoadPanel.tsx`**

```tsx
import { EmptyState } from "@/components/ui/empty-state";
import { LoadHeat } from "@/components/folders/charts/LoadHeat";
import type { LoadGrid } from "@/lib/folders/tower";
import { Failed, Panel } from "./Panel";

export function LoadPanel({
  kicker,
  title = "Load by board and week",
  grid,
  failed,
  onRetry,
}: {
  kicker: string;
  title?: string;
  grid: LoadGrid | null;
  failed: boolean;
  onRetry: () => void;
}) {
  return (
    <Panel kicker={kicker} title={title}>
      {failed || grid === null ? (
        <Failed onRetry={onRetry} />
      ) : grid.max === 0 ? (
        <EmptyState variant="inline">Nothing open in this window.</EmptyState>
      ) : (
        <>
          <LoadHeat grid={grid} />
          <p className="text-muted-foreground text-xs">
            Red: still open from a past week. Accent: due this week or later.
          </p>
        </>
      )}
    </Panel>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/components/folders/charts/LoadHeat.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/folders/charts/LoadHeat.tsx src/components/folders/charts/LoadHeat.test.tsx src/components/folders/panels/LoadPanel.tsx
git commit -m "feat(folders): add the board by week load heat map"
```

---

### Task 8: People load section

**Files:**

- Create: `src/components/folders/panels/PeoplePanel.tsx`, `src/components/folders/panels/PeoplePanel.test.tsx`

**Interfaces:**

- Consumes: `getFolderWorkload` (`src/lib/folders/actions.ts:219`), `workloadKey` and `peopleFromWorkload` (`src/components/folders/tabs/People.tsx:18,31`), `WorkloadBars` (`charts/WorkloadBars.tsx`).
- Produces: `<PeoplePanel kicker title? folderId stage members onSeeAll? />`; exported `PEOPLE_SHOWN = 8`.

- [ ] **Step 1: Write the failing test**

Create `src/components/folders/panels/PeoplePanel.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkloadRow } from "@/lib/folders/types";

const getFolderWorkload = vi.fn();
vi.mock("@/lib/folders/actions", () => ({
  getFolderWorkload: (input: { folderId: string }) => getFolderWorkload(input),
}));
import { PeoplePanel } from "./PeoplePanel";

const members = [
  { userId: "u1", fullName: "Ada Lovelace", avatarUrl: null },
  { userId: "u2", fullName: "Grace Hopper", avatarUrl: null },
];
const row = (
  userId: string | null,
  open: number,
  overdue: number,
  stageKey = "build",
): WorkloadRow => ({
  userId,
  boardId: "b1",
  boardName: "Backend",
  stageKey,
  stageName: stageKey,
  open,
  overdue,
});

function renderPanel(props: Partial<Parameters<typeof PeoplePanel>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PeoplePanel
        kicker="05"
        folderId="f1"
        stage={null}
        members={members}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("PeoplePanel", () => {
  beforeEach(() => getFolderWorkload.mockReset());

  it("loads workload once and lists people with open and late counts, unassigned last", async () => {
    getFolderWorkload.mockResolvedValue({
      ok: true,
      data: [row("u1", 9, 4), row("u2", 3, 0), row(null, 5, 2)],
    });
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText("Ada Lovelace")).toBeInTheDocument(),
    );
    expect(getFolderWorkload).toHaveBeenCalledTimes(1);
    expect(getFolderWorkload).toHaveBeenCalledWith({ folderId: "f1" });
    expect(screen.getByText("4 late")).toBeInTheDocument();
    const names = screen
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    expect(names[names.length - 1]).toContain("Unassigned");
  });

  it("narrows to the selected stage without another request", async () => {
    getFolderWorkload.mockResolvedValue({
      ok: true,
      data: [row("u1", 9, 4, "build"), row("u2", 3, 0, "qa")],
    });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const ui = (stage: string | null) => (
      <QueryClientProvider client={qc}>
        <PeoplePanel
          kicker="05"
          folderId="f1"
          stage={stage}
          members={members}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(ui(null));
    await waitFor(() =>
      expect(screen.getByText("Grace Hopper")).toBeInTheDocument(),
    );
    rerender(ui("build"));
    expect(screen.queryByText("Grace Hopper")).toBeNull();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(getFolderWorkload).toHaveBeenCalledTimes(1);
  });

  it("shows at most eight people and offers the full list", async () => {
    const many = Array.from({ length: 11 }, (_, i) => row(`x${i}`, 20 - i, 0));
    getFolderWorkload.mockResolvedValue({ ok: true, data: many });
    const onSeeAll = vi.fn();
    renderPanel({ onSeeAll });
    await waitFor(() =>
      expect(screen.getAllByTestId("workload-bar")).toHaveLength(8),
    );
    fireEvent.click(screen.getByRole("button", { name: "See all 11" }));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it("reports a failed read in place", async () => {
    getFolderWorkload.mockResolvedValue({ ok: false, error: "nope" });
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText(/Couldn't load workload/)).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/components/folders/panels/PeoplePanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write `PeoplePanel.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getFolderWorkload } from "@/lib/folders/actions";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  WorkloadBars,
  type WorkloadPerson,
} from "@/components/folders/charts/WorkloadBars";
import {
  peopleFromWorkload,
  workloadKey,
} from "@/components/folders/tabs/People";
import type { FolderMember } from "@/lib/folders/types";
import { Panel } from "./Panel";

export const PEOPLE_SHOWN = 8;

/** True once the element is near the viewport. Where IntersectionObserver is
 *  missing (jsdom, very old browsers) it is true at once. */
function useNearViewport<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [near, setNear] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    const el = ref.current;
    if (near || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return { ref, near };
}

/**
 * Open and late work per person on the Overview. Reads the SAME query the
 * People tab reads (same key, 60 s stale time), fetched when this section
 * nears the viewport — never on first paint. Stage changes re-derive from the
 * cache.
 */
export function PeoplePanel({
  kicker,
  title = "Open work by person",
  folderId,
  stage,
  members,
  onSeeAll,
}: {
  kicker: string;
  title?: string;
  folderId: string;
  stage: string | null;
  members: FolderMember[];
  /** Opens the People tab. Omitted when the layout has no People tab. */
  onSeeAll?: () => void;
}) {
  const { ref, near } = useNearViewport<HTMLDivElement>();
  const q = useQuery({
    queryKey: workloadKey(folderId),
    queryFn: async () => {
      const res = await getFolderWorkload({ folderId });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    staleTime: 60_000,
    enabled: near,
  });

  let body;
  if (q.isError)
    body = (
      <EmptyState variant="inline">
        Couldn&apos;t load workload. {q.error.message}
      </EmptyState>
    );
  else if (!q.data) body = <Skeleton className="h-40 w-full" />;
  else {
    const people = peopleFromWorkload(q.data, stage, members);
    const loose = q.data.filter(
      (r) => r.userId === null && (stage === null || r.stageKey === stage),
    );
    const unassigned: WorkloadPerson | null =
      loose.length === 0
        ? null
        : {
            userId: null,
            name: "Unassigned",
            avatarUrl: null,
            open: loose.reduce((s, r) => s + r.open, 0),
            overdue: loose.reduce((s, r) => s + r.overdue, 0),
          };
    const shown = people.slice(0, PEOPLE_SHOWN);
    body = (
      <>
        <WorkloadBars people={unassigned ? [...shown, unassigned] : shown} />
        {people.length > PEOPLE_SHOWN && onSeeAll ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={onSeeAll}
          >
            See all {people.length}
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <div ref={ref}>
      <Panel kicker={kicker} title={title}>
        {body}
      </Panel>
    </div>
  );
}
```

In the third test, `getAllByTestId("workload-bar")` counts bars; with eleven people and no unassigned row the panel renders exactly eight.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/components/folders/panels/PeoplePanel.test.tsx src/components/folders/tabs/People.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/folders/panels/PeoplePanel.tsx src/components/folders/panels/PeoplePanel.test.tsx
git commit -m "feat(folders): add a lazy people load section to the overview"
```

---

### Task 9: Boards with health and sort, grouped attention

**Files:**

- Modify: `src/components/folders/tabs/Boards.tsx` (export `HEALTH` only), `src/components/folders/panels/BoardStatusPanel.tsx`, `src/components/folders/panels/AttentionPanel.tsx`
- Create: `src/components/folders/panels/BoardStatusPanel.test.tsx`, `src/components/folders/panels/AttentionPanel.test.tsx`

**Interfaces:**

- Consumes: `BoardSummary` (`rollup.ts`), `AttentionGroup` (`tower.ts`), `HEALTH` (`tabs/Boards.tsx:27`).
- Produces: `BoardStatusPanel` unchanged props, new behaviour; `AttentionPanel` optional prop `groups?: AttentionGroup[] | null` (when given, the grouped view replaces the flat list).

- [ ] **Step 1: Write the failing tests**

Create `src/components/folders/panels/BoardStatusPanel.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BoardSummary } from "@/lib/folders/rollup";
import { BoardStatusPanel } from "./BoardStatusPanel";

const b = (
  o: Partial<BoardSummary> &
    Pick<BoardSummary, "id" | "name" | "health" | "total">,
): BoardSummary => ({
  done: 0,
  inProgress: 0,
  overdue: 0,
  notStarted: 0,
  stale: 0,
  donePct: 0,
  nextMilestone: null,
  ...o,
});
const boards = [
  b({ id: "b1", name: "Zeta", health: "on_track", total: 50 }),
  b({ id: "b2", name: "Alpha", health: "off_track", total: 10, overdue: 6 }),
  b({ id: "b3", name: "Mid", health: "at_risk", total: 90, overdue: 2 }),
];
const names = () => screen.getAllByRole("link").map((a) => a.textContent);

describe("BoardStatusPanel", () => {
  it("opens worst first with a health pill and a legend", () => {
    render(
      <BoardStatusPanel
        kicker="04"
        boards={boards}
        failed={false}
        onRetry={vi.fn()}
      />,
    );
    expect(names()).toEqual(["Alpha", "Mid", "Zeta"]);
    expect(screen.getByText("Off track")).toBeInTheDocument();
    for (const label of ["Done", "In progress", "Overdue", "Not started"])
      expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("re-sorts on the client by size and by name", () => {
    render(
      <BoardStatusPanel
        kicker="04"
        boards={boards}
        failed={false}
        onRetry={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Size" }));
    expect(names()).toEqual(["Mid", "Zeta", "Alpha"]);
    fireEvent.click(screen.getByRole("radio", { name: "A–Z" }));
    expect(names()).toEqual(["Alpha", "Mid", "Zeta"]);
    expect(screen.getByRole("radio", { name: "A–Z" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("hides the sort control for a single board", () => {
    render(
      <BoardStatusPanel
        kicker="04"
        boards={[boards[0]!]}
        failed={false}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});
```

Create `src/components/folders/panels/AttentionPanel.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FIXTURE_TODAY, folderFixture } from "@/lib/folders/fixture";
import { attentionGroups } from "@/lib/folders/tower";
import { AttentionPanel } from "./AttentionPanel";

const fx = folderFixture();
const groups = attentionGroups(fx.rollup!, fx.attention!, FIXTURE_TODAY);

describe("AttentionPanel grouped", () => {
  it("shows one row per board with its counts and keeps items collapsed", () => {
    render(
      <AttentionPanel
        kicker="06"
        attention={fx.attention}
        caption={null}
        groups={groups}
        onRetry={vi.fn()}
      />,
    );
    const first = screen.getAllByTestId("attention-group")[0]!;
    expect(within(first).getByRole("button")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(within(first).getByRole("button")).toHaveTextContent(
      groups[0]!.boardName,
    );
    expect(screen.queryByRole("link", { name: /Auth refactor/ })).toBeNull();
  });

  it("expands a board in place to its items, linking to the board item", () => {
    render(
      <AttentionPanel
        kicker="06"
        attention={fx.attention}
        caption={null}
        groups={groups}
        onRetry={vi.fn()}
      />,
    );
    const backend = screen
      .getAllByTestId("attention-group")
      .find((g) =>
        within(g).getByRole("button").textContent?.includes("Backend"),
      )!;
    fireEvent.click(within(backend).getByRole("button"));
    expect(within(backend).getByRole("button")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      within(backend).getByRole("link", { name: /Auth refactor/ }),
    ).toHaveAttribute("href", "/boards/b1?item=i1");
  });

  it("says when the list is a sample of a larger total", () => {
    const big = [
      { ...groups[0]!, overdue: 140, items: groups[0]!.items.slice(0, 1) },
    ];
    render(
      <AttentionPanel
        kicker="06"
        attention={fx.attention}
        caption={null}
        groups={big}
        onRetry={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/Showing 1\./)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open the board for all 140 overdue." }),
    ).toHaveAttribute("href", `/boards/${groups[0]!.boardId}`);
  });

  it("keeps the flat list when no groups are given, and the empty and failed states", () => {
    const { rerender } = render(
      <AttentionPanel
        kicker="06"
        attention={fx.attention}
        caption="Top 4 across the folder"
        onRetry={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("link", { name: /Auth refactor/ }),
    ).toBeInTheDocument();
    rerender(
      <AttentionPanel
        kicker="06"
        attention={[]}
        caption={null}
        groups={[]}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("Nothing needs attention.")).toBeInTheDocument();
    rerender(
      <AttentionPanel
        kicker="06"
        attention={null}
        caption={null}
        groups={null}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/components/folders/panels/BoardStatusPanel.test.tsx src/components/folders/panels/AttentionPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Export `HEALTH`**

In `src/components/folders/tabs/Boards.tsx:27`, change `const HEALTH: Record<` to `export const HEALTH: Record<`. Nothing else in that file changes.

- [ ] **Step 4: Rewrite `BoardStatusPanel.tsx`**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { StackedStatusBar } from "@/components/folders/charts/StackedStatusBar";
import { HEALTH } from "@/components/folders/tabs/Boards";
import { STATUS_BG, StatusPill } from "@/components/ui/status-pill";
import type { BoardSummary } from "@/lib/folders/rollup";
import { cn } from "@/lib/utils";
import { Failed, Panel } from "./Panel";

type Sort = "health" | "size" | "name";
const SORTS: { key: Sort; label: string }[] = [
  { key: "health", label: "Health" },
  { key: "size", label: "Size" },
  { key: "name", label: "A–Z" },
];

const LEGEND = [
  { label: "Done", bg: STATUS_BG.green },
  { label: "In progress", bg: STATUS_BG.blue },
  { label: "Overdue", bg: STATUS_BG.red },
  { label: "Not started", bg: STATUS_BG.gray },
];

/** Worst first by default: health, then overdue, then name. */
export function sortBoardStatus(
  boards: BoardSummary[],
  by: Sort,
): BoardSummary[] {
  const byName = (a: BoardSummary, b: BoardSummary) =>
    a.name.localeCompare(b.name);
  return [...boards].sort((a, b) =>
    by === "name"
      ? byName(a, b)
      : by === "size"
        ? b.total - a.total || byName(a, b)
        : HEALTH[a.health].rank - HEALTH[b.health].rank ||
          b.overdue - a.overdue ||
          byName(a, b),
  );
}

export function BoardStatusPanel({
  kicker,
  title = "Status by board",
  boards,
  failed,
  onRetry,
}: {
  kicker: string;
  title?: string;
  boards: BoardSummary[];
  failed: boolean;
  onRetry: () => void;
}) {
  const [sort, setSort] = useState<Sort>("health");
  return (
    <Panel kicker={kicker} title={title}>
      {failed ? (
        <Failed onRetry={onRetry} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ul className="text-muted-foreground flex flex-wrap gap-3 text-xs">
              {LEGEND.map((l) => (
                <li key={l.label} className="inline-flex items-center gap-1.5">
                  <span className={cn("size-2 rounded-sm", l.bg)} />
                  {l.label}
                </li>
              ))}
            </ul>
            {boards.length > 1 ? (
              <div
                role="radiogroup"
                aria-label="Sort boards"
                data-print-hide
                className="flex gap-1"
              >
                {SORTS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    role="radio"
                    aria-checked={sort === s.key}
                    onClick={() => setSort(s.key)}
                    className={cn(
                      "inline-flex items-center rounded-sm border px-2 py-0.5 text-xs pointer-coarse:min-h-11 pointer-coarse:px-3",
                      sort === s.key
                        ? "border-border-bright text-foreground"
                        : "text-muted-foreground hover:border-border-hover",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {sortBoardStatus(boards, sort).map((b) => (
            <div key={b.id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <Link
                  href={`/boards/${b.id}`}
                  className="hover:text-foreground text-muted-foreground min-w-0 truncate font-medium"
                >
                  {b.name}
                </Link>
                <span className="flex shrink-0 items-center gap-2">
                  <StatusPill color={HEALTH[b.health].color} variant="soft">
                    {HEALTH[b.health].label}
                  </StatusPill>
                  <span className="text-muted-foreground font-mono tabular-nums">
                    {b.total}
                  </span>
                </span>
              </div>
              <StackedStatusBar
                mix={{
                  done: b.done,
                  inProgress: b.inProgress,
                  overdue: b.overdue,
                  notStarted: b.notStarted,
                }}
                label={b.name}
              />
            </div>
          ))}
        </>
      )}
    </Panel>
  );
}
```

- [ ] **Step 5: Rewrite `AttentionPanel.tsx`**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill, type StatusColor } from "@/components/ui/status-pill";
import type { AttentionGroup } from "@/lib/folders/tower";
import type { AttentionReason, AttentionRow } from "@/lib/folders/types";
import { cn } from "@/lib/utils";
import { Failed, Panel } from "./Panel";

const REASON_COLOR: Record<AttentionReason, StatusColor> = {
  overdue: "red",
  blocked: "red",
  unassigned: "yellow",
  stale: "gray",
};

function ItemRow({ a, withBoard }: { a: AttentionRow; withBoard: boolean }) {
  return (
    <li className="flex items-center gap-3 py-2 text-xs">
      <StatusPill
        color={REASON_COLOR[a.reason]}
        variant="soft"
        className="w-24 justify-center"
      >
        {a.reason}
      </StatusPill>
      <Link
        href={`/boards/${a.boardId}?item=${a.itemId}`}
        className="hover:text-foreground min-w-0 flex-1 truncate font-medium"
      >
        {a.itemName}
      </Link>
      <span className="text-muted-foreground truncate">
        {withBoard ? a.boardName : null}
        {a.groupName ? `${withBoard ? " · " : ""}${a.groupName.trim()}` : ""}
      </span>
      <span className="text-muted-foreground font-mono tabular-nums">
        {a.reason} · {a.ageDays}d
      </span>
    </li>
  );
}

function facts(g: AttentionGroup): string {
  const parts = [
    g.overdue > 0 ? `${g.overdue} overdue` : null,
    g.blocked > 0 ? `${g.blocked} blocked` : null,
    g.unassigned > 0 ? `${g.unassigned} unassigned` : null,
    g.stale > 0 ? `${g.stale} stale` : null,
    g.oldestOverdueDays !== null ? `oldest ${g.oldestOverdueDays}d` : null,
  ].filter((p): p is string => p !== null);
  return parts.join(" · ");
}

function Group({ g }: { g: AttentionGroup }) {
  const [open, setOpen] = useState(false);
  const panelId = `attention-${g.boardId}`;
  return (
    <li data-testid="attention-group" className="py-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-1 py-1.5 text-left text-xs pointer-coarse:min-h-11"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate font-medium">
          {g.boardName}
        </span>
        <span className="text-muted-foreground font-mono tabular-nums">
          {facts(g)}
        </span>
      </button>
      {open ? (
        <div id={panelId} className="pl-6">
          {g.items.length === 0 ? (
            <p className="text-muted-foreground py-2 text-xs">
              None of this board&apos;s items are in the top of the list.{" "}
              <Link
                href={`/boards/${g.boardId}`}
                className="hover:text-foreground underline"
              >
                Open the board
              </Link>
            </p>
          ) : (
            <>
              <ul className="divide-y">
                {g.items.map((a) => (
                  <ItemRow key={a.itemId} a={a} withBoard={false} />
                ))}
              </ul>
              {g.overdue > g.items.length ? (
                <p className="text-muted-foreground py-2 text-xs">
                  Showing {g.items.length}.{" "}
                  <Link
                    href={`/boards/${g.boardId}`}
                    className="hover:text-foreground underline"
                  >
                    Open the board for all {g.overdue} overdue.
                  </Link>
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

/**
 * "Needs attention". With `groups` it is one row per board carrying the
 * rollup's counts (totals, not a sample), each expanding in place to the part
 * of the top-N sample on that board. Without `groups` it is the flat list.
 */
export function AttentionPanel({
  kicker,
  title = "Needs attention",
  attention,
  caption,
  groups,
  onRetry,
}: {
  kicker: string;
  title?: string;
  attention: AttentionRow[] | null;
  caption: string | null;
  groups?: AttentionGroup[] | null;
  onRetry: () => void;
}) {
  const grouped = groups !== undefined;
  return (
    <Panel kicker={kicker} title={title}>
      {caption ? (
        <p
          data-testid="attention-caption"
          className="text-muted-foreground text-xs"
        >
          {caption}
        </p>
      ) : null}
      {attention === null || groups === null ? (
        <Failed onRetry={onRetry} />
      ) : grouped ? (
        groups.length === 0 ? (
          <EmptyState variant="inline">Nothing needs attention.</EmptyState>
        ) : (
          <ul className="divide-y">
            {groups.map((g) => (
              <Group key={g.boardId} g={g} />
            ))}
          </ul>
        )
      ) : attention.length === 0 ? (
        <EmptyState variant="inline">Nothing needs attention.</EmptyState>
      ) : (
        <ul className="divide-y">
          {attention.map((a) => (
            <ItemRow key={a.itemId} a={a} withBoard />
          ))}
        </ul>
      )}
    </Panel>
  );
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run src/components/folders/panels src/components/folders/tabs`
Expected: PASS, including the unchanged `Overview.test.tsx` and `Boards.test.tsx`.

- [ ] **Step 7: Commit**

```bash
git add src/components/folders/tabs/Boards.tsx src/components/folders/panels/BoardStatusPanel.tsx src/components/folders/panels/BoardStatusPanel.test.tsx src/components/folders/panels/AttentionPanel.tsx src/components/folders/panels/AttentionPanel.test.tsx
git commit -m "feat(folders): rank boards by health and group attention by board"
```

---

### Task 10: Presets, schema and Overview wiring

**Files:**

- Modify: `src/lib/validations/folder-layout.ts`, `src/lib/folders/presets.ts`, `src/lib/folders/layout.ts`, `src/components/folders/edit/SectionChrome.tsx`, `src/components/folders/edit/SectionsSheet.tsx`, `src/components/folders/tabs/Overview.tsx`, `src/components/folders/CommandCenter.tsx`
- Test: `src/lib/folders/layout.test.ts`, `src/components/folders/SectionGrid.test.tsx`, `src/components/folders/edit/use-layout-draft.test.ts`, `src/components/folders/tabs/Overview.test.tsx`, `src/components/folders/CommandCenter.test.tsx`

**Interfaces:**

- Consumes: everything Tasks 3–9 produce.
- Produces: `BUILTIN_PANELS` includes `"load"` and `"people"`; `OverviewTab` optional prop `onSeeAllPeople?: () => void`.

- [ ] **Step 1: Update the tests first**

`src/lib/folders/layout.test.ts`: rename the test "the project preset is today's layout: six KPIs and all six panels" to "the project preset is the tower layout" and change its expected panel list to:

```ts
    ).toEqual([
      "kpis",
      "burn",
      "load",
      "boardStatus",
      "people",
      "attention",
      "intelligence",
      "milestones",
    ]);
```

In the `layoutNeedsLoad` test added by Task 4, change `panel: "load" as never` to `panel: "load" as const`, and add `expect(layoutNeedsLoad(PRESETS.project)).toBe(true);` and `expect(layoutNeedsLoad(PRESETS.crm)).toBe(false);`.

Add:

```ts
it("gives the crm and support presets the people section and no load map", () => {
  for (const key of ["crm", "support"] as const) {
    const panels = canvasSections(PRESETS[key], "overview").map((s) =>
      s.type === "builtin" ? s.panel : "widget",
    );
    expect(panels).toContain("people");
    expect(panels).not.toContain("load");
  }
});
```

`src/components/folders/SectionGrid.test.tsx`: in the first test change the expected ids to `["kpis", "burn", "load", "board-status", "people", "attention", "intelligence", "milestones"]`. In "places each grid cell on the 12-column grid from x and w" replace the comment and two assertions with:

```ts
// burn: x 0, w 8 → column 1 span 8. load: x 8, w 4 → column 9 span 4.
expect(groups[1].style.getPropertyValue("--col")).toBe("1 / span 8");
expect(groups[2].style.getPropertyValue("--col")).toBe("9 / span 4");
```

(unchanged values, new comment). In "stacks a consecutive same-column run into ONE grid cell" change the expected groups to:

```ts
expect(ids).toEqual([
  ["kpis"],
  ["burn"],
  ["load"],
  ["board-status"],
  ["people"],
  ["attention"],
  ["intelligence", "milestones"],
]);
const right = screen.getAllByTestId("section-group")[6];
```

`src/components/folders/edit/use-layout-draft.test.ts`: in "moves a section up without disturbing the rest of the order" the expected list becomes `["burn", "kpis", "load", "boardStatus", "people", "attention", "intelligence", "milestones"]`; in "is a no-op when moving the first section up or the last one down" it becomes `["kpis", "burn", "load", "boardStatus", "people", "attention", "intelligence", "milestones"]`.

`src/components/folders/tabs/Overview.test.tsx`: add next to the existing `vi.mock` for `BurnChart`:

```tsx
vi.mock("@/components/folders/panels/PeoplePanel", () => ({
  PeoplePanel: (p: { stage: string | null; onSeeAll?: () => void }) => (
    <button
      type="button"
      data-testid="people-panel"
      data-stage={p.stage ?? ""}
      onClick={p.onSeeAll}
    >
      people
    </button>
  ),
}));
```

Replace the test "lists attention rows linking to the board with ?item=" with:

```tsx
it("groups attention by board and expands to rows linking with ?item=", () => {
  renderOverview();
  expect(screen.queryByRole("link", { name: /Auth refactor/ })).toBeNull();
  const backend = screen
    .getAllByTestId("attention-group")
    .find((g) => g.textContent?.includes("Backend"))!;
  fireEvent.click(backend.querySelector("button")!);
  const link = screen.getByRole("link", { name: /Auth refactor/ });
  expect(link).toHaveAttribute("href", "/boards/b1?item=i1");
  expect(screen.getByText("overdue · 14d")).toBeInTheDocument();
});
```

Replace the three attention-caption tests ("captions how much…", "captions the attention list as a slice…", "never renders more than 20 attention rows") with:

```tsx
it("captions the attention section with its scope, not a row count", () => {
  renderOverview();
  expect(screen.getByTestId("attention-caption")).toHaveTextContent(
    "By board. Counts are totals; a board expands to its most urgent items.",
  );
});

it("keeps only the selected stage's items inside the groups", () => {
  renderOverview({}, { stage: "build" });
  const all = screen.getAllByTestId("attention-group");
  for (const g of all) fireEvent.click(g.querySelector("button")!);
  expect(
    screen.getAllByRole("link", {
      name: /Auth refactor|Push notifications|Onboarding flow|Crash reporting/,
    }),
  ).toHaveLength(4);
});

it("never renders more than 20 attention rows per board", () => {
  const many = Array.from({ length: 60 }, (_, i) => ({
    itemId: `x${i}`,
    itemName: `Item ${i}`,
    boardId: "b1",
    boardName: "Backend",
    groupId: "b1:build",
    groupName: "Build",
    reason: "stale" as const,
    ageDays: 30,
    severity: 1,
  }));
  renderOverview({ attention: many });
  const backend = screen
    .getAllByTestId("attention-group")
    .find((g) => g.textContent?.includes("Backend"))!;
  fireEvent.click(backend.querySelector("button")!);
  expect(screen.getAllByRole("link", { name: /^Item / })).toHaveLength(20);
});
```

In "replaces the burn chart when there are no due dates and shows an em dash for gap", replace the `getByText("Add due dates to see planned vs completed")` assertion with:

```tsx
expect(
  screen.getByRole("heading", { name: "Items by stage" }),
).toBeInTheDocument();
expect(screen.queryByText("Load by board and week")).toBeNull();
expect(screen.getByText("No due dates set")).toBeInTheDocument();
```

and rename the test to "swaps the burn chart for items by stage and hides the load map when there are no due dates".

In "shows an inline retry for a failed panel and keeps the rest", `attention: null` now yields one Retry button from the attention panel; the fixture's `load` is set, so no second button appears. Leave it unchanged.

Add:

```tsx
it("renders the load map and the people section in the project layout", () => {
  renderOverview();
  expect(screen.getByText("Load by board and week")).toBeInTheDocument();
  expect(
    screen.getByRole("rowheader", { name: "Backend" }),
  ).toBeInTheDocument();
  expect(screen.getByTestId("people-panel")).toBeInTheDocument();
});

it("does not render a load section the saved layout does not have", () => {
  const payload = folderFixture();
  const sections = canvasSections(payload.layout.config, "overview").filter(
    (s) => s.id !== "load",
  );
  render(
    <OverviewTab
      payload={payload}
      rows={payload.rollup!}
      stages={buildStages(payload.rollup!, FIXTURE_TODAY)}
      stage={null}
      board={null}
      sections={sections}
      onRetry={vi.fn()}
    />,
  );
  expect(screen.queryByText("Load by board and week")).toBeNull();
});

it("shows the reading line above the burn chart", () => {
  renderOverview();
  expect(screen.getByTestId("burn-reading")).toBeInTheDocument();
});
```

`src/components/folders/CommandCenter.test.tsx`: add the same `PeoplePanel` mock as above next to its other `vi.mock` calls, and add:

```tsx
it("opens the People tab from the overview's people section with no navigation", () => {
  render(wrap({ payload: folderFixture() }));
  fireEvent.click(screen.getByTestId("people-panel"));
  expect(screen.getByRole("tab", { name: /People/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
```

If `fireEvent` is not already imported in that file, add it to the `@testing-library/react` import. If the tab strip marks the active tab with a different attribute than `aria-selected`, read `TabStrip.tsx` and assert on the attribute it uses; the behaviour under test is that the People tab becomes the active one.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/lib/folders/layout.test.ts src/components/folders`
Expected: FAIL on the updated assertions.

- [ ] **Step 3: Add the panels to the schema and labels**

`src/lib/validations/folder-layout.ts`: `BUILTIN_PANELS` becomes

```ts
export const BUILTIN_PANELS = [
  "kpis",
  "burn",
  "boardStatus",
  "attention",
  "intelligence",
  "milestones",
  "load",
  "people",
] as const;
```

`src/lib/folders/layout.ts`: in `layoutNeedsLoad`, replace `(s.panel as string) === "load"` with `s.panel === "load"` and shorten its comment to the first sentence.

In both `src/components/folders/edit/SectionChrome.tsx` and `src/components/folders/edit/SectionsSheet.tsx`, add to `PANEL_LABEL`:

```ts
  load: "Load by board and week",
  people: "Open work by person",
```

- [ ] **Step 4: Update the presets**

In `src/lib/folders/presets.ts`:

Change `BOARD_STATUS`'s layout to `{ x: 0, y: 6, w: 8, h: 4 }`, `ATTENTION`'s to `{ x: 0, y: 10, w: 8, h: 5 }`, `INTELLIGENCE`'s to `{ x: 8, y: 10, w: 4, h: 3 }`, `MILESTONES`'s to `{ x: 8, y: 13, w: 4, h: 2 }`, and add:

```ts
const LOAD: BuiltinSection = {
  id: "load",
  type: "builtin",
  panel: "load",
  layout: { x: 8, y: 2, w: 4, h: 4 },
};
const PEOPLE: BuiltinSection = {
  id: "people",
  type: "builtin",
  panel: "people",
  layout: { x: 8, y: 6, w: 4, h: 4 },
};
```

Add `load: LOAD, people: PEOPLE,` to `DEFAULT_SECTION`.

The project preset's sections become `pick("kpis", "burn", "load", "boardStatus", "people", "attention", "intelligence", "milestones")`, and its doc comment becomes:

```ts
/**
 * `project` is the tower layout: KPI row, burn beside the load map, boards
 * beside people, attention with intelligence and milestones stacked on the
 * right, then the stages, timeline, boards and people tabs.
 */
```

In `crm`, replace the `BOARD_STATUS` and `INTELLIGENCE` entries with:

```ts
          { ...BOARD_STATUS, layout: { x: 8, y: 2, w: 4, h: 4 } },
          { ...PEOPLE, layout: { x: 8, y: 6, w: 4, h: 4 } },
          { ...INTELLIGENCE, layout: { x: 8, y: 10, w: 4, h: 3 } },
```

In `support`, replace the `BOARD_STATUS` entry with:

```ts
          { ...BOARD_STATUS, layout: { x: 8, y: 2, w: 4, h: 4 } },
          { ...PEOPLE, layout: { x: 8, y: 6, w: 4, h: 4 } },
```

(In both, board status, people and intelligence share `x: 8, w: 4` and are consecutive, so `groupSections` stacks them in the right-hand column.)

- [ ] **Step 5: Wire `Overview.tsx`**

Add imports:

```tsx
import { LoadPanel } from "@/components/folders/panels/LoadPanel";
import { PeoplePanel } from "@/components/folders/panels/PeoplePanel";
import {
  attentionGroups,
  burnForecast,
  loadGrid,
  stageBars,
} from "@/lib/folders/tower";
```

Add the prop `onSeeAllPeople` to the destructuring and to the props type:

```tsx
  /** Opens the People tab; omitted when the layout has none. */
  onSeeAllPeople?: () => void;
```

Replace the block from `const attentionInScope =` through the end of `attentionCaption` with:

```tsx
const attentionInScope =
  payload.attention === null
    ? null
    : payload.attention.filter(
        (a) =>
          (board === null || a.boardId === board) &&
          (stage === null ||
            (a.groupName !== null && stageKey(a.groupName) === stage)),
      );
// One row per board. Counts come from the (already filtered) rollup rows, so
// they are totals; each board expands to at most ATTENTION_SHOWN of the
// RPC's top-N sample.
const groups =
  attentionInScope === null
    ? null
    : attentionGroups(rows, attentionInScope, payload.todayISO).map((g) => ({
        ...g,
        items: g.items.slice(0, ATTENTION_SHOWN),
      }));
const attentionCaption =
  groups === null || groups.length === 0
    ? null
    : "By board. Counts are totals; a board expands to its most urgent items.";
const total = rows.reduce((s, r) => s + r.total, 0);
const forecast = burn === null ? null : burnForecast(burn, total);
```

Delete the now-unused `const attention = attentionInScope?.slice(…)` line. Update the comment above `ATTENTION_SHOWN` to say "per board".

In the `switch`, change these cases:

```tsx
              case "kpis":
                return (
                  <KpisPanel
                    cards={s.props?.cards ?? []}
                    rows={rows}
                    todayISO={payload.todayISO}
                    failed={payload.rollup === null}
                    onRetry={onRetry}
                    burn={payload.burn}
                    stage={stage}
                    board={board}
                  />
                );
              case "burn":
                return (
                  <BurnPanel
                    kicker={kicker}
                    title={s.title}
                    board={board}
                    burn={burn}
                    anyDue={anyDue}
                    onRetry={onRetry}
                    forecast={forecast}
                    stageBars={stageBars(stages)}
                  />
                );
```

```tsx
              case "attention":
                return (
                  <AttentionPanel
                    kicker={kicker}
                    title={s.title}
                    attention={attentionInScope}
                    caption={attentionCaption}
                    groups={groups}
                    onRetry={onRetry}
                  />
                );
```

and add before `default:`:

```tsx
              case "load":
                // No dates: nothing to plot, so the section is not drawn at all.
                return anyDue ? (
                  <LoadPanel
                    kicker={kicker}
                    title={s.title}
                    grid={
                      payload.load === null
                        ? null
                        : loadGrid(
                            payload.load,
                            payload.boards,
                            { stageKey: stage, boardId: board },
                            payload.todayISO,
                          )
                    }
                    failed={payload.load === null}
                    onRetry={onRetry}
                  />
                ) : null;
              case "people":
                return (
                  <PeoplePanel
                    kicker={kicker}
                    title={s.title}
                    folderId={payload.folder.id}
                    stage={stage}
                    members={payload.members}
                    onSeeAll={onSeeAllPeople}
                  />
                );
```

- [ ] **Step 6: Wire `CommandCenter.tsx`**

Below the `canExport` line add:

```tsx
const peopleTabId = layoutTabs.find((t) => t.kind === "people")?.id ?? null;
```

and pass to `<OverviewTab … />`:

```tsx
              onSeeAllPeople={
                peopleTabId === null ? undefined : () => setTab(peopleTabId)
              }
```

Nothing else in this file changes. `setTab` writes the URL with `history.replaceState`, so this is not a navigation.

- [ ] **Step 7: Run everything**

Run: `pnpm vitest run src/lib/folders src/lib/validations src/components/folders`
Expected: PASS, including `no-recharts-in-first-paint.test.ts`, `no-gantt-in-first-paint.test.ts` and `command-center-state.test.tsx`.

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/validations/folder-layout.ts src/lib/folders/presets.ts src/lib/folders/layout.ts src/lib/folders/layout.test.ts src/components/folders/edit/SectionChrome.tsx src/components/folders/edit/SectionsSheet.tsx src/components/folders/tabs/Overview.tsx src/components/folders/tabs/Overview.test.tsx src/components/folders/CommandCenter.tsx src/components/folders/CommandCenter.test.tsx src/components/folders/SectionGrid.test.tsx src/components/folders/edit/use-layout-draft.test.ts
git commit -m "feat(folders): make the tower layout the default overview"
```

---

### Task 11: Gates and browser check (ORCHESTRATOR)

- [ ] **Step 1: The four gates**

Run each in the foreground, timeout 600000: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
Expected: all PASS. `pnpm build` may rewrite `AGENTS.md`; run `git status` and, if it is modified, `git checkout -- AGENTS.md`.

- [ ] **Step 2: Local production build in the owner's Chrome**

Run in the worktree: `pnpm start -p 3001` (background, after the build above). Open `http://localhost:3001/folders/bb2b3010-65d1-4ac7-8c47-474c415e78d7` (DAAS) in the owner's Chrome, which is already signed in.

Check, in dark and in light, at 1384px wide and at phone width (about 400px):

1. KPI row: Complete, Gap, Overdue and Due this week each show a change pill and a sparkline; Blocked and Stale appear as chips when zero. Measure one sparkline's box: 84 × 28 CSS px, not clipped.
2. With a board chosen in the board filter the sparklines disappear and the cards fall back to their bar.
3. Burn chart: the reading line names 663 items that arrived already done; a dotted forecast line starts at today only if the pace is above zero.
4. Load map: eleven board rows, seven week columns, red cells left of "now"; a cell's number is legible (contrast) in both themes; clicking a cell opens that board. At phone width the table stays inside the panel with no horizontal page scroll.
5. Boards: worst first, health pills, legend; Size and A–Z re-sort with no network request (watch the Network panel).
6. Needs attention: one row per board; expanding Platform & Integrations shows items and "Open the board for all 140 overdue."
7. People: loads after the section scrolls into view (one `getFolderWorkload` request); "See all" switches to the People tab with no navigation request.
8. Open the CRM folder (`/folders/2fee1041-c6c1-4064-b6a5-b14e965f40c3`): "Items by stage" replaces the chart, no load map, the chip "No due dates set" is present.
9. Customize: the Sections sheet offers nothing hidden on an untouched folder; hide "Load by board and week", Save, reload: it stays hidden and no `folder_load` request is made (check the server log or the RSC payload for `"load":null`).

Fix anything found through the implementer of the task that owns the file, then repeat the gates.

- [ ] **Step 3: Stop the server** and confirm `git status` is clean apart from intended changes.

---

### Task 12: Whole-branch review (ORCHESTRATOR)

- [ ] Build the review package from the merge base (`git merge-base origin/develop HEAD`) to `HEAD` and dispatch the final reviewer on the most capable model, pointing it at the ledger's deferred-minor lines. Ask it specifically to check: cross-task type drift (`BurnRow` optional fields read with `?? 0` everywhere), the two `PANEL_LABEL` maps agreeing, every new control having a 44px coarse target and a focus ring, semantic tokens only, and that no section fetches on first paint except `folder_load`.
- [ ] One fix dispatch for all findings, one scoped re-review, then re-run the four gates.

---

### Task 13: Finish (ORCHESTRATOR)

- [ ] Confirm `task/folder-invites` has merged. If it merged after this branch was last rebased, `scripts/finish-task.sh` rebases onto it; resolve `src/lib/folders/payload.ts` by keeping both branches' additions, and regenerate `src/types/database.types.ts` from DEV instead of merging it by hand.
- [ ] Run `scripts/finish-task.sh` from inside the worktree.
- [ ] Give the owner the "How to test this" walkthrough (the nine checks of Task 11 Step 2, against `develop`), and put the same list in the `/wrapup` session note.

## Self-review

- **Spec coverage:** §1 KPI trend → Tasks 3, 5; §2 forecast → Tasks 3, 6; §3 completion date → Deviation 1–2, replaced by `imported_done` in Tasks 1, 3, 6; §4 load → Tasks 1, 3, 4, 7, 10; §5 people → Task 8; §6 boards → Task 9; §7 attention → Tasks 3, 9, 10; §8 milestones → Task 3; §9 no-dates → Tasks 5, 6, 10; §10 presets → Task 10; budget → Tasks 2, 4, 8; rollout comparison → Task 2; coordination → "Branch state and merge order".
- **Type consistency:** `Trend`, `Tone`, `Forecast`, `LoadGrid`, `AttentionGroup`, `StageBar` are defined once in Task 3 and imported by name in Tasks 5–10. `KpiCard`'s `trend.change.color` is a `StatusColor`; `trendChange` returns `tone: Tone`, a subset of it. `BurnRow.importedDone` / `overdueOpen` are optional and always read with `?? 0`.
- **Known soft spots, each with its instruction in place:** Task 3 Step 8 and Task 6's `BurnChartInner` test depend on names inside test files the author did not read in full (`rollup.test.ts`'s milestone assertions, the points constant in `BurnChartInner.test.tsx`); Task 10's CommandCenter test depends on which attribute `TabStrip` uses for the active tab. Each step says what to do in either case.
