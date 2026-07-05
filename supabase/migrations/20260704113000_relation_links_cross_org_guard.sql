-- Security hardening (finding #7): stop relation_links from pointing at another
-- org's item. The write policies gate only on the OWNING board
-- (is_org_member(org_id) AND can_edit_board(board_id)) and never check the
-- LINKED item's org, so a raw insert/update could set linked_item_id to a row
-- in a different org (cross-org reference; the linked-item name is RLS-filtered
-- on read, but the link row itself leaks existence + is a cross-tenant FK).
-- Add the item_in_org(linked_item_id, org_id) confinement cell_values-style
-- writes use.
--
-- NOTE: the LATEST relation_links write policies are the split
-- insert/update/delete policies from 20260621130000_lockdown_definer_execution
-- _and_perf.sql (the original "write if can edit board" FOR ALL policy from
-- 20260621060001 was dropped there). Recreate the insert + update policies with
-- the added WITH CHECK conjunct; the delete policy is unchanged and left as-is.
drop policy if exists "relation_links: insert if can edit board" on public.relation_links;
create policy "relation_links: insert if can edit board" on public.relation_links
  for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and public.can_edit_board(board_id)
    and public.item_in_org(linked_item_id, org_id)
  );

drop policy if exists "relation_links: update if can edit board" on public.relation_links;
create policy "relation_links: update if can edit board" on public.relation_links
  for update to authenticated
  using (public.can_edit_board(board_id))
  with check (
    public.is_org_member(org_id)
    and public.can_edit_board(board_id)
    and public.item_in_org(linked_item_id, org_id)
  );

-- set_relation_links (SECURITY DEFINER) derives the target board from the
-- relation column's settings and validates linked ids are on it, but never
-- checks the caller may READ that target board — an editor of the owning board
-- could link to (and thereby confirm existence of) items on a private board
-- they hold no grant on. Require can_read_board(v_target) before linking.
--
-- CREATE OR REPLACE only. Body copied verbatim from 20260621060001_relation
-- _links.sql with exactly the can_read_board(v_target) guard added after the
-- target-board resolution; everything else is unchanged.
create or replace function public.set_relation_links(
  p_item_id uuid,
  p_column_id uuid,
  p_linked_item_ids uuid[]
) returns setof public.relation_links
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := (select auth.uid());
  v_org_id    uuid;
  v_board_id  uuid;
  v_kind      public.column_kind;
  v_settings  jsonb;
  v_target    uuid;
  v_multiple  boolean;
  v_ids       uuid[];
  v_id        uuid;
  v_pos       int := 0;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select org_id, board_id into v_org_id, v_board_id
  from public.items where id = p_item_id;
  if v_org_id is null then raise exception 'Item not found'; end if;
  if not public.can_edit_board(v_board_id) then raise exception 'Not authorized'; end if;

  select kind, settings into v_kind, v_settings from public.columns
  where id = p_column_id and board_id = v_board_id;
  if v_kind is null then raise exception 'Column not found'; end if;
  if v_kind <> 'relation' then raise exception 'Not a relation column'; end if;

  v_target   := (v_settings ->> 'target_board_id')::uuid;
  v_multiple := coalesce((v_settings ->> 'allow_multiple')::boolean, true);
  if v_target is null then raise exception 'Relation column has no target board'; end if;

  -- The caller must be able to READ the target board before linking to its
  -- items (finding #7); can_read_board also enforces same-org membership.
  if not public.can_read_board(v_target) then
    raise exception 'Not authorized to link to the target board' using errcode = '42501';
  end if;

  -- de-dup while preserving first-seen order
  select array_agg(x order by ord) into v_ids
  from (
    select x, min(ord) as ord
    from unnest(p_linked_item_ids) with ordinality as u(x, ord)
    group by x
  ) d;
  v_ids := coalesce(v_ids, '{}'::uuid[]);

  if not v_multiple and array_length(v_ids, 1) > 1 then
    raise exception 'This relation allows only a single linked item';
  end if;

  -- every linked id must be a real item on the target board, and not self
  if exists (
    select 1 from unnest(v_ids) as u(x)
    where u.x = p_item_id
       or not exists (
         select 1 from public.items i
         where i.id = u.x and i.board_id = v_target
       )
  ) then
    raise exception 'Linked item is not on the target board';
  end if;

  delete from public.relation_links
   where item_id = p_item_id and column_id = p_column_id;

  foreach v_id in array v_ids loop
    insert into public.relation_links
      (org_id, board_id, item_id, column_id, linked_item_id, position)
      values (v_org_id, v_board_id, p_item_id, p_column_id, v_id, v_pos);
    v_pos := v_pos + 1;
  end loop;

  return query
    select * from public.relation_links
    where item_id = p_item_id and column_id = p_column_id
    order by position;
end;
$$;

revoke execute on function public.set_relation_links(uuid, uuid, uuid[])
  from public, anon;
grant execute on function public.set_relation_links(uuid, uuid, uuid[]) to authenticated;
