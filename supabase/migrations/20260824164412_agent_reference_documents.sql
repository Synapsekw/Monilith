-- 20260824164412_agent_reference_documents.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (Spec 2b · Unit U1):
--   1) agent_documents — a personal library of reference text, owner-scoped.
--   2) user_agent_documents — the many-to-many join to user_agents.
--   3) user_agent_runs.documents_omitted — a run that succeeded WITHOUT its
--      documents. Deliberately not a status and not an error: the run worked.
--      Mirrors model_substituted (see run-status.ts:64-76).
--
-- ADDITIVE ONLY: two new tables plus one column with a NOT NULL default. No
-- drop, no data-modifying statement.
--
-- Note: NO column is added to user_agents. A join table needs only its own
-- table-level grants, which sidesteps the column-grant trap entirely.

create table if not exists public.agent_documents (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations (id) on delete cascade,
  owner_id         uuid not null references auth.users (id) on delete cascade,
  title            text not null check (length(title) between 1 and 200),
  -- The extracted/edited text: the ONLY truth. What the owner sees in the
  -- review textarea is byte-for-byte what enters the prompt.
  body             text not null check (length(body) between 1 and 2000000),
  -- Denormalised so the attach-time meter never has to select `body`.
  -- Recomputed on EVERY write; documents-db.test.ts pins that.
  token_estimate   integer not null check (token_estimate >= 0),
  source_format    text not null
                     check (source_format in ('pasted','markdown','text','pdf','docx','xlsx')),
  source_file_name text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists agent_documents_owner_idx
  on public.agent_documents (owner_id, updated_at desc);

create table if not exists public.user_agent_documents (
  user_agent_id uuid not null references public.user_agents (id)     on delete cascade,
  document_id   uuid not null references public.agent_documents (id) on delete cascade,
  position      integer not null default 0,
  primary key (user_agent_id, document_id)
);

create index if not exists user_agent_documents_doc_idx
  on public.user_agent_documents (document_id);

alter table public.agent_documents        enable row level security;
alter table public.user_agent_documents   enable row level security;

-- Owner-scoped, all four verbs. A colleague in the same org cannot read
-- another person's library: this is a PERSONAL library, not an org one.
drop policy if exists agent_documents_owner_select on public.agent_documents;
create policy agent_documents_owner_select on public.agent_documents
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists agent_documents_owner_insert on public.agent_documents;
create policy agent_documents_owner_insert on public.agent_documents
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

-- `with check` re-asserts owner_id so an update can never re-parent a row.
drop policy if exists agent_documents_owner_update on public.agent_documents;
create policy agent_documents_owner_update on public.agent_documents
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists agent_documents_owner_delete on public.agent_documents;
create policy agent_documents_owner_delete on public.agent_documents
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- The join resolves through BOTH parents: the agent must be the caller's AND
-- the document must be the caller's. Checking only one would let a caller
-- attach someone else's document to their own agent.
drop policy if exists user_agent_documents_owner_select on public.user_agent_documents;
create policy user_agent_documents_owner_select on public.user_agent_documents
  for select to authenticated
  using (
    exists (select 1 from public.user_agents ua
             where ua.id = user_agent_id and ua.owner_id = (select auth.uid()))
  );

drop policy if exists user_agent_documents_owner_insert on public.user_agent_documents;
create policy user_agent_documents_owner_insert on public.user_agent_documents
  for insert to authenticated
  with check (
    exists (select 1 from public.user_agents ua
             where ua.id = user_agent_id and ua.owner_id = (select auth.uid()))
    and exists (select 1 from public.agent_documents d
                 where d.id = document_id and d.owner_id = (select auth.uid()))
  );

drop policy if exists user_agent_documents_owner_delete on public.user_agent_documents;
create policy user_agent_documents_owner_delete on public.user_agent_documents
  for delete to authenticated
  using (
    exists (select 1 from public.user_agents ua
             where ua.id = user_agent_id and ua.owner_id = (select auth.uid()))
  );

-- Table-level, positively written — mirrors 20260812062428_agent_proposals.sql.
-- No UPDATE on the join table: reordering is delete+insert in one action, and
-- an updatable composite PK is a sharp edge for nothing.
grant select, insert, update, delete on public.agent_documents      to authenticated;
grant select, insert, delete         on public.user_agent_documents to authenticated;

-- A run that succeeded WITHOUT its documents.
alter table public.user_agent_runs
  add column if not exists documents_omitted boolean not null default false;
