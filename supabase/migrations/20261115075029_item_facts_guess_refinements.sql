-- 20261115075029_item_facts_guess_refinements.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Refines the item_facts DEFAULT guesses (used only without explicit Work
--   tracking; explicit settings behave exactly as before):
--   * word boundaries are any non-letter, so "due_date" / "end_date" match;
--   * baseline-like names (original / baseline / planned / initial /
--     previous / old) lose to the live due date, so "Due" beats
--     "Original due" whatever the column order; a lone "Original due" still
--     falls back to itself;
--   * "In complete" (with a space) reads as not done.
--   Same columns, order and types; security_invoker kept; grants restated.
--   Also refreshes the two stale column comments on public.boards.
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
      -- (Incomplete, In complete, Not done, Undone, Uncompleted); any
      -- non-letter counts as a word boundary. Twin of looksDoneLabel in
      -- src/lib/boards/work-guess.ts.
      else so.label ~* '(done|complete|cancel)'
       and so.label !~* '(^|[^[:alpha:]])(not[\s-]*|un[\s-]*|in[\s-]*)(done|complete)'
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
  -- Guess (an explicit column leaves one candidate, so the order is moot).
  -- Keys: (1) due-like and not baseline-like first; (2) start-like last;
  -- (3) baseline-like after the rest; (4) position, then id. Tiers: live due
  -- names ("Due", "due_date"), neutral names, baseline names ("Original
  -- due"), start names. Any non-letter is a word boundary, so "Calendar" and
  -- "Weekend" are not due-like. Twin of guessDueColumn in
  -- src/lib/boards/work-guess.ts.
  order by
    coalesce(c.name ~* '(^|[^[:alpha:]])(due|deadline|end|finish|target)([^[:alpha:]]|$)' and c.name !~* '(^|[^[:alpha:]])(original|baseline|planned|initial|previous|old)([^[:alpha:]]|$)', false) desc,
    coalesce(c.name ~* '(^|[^[:alpha:]])(start|begin|kickoff|created)([^[:alpha:]]|$)', false) asc,
    coalesce(c.name ~* '(^|[^[:alpha:]])(original|baseline|planned|initial|previous|old)([^[:alpha:]]|$)', false) asc,
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

comment on column public.boards.work_done_option_ids is
  'Option ids of work_status_column_id that mean done; applies only while work_status_column_id is set. Null = label guess: matches (done|complete|cancel) and is not a negated form (incomplete, in complete, not done, undone, uncompleted). See src/lib/boards/work-guess.ts.';
comment on column public.boards.work_due_column_id is
  'Date column that holds the due date. Null = guess: due-like names (due, deadline, end, finish, target) that are not baseline-like (original, baseline, planned, initial, previous, old) first, start-like names (start, begin, kickoff, created) last, baseline-like after the rest, then position, then id. See src/lib/boards/work-guess.ts.';
