-- 20260915123539_private_folders_copy_forward.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (spec §3.2, §3.3):
--   1. Copy every private (per-user) sidebar folder forward into ONE shared
--      folder per (workspace, trim(lower(name))). Workspace comes from the
--      boards inside the private folder; a private folder whose boards span
--      workspaces is split per workspace. A private folder with no visible
--      (non-archived) board has NO derivable workspace and is therefore not
--      copied — see "empty private folders" below.
--   2. Place each board in the shared folder whose name held it most often
--      across users; ties break by the earliest private folder created_at.
--   3. Backfill dashboards.folder_id where every sourced widget's board sits
--      in one folder of the dashboard's workspace.
--
--   THIS MIGRATION IS PURELY ADDITIVE. It inserts into public.folders /
--   public.folder_boards and updates dashboards.folder_id only where it is
--   already NULL. It does NOT drop public.board_folders /
--   public.board_folder_boards: the drop is a SEPARATE follow-up migration,
--   run only after the owner has verified the live sidebar against the copied
--   data. Until then the private tables and their RLS stay exactly as they
--   are — orphaned by the application code, but intact and recoverable.
--   (DEV is the live, user-facing database; see AGENTS.md.)
--
--   Idempotent: every write is `on conflict do nothing` / `where folder_id is
--   null`, so a re-run is a no-op.
--
--   Accepted trap (spec §3.2): a folder one user made for themselves becomes
--   visible to the whole workspace. The owner accepted this.
--
--   Empty private folders: a private folder is user-global and carries no
--   workspace of its own (20260826102555_sidebar_board_folders.sql), so an
--   empty one has no workspace to be copied INTO. Inventing one would create a
--   folder in a workspace the user never associated it with, so such folders
--   are skipped. At the time of writing DEV holds 0 of them, so nothing is
--   lost; the private rows survive this migration either way and can be
--   revisited before the follow-up drop.
--
--   The statements between the copy-forward markers are what
--   scripts/sql/verify-folder-copy-forward.sql replays inside a rolled-back
--   transaction — keep the markers.

-- copy-forward:begin
with p as (
  select bfb.board_id,
         bfb.folder_id,
         bfb.position,
         bf.name,
         bf.user_id,
         bf.created_at as folder_created,
         b.workspace_id,
         b.org_id
  from public.board_folder_boards bfb
  join public.board_folders bf on bf.id = bfb.folder_id
  join public.boards b on b.id = bfb.board_id and b.archived_at is null
),
k as (
  select p.org_id,
         p.workspace_id,
         lower(trim(p.name)) as key,
         min(p.folder_created) as first_created,
         (array_agg(trim(p.name) order by p.folder_created asc, p.folder_id asc))[1] as display_name,
         (array_agg(p.user_id   order by p.folder_created asc, p.folder_id asc))[1] as first_user
  from p
  group by p.org_id, p.workspace_id, lower(trim(p.name))
)
insert into public.folders (org_id, workspace_id, name, position, created_by, created_at)
select k.org_id,
       k.workspace_id,
       k.display_name,
       -- Append AFTER any folder the workspace already holds. `folders` is
       -- empty on DEV today, but a bare row_number() would hand a copied
       -- folder the same position as a hand-made one if that ever changed.
       (coalesce((select max(f2.position)
                    from public.folders f2
                   where f2.workspace_id = k.workspace_id), -1)
        + row_number() over (partition by k.workspace_id
                                 order by k.first_created asc, k.display_name asc))::int,
       k.first_user,
       k.first_created
from k
on conflict (workspace_id, lower(trim(name))) do nothing;

with p as (
  select bfb.board_id,
         bfb.position,
         bf.name,
         bf.created_at as folder_created,
         b.workspace_id
  from public.board_folder_boards bfb
  join public.board_folders bf on bf.id = bfb.folder_id
  join public.boards b on b.id = bfb.board_id and b.archived_at is null
),
v as (
  select p.board_id,
         p.workspace_id,
         lower(trim(p.name)) as key,
         count(*) as votes,
         min(p.folder_created) as first_created,
         min(p.position) as position
  from p
  group by p.board_id, p.workspace_id, lower(trim(p.name))
),
w as (
  select distinct on (v.board_id) v.board_id, v.workspace_id, v.key, v.position
  from v
  order by v.board_id, v.votes desc, v.first_created asc
)
insert into public.folder_boards (folder_id, board_id, position)
select fo.id, w.board_id, w.position
from w
join public.folders fo
  on fo.workspace_id = w.workspace_id
 and lower(trim(fo.name)) = w.key
on conflict (board_id) do nothing;

update public.dashboards d
set folder_id = x.folder_id
from (
  -- `min(uuid)` does not exist in Postgres. The `having` below already proves
  -- the group holds exactly ONE distinct folder_id, so taking the first
  -- element of the aggregate is that one value, not an arbitrary pick.
  select dw.dashboard_id, (array_agg(distinct fb.folder_id))[1] as folder_id
  from public.dashboard_widgets dw
  join public.folder_boards fb on fb.board_id = dw.source_board_id
  group by dw.dashboard_id
  having count(distinct fb.folder_id) = 1
     and count(*) = (
       select count(*) from public.dashboard_widgets dw2
       where dw2.dashboard_id = dw.dashboard_id and dw2.source_board_id is not null
     )
) x
where d.id = x.dashboard_id
  and d.folder_id is null
  and exists (
    select 1 from public.folders fo
    where fo.id = x.folder_id and fo.workspace_id = d.workspace_id
  );
-- copy-forward:end

-- NO drop here. public.board_folders and public.board_folder_boards are left
-- in place on purpose (see the header): the drop ships as a separate migration
-- once the live sidebar has been verified against the copied data.
