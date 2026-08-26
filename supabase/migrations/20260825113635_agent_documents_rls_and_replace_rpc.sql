-- 20260825113635_agent_documents_rls_and_replace_rpc.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   1) agent_documents: adds `public.is_org_member(org_id)` to the INSERT and
--      UPDATE `with check` clauses. 20260824164412 asserted only
--      `owner_id = auth.uid()` there, so a caller could insert — or by UPDATE
--      re-parent — one of their own rows into an org they do not belong to.
--      There is no read leak (SELECT is owner-scoped), but `org_id` was
--      untrustworthy for any org-scoped count, quota or export built on it.
--   2) public.replace_agent_documents(): the attach-set swap, delete + insert,
--      in ONE transaction. PostgREST gives each request its own transaction, so
--      the previous TypeScript delete-then-insert left an agent with ZERO
--      attachments whenever the insert failed (a concurrently deleted document
--      trips the FK; a duplicate id trips the composite PK).
--
-- POLICY + FUNCTION DDL ONLY. No delete/update/truncate/insert is EXECUTED by
-- this migration; not a single row of user data is read or written by it. The
-- `delete`/`insert` inside the function body are that function's runtime
-- behaviour when the owner saves an attach set — they do not run at migration
-- time.

-- ---------------------------------------------------------------------------
-- 1) agent_documents write policies: pin org_id to an org the caller is in.
-- ---------------------------------------------------------------------------
--
-- Deliberately asymmetric, exactly like `user_agents_owner_all`
-- (20260801091231_personal_agents.sql:67-84): `is_org_member` goes on the WRITE
-- side only. `using` stays owner_id-only so an owner can ALWAYS reach their own
-- rows — including a stale one left behind after they leave org_id's org.
-- Losing read/update/delete access to your own personal document because your
-- membership changed would be a worse outcome than a temporarily stale org_id
-- on an already-owner-scoped row.

drop policy if exists agent_documents_owner_insert on public.agent_documents;
create policy agent_documents_owner_insert on public.agent_documents
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and public.is_org_member(org_id)
  );

-- `with check` re-asserts owner_id so an update can never re-parent a row, and
-- now re-asserts org_id for the same reason.
drop policy if exists agent_documents_owner_update on public.agent_documents;
create policy agent_documents_owner_update on public.agent_documents
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and public.is_org_member(org_id)
  );

-- ---------------------------------------------------------------------------
-- 2) replace_agent_documents(): atomic attach-set replacement.
-- ---------------------------------------------------------------------------
--
-- SECURITY INVOKER (the default, stated explicitly because it is the whole
-- point): the caller's RLS still applies to BOTH statements, so this function
-- grants nothing the caller could not already do one statement at a time. It
-- only makes the pair atomic. A DEFINER function here would silently bypass
-- `user_agent_documents_owner_*` and let anyone attach anyone's document to
-- anyone's agent.
--
-- Dedupes on the way in — a repeated id would otherwise trip the composite
-- primary key and, before this function existed, take the whole prior set down
-- with it. First occurrence wins and `position` is renumbered 0..n-1 from the
-- array order, so the injection order the caller asked for is preserved with no
-- gaps. `setAgentDocumentsSchema` dedupes too; this is the backstop, not the
-- first line of defence.
create or replace function public.replace_agent_documents(
  p_user_agent_id uuid,
  p_document_ids  uuid[]
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from public.user_agent_documents
   where user_agent_id = p_user_agent_id;

  if p_document_ids is null or array_length(p_document_ids, 1) is null then
    return;
  end if;

  insert into public.user_agent_documents (user_agent_id, document_id, "position")
  select p_user_agent_id,
         d.document_id,
         (row_number() over (order by d.first_ord))::int - 1
    from (
      select u.id as document_id, min(u.ord) as first_ord
        from unnest(p_document_ids) with ordinality as u(id, ord)
       group by u.id
    ) d;
end;
$$;

comment on function public.replace_agent_documents(uuid, uuid[]) is
  'Atomically replace one user_agent''s reference-document attachment set. '
  'SECURITY INVOKER: the caller''s RLS applies to both the delete and the '
  'insert, so a failed insert rolls the delete back and the prior set survives.';

revoke all on function public.replace_agent_documents(uuid, uuid[]) from public;
grant execute on function public.replace_agent_documents(uuid, uuid[]) to authenticated;
