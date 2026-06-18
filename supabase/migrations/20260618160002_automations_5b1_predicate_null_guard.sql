-- Corrective migration: defense-in-depth null-value guard for
-- _automation_condition_predicate, mirroring _dashboard_list_predicate (D3b).
-- The original function (20260618160001) omitted this guard: a null p_val with
-- 'contains' would build `ilike '%%'` (matches any non-null cell) instead of
-- returning 'false'. Unreachable from the current UI but a latent trap.
create or replace function public._automation_condition_predicate(
  p_col uuid, p_op text, p_val text, p_item_id uuid
) returns text
language plpgsql immutable set search_path = '' as $$
declare
  e_open text := format(
    'exists(select 1 from public.cell_values cv where cv.item_id = %L and cv.column_id = %L and ',
    p_item_id, p_col
  );
  n_open text := format(
    'not exists(select 1 from public.cell_values cv where cv.item_id = %L and cv.column_id = %L and ',
    p_item_id, p_col
  );
begin
  -- malformed numeric/date values yield a guaranteed-false predicate
  if p_op in ('num_eq','num_ne','gt','lt')
     and (p_val is null or p_val !~ '^-?[0-9]+(\.[0-9]+)?$') then
    return 'false';
  end if;
  if p_op in ('before','after','on')
     and (p_val is null or p_val !~ '^\d{4}-\d{2}-\d{2}$') then
    return 'false';
  end if;

  -- null p_val on value-matching operators must not produce a spurious match
  -- (e.g. contains with null would build `ilike '%%'`, matching every row).
  -- Return 'false' immediately, mirroring _dashboard_list_predicate (D3b).
  if p_op in ('is','is_not','contains','eq') and p_val is null then
    return 'false';
  end if;

  return case p_op
    when 'is'        then e_open || format('cv.value->>''optionId'' = %L)', p_val)
    when 'is_not'    then e_open || format('cv.value->>''optionId'' is distinct from %L)', p_val)
    when 'contains'  then e_open || format('cv.value->>''text'' ilike %L)', '%' || coalesce(p_val,'') || '%')
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
    else 'false'
  end;
end; $$;
