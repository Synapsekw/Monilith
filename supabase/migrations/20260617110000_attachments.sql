-- Phase 4c (Attachments): item-level file metadata for the Files tab. Bytes live
-- in the private `attachments` Storage bucket; this table is the metadata index.
-- Mirrors Phase-4a item_updates RLS: denormalized org_id/board_id, is_org_member()
-- reads, *_in_org() write guards, (select auth.uid()) idiom. First Storage use in
-- the repo — object policies authorize against org_id = path's leading segment.

-- ── Metadata table ─────────────────────────────────────────────────────────
create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  board_id     uuid not null references public.boards (id) on delete cascade,
  item_id      uuid references public.items (id) on delete cascade,
  update_id    uuid references public.item_updates (id) on delete cascade, -- v1: always null
  uploaded_by  uuid not null references auth.users (id),
  storage_path text not null unique,      -- <org_id>/<board_id>/<item_id>/<uuid>-<name>
  file_name    text not null,             -- sanitized original display name
  mime_type    text not null,
  size_bytes   bigint not null,
  created_at   timestamptz not null default now(),
  check (item_id is not null or update_id is not null),
  check (size_bytes > 0 and size_bytes <= 52428800)
);
create index attachments_item_id_idx on public.attachments (item_id, created_at desc);
create index attachments_org_id_idx  on public.attachments (org_id);
-- update_id index deferred: column is always null in v1; add when comment-threading lands in v2

-- ── Table RLS (mirrors item_updates) ───────────────────────────────────────
alter table public.attachments enable row level security;

-- read: any org member
create policy attachments_select on public.attachments
  for select to authenticated using (public.is_org_member(org_id));

-- insert: member, parent-consistent, self as uploader
create policy attachments_insert on public.attachments
  for insert to authenticated with check (
    public.is_org_member(org_id)
    and public.board_in_org(board_id, org_id)
    and public.item_in_org(item_id, org_id)
    and uploaded_by = (select auth.uid())
  );

-- delete: uploader or org admin/owner
create policy attachments_delete on public.attachments
  for delete to authenticated using (
    public.is_org_member(org_id)
    and (uploaded_by = (select auth.uid())
         or public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  );
-- no update policy — attachment rows are immutable

grant select, insert, delete on public.attachments to authenticated;

-- ── Private bucket ─────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 52428800, null)
on conflict (id) do nothing;

-- ── Storage object RLS (bucket `attachments`; org = path's leading segment) ──
create policy attachments_obj_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'attachments'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy attachments_obj_select on storage.objects
  for select to authenticated using (
    bucket_id = 'attachments'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy attachments_obj_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'attachments'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
    and (owner = (select auth.uid())
         or public.has_org_role(((storage.foldername(name))[1])::uuid, array['owner','admin']::public.org_role[]))
  );

-- ── Realtime ───────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.attachments;
