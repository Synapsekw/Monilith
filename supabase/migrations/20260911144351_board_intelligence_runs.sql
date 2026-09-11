-- 20260911144351_board_intelligence_runs.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Board Intelligence Phase 2 (spec §4.5, §4.6, §7):
--   1. board_intelligence_runs — per (board, user) cache of a brief + suggestions.
--   2. item_activities.source — 'user' by default, 'intelligence' when a write
--      came from an applied/undone suggestion; set through a transaction-local
--      setting read by the existing activity triggers.
--   3. apply_intelligence_cells(p_board_id, p_writes) — ONE transaction for a
--      suggestion's cell writes; returns before-values (for Undo) and the
--      authoritative rows (for the client cache). SECURITY INVOKER: RLS on
--      cell_values (can_edit_board) is the authorization.
--   4. item_updates (board_id, created_at desc) — the board-level transcript read.

-- ── 1. runs cache ───────────────────────────────────────────────────────────
create table public.board_intelligence_runs (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  board_id     uuid not null,
  user_id      uuid not null references auth.users (id) on delete cascade,
  generated_at timestamptz not null default now(),
  input_hash   text not null,
  payload      jsonb not null,
  dismissed    text[] not null default '{}'::text[],
  applied      text[] not null default '{}'::text[],
  model        text,
  tokens_in    integer not null default 0,
  tokens_out   integer not null default 0,
  -- org_id must be the board's org: enforced declaratively for every role,
  -- service_role included (see 20260804144223_board_thread_org_coupling.sql).
  constraint board_intelligence_runs_board_org_fkey
    foreign key (board_id, org_id) references public.boards (id, org_id) on delete cascade
);

comment on table public.board_intelligence_runs is
  'Cached Board Intelligence brief + suggestions per (board, user). Own rows only; stale after 30 min or when input_hash changes.';

create index board_intelligence_runs_lookup_idx
  on public.board_intelligence_runs (board_id, user_id, generated_at desc);

alter table public.board_intelligence_runs enable row level security;

create policy "board_intelligence_runs: select own"
  on public.board_intelligence_runs for select to authenticated
  using (user_id = (select auth.uid()) and public.can_read_board(board_id));

create policy "board_intelligence_runs: insert own"
  on public.board_intelligence_runs for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_org_member(org_id)
    and public.can_read_board(board_id)
  );

create policy "board_intelligence_runs: update own"
  on public.board_intelligence_runs for update to authenticated
  using (user_id = (select auth.uid()) and public.can_read_board(board_id))
  with check (user_id = (select auth.uid()) and public.can_read_board(board_id));

create policy "board_intelligence_runs: delete own"
  on public.board_intelligence_runs for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.board_intelligence_runs to authenticated;

-- ── 2. activity source ──────────────────────────────────────────────────────
alter table public.item_activities
  add column source text not null default 'user'
  constraint item_activities_source_check check (source in ('user', 'intelligence'));

comment on column public.item_activities.source is
  'user (default) or intelligence — set when the write came from an applied/undone Board Intelligence suggestion.';

-- The triggers read a transaction-local setting; unset → 'user'. Bodies are
-- the latest shipped definitions (20260621150000 / 20260617090000) plus `source`.
create or replace function public.tg_log_cell_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_source text := coalesce(nullif(current_setting('app.activity_source', true), ''), 'user');
begin
  if (tg_op = 'INSERT') then
    insert into public.item_activities (org_id, board_id, item_id, actor_id, action, column_id, new_value, source)
    values (new.org_id, new.board_id, new.item_id, (select auth.uid()), 'cell_changed', new.column_id, new.value, v_source);
    return new;
  elsif (tg_op = 'UPDATE') then
    if (new.value is distinct from old.value) then
      insert into public.item_activities (org_id, board_id, item_id, actor_id, action, column_id, old_value, new_value, source)
      values (new.org_id, new.board_id, new.item_id, (select auth.uid()), 'cell_changed', new.column_id, old.value, new.value, v_source);
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    if exists (select 1 from public.items where id = old.item_id)
       and exists (select 1 from public.columns where id = old.column_id) then
      insert into public.item_activities (org_id, board_id, item_id, actor_id, action, column_id, old_value, source)
      values (old.org_id, old.board_id, old.item_id, (select auth.uid()), 'cell_changed', old.column_id, old.value, v_source);
    end if;
    return old;
  end if;
  return null;
end; $$;

create or replace function public.tg_log_update_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_source text := coalesce(nullif(current_setting('app.activity_source', true), ''), 'user');
begin
  insert into public.item_activities (org_id, board_id, item_id, actor_id, action, new_value, source)
  values (new.org_id, new.board_id, new.item_id, new.author_id, 'update_added',
          jsonb_build_object('update_id', new.id), v_source);
  return new;
end; $$;

-- ── 3. one-transaction apply ────────────────────────────────────────────────
-- p_writes: [{ "item_id": uuid, "column_id": uuid, "value": jsonb | null }]
-- value null = clear the cell (an empty cell is the ABSENCE of a row).
-- Returns { "before": [...], "cells": [...] } — see the plan for the shape.
create or replace function public.apply_intelligence_cells(p_board_id uuid, p_writes jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_org    uuid;
  v_write  jsonb;
  v_item   uuid;
  v_col    uuid;
  v_value  jsonb;
  v_old    jsonb;
  v_row    public.cell_values;
  v_before jsonb := '[]'::jsonb;
  v_cells  jsonb := '[]'::jsonb;
begin
  if p_writes is null or jsonb_typeof(p_writes) <> 'array'
     or jsonb_array_length(p_writes) = 0 or jsonb_array_length(p_writes) > 50 then
    raise exception 'apply_intelligence_cells: expected 1..50 writes';
  end if;

  -- A duplicate (item_id, column_id) pair in the same batch would make the
  -- returned `before` payload useless for Undo (it would restore whichever
  -- write happened to run first, not the true pre-call state).
  if (select count(*) from jsonb_array_elements(p_writes) w)
     <> (
       select count(distinct (w->>'item_id') || ':' || (w->>'column_id'))
       from jsonb_array_elements(p_writes) w
     ) then
    raise exception 'apply_intelligence_cells: duplicate item_id/column_id in p_writes';
  end if;

  -- RLS-filtered: a board the caller cannot read reads as "not found".
  select b.org_id into v_org from public.boards b where b.id = p_board_id;
  if v_org is null then
    raise exception 'apply_intelligence_cells: board not found';
  end if;

  -- Transaction-local: every activity row the triggers write in this call
  -- carries source = 'intelligence'; the setting dies with the transaction.
  perform set_config('app.activity_source', 'intelligence', true);

  for v_write in select * from jsonb_array_elements(p_writes) loop
    v_item  := (v_write->>'item_id')::uuid;
    v_col   := (v_write->>'column_id')::uuid;
    v_value := v_write->'value';
    v_old   := null;

    if not exists (select 1 from public.items i where i.id = v_item and i.board_id = p_board_id)
       or not exists (select 1 from public.columns c where c.id = v_col and c.board_id = p_board_id) then
      raise exception 'apply_intelligence_cells: item or column is not on this board';
    end if;

    select cv.value into v_old from public.cell_values cv
      where cv.item_id = v_item and cv.column_id = v_col;
    v_before := v_before || jsonb_build_object('item_id', v_item, 'column_id', v_col, 'value', v_old);

    if v_value is null or jsonb_typeof(v_value) = 'null' then
      delete from public.cell_values cv where cv.item_id = v_item and cv.column_id = v_col;
      -- A caller without edit access has the row RLS-filtered out of the
      -- delete rather than erroring: it silently "succeeds" on zero rows.
      -- Undo is the common case for this branch (clearing a previously-empty
      -- cell), so only flag it when a row genuinely existed to delete.
      if v_old is not null and not found then
        raise exception 'apply_intelligence_cells: no edit access to this board' using errcode = '42501';
      end if;
      v_cells := v_cells || jsonb_build_object('item_id', v_item, 'column_id', v_col, 'cleared', true);
    else
      insert into public.cell_values (org_id, board_id, item_id, column_id, value)
      values (v_org, p_board_id, v_item, v_col, v_value)
      on conflict (item_id, column_id) do update set value = excluded.value
      returning * into v_row;
      v_cells := v_cells || to_jsonb(v_row);
    end if;
  end loop;

  -- Clear the transaction-local stamp so it cannot outlive this call if it
  -- is ever invoked inside a larger caller transaction (set_config's `true`
  -- argument scopes it to the transaction, not the statement).
  perform set_config('app.activity_source', '', true);

  return jsonb_build_object('before', v_before, 'cells', v_cells);
end $$;

comment on function public.apply_intelligence_cells (uuid, jsonb) is
  'Apply a Board Intelligence suggestion''s cell writes in one transaction under the caller''s RLS; returns before-values and the written rows. Activity rows get source = intelligence.';

revoke execute on function public.apply_intelligence_cells (uuid, jsonb) from public, anon;
grant execute on function public.apply_intelligence_cells (uuid, jsonb) to authenticated;

-- ── 4. board-level transcript read ──────────────────────────────────────────
create index item_updates_board_created_idx
  on public.item_updates (board_id, created_at desc);
