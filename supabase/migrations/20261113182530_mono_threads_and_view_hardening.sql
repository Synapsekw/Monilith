-- 20261113182530_mono_threads_and_view_hardening.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Personal Monos, Plan 2A — final review hardening.
--   (a) A thread's Mono is fixed at creation: the ai_conversations Mono guard
--       now refuses any UPDATE that changes mono_id (setting it on an ordinary
--       thread, clearing it on a Mono thread, or moving it to another Mono).
--       The trigger already fires on `update of mono_id, user_id, org_id`.
--   (b) org_monos view grants are made explicit: only authenticated may read
--       it, and only with SELECT (default privileges had granted everything).

-- (a) -----------------------------------------------------------------------
create or replace function public.tg_ai_conversations_guard_mono()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.mono_id is distinct from old.mono_id then
    raise exception 'a thread''s Mono cannot be changed' using errcode = '42501';
  end if;
  if new.mono_id is null then return new; end if;
  if not exists (
    select 1 from public.monos m
     where m.user_id = new.mono_id and m.owner_id = new.user_id and m.org_id = new.org_id
  ) then
    raise exception 'only its owner can talk to a Mono' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.tg_ai_conversations_guard_mono() from public, anon, authenticated;

-- (b) -----------------------------------------------------------------------
revoke all on public.org_monos from public, anon, authenticated;
grant select on public.org_monos to authenticated;
