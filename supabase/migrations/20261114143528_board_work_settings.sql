-- Per-board work settings (spec 4.2). All nullable: null means "guess live"
-- (first status column, first date column, label ~ done|complete), resolved
-- in the item_facts view. No backfill.
alter table public.boards
  add column work_status_column_id uuid
    references public.columns (id) on delete set null,
  add column work_done_option_ids text[],
  add column work_due_column_id uuid
    references public.columns (id) on delete set null;

comment on column public.boards.work_status_column_id is
  'Status column that defines done for this board. Null = first status column by position.';
comment on column public.boards.work_done_option_ids is
  'Option ids of work_status_column_id that mean done. Null = label matches (done|complete).';
comment on column public.boards.work_due_column_id is
  'Date column that holds the due date. Null = first date column by position.';
