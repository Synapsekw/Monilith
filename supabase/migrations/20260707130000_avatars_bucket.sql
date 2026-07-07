-- Avatar upload: public `avatars` bucket + owner-only-write storage RLS.
-- `profiles.avatar_url` already exists; this migration adds only the bucket and
-- its storage.objects policies. Public-read is deliberate (spec §2.1): avatar_url
-- is a stored string rendered directly by <Image> across the CACHED org-member
-- roster, so a private bucket + per-render signed URLs is infeasible. Object key:
-- `{user_id}/{uuid}.{ext}` — the leading segment = auth.uid() authorizes writes
-- (mirrors the attachments bucket authorizing on the leading org_id segment).
-- Spec: docs/superpowers/specs/2026-07-06-avatar-upload-design.md

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- read: public (bucket is public; policy kept explicit for clarity)
create policy avatars_obj_select on storage.objects
  for select using (bucket_id = 'avatars');

-- insert: only under the caller's own `{auth.uid()}/` prefix. A malformed key
-- with no [1] segment → NULL::uuid = uid → NULL → deny (safe, no fallback).
create policy avatars_obj_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = (select auth.uid()));

-- update: same owner guard (upsert path)
create policy avatars_obj_update on storage.objects
  for update to authenticated using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = (select auth.uid()));

-- delete: same owner guard (replace/remove cleanup)
create policy avatars_obj_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = (select auth.uid()));
