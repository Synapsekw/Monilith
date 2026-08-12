-- 20260812062428_agent_proposals.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (Spec 2a · Unit C):
--   1) user_agent_proposals — the durable record of a tool call an agent WANTED
--      to make but had no grant for. Written by the service-role run; decided by
--      the owner later. This is what lets an unattended 07:00 run finish instead
--      of hanging on a human.
--   2) user_agent_runs gains effect columns: a run that can WRITE must record
--      what it did, and under which grants it did it.
--
-- ADDITIVE ONLY: one new table plus four nullable columns. No drop column, no
-- data-modifying statement, so every existing row stays byte-identical.

create table if not exists public.user_agent_proposals (
  id            uuid primary key default gen_random_uuid(),
  user_agent_id uuid not null references public.user_agents (id) on delete cascade,
  run_id        uuid not null references public.user_agent_runs (id) on delete cascade,
  org_id        uuid not null references public.organizations (id) on delete cascade,
  owner_id      uuid not null references auth.users (id) on delete cascade,
  capability    text not null,
  tool_name     text not null,
  -- The AI SDK's toolCallId. Paired with run_id it is the natural idempotency
  -- key: a redelivered run cannot insert the same proposed call twice.
  tool_call_id  text not null,
  input         jsonb not null,
  -- SERVER-derived from the validated input. Never text the model wrote: a
  -- model-authored summary is a sentence the user approves that need not
  -- describe what actually executes.
  summary       text not null check (length(summary) between 1 and 500),
  status        text not null default 'pending'
                  check (status in ('pending','approved','rejected','expired','failed')),
  decided_at    timestamptz,
  decided_by    uuid references auth.users (id),
  result        jsonb,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);

create unique index if not exists user_agent_proposals_call_uniq
  on public.user_agent_proposals (run_id, tool_call_id);
create index if not exists user_agent_proposals_owner_idx
  on public.user_agent_proposals (owner_id, status, created_at desc);
create index if not exists user_agent_proposals_agent_idx
  on public.user_agent_proposals (user_agent_id, created_at desc);

alter table public.user_agent_proposals enable row level security;

-- Owner-scoped read. Mirrors user_agent_runs_owner_read: no org-admin read,
-- because a proposal embeds the agent's instructions-derived intent and, for
-- create_file, the document body itself.
drop policy if exists user_agent_proposals_owner_read on public.user_agent_proposals;
create policy user_agent_proposals_owner_read on public.user_agent_proposals
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- Deciding is an UPDATE by the owner. There is deliberately NO insert policy:
-- rows are written only by the service-role run, exactly as user_agent_runs is.
-- The `with check` re-asserts owner_id so an update can never re-parent a row.
drop policy if exists user_agent_proposals_owner_decide on public.user_agent_proposals;
create policy user_agent_proposals_owner_decide on public.user_agent_proposals
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Table-level, and deliberately WITHOUT insert: an owner needs to read their
-- queue and decide a row, and nothing more.
--
-- Honest note on what this line does and does not buy. This project's default
-- privileges already hand `authenticated` (and `anon`) arwdDxtm on every new
-- public table, so the statement is belt-and-braces rather than the boundary —
-- verified on live DEV: user_agent_runs carries the same full ACL and refuses
-- every authenticated write purely because it has no write POLICY. RLS is the
-- boundary here too: SELECT and UPDATE are owner-scoped above, and INSERT and
-- DELETE have no policy at all, so their `with check`/`using` default to false.
-- The grant is written positively (never `grant insert`) so that a future
-- reader adding an insert policy has to think about the write path first.
grant select, update on public.user_agent_proposals to authenticated;

alter table public.user_agent_runs
  add column if not exists grants     jsonb,
  add column if not exists steps      int,
  add column if not exists tools_used text[],
  add column if not exists output     text;

-- No column grants needed here, unlike 20260812060142's user_agents columns:
-- `authenticated`'s ACL on user_agent_runs is TABLE-level (arwdDxtm), verified
-- against pg_class.relacl on live DEV before writing this, so the four new
-- columns are already covered. (Writes are still refused — the table has a
-- SELECT-only policy and no write policy at all; that is RLS doing the work,
-- not the grant.)

comment on column public.user_agent_runs.grants is
  'The capability set in force when this run executed. Recorded per-run rather '
  'than as grant-table history because "what could this agent do at 07:00 on '
  'the 3rd?" is the question that actually matters.';

comment on column public.user_agent_runs.steps is
  'How many model steps the tool loop consumed. Null for every run that '
  'predates the tool-using runtime.';

comment on column public.user_agent_runs.tools_used is
  'Tool names the run actually EXECUTED (not proposed). Proposed-but-refused '
  'calls live in user_agent_proposals.';

comment on column public.user_agent_runs.output is
  'The run''s final assistant text, kept so the owner can see what the agent '
  'concluded without re-reading the email.';
