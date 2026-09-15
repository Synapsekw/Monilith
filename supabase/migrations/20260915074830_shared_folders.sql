-- 20260915074830_shared_folders.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Shared workspace folders (spec §3.1): every folder is a project that a
--   command center attaches to. Replaces the private per-user board_folders
--   layer, which is copied forward and dropped in a LATER migration
--   (<version>_private_folders_copy_forward.sql) so the private-folder code
--   keeps type-checking until the sidebar switches over.
--
--   "Workspace member" == org member: workspaces carry no membership table of
--   their own (20260614174043_init_auth_tenancy.sql:246-261), so writes gate on
--   is_org_member(org_id) and the workspace belonging to that org.

create table public.folders (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (char_length(trim(name)) between 1 and 60),
  position     integer not null default 0,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index folders_workspace_position_idx on public.folders (workspace_id, position);
create index folders_org_id_idx on public.folders (org_id);
create index folders_created_by_idx on public.folders (created_by);
-- One folder per name per workspace. Makes the copy-forward idempotent and the
-- gallery stable; createFolder maps 23505 to a friendly message.
create unique index folders_workspace_name_key
  on public.folders (workspace_id, lower(trim(name)));

create trigger folders_set_updated_at
  before update on public.folders
  for each row execute function public.set_updated_at();

create table public.folder_boards (
  folder_id  uuid not null references public.folders(id) on delete cascade,
  board_id   uuid not null references public.boards(id) on delete cascade,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (board_id)                 -- a board sits in at most one folder
);

create index folder_boards_folder_position_idx on public.folder_boards (folder_id, position);

-- May this caller put this board in this folder? Org member of the folder's org,
-- the board lives in the folder's workspace (no cross-workspace folders, spec
-- §11), and the caller can read the board (no existence oracle, same reasoning
-- as 20260826102555_sidebar_board_folders.sql:68-70).
create or replace function public.folder_accepts_board(p_folder_id uuid, p_board_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.folders f
    join public.boards b on b.id = p_board_id
    where f.id = p_folder_id
      and public.is_org_member(f.org_id)
      and b.workspace_id = f.workspace_id
      and public.can_read_board(b.id)
  );
$$;

revoke execute on function public.folder_accepts_board(uuid, uuid) from public, anon;
grant execute on function public.folder_accepts_board(uuid, uuid) to authenticated;

alter table public.folders       enable row level security;
alter table public.folder_boards enable row level security;

-- folders: org-visible; org members write; the workspace must be the org's.
create policy "folders: read if member" on public.folders
  for select to authenticated
  using (org_id in (select public.auth_user_orgs()));

create policy "folders: insert if member" on public.folders
  for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.workspaces w
      where w.id = folders.workspace_id and w.org_id = folders.org_id
    )
  );

create policy "folders: update if member" on public.folders
  for update to authenticated
  using (public.is_org_member(org_id))
  with check (
    public.is_org_member(org_id)
    and exists (
      select 1 from public.workspaces w
      where w.id = folders.workspace_id and w.org_id = folders.org_id
    )
  );

create policy "folders: delete if member" on public.folders
  for delete to authenticated
  using (public.is_org_member(org_id));

-- folder_boards: visible with the folder; writes go through folder_accepts_board.
create policy "folder_boards: read if member" on public.folder_boards
  for select to authenticated
  using (exists (
    select 1 from public.folders f
    where f.id = folder_boards.folder_id
      and f.org_id in (select public.auth_user_orgs())
  ));

create policy "folder_boards: insert if member" on public.folder_boards
  for insert to authenticated
  with check (public.folder_accepts_board(folder_id, board_id));

create policy "folder_boards: update if member" on public.folder_boards
  for update to authenticated
  using (exists (
    select 1 from public.folders f
    where f.id = folder_boards.folder_id and public.is_org_member(f.org_id)
  ))
  with check (public.folder_accepts_board(folder_id, board_id));

create policy "folder_boards: delete if member" on public.folder_boards
  for delete to authenticated
  using (exists (
    select 1 from public.folders f
    where f.id = folder_boards.folder_id and public.is_org_member(f.org_id)
  ));

grant select, insert, update, delete on public.folders, public.folder_boards to authenticated;

-- Dashboards fold into a folder (spec §3.3). Backfilled by the copy-forward migration.
alter table public.dashboards
  add column folder_id uuid references public.folders(id) on delete set null;
create index dashboards_folder_idx on public.dashboards (folder_id);

-- Ask can be scoped to a folder (spec §5.1), mirroring ai_conversations.board_id.
alter table public.ai_conversations
  add column folder_id uuid references public.folders(id) on delete set null;
create index ai_conversations_folder_idx on public.ai_conversations (folder_id);
