-- 20260826102555_sidebar_board_folders.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Sidebar board folders: a private, per-user grouping layer over the Boards nav.

-- Sidebar board folders: a private, per-user grouping layer over the Boards nav.
--
-- Placement is keyed (user_id, board_id), NOT boards.folder_id, because a board
-- shared with me is owned by someone else — a column on `boards` would move it in
-- the OWNER's sidebar too. That primary key is also what enforces "a board is in
-- at most one folder" structurally, so no application code has to.
--
-- Folders are deliberately user-global (no workspace_id): a single folder must be
-- able to hold a board shared with me (not workspace-filtered) alongside my own
-- (which are). A folder with nothing visible is hidden in the UI, not stored
-- differently.

create table public.board_folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 60),
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index board_folders_user_position_idx
  on public.board_folders (user_id, position);

create trigger board_folders_set_updated_at
  before update on public.board_folders
  for each row execute function public.set_updated_at();

create table public.board_folder_boards (
  user_id    uuid not null references auth.users(id) on delete cascade,
  board_id   uuid not null references public.boards(id) on delete cascade,
  folder_id  uuid not null references public.board_folders(id) on delete cascade,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, board_id)
);

-- Covers the hot read (my placements, grouped by folder) and doubles as the FK
-- covering index the Supabase advisor asks for.
create index board_folder_boards_folder_position_idx
  on public.board_folder_boards (folder_id, position);

alter table public.board_folders       enable row level security;
alter table public.board_folder_boards enable row level security;

-- board_folders: yours or it does not exist.
create policy "board_folders: read own" on public.board_folders
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "board_folders: insert own" on public.board_folders
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "board_folders: update own" on public.board_folders
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "board_folders: delete own" on public.board_folders
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- board_folder_boards: same identity gate, plus you may only file a board you can
-- actually read. Without the can_read_board() check a user could file a board id
-- they cannot see — invisible on read, but an unnecessary existence oracle.
create policy "board_folder_boards: read own" on public.board_folder_boards
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "board_folder_boards: insert own" on public.board_folder_boards
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.can_read_board(board_id)
  );
create policy "board_folder_boards: update own" on public.board_folder_boards
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.can_read_board(board_id)
  );
create policy "board_folder_boards: delete own" on public.board_folder_boards
  for delete to authenticated
  using (user_id = (select auth.uid()));
