-- (a) Column-scope attachments for the Files column kind. Item-panel
-- attachments (Phase 4c) keep column_id NULL; Files-cell attachments set both
-- item_id and column_id.
alter table public.attachments
  add column column_id uuid references public.columns (id) on delete cascade;

create index attachments_item_column_idx
  on public.attachments (item_id, column_id)
  where column_id is not null;

-- (b) Atomic option delete: remove an option from a status/dropdown column's
-- settings AND clear every cell that referenced it, returning the cleared count.
-- SECURITY DEFINER + org-member guard; pinned search_path.
create or replace function public.delete_column_option(
  p_column_id uuid,
  p_option_id text
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_org_id uuid;
  v_kind   public.column_kind;
  v_count  integer := 0;
begin
  select org_id, kind into v_org_id, v_kind
  from public.columns where id = p_column_id;
  if v_org_id is null then
    raise exception 'Column not found';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'Not authorized';
  end if;

  if v_kind = 'status' then
    -- count, then delete referencing cells (clearing = remove the row,
    -- matching clearCell semantics).
    select count(*) into v_count
    from public.cell_values
    where column_id = p_column_id and value->>'optionId' = p_option_id;

    delete from public.cell_values
    where column_id = p_column_id and value->>'optionId' = p_option_id;

  elsif v_kind = 'dropdown' then
    select count(*) into v_count
    from public.cell_values
    where column_id = p_column_id and value->'optionIds' ? p_option_id;

    -- strip the id from each array
    update public.cell_values
    set value = jsonb_set(
      value, '{optionIds}',
      coalesce((
        select jsonb_agg(e)
        from jsonb_array_elements_text(value->'optionIds') e
        where e <> p_option_id
      ), '[]'::jsonb)
    )
    where column_id = p_column_id and value->'optionIds' ? p_option_id;

    -- drop now-empty cells
    delete from public.cell_values
    where column_id = p_column_id and value->'optionIds' = '[]'::jsonb;

  else
    raise exception 'Column kind % has no options', v_kind;
  end if;

  -- remove the option from settings.options
  update public.columns
  set settings = jsonb_set(
    settings, '{options}',
    coalesce((
      select jsonb_agg(o)
      from jsonb_array_elements(settings->'options') o
      where o->>'id' <> p_option_id
    ), '[]'::jsonb)
  )
  where id = p_column_id;

  return v_count;
end;
$$;

revoke all on function public.delete_column_option(uuid, text) from public;
grant execute on function public.delete_column_option(uuid, text) to authenticated;
