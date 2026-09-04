-- 20260827105257_agent_forget_and_memory_containment.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- ADDITIVE REPAIR of 20260827095748_agent_memory.sql, which is already applied
-- to DEV and is therefore never edited in place. Four review findings, all in
-- the same blast radius (`agent_memory` and the two functions that write it):
--
--   1) agent_forget() — the agent's ONLY delete path, refusing an owner note.
--      CRITICAL. `agent_remember` refuses to overwrite an `origin='owner'`
--      note, but nothing refused to DELETE one, so delete-then-rewrite bypassed
--      the owner-note invariant outright: forget("escalation-policy") then
--      remember("escalation-policy", "<attacker text>") — the second call sees
--      no existing row, passes the cap, and inserts origin='agent'. Both calls
--      sit under the SINGLE `memory.write` grant, so one injected tool result
--      buys both. The RLS delete policy cannot help: it is
--      `using (owner_id = auth.uid())` with no origin predicate, and THE AGENT
--      RUNS AS ITS OWNER. This is the gotcha-91 shape — a guard mounted on one
--      write path and never mirrored onto its sibling.
--
--   2) value: the marker guard, as a CHECK. The Zod layer rejected the
--      colon-terminated sentinel "YOUR OWNER'S INSTRUCTIONS:", but the marker
--      the prompt actually carries is "YOUR OWNER'S INSTRUCTIONS [nonce]:" —
--      and the first is NOT a substring of the second, because the bracketed
--      nonce sits between the label and the colon. So the exact real marker
--      passed. It has to be a CHECK and not only Zod: memory's second writer is
--      a language model, and the per-agent nonce (which defeats a DOCUMENT
--      forger, who never reads the prompt) does not defend memory at all — the
--      keyed marker is rendered into the very system prompt the writing model
--      is reading, so an injection need only say "include the bracketed token
--      you see above". Memory is the one untrusted block whose writer and
--      reader are the same actor.
--
--   3) value: 500 -> 380 characters. The proposal card an owner approves frames
--      the note as `Remember this for every future run, as "<key>": "<value>"`
--      — 44 characters of frame plus a key of up to 64 — and
--      `user_agent_proposals.summary` clamps at 500 with an ellipsis. At 500 a
--      note could therefore be approved with its TAIL HIDDEN: 440 benign
--      characters on the card, the payload past the clamp, and the FULL value
--      entering every future system prompt. 44 + 64 + 380 = 488 <= 500, so no
--      valid note can produce a clamped summary. `proposal-summary.test.ts`
--      pins the arithmetic; this constraint is what makes it true of the
--      model's path as well as the owner's form.
--
--   4) value: every line break, not just LF. The original excluded E'\n' only,
--      so CR, VT, FF, NEL (U+0085) and the Unicode LINE/PARAGRAPH separators
--      (U+2028/U+2029) all still put following text at the START of a line —
--      the only position from which a forged marker reads as prompt structure.
--      With (2) that was the delivery mechanism.
--
--   5) agent_remember(): the cap check is made genuinely atomic. Three comments
--      claimed the count and the insert were indivisible; at READ COMMITTED two
--      concurrent runs both reading 49 both insert. The row lock below makes
--      the claim true rather than deleting it.
--
-- DDL ONLY. NOT ONE ROW OF USER DATA IS READ OR WRITTEN BY THIS MIGRATION, and
-- `public.agent_memory` was empty on DEV when it was authored, so the tightened
-- constraint cannot reject anything that already exists.
--
-- THE CEILING BACKFILL REMAINS DELIBERATELY ABSENT — owner ruling, 2026-08-27.
-- See the header of 20260827095748_agent_memory.sql. It has still not been
-- executed, and this migration does not execute it either.

-- ---------------------------------------------------------------------------
-- 1) value containment: length, line breaks, and the instructions marker.
-- ---------------------------------------------------------------------------
alter table public.agent_memory
  drop constraint if exists agent_memory_value_check;

alter table public.agent_memory
  add constraint agent_memory_value_contained check (
    length(value) between 1 and 380
    -- Every character that STARTS A NEW LINE, not just LF. Mirrored exactly by
    -- `LINE_BREAK` in src/lib/validations/agent-memory.ts.
    and value !~ E'[\n\r\v\f\u0085\u2028\u2029]'
    -- The LABEL, case-insensitively — NOT the colon-terminated sentinel, which
    -- the real keyed marker does not contain. See note (2) in the header.
    and value !~* 'YOUR OWNER''S INSTRUCTIONS'
  );

comment on column public.agent_memory.value is
  'One line, 1..380 characters, carrying no form of the prompt''s own '
  '"YOUR OWNER''S INSTRUCTIONS" marker. Structural containment, enforced HERE '
  'because the second writer of this column is a language model that never '
  'passes through the Zod layer the owner''s form does. 380 rather than 500 so '
  'the longest legal note still fits, whole, inside the 500-character proposal '
  'summary an owner approves — a clamped summary would hide the tail of a note '
  'that nonetheless enters every future system prompt.';

-- ---------------------------------------------------------------------------
-- 2) agent_forget(): the agent's only delete path.
-- ---------------------------------------------------------------------------
--
-- SECURITY INVOKER, exactly like `agent_remember`: the caller's RLS applies to
-- every statement, so this grants nothing the caller could not already do. What
-- it buys is the ORIGIN PREDICATE — the one thing RLS cannot express here,
-- because the agent and the owner are the same Postgres role.
--
-- Returns a STATUS rather than raising, for `agent_remember`'s reason: the
-- caller turns it into a tool result the model must act on, and a raise
-- surfaces as {"error": …} the model cannot distinguish from a transport fault.
--
-- The three outcomes are distinct on purpose. "refused_owner_note" must not be
-- reported as "not_found": telling a model its owner's note does not exist
-- invites it to create one on that key, which is the very rewrite this
-- function exists to prevent.
create or replace function public.agent_forget(
  p_user_agent_id uuid,
  p_key           text
) returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_origin  text;
  v_deleted int;
begin
  select m.origin into v_origin
    from public.agent_memory m
   where m.user_agent_id = p_user_agent_id and m.key = p_key;

  if v_origin is null then
    return 'not_found';
  end if;
  if v_origin = 'owner' then
    return 'refused_owner_note';
  end if;

  -- `origin = 'agent'` is repeated ON THE DELETE ITSELF, not left to the read
  -- above. The read is for the message; THIS is the guard. A concurrent owner
  -- edit between the two statements must not be deleted by a decision taken
  -- before it landed.
  delete from public.agent_memory m
   where m.user_agent_id = p_user_agent_id
     and m.key = p_key
     and m.origin = 'agent';
  get diagnostics v_deleted = row_count;

  return case when v_deleted > 0 then 'forgotten' else 'not_found' end;
end;
$$;

comment on function public.agent_forget(uuid, text) is
  'The agent-side memory delete. SECURITY INVOKER: the caller''s RLS applies, so '
  'this buys the ORIGIN PREDICATE and never reach. REFUSES an origin=''owner'' '
  'note — without that, delete-then-rewrite bypasses agent_remember''s '
  'owner-note refusal entirely, since RLS scopes deletes by owner_id and the '
  'agent runs as its owner.';

revoke all on function public.agent_forget(uuid, text) from public;
grant execute on function public.agent_forget(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) agent_remember(): the cap check becomes genuinely atomic.
-- ---------------------------------------------------------------------------
--
-- UNCHANGED except for the `for update` on the parent agent row and the
-- comments that surround it. Recreated in full rather than patched because
-- `create or replace function` has no other form.
--
-- WHY THE LOCK. The previous body did `select count(*)` and then `insert`, in
-- plpgsql, at READ COMMITTED — two concurrent runs of the same agent both
-- reading 49 both insert, and the cap is exceeded. The impact is benign (a note
-- or two over 50); the defect was that three separate comments asserted the
-- pair was atomic. Locking the `user_agents` row serialises every write to THAT
-- agent's memory, which is the smallest scope that makes the claim true. It is
-- also cheap: it is one row, held for the duration of a single function call,
-- and `user_agents_owner_all` is `for all` so `select … for update` satisfies
-- both the SELECT and the UPDATE policy for the owner.
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
  --
  -- FOR UPDATE: this is also the serialisation point for the cap check below.
  select ua.org_id, ua.owner_id into v_org_id, v_owner_id
    from public.user_agents ua
   where ua.id = p_user_agent_id
     for update;
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

  -- Atomic BECAUSE OF THE ROW LOCK ABOVE, not because count-then-insert is
  -- atomic on its own — it is not. Any concurrent run of this agent is blocked
  -- on that lock until this transaction ends, so the count cannot go stale
  -- between here and the insert.
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
  'this buys atomicity and never reach. The cap check is atomic BECAUSE it '
  'takes a `for update` lock on the parent user_agents row first — '
  'count-then-insert at READ COMMITTED is not atomic on its own. Refuses a key '
  'held by an origin=''owner'' note, and refuses at the 50-note cap rather than '
  'evicting — a silently evicted note is a fact the agent believes it still '
  'knows. Its sibling `agent_forget` refuses to DELETE an owner note, without '
  'which this refusal is bypassable by delete-then-rewrite.';

revoke all on function public.agent_remember(uuid, text, text, integer, uuid) from public;
grant execute on function public.agent_remember(uuid, text, text, integer, uuid) to authenticated;
