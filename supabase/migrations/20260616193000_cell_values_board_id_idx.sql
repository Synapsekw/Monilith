-- cell_values is read in bulk filtered by board_id (getBoardPayload), but only
-- org_id and column_id were indexed. Add the board_id index for the hot path.
create index if not exists cell_values_board_id_idx
  on public.cell_values (board_id);
