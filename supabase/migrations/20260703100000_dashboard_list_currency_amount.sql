-- Currency columns in dashboard List-widget filters: the numeric operators
-- (num_eq/num_ne/gt/lt) previously read only cv.value->>'n' (numbers cells).
-- Currency cells store { amount } (spec: currency column), so the numeric
-- predicates now coalesce 'n' with 'amount' — the same "read the kind's
-- numeric key" pattern as numericValues in src/lib/boards/aggregation.ts.
-- Safe kind-agnostically: a cell value carries exactly one of the two keys
-- (numbers → n, currency → amount), so coalesce never mixes semantics.
-- Everything else is byte-identical to 20260618120000_dashboard_list_rows.sql.

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
    when 'num_eq'    then e_open || format('coalesce(cv.value->>''n'', cv.value->>''amount'')::numeric = %L::numeric)', p_val)
    when 'num_ne'    then e_open || format('coalesce(cv.value->>''n'', cv.value->>''amount'')::numeric <> %L::numeric)', p_val)
    when 'gt'        then e_open || format('coalesce(cv.value->>''n'', cv.value->>''amount'')::numeric > %L::numeric)', p_val)
    when 'lt'        then e_open || format('coalesce(cv.value->>''n'', cv.value->>''amount'')::numeric < %L::numeric)', p_val)
    when 'before'    then e_open || format('(cv.value->>''date'')::date < %L::date)', p_val)
    when 'after'     then e_open || format('(cv.value->>''date'')::date > %L::date)', p_val)
    when 'on'        then e_open || format('(cv.value->>''date'')::date = %L::date)', p_val)
    when 'not_empty' then e_open || 'cv.value is not null)'
    when 'is_empty'  then n_open || 'cv.value is not null)'
    else null
  end;
end; $$;
