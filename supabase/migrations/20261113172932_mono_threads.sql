-- 20261113172932_mono_threads.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Personal Monos, Plan 2A / unit R (chat). A Mono's chat threads are ordinary
--   ai_conversations rows owned by the Mono's owner, so ai_messages RLS,
--   compaction, staging and applyBatch work unchanged.
alter table public.ai_conversations
  add column mono_id uuid references public.monos (user_id) on delete cascade;
alter table public.ai_conversations
  add constraint ai_conversations_mono_private check (
    mono_id is null
    or (visibility = 'private' and board_id is null and folder_id is null and run_id is null)
  );
create index ai_conversations_mono_updated_idx
  on public.ai_conversations (mono_id, updated_at desc) where mono_id is not null;

-- Only a Mono's owner may hold a thread with it (spec §4 "Chat").
create or replace function public.tg_ai_conversations_guard_mono()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
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
create trigger ai_conversations_guard_mono
  before insert or update of mono_id, user_id, org_id on public.ai_conversations
  for each row execute function public.tg_ai_conversations_guard_mono();
