-- Personal Monos, Plan 2A / unit I: one Mono per person per org.
-- Spec: docs/superpowers/specs/2026-11-13-personal-monos-design.md §1, §2.
-- Session mechanism: vault/decisions/2026-11-13-decision-44-mono-identity-session.md.

-- ── 1. monos ────────────────────────────────────────────────────────────────
create table public.monos (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  org_id          uuid not null references public.organizations (id) on delete cascade,
  owner_id        uuid not null references auth.users (id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 40),
  color           text not null check (color ~ '^#[0-9a-f]{6}$'),
  brain           text not null default 'none' check (brain in ('none', 'key', 'connected')),
  oauth_client_id uuid references public.oauth_clients (id) on delete set null,
  last_seen_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint monos_one_per_owner unique (org_id, owner_id),
  constraint monos_not_its_own_owner check (user_id <> owner_id)
);
create index monos_owner_idx on public.monos (owner_id);
create trigger monos_set_updated_at before update on public.monos
  for each row execute function public.set_updated_at();

-- RLS cannot hide single columns, so the secret-ish columns are simply not
-- granted. Inserts, updates and deletes happen only in definer functions.
alter table public.monos enable row level security;
revoke all on public.monos from anon, authenticated;
grant select (user_id, org_id, owner_id, name, color, last_seen_at, created_at, updated_at)
  on public.monos to authenticated;
create policy "monos: read if org member" on public.monos
  for select to authenticated using (public.is_org_member(org_id));

create view public.org_monos with (security_invoker = true) as
  select user_id, org_id, owner_id, name, color from public.monos;
revoke all on public.org_monos from anon;
grant select on public.org_monos to authenticated;

-- ── 2. brain: derived from the owner's own key ──────────────────────────────
create or replace function public._mono_brain_for(p_owner uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when exists (
    select 1 from public.user_ai_credentials c
     where c.user_id = p_owner and c.provider in ('anthropic', 'openai')
  ) then 'key' else 'none' end;
$$;
revoke execute on function public._mono_brain_for(uuid) from public, anon, authenticated;

create or replace function public.tg_sync_mono_brain()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := coalesce(new.user_id, old.user_id);
begin
  -- 'connected' belongs to the MCP consent flow (Plan 2B); a key change never
  -- downgrades it.
  update public.monos m
     set brain = public._mono_brain_for(v_owner)
   where m.owner_id = v_owner
     and m.brain <> 'connected'
     and m.brain is distinct from public._mono_brain_for(v_owner);
  return null;
end $$;
revoke execute on function public.tg_sync_mono_brain() from public, anon, authenticated;
create trigger user_ai_credentials_sync_mono_brain
  after insert or update or delete on public.user_ai_credentials
  for each row execute function public.tg_sync_mono_brain();

-- ── 3. creating a Mono (service role only) ──────────────────────────────────
-- The Server Action creates the bot with the GoTrue admin API first (a
-- magic-link-capable user; ADR decision-44), then calls this. Granting it to
-- service_role only means no client can turn an arbitrary user into a Mono.
create or replace function public.create_mono(
  p_org_id uuid, p_owner_id uuid, p_mono_id uuid, p_name text, p_color text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_existing uuid; v_email text;
begin
  select m.user_id into v_existing from public.monos m
   where m.org_id = p_org_id and m.owner_id = p_owner_id;
  if v_existing is not null then return v_existing; end if;

  if not exists (
    select 1 from public.org_members om
      join public.profiles p on p.id = om.user_id
     where om.org_id = p_org_id and om.user_id = p_owner_id
       and om.deactivated_at is null and om.role <> 'agent' and not p.is_agent
  ) then
    raise exception 'owner is not an active person in this org' using errcode = '42501';
  end if;

  select u.email into v_email from auth.users u where u.id = p_mono_id;
  if v_email is distinct from 'mono-' || p_mono_id::text || '@monolith.internal' then
    raise exception 'not a Mono bot user' using errcode = '42501';
  end if;
  if exists (select 1 from public.org_members om where om.user_id = p_mono_id)
     or exists (select 1 from public.monos m where m.user_id = p_mono_id) then
    raise exception 'that bot user is already in use' using errcode = '42501';
  end if;

  insert into public.monos (user_id, org_id, owner_id, name, color, brain)
  values (p_mono_id, p_org_id, p_owner_id, btrim(p_name), lower(p_color),
          public._mono_brain_for(p_owner_id))
  on conflict (org_id, owner_id) do nothing;
  if not found then
    select m.user_id into v_existing from public.monos m
     where m.org_id = p_org_id and m.owner_id = p_owner_id;
    return v_existing;
  end if;

  update public.profiles set is_agent = true, full_name = btrim(p_name) where id = p_mono_id;
  insert into public.org_members (org_id, user_id, role) values (p_org_id, p_mono_id, 'agent');
  return p_mono_id;
end $$;
revoke execute on function public.create_mono(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_mono(uuid, uuid, uuid, text, text) to service_role;

-- ── 4. the owner's own reads and edits ──────────────────────────────────────
create or replace function public.get_my_mono(p_org_id uuid)
returns table (user_id uuid, org_id uuid, owner_id uuid, name text, color text,
               brain text, key_provider text, last_seen_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, m.org_id, m.owner_id, m.name, m.color, m.brain,
         (select c.provider from public.user_ai_credentials c
           where c.user_id = m.owner_id and c.provider in ('anthropic', 'openai')
           order by (c.provider = 'anthropic') desc
           limit 1),
         m.last_seen_at, m.created_at
    from public.monos m
   where m.org_id = p_org_id and m.owner_id = (select auth.uid());
$$;
revoke execute on function public.get_my_mono(uuid) from public, anon;
grant execute on function public.get_my_mono(uuid) to authenticated;

create or replace function public.update_my_mono(p_org_id uuid, p_name text, p_color text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_mono uuid;
begin
  update public.monos m set name = btrim(p_name), color = lower(p_color)
   where m.org_id = p_org_id and m.owner_id = (select auth.uid())
  returning m.user_id into v_mono;
  if v_mono is null then raise exception 'no Mono in this org' using errcode = 'P0002'; end if;
  -- Name-only surfaces (dashboards, old activity) read profiles.full_name.
  update public.profiles set full_name = btrim(p_name) where id = v_mono;
end $$;
revoke execute on function public.update_my_mono(uuid, text, text) from public, anon;
grant execute on function public.update_my_mono(uuid, text, text) to authenticated;

-- ── 5. a Mono is never a person, and a person never becomes a Mono ──────────
create or replace function public.tg_org_members_guard_agent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.role is distinct from old.role
     and (old.role = 'agent' or new.role = 'agent') then
    raise exception 'a Mono''s role cannot change, and nobody can become one'
      using errcode = '42501';
  end if;
  if new.role = 'agent' then
    if not exists (select 1 from public.monos m
                    where m.user_id = new.user_id and m.org_id = new.org_id) then
      raise exception 'only a Mono can hold the agent role' using errcode = '42501';
    end if;
  elsif exists (select 1 from public.profiles p where p.id = new.user_id and p.is_agent) then
    raise exception 'a bot cannot join an org as a person' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.tg_org_members_guard_agent() from public, anon, authenticated;
create trigger org_members_guard_agent
  before insert or update of role on public.org_members
  for each row execute function public.tg_org_members_guard_agent();

alter table public.org_invitations
  add constraint org_invitations_role_not_agent check (role <> 'agent');

-- ── 6. lifecycle: leaving, deactivation, removal ────────────────────────────
-- The owner leaves (or is removed from) the org, or a Mono's own membership is
-- deleted: the Mono goes.
create or replace function public.tg_org_members_remove_monos()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.monos m
   where m.org_id = old.org_id
     and (m.owner_id = old.user_id or m.user_id = old.user_id);
  return null;
end $$;
revoke execute on function public.tg_org_members_remove_monos() from public, anon, authenticated;
create trigger org_members_remove_monos
  after delete on public.org_members
  for each row execute function public.tg_org_members_remove_monos();

-- A removed Mono loses every membership and every session in the same
-- transaction, so a token cached on a warm instance can read and write
-- nothing. The bot auth user and its profile stay: item_updates.author_id
-- has no cascade, and authored history must keep its name.
create or replace function public.tg_monos_cleanup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.board_members bm where bm.user_id = old.user_id;
  delete from public.org_members om where om.org_id = old.org_id and om.user_id = old.user_id;
  delete from auth.sessions s where s.user_id = old.user_id;
  return null;
end $$;
revoke execute on function public.tg_monos_cleanup() from public, anon, authenticated;
create trigger monos_cleanup
  after delete on public.monos
  for each row execute function public.tg_monos_cleanup();

-- Deactivating (or reactivating) the owner does the same to their Mono.
create or replace function public.tg_org_members_mirror_deactivation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'agent' or new.deactivated_at is not distinct from old.deactivated_at then
    return null;
  end if;
  update public.org_members om
     set deactivated_at = new.deactivated_at, deactivated_by = new.deactivated_by
    from public.monos m
   where m.org_id = new.org_id and m.owner_id = new.user_id
     and om.org_id = m.org_id and om.user_id = m.user_id;
  return null;
end $$;
revoke execute on function public.tg_org_members_mirror_deactivation() from public, anon, authenticated;
create trigger org_members_mirror_deactivation
  after update of deactivated_at on public.org_members
  for each row execute function public.tg_org_members_mirror_deactivation();

-- ── 7. the members list shows people only ───────────────────────────────────
create or replace function public.get_org_members(p_org_id uuid, p_limit integer default 50, p_offset integer default 0)
returns table(user_id uuid, email text, full_name text, role public.org_role,
              deactivated_at timestamptz, created_at timestamptz)
language sql security definer set search_path = '' as $$
  select m.user_id, u.email::text, (u.raw_user_meta_data ->> 'full_name'),
         m.role, m.deactivated_at, m.created_at
  from public.org_members m
  join auth.users u on u.id = m.user_id
  where m.org_id = p_org_id
    and m.role <> 'agent'
    and (
      public.has_org_role(p_org_id, array['owner','admin']::public.org_role[])
      or public.is_platform_admin()
    )
  order by m.created_at
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;

-- ── 8. session growth (ADR decision-44 consequence) ─────────────────────────
-- Each mint leaves an auth.sessions row. Access tokens are verified by
-- signature and a Mono re-mints within 55 minutes, so a 2-hour-old session is
-- never in use. Bounded per run.
create or replace function public.prune_mono_sessions()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  with doomed as (
    select s.id from auth.sessions s
      join public.profiles p on p.id = s.user_id
     where p.is_agent and s.created_at < now() - interval '2 hours'
     limit 5000
  )
  delete from auth.sessions s using doomed d where s.id = d.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.prune_mono_sessions() from public, anon, authenticated;

select cron.schedule('mono-sessions-prune', '17 * * * *', $$select public.prune_mono_sessions()$$);
