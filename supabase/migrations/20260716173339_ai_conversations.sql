-- 20260716173339_ai_conversations.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Adds the two tables backing full-page Ask Pulse conversational history:
--   ai_conversations (one per chat thread, owner-scoped) and ai_messages
--   (turns within a conversation). Both carry owner-scoped RLS so a user reads
--   and writes only their own threads; org membership is enforced on insert.

-- ai_conversations: one per chat thread, owned by a user, scoped to an org.
create table public.ai_conversations (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  workspace_id     uuid references public.workspaces (id) on delete set null,
  title            text not null default 'New chat',
  summary          text,
  summarized_upto  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index ai_conversations_user_updated_idx
  on public.ai_conversations (user_id, updated_at desc);

alter table public.ai_conversations enable row level security;

-- Owner-scoped: a user sees/writes only their own conversations, in an org they belong to.
create policy "ai_conversations_select_own" on public.ai_conversations
  for select using (user_id = (select auth.uid()) and public.is_org_member(org_id));
create policy "ai_conversations_insert_own" on public.ai_conversations
  for insert with check (user_id = (select auth.uid()) and public.is_org_member(org_id));
create policy "ai_conversations_update_own" on public.ai_conversations
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "ai_conversations_delete_own" on public.ai_conversations
  for delete using (user_id = (select auth.uid()));

create trigger ai_conversations_set_updated_at
  before update on public.ai_conversations
  for each row execute function public.set_updated_at();

-- ai_messages: turns within a conversation. Ownership derives from the parent conversation.
create table public.ai_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.ai_conversations (id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  tool_trace       jsonb,
  created_at       timestamptz not null default now()
);

create index ai_messages_conversation_created_idx
  on public.ai_messages (conversation_id, created_at);

alter table public.ai_messages enable row level security;

create policy "ai_messages_select_own" on public.ai_messages
  for select using (exists (
    select 1 from public.ai_conversations c
    where c.id = conversation_id and c.user_id = (select auth.uid())
  ));
create policy "ai_messages_insert_own" on public.ai_messages
  for insert with check (exists (
    select 1 from public.ai_conversations c
    where c.id = conversation_id and c.user_id = (select auth.uid()) and public.is_org_member(c.org_id)
  ));
create policy "ai_messages_delete_own" on public.ai_messages
  for delete using (exists (
    select 1 from public.ai_conversations c
    where c.id = conversation_id and c.user_id = (select auth.uid())
  ));
