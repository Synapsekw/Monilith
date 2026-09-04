-- 20260827095748_agent_memory.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (Spec 2c · Unit U1):
--   1) agent_memory — per-agent keyed notes. One row per (agent, key); a second
--      write to a key REPLACES it, so dedup is structural rather than semantic.
--   2) agent_remember() — the agent's ONLY write path. security invoker, so it
--      buys atomicity and never reach. Three things must happen indivisibly:
--      the 50-note cap check, an upsert conditional on origin='agent', and
--      telling the caller which of the four outcomes occurred.
--   3) user_agent_runs.memory_notes_dropped — a COUNT, not a boolean: memory
--      truncation is partial by design. Like model_substituted and
--      documents_omitted this is neither a status nor an error; the run
--      succeeded (run-status.ts).
--   4) memory.write joins the closed capability vocabulary — both check
--      constraints and the ceiling column default.
--
-- DDL ONLY. NOT ONE ROW OF USER DATA IS READ OR WRITTEN BY THIS MIGRATION.
--
-- THE CEILING BACKFILL IS DELIBERATELY ABSENT — owner ruling, 2026-08-27.
--
-- The spec (§1.3) and the plan (Task 1 Step 2) both carried a data-modifying
-- `update public.org_ai_settings …` at the bottom of this file, to add
-- 'memory.write' to every EXISTING org's ceiling array. The owner ruled it out
-- of this slice: the DEV database holds real, live, user-facing data
-- (decision-32), and a data-modifying statement against it is production
-- surgery that is reviewed and run on its own, never as a side effect of
-- shipping a feature branch.
--
-- The exact statement, recorded here so it is reviewable in the diff and
-- runnable verbatim later. IT HAS NOT BEEN EXECUTED:
--
--     update public.org_ai_settings
--        set agent_capability_ceiling = agent_capability_ceiling || 'memory.write'
--      where not ('memory.write' = any (agent_capability_ceiling));
--
-- WHAT THAT MEANS FOR THIS SHIP, stated plainly so nobody reads the feature's
-- silence as a bug: every org that already has an `org_ai_settings` row carries
-- the literal four-element array, so `makeGrantGate` denies every memory write
-- with "memory.write is disabled for this organization" — and because the
-- CEILING check runs BEFORE the grant check and records NO proposal, the owner
-- sees nothing at all. The feature therefore ships INSTALLABLE BUT INERT: the
-- table, the RPC, the tools, the panel and the prompt block are all live and
-- tested, and one `update` (or an admin ticking the box on the org AI settings
-- page, which writes the same array) turns it on. That is the intended state.
--
-- The `alter column … set default` below IS included: it is DDL, it changes no
-- existing row, and it only decides what a BRAND-NEW org_ai_settings row gets —
-- keeping the DB default in step with `DEFAULT_ORG_AI_SETTINGS` on the
-- TypeScript side, which derives from AGENT_CAPABILITIES.

-- ---------------------------------------------------------------------------
-- 1) agent_memory
-- ---------------------------------------------------------------------------
create table if not exists public.agent_memory (
  id             uuid primary key default gen_random_uuid(),
  user_agent_id  uuid not null references public.user_agents (id) on delete cascade,
  org_id         uuid not null references public.organizations (id) on delete cascade,
  owner_id       uuid not null references auth.users (id) on delete cascade,
  -- Slug-shaped, so a key can never be a sentence or a prompt fragment.
  key            text not null check (key ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  -- ONE LINE, bounded. This is structural containment, not tidiness: a value
  -- that cannot contain a newline cannot open a block, cannot forge a heading,
  -- and cannot place a colon-terminated all-caps line at the start of a line.
  -- Memory is model-written text that re-enters the SYSTEM PROMPT, and the
  -- model does not go through the Zod layer the owner's form does — so the
  -- containment has to live here to be true of every write path.
  value          text not null check (length(value) between 1 and 500
                                      and position(E'\n' in value) = 0),
  -- What makes an owner's note un-clobberable by the agent. The owner's word
  -- is the fixed point of this feature.
  origin         text not null check (origin in ('agent','owner')),
  -- Denormalised so the budget meter never selects `value`. Recomputed on
  -- EVERY write; memory-db.test.ts pins that.
  token_estimate integer not null check (token_estimate >= 0),
  -- Provenance: "which morning did my agent decide this?" is the first
  -- question an owner asks about a note they disagree with. `set null` — a
  -- pruned run must not take the note with it.
  last_run_id    uuid references public.user_agent_runs (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_agent_id, key)
);

create index if not exists agent_memory_agent_idx
  on public.agent_memory (user_agent_id, updated_at desc);

alter table public.agent_memory enable row level security;

-- Owner-scoped on all four verbs. `is_org_member` goes on the WRITE side only
-- — the same deliberate asymmetry as agent_documents (20260825113635) and
-- user_agents_owner_all: an owner who leaves an org must never lose reach to
-- their own already-owner-scoped rows.
drop policy if exists agent_memory_owner_select on public.agent_memory;
create policy agent_memory_owner_select on public.agent_memory
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists agent_memory_owner_insert on public.agent_memory;
create policy agent_memory_owner_insert on public.agent_memory
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and public.is_org_member(org_id)
    and exists (select 1 from public.user_agents ua
                 where ua.id = user_agent_id and ua.owner_id = (select auth.uid()))
  );

-- `with check` re-asserts owner_id and org_id so an update can never re-parent
-- a row into someone else's library or an org the caller is not in.
drop policy if exists agent_memory_owner_update on public.agent_memory;
create policy agent_memory_owner_update on public.agent_memory
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and public.is_org_member(org_id)
  );

drop policy if exists agent_memory_owner_delete on public.agent_memory;
create policy agent_memory_owner_delete on public.agent_memory
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Table-level, positively written — mirrors 20260812062428_agent_proposals.sql
-- and 20260824164412_agent_reference_documents.sql.
grant select, insert, update, delete on public.agent_memory to authenticated;

comment on table public.agent_memory is
  'Per-agent keyed memory notes (Spec 2c). One row per (user_agent_id, key); a '
  'second write to a key REPLACES it. `origin` distinguishes what the agent '
  'learned from what its owner told it, and an owner note is not agent-writable.';

-- ---------------------------------------------------------------------------
-- 2) agent_remember(): the agent's only write path.
-- ---------------------------------------------------------------------------
--
-- SECURITY INVOKER (the default, stated because it is the whole point): the
-- caller's RLS applies to every statement, so this grants nothing the caller
-- could not already do. A DEFINER function here would let any authenticated
-- caller write any agent's memory.
--
-- Returns a STATUS rather than raising, because the caller turns it into a
-- tool result the model must act on — a raise surfaces as {"error": …} with no
-- key list to choose a victim from, and the model would loop.
create or replace function public.agent_remember(
  p_user_agent_id  uuid,
  p_key            text,
  p_value          text,
  p_token_estimate integer,
  p_run_id         uuid
) returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_org_id   uuid;
  v_owner_id uuid;
  v_count    int;
  v_existing text;
  v_id       uuid;
begin
  -- Resolve the parents from the agent row, NEVER from arguments: a
  -- caller-supplied org_id/owner_id would be a cross-tenant write primitive.
  -- RLS on user_agents is what makes this read safe.
  select ua.org_id, ua.owner_id into v_org_id, v_owner_id
    from public.user_agents ua
   where ua.id = p_user_agent_id;
  -- RAISE, do not return a status. An unreachable agent is not one of the four
  -- outcomes the model can act on — it means the caller passed an id the
  -- caller cannot see, which is a bug or an attack, not a refusal. It surfaces
  -- through `agentRemember`'s throw and `tools.ts`'s one failure shape as
  -- {"error": …}, which fails the STEP without failing the run.
  if v_org_id is null then
    raise exception 'agent_remember: no such user_agent %', p_user_agent_id
      using errcode = 'no_data_found';
  end if;

  select m.origin into v_existing
    from public.agent_memory m
   where m.user_agent_id = p_user_agent_id and m.key = p_key;

  if v_existing = 'owner' then
    return 'refused_owner_note';
  end if;

  -- The cap and the insert must be ONE statement's worth of atomic, or a
  -- check-then-insert races itself into a silently-51st note.
  if v_existing is null then
    select count(*) into v_count
      from public.agent_memory m
     where m.user_agent_id = p_user_agent_id;
    if v_count >= 50 then
      return 'refused_cap';
    end if;
  end if;

  insert into public.agent_memory
    (user_agent_id, org_id, owner_id, key, value, origin, token_estimate, last_run_id)
  values
    (p_user_agent_id, v_org_id, v_owner_id, p_key, p_value, 'agent', p_token_estimate, p_run_id)
  on conflict (user_agent_id, key) do update
     set value          = excluded.value,
         token_estimate = excluded.token_estimate,
         last_run_id    = excluded.last_run_id,
         updated_at     = now()
   -- Unqualified table name, not schema-qualified: in ON CONFLICT DO UPDATE
   -- the existing row is referenced by the target's own name/alias.
   where agent_memory.origin = 'agent'
  returning id into v_id;

  if v_id is null then
    return 'refused_owner_note';
  end if;

  return case when v_existing is null then 'written' else 'replaced' end;
end;
$$;

comment on function public.agent_remember(uuid, text, text, integer, uuid) is
  'The agent-side memory write. SECURITY INVOKER: the caller''s RLS applies, so '
  'this buys atomicity (cap check + conditional upsert) and never reach. '
  'Refuses a key owned by an origin=''owner'' note, and refuses at the 50-note '
  'cap rather than evicting — a silently evicted note is a fact the agent '
  'believes it still knows.';

revoke all on function public.agent_remember(uuid, text, text, integer, uuid) from public;
grant execute on function public.agent_remember(uuid, text, text, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) The run disclosure column.
-- ---------------------------------------------------------------------------
alter table public.user_agent_runs
  add column if not exists memory_notes_dropped integer not null default 0;

comment on column public.user_agent_runs.memory_notes_dropped is
  'How many memory notes did not fit this run''s memory budget. A COUNT, not a '
  'boolean — memory truncation is partial by design. Like model_substituted and '
  'documents_omitted this is a disclosure on a run that SUCCEEDED.';

-- ---------------------------------------------------------------------------
-- 4) The fifth capability.
-- ---------------------------------------------------------------------------
alter table public.user_agents
  drop constraint if exists user_agents_capabilities_known;
alter table public.user_agents
  add constraint user_agents_capabilities_known
  check (capabilities <@ array['board.write','files.write',
                              'automation.create','time.log','memory.write']::text[]);

-- New rows only. Changes nothing that already exists — see the header note on
-- the omitted backfill.
alter table public.org_ai_settings
  alter column agent_capability_ceiling set default
    array['board.write','files.write',
          'automation.create','time.log','memory.write']::text[];

alter table public.org_ai_settings
  drop constraint if exists org_ai_settings_ceiling_known;
alter table public.org_ai_settings
  add constraint org_ai_settings_ceiling_known
  check (agent_capability_ceiling <@ array['board.write','files.write',
                                           'automation.create','time.log',
                                           'memory.write']::text[]);
