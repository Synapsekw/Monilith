-- 20261115073021_item_facts_better_guesses.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Better DEFAULT guesses in public.item_facts, used only when a board owner
--   has not set Work tracking. Explicit settings behave exactly as before.
--   * Due column: among the board's date columns, a name that looks like a due
--     date (whole word due / deadline / end / finish / target) wins; names that
--     look like a start date (start / begin / kickoff / created) come after
--     the rest; then position, then id as before. A board whose only date
--     column is "Start" still falls back to it.
--   * Done label: (done|complete|cancel) so Cancelled / Canceled count as
--     finished, minus negated forms (Incomplete, Not done, Undone, ...).
--   Same columns, order and types; security_invoker kept; grants restated.
--   The TypeScript twin is src/lib/boards/work-guess.ts (parity-tested).

create or replace view public.item_facts
with (security_invoker = true)
as
select
  i.id          as item_id,
  i.org_id,
  i.board_id,
  i.group_id,
  i.name,
  i.updated_at,
  sc.id         as status_column_id,
  nullif(scv.value ->> 'optionId', '') as status_option_id,
  so.label      as status_label,
  so.color      as status_color,
  coalesce(
    case
      when b.work_status_column_id is not null
       and b.work_done_option_ids is not null
        then (scv.value ->> 'optionId') = any (b.work_done_option_ids)
      -- Guess: says done / complete / cancel(l)ed and is not a negated form
      -- (Incomplete, Not done, Undone, Uncompleted). Twin of looksDoneLabel
      -- in src/lib/boards/work-guess.ts.
      else so.label ~* '(done|complete|cancel)'
       and so.label !~* '\m(not[\s-]*|un[\s-]*|in-?)(done|complete)'
    end,
    false
  )             as is_done,
  dc.id         as due_column_id,
  case
    when left(coalesce(nullif(dcv.value ->> 'end', ''), dcv.value ->> 'date'), 10)
           ~ '^\d{4}-\d{2}-\d{2}$'
     and pg_input_is_valid(
           left(coalesce(nullif(dcv.value ->> 'end', ''), dcv.value ->> 'date'), 10),
           'date')
      then left(coalesce(nullif(dcv.value ->> 'end', ''), dcv.value ->> 'date'), 10)::date
  end           as due_date
from public.items i
join public.boards b
  on b.id = i.board_id and b.archived_at is null
join public.groups g
  on g.id = i.group_id and g.archived_at is null
left join lateral (
  select c.id, c.settings
  from public.columns c
  where c.board_id = b.id
    and c.kind = 'status'
    and (b.work_status_column_id is null or c.id = b.work_status_column_id)
  order by c.position asc, c.id asc
  limit 1
) sc on true
left join lateral (
  select c.id
  from public.columns c
  where c.board_id = b.id
    and c.kind = 'date'
    and (b.work_due_column_id is null or c.id = b.work_due_column_id)
  -- Guess (an explicit column leaves one candidate, so the order is moot):
  -- a due-like name first, start-like names last, then position, then id.
  -- Twin of guessDueColumn in src/lib/boards/work-guess.ts.
  order by
    coalesce(c.name ~* '\m(due|deadline|end|finish|target)\M', false) desc,
    coalesce(c.name ~* '\m(start|begin|kickoff|created)\M', false) asc,
    c.position asc, c.id asc
  limit 1
) dc on true
left join public.cell_values scv
  on scv.item_id = i.id and scv.column_id = sc.id
left join public.cell_values dcv
  on dcv.item_id = i.id and dcv.column_id = dc.id
left join lateral (
  select o ->> 'label' as label, o ->> 'color' as color
  from jsonb_array_elements(
    case when jsonb_typeof(sc.settings -> 'options') = 'array'
         then sc.settings -> 'options' else '[]'::jsonb end
  ) as o
  where o ->> 'id' = scv.value ->> 'optionId'
  limit 1
) so on true
where i.archived_at is null;

revoke all on public.item_facts from public, anon;
grant select on public.item_facts to authenticated, service_role;
