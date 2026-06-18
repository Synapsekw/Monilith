-- D3b: bounded, indexed, membership-checked row fetch for the List widget.
-- Translates a flat filter {combinator, conditions[]} into per-condition
-- EXISTS(cell_values) predicates joined by AND/OR, applies LIMIT *after*
-- filtering. Predicate construction is isolated in a helper; all condition
-- values are bound via format(%L) (injection-safe). Numeric/date values are
-- regex-guarded so a malformed value yields no match (not a widget error).

-- Helper: build one EXISTS/NOT EXISTS predicate string for a condition.
-- `i` is the items alias in the caller's dynamic query.
create or replace function public._dashboard_list_predicate(
  p_col uuid,
  p_op  text,
  p_val text
) returns text
language plpgsql
immutable
set search_path = '' as $$
declare
  e_open text := format(
    'exists (select 1 from public.cell_values cv '
    || 'where cv.item_id = i.id and cv.column_id = %L and ', p_col);
  n_open text := format(
    'not exists (select 1 from public.cell_values cv '
    || 'where cv.item_id = i.id and cv.column_id = %L and ', p_col);
begin
  -- guard numeric/date casts: bad value → always-false predicate
  if p_op in ('num_eq', 'num_ne', 'gt', 'lt')
     and (p_val is null or p_val !~ '^\s*-?\d+(\.\d+)?\s*$') then
    return 'false';
  end if;
  if p_op in ('before', 'after', 'on')
     and (p_val is null or p_val !~ '^\d{4}-\d{2}-\d{2}') then
    return 'false';
  end if;
  if p_op in ('is', 'is_not', 'contains', 'eq') and p_val is null then
    return 'false';
  end if;

  return case p_op
    when 'is'        then e_open || format('cv.value->>''optionId'' = %L)', p_val)
    when 'is_not'    then e_open || format('cv.value->>''optionId'' is distinct from %L)', p_val)
    when 'contains'  then e_open || format('cv.value->>''text'' ilike %L)', '%' || p_val || '%')
    when 'eq'        then e_open || format('cv.value->>''text'' = %L)', p_val)
    when 'num_eq'    then e_open || format('(cv.value->>''n'')::numeric = %L::numeric)', p_val)
    when 'num_ne'    then e_open || format('(cv.value->>''n'')::numeric <> %L::numeric)', p_val)
    when 'gt'        then e_open || format('(cv.value->>''n'')::numeric > %L::numeric)', p_val)
    when 'lt'        then e_open || format('(cv.value->>''n'')::numeric < %L::numeric)', p_val)
    when 'before'    then e_open || format('(cv.value->>''date'')::date < %L::date)', p_val)
    when 'after'     then e_open || format('(cv.value->>''date'')::date > %L::date)', p_val)
    when 'on'        then e_open || format('(cv.value->>''date'')::date = %L::date)', p_val)
    when 'not_empty' then e_open || 'cv.value is not null)'
    when 'is_empty'  then n_open || 'cv.value is not null)'
    else null
  end;
end; $$;

create or replace function public.dashboard_list_rows(
  p_board_id uuid,
  p_filter   jsonb default '{}'::jsonb,
  p_limit    int   default 25
) returns table (item_id uuid, name text, created_at timestamptz)
language plpgsql
security definer
set search_path = '' as $$
declare
  v_org_id     uuid;
  v_combinator text;
  v_cond       jsonb;
  v_pred       text;
  v_preds      text[] := '{}';
  v_where      text;
  v_limit      int := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  select org_id into v_org_id from public.boards where id = p_board_id;
  if v_org_id is null then
    raise exception 'board not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  v_combinator := lower(coalesce(p_filter->>'combinator', 'and'));
  if v_combinator not in ('and', 'or') then
    v_combinator := 'and';
  end if;

  for v_cond in
    select value
    from jsonb_array_elements(coalesce(p_filter->'conditions', '[]'::jsonb))
  loop
    v_pred := public._dashboard_list_predicate(
      (v_cond->>'columnId')::uuid,
      v_cond->>'operator',
      v_cond->>'value'
    );
    if v_pred is not null then
      v_preds := array_append(v_preds, v_pred);
    end if;
  end loop;

  if array_length(v_preds, 1) is null then
    v_where := 'true';
  else
    v_where := array_to_string(v_preds, ' ' || v_combinator || ' ');
  end if;

  return query execute format(
    'select i.id, i.name, i.created_at from public.items i '
    || 'where i.board_id = %L and (%s) '
    || 'order by i.created_at desc limit %L',
    p_board_id, v_where, v_limit
  );
end; $$;

grant execute on function public.dashboard_list_rows(uuid, jsonb, int) to authenticated;
