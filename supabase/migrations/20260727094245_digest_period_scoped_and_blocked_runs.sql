-- 20260727094245_digest_period_scoped_and_blocked_runs.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- Make the first weekly digest backlog-safe, and make a skipped run observable.
--
-- Incident: production never fired a single digest between 2026-07-03 and
-- 2026-07-27 (digest_runs: 0 rows) because vault.secrets has no 'digest_secret'.
-- _health_digest_ping() took its early-return branch every morning, raised a
-- NOTICE that is persisted nowhere, and pg_cron filed the job as 'succeeded'.
--
-- Two defects, fixed here:
--
-- 1. The digest was never period-scoped. _board_health_counts applies p_since to
--    new_items ONLY; overdue_items, incomplete_items and incomplete_sample were
--    all-time current state. An email headed "Week of <Monday>" would therefore
--    have announced every overdue and structurally-incomplete item accumulated
--    since the org was created. _org_health_digest now scopes all three signals
--    to the window, so no run — first or thousandth — can replay history, and a
--    genuinely fresh org is correct by construction (its first week is all there
--    is). dashboard_health_summary / _board_health_counts are deliberately NOT
--    touched: the in-app health widget should keep reporting standing totals.
--
-- 2. A blocked run left no trace. digest_runs gains a 'blocked' status and a
--    nullable org_id (a run blocked before any org is considered belongs to no
--    org), and the ping records one.

-- ── 1. Ledger: a run can be blocked before it reaches any org ────────────────

alter table public.digest_runs alter column org_id drop not null;

alter table public.digest_runs drop constraint if exists digest_runs_status_check;
alter table public.digest_runs add constraint digest_runs_status_check
  check (status in ('pending', 'sent', 'skipped', 'failed', 'blocked'));

comment on column public.digest_runs.org_id is
  'Null only for status = ''blocked'': the run never reached an org because the digest is not provisioned.';

-- Bounds the blocked trail to one row per ISO week (52/yr, not 365) and stops an
-- unauthenticated POST to /api/digest/run from growing the table. NULLs are
-- distinct in a plain unique index, hence the partial index on org_id is null.
create unique index if not exists digest_runs_blocked_period_idx
  on public.digest_runs (period_start) where org_id is null;

-- ── 2. Rule core: expose WHEN an item became overdue ─────────────────────────
-- Return-type change ⇒ drop + recreate. Nothing depends on this in the catalog:
-- callers are plpgsql/sql string bodies, resolved by name at runtime.

drop function if exists public._board_health_flags(uuid);

create function public._board_health_flags(p_board_id uuid)
returns table (
  item_id uuid,
  item_name text,
  item_created_at timestamptz,
  is_done boolean,
  is_overdue boolean,
  is_incomplete boolean,
  overdue_since text
)
language sql stable security definer set search_path = '' as $$
  with cols as (
    select
      (select c.id from public.columns c
        where c.board_id = p_board_id and c.kind = 'status'
        order by c.position asc limit 1) as status_col,
      (select c.settings from public.columns c
        where c.board_id = p_board_id and c.kind = 'status'
        order by c.position asc limit 1) as status_settings,
      (select c.id from public.columns c
        where c.board_id = p_board_id and c.kind = 'people'
        order by c.position asc limit 1) as people_col,
      (select c.id from public.columns c
        where c.board_id = p_board_id and c.kind = 'date'
        order by c.position asc limit 1) as date_col
  ),
  base as (
    select
      i.id,
      i.name,
      i.created_at,
      exists (
        select 1
        from public.cell_values cv,
             jsonb_array_elements(
               coalesce(cols.status_settings -> 'options', '[]'::jsonb)) opt
        where cv.item_id = i.id
          and cv.column_id = cols.status_col
          and opt ->> 'id' = cv.value ->> 'optionId'
          and opt ->> 'label' ~* '(done|complete)'
      ) as is_done,
      -- Earliest past-due date across the item's date cells: the moment it first
      -- became overdue. Compared as ISO text, exactly like the has_past_due test
      -- below, so a malformed cell value can never raise on a cast.
      (
        select min(coalesce(cv.value ->> 'end', cv.value ->> 'date'))
        from public.cell_values cv
        join public.columns c on c.id = cv.column_id and c.kind = 'date'
        where cv.item_id = i.id
          and coalesce(cv.value ->> 'end', cv.value ->> 'date')
              < current_date::text
      ) as past_due_from,
      exists (
        select 1
        from public.cell_values cv
        join public.columns c on c.id = cv.column_id and c.kind = 'date'
        where cv.item_id = i.id
          and coalesce(cv.value ->> 'end', cv.value ->> 'date')
              < current_date::text
      ) as has_past_due,
      (cols.people_col is not null) as has_people_col,
      exists (
        select 1 from public.cell_values cv
        where cv.item_id = i.id and cv.column_id = cols.people_col
          and jsonb_array_length(coalesce(cv.value -> 'userIds', '[]'::jsonb)) > 0
      ) as has_owner,
      (cols.date_col is not null) as has_date_col,
      exists (
        select 1 from public.cell_values cv
        where cv.item_id = i.id and cv.column_id = cols.date_col
          and cv.value ->> 'date' is not null
      ) as has_date
    from public.items i
    cross join cols
    where i.board_id = p_board_id and i.parent_id is null
  )
  select
    id,
    name,
    created_at,
    is_done,
    (has_past_due and not is_done) as is_overdue,
    (not is_done and (
      (has_people_col and not has_owner) or (has_date_col and not has_date)
    )) as is_incomplete,
    case when (has_past_due and not is_done) then past_due_from end as overdue_since
  from base
$$;

revoke execute on function public._board_health_flags(uuid)
  from public, anon, authenticated;

-- ── 3. Digest payload, scoped to the period it claims to cover ───────────────
-- new        ⇔ created inside the window                 (unchanged)
-- overdue    ⇔ BECAME overdue inside the window          (was: all-time)
-- incomplete ⇔ created inside the window and incomplete  (was: all-time)
-- total/done ⇔ board totals, kept as context (counts only, no names)
-- Boards with no in-window signal are dropped, so an org with a stale backlog
-- and a quiet week produces no rows at all and finalizes 'skipped'.

create or replace function public._org_health_digest(
  p_org_id uuid,
  p_since timestamptz
) returns table (
  board_id uuid,
  board_name text,
  total_items integer,
  done_items integer,
  overdue_items integer,
  incomplete_items integer,
  new_items integer,
  new_sample jsonb,
  incomplete_sample jsonb
)
language plpgsql stable security definer set search_path = '' as $$
declare
  b record;
  c record;
  v_since_date text := ((p_since at time zone 'UTC')::date)::text;
begin
  for b in
    select bd.id, bd.name
    from public.boards bd
    where bd.org_id = p_org_id
    order by bd.created_at asc
    limit 200
  loop
    select
      count(*)::int as total_items,
      count(*) filter (where f.is_done)::int as done_items,
      count(*) filter (
        where f.is_overdue and f.overdue_since >= v_since_date)::int as overdue_items,
      count(*) filter (
        where f.is_incomplete and f.item_created_at >= p_since)::int as incomplete_items,
      count(*) filter (where f.item_created_at >= p_since)::int as new_items
      into c
    from public._board_health_flags(b.id) f;

    if c.total_items = 0
       or (c.overdue_items = 0 and c.incomplete_items = 0 and c.new_items = 0) then
      continue;
    end if;
    board_id := b.id;
    board_name := b.name;
    total_items := c.total_items;
    done_items := c.done_items;
    overdue_items := c.overdue_items;
    incomplete_items := c.incomplete_items;
    new_items := c.new_items;
    new_sample := (
      select coalesce(jsonb_agg(x.item_name), '[]'::jsonb)
      from (
        select f.item_name, f.item_created_at
        from public._board_health_flags(b.id) f
        where f.item_created_at >= p_since
        order by f.item_created_at desc
        limit 5
      ) x
    );
    incomplete_sample := (
      select coalesce(jsonb_agg(x.item_name), '[]'::jsonb)
      from (
        select f.item_name, f.item_created_at
        from public._board_health_flags(b.id) f
        where f.is_incomplete and f.item_created_at >= p_since
        order by f.item_created_at desc
        limit 5
      ) x
    );
    return next;
  end loop;
end; $$;

revoke execute on function public._org_health_digest(uuid, timestamptz)
  from public, anon, authenticated;

-- ── 4. The missing-secret guard ──────────────────────────────────────────────
-- Was: raise notice + return, i.e. a silent skip filed as a succeeded cron job.
-- Now: a WARNING in the Postgres log AND a queryable 'blocked' row. "The digest
-- has never fired" is now one select away:
--   select * from public.digest_runs where status = 'blocked';

create or replace function public._health_digest_ping()
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
  v_missing text;
  v_period_start date;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'app_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'digest_secret';

  if v_url is null or v_secret is null then
    v_missing := concat_ws(', ',
      case when v_url is null then 'app_url' end,
      case when v_secret is null then 'digest_secret' end);
    -- Monday of the current ISO week, matching currentDigestPeriod() in TS.
    v_period_start := (date_trunc('week', (now() at time zone 'UTC')))::date;

    insert into public.digest_runs
      (org_id, period_start, period_end, status, error, completed_at)
    values
      (null, v_period_start, v_period_start + 6, 'blocked',
       'vault secret(s) missing: ' || v_missing, now())
    on conflict do nothing;

    raise warning
      'health digest BLOCKED: vault secret(s) missing (%). No digest will be sent; see digest_runs where status = ''blocked''.',
      v_missing;
    return;
  end if;

  perform net.http_post(
    url := v_url || '/api/digest/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb
  );
end; $$;

revoke execute on function public._health_digest_ping()
  from public, anon, authenticated;
