-- 20260924115449_folder_layouts.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- Per-folder command center layout (spec 1 of 3).
-- An ABSENT row means the `project` preset, i.e. today's layout. There is no
-- backfill: every existing folder keeps rendering exactly as it does now.
create table public.folder_layouts (
  folder_id  uuid primary key references public.folders(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  preset     text not null default 'project'
               check (preset in ('project', 'crm', 'support', 'blank')),
  config     jsonb not null,
  version    integer not null default 1 check (version > 0),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Bounds the hot-path read. The Zod schema enforces the same ceiling; this
  -- is the backstop for anything that reaches the table another way.
  constraint folder_layouts_config_size check (pg_column_size(config) <= 32768)
);

create index folder_layouts_org_id_idx on public.folder_layouts (org_id);

create trigger folder_layouts_set_updated_at
  before update on public.folder_layouts
  for each row execute function public.set_updated_at();

alter table public.folder_layouts enable row level security;

-- Mirrors public.folders: org-visible, org members write, and the folder the
-- row points at must belong to the same org as the row claims.
create policy "folder_layouts: read if member" on public.folder_layouts
  for select to authenticated
  using (org_id in (select public.auth_user_orgs()));

create policy "folder_layouts: insert if member" on public.folder_layouts
  for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and exists (
      select 1 from public.folders f
      where f.id = folder_layouts.folder_id and f.org_id = folder_layouts.org_id
    )
  );

create policy "folder_layouts: update if member" on public.folder_layouts
  for update to authenticated
  using (public.is_org_member(org_id))
  with check (
    public.is_org_member(org_id)
    and exists (
      select 1 from public.folders f
      where f.id = folder_layouts.folder_id and f.org_id = folder_layouts.org_id
    )
  );

create policy "folder_layouts: delete if member" on public.folder_layouts
  for delete to authenticated
  using (public.is_org_member(org_id));

grant select, insert, update, delete on public.folder_layouts to authenticated;
