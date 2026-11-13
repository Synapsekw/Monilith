-- 20261113170824_mono_owner_only_assign.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   1. cell_values_guard_mono_assign: a People-cell write that ADDS a Mono is
--      refused (42501) unless the signed-in caller is that Mono's owner, and
--      refused (P0001) while the Mono is asleep (brain = 'none'). Otherwise
--      the Mono is put on the board as the owner (board_members_guard_mono
--      sets the level; the owner-guard passes because auth.uid() = owner).
--      Removing a Mono is always allowed.
--   2. notifications_skip_agents: notifications to agent profiles are dropped.
--   3. boards_no_agent_creator: a board whose created_by is an agent profile
--      is refused (42501). A Mono never creates boards.

-- Personal Monos, Plan 2A / unit O. Owner-only assignment, enforced at the
-- one table every People write reaches (upsertCellCore, MCP, automations,
-- imports), not only in pickers or prompts.

create or replace function public.tg_cell_values_guard_mono_assign()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_new text[] := '{}';
  v_old text[] := '{}';
  r record;
begin
  if (select c.kind from public.columns c where c.id = new.column_id)
       is distinct from 'people'::public.column_kind then
    return new;
  end if;
  if jsonb_typeof(new.value -> 'userIds') = 'array' then
    select coalesce(array_agg(x), '{}') into v_new
      from jsonb_array_elements_text(new.value -> 'userIds') as t(x);
  end if;
  if tg_op = 'UPDATE' and jsonb_typeof(old.value -> 'userIds') = 'array' then
    select coalesce(array_agg(x), '{}') into v_old
      from jsonb_array_elements_text(old.value -> 'userIds') as t(x);
  end if;
  for r in
    select m.user_id, m.owner_id, m.brain from public.monos m
     where m.user_id::text = any (v_new) and not (m.user_id::text = any (v_old))
  loop
    if v_uid is null or v_uid <> r.owner_id then
      raise exception 'only its owner can assign a Mono' using errcode = '42501';
    end if;
    if r.brain = 'none' then
      raise exception 'this Mono is asleep. Give it a brain before assigning it'
        using errcode = 'P0001';
    end if;
    -- The owner can edit this board (RLS let the write through), so their Mono
    -- may join it; board_members_guard_mono sets the level.
    insert into public.board_members (org_id, board_id, user_id, access_level, granted_by)
    values (new.org_id, new.board_id, r.user_id, 'viewer', r.owner_id)
    on conflict (board_id, user_id) do nothing;
  end loop;
  return new;
end $$;
revoke execute on function public.tg_cell_values_guard_mono_assign() from public, anon, authenticated;
create trigger cell_values_guard_mono_assign
  before insert or update of value on public.cell_values
  for each row execute function public.tg_cell_values_guard_mono_assign();

-- A bot has no inbox and an internal address. Plan 2B's mono_inbox is how a
-- Mono hears about work.
create or replace function public.tg_notifications_skip_agents()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.profiles p where p.id = new.recipient_id and p.is_agent) then
    return null;
  end if;
  return new;
end $$;
revoke execute on function public.tg_notifications_skip_agents() from public, anon, authenticated;
create trigger notifications_skip_agents
  before insert on public.notifications
  for each row execute function public.tg_notifications_skip_agents();

-- Owner decision (2026-11-13): a Mono never creates boards. A board it created
-- would be invisible to its owner until shared. Enforced at the table, so the
-- confirm card, MCP and any future path are all covered.
create or replace function public.tg_boards_no_agent_creator()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.profiles p where p.id = new.created_by and p.is_agent) then
    raise exception 'A Mono cannot create boards' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.tg_boards_no_agent_creator() from public, anon, authenticated;
create trigger boards_no_agent_creator
  before insert on public.boards
  for each row execute function public.tg_boards_no_agent_creator();
