-- verify-folder-copy-forward.sql
--
-- Replays the copy-forward block of
-- supabase/migrations/*_private_folders_copy_forward.sql against a synthetic
-- fixture inside ONE transaction that always ROLLS BACK. Nothing is committed,
-- so it is safe to run against DEV (which holds the live, user-facing data).
--
-- The bare psql-variable line further down (the placeholder) is substituted by
-- the harness (src/lib/folders/copy-forward.integration.test.ts) with the
-- statements between the `-- copy-forward:begin` / `-- copy-forward:end`
-- markers in the migration, so this script can never drift from what actually
-- shipped. That placeholder must stay the file's ONLY occurrence of the token
-- — the harness replaces the first match and asserts there is exactly one.
--
-- The harness passes `-v ON_ERROR_STOP=1`; every assertion raises, so a failed
-- assertion aborts the script with a non-zero exit.

begin;

-- The private tables are still present today (the drop is a later migration),
-- but this script must keep passing AFTER that drop lands. Recreate only the
-- columns the copy-forward reads, and only if they are gone. When the real
-- tables exist this is a no-op and the fixture rows below are subject to their
-- real FKs — which the fixture satisfies.
create table if not exists public.board_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.board_folder_boards (
  user_id uuid not null,
  board_id uuid not null,
  folder_id uuid not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, board_id)
);

-- Fixture identities (rolled back with everything else).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cf-a@example.com', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('a0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cf-b@example.com', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organizations (id, name, slug, created_by) values ('b0000000-0000-4000-8000-000000000001', 'CF Org', 'cf-org-verify', 'a0000000-0000-4000-8000-000000000001');
insert into public.workspaces (id, org_id, name, created_by) values ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'CF WS', 'a0000000-0000-4000-8000-000000000001');
insert into public.boards (id, org_id, workspace_id, name, created_by) values
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Board 1', 'a0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Board 2', 'a0000000-0000-4000-8000-000000000001');

-- User A: "Client Work" holds Board 1 + Board 2. User B: " client work " holds
-- Board 1; B also has "Archive" holding Board 2 (created later than A's).
insert into public.board_folders (id, user_id, name, created_at) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Client Work',   '2026-01-01'),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', ' client work ', '2026-02-01'),
  ('e0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', 'Archive',       '2026-03-01');
insert into public.board_folder_boards (user_id, board_id, folder_id, position) values
  ('a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 0),
  ('a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 1),
  ('a0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 0),
  ('a0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003', 0);

-- A dashboard whose only sourced widget reads Board 1 → lands in "Client Work".
insert into public.dashboards (id, org_id, workspace_id, name, created_by) values
  ('f0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'D1', 'a0000000-0000-4000-8000-000000000001');
insert into public.dashboard_widgets (dashboard_id, org_id, kind, source_board_id) values
  ('f0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'number', 'd0000000-0000-4000-8000-000000000001');

-- The placeholder below is replaced with the migration's marker block.
:copy_forward

do $$
declare
  n_folders int;
  v_name text;
  v_b1 uuid;
  v_b2 uuid;
  v_dash uuid;
begin
  select count(*), min(name) into n_folders, v_name
  from public.folders where workspace_id = 'c0000000-0000-4000-8000-000000000001' and lower(trim(name)) = 'client work';
  if n_folders <> 1 then raise exception 'expected ONE shared "client work" folder, got %', n_folders; end if;
  if v_name <> 'Client Work' then raise exception 'expected first-seen casing "Client Work", got %', v_name; end if;

  select fb.folder_id into v_b1 from public.folder_boards fb where fb.board_id = 'd0000000-0000-4000-8000-000000000001';
  select fb.folder_id into v_b2 from public.folder_boards fb where fb.board_id = 'd0000000-0000-4000-8000-000000000002';
  if v_b1 is null or v_b1 <> (select id from public.folders where workspace_id = 'c0000000-0000-4000-8000-000000000001' and lower(trim(name)) = 'client work') then
    raise exception 'Board 1 should land in Client Work (2 votes)';
  end if;
  -- Board 2: Client Work (A, created 2026-01) vs Archive (B, 2026-03) — one vote each → earliest wins.
  if v_b2 <> v_b1 then raise exception 'Board 2 tie should break to the earliest folder (Client Work)'; end if;

  select folder_id into v_dash from public.dashboards where id = 'f0000000-0000-4000-8000-000000000001';
  if v_dash is distinct from v_b1 then raise exception 'dashboard D1 should be backfilled into Client Work'; end if;
  raise notice 'copy-forward verification passed';
end $$;

-- Same sentence on STDOUT. psql sends `raise notice` to stderr, and the
-- harness only captures stdout — this is the line it asserts on. It is
-- unreachable unless every assertion above passed (ON_ERROR_STOP=1).
select 'copy-forward verification passed' as result;

rollback;
