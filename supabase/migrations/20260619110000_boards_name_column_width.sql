-- Per-board width for the built-in Name column. NULL = auto-fit (the client
-- measures the longest item name); an integer is a user-dragged width. Bounds
-- mirror the configurable-column resize handle (ColumnHeader MIN/MAX = 80/1200).
alter table public.boards
  add column name_column_width int
  check (name_column_width is null or name_column_width between 80 and 1200);
