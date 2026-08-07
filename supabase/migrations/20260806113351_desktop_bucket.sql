-- Public bucket hosting the macOS desktop-shell installer (.dmg).
--
-- Public on purpose, like `avatars`: the installer must be downloadable from
-- the Settings page, and a signed URL would expire and break every stale link
-- and the auto-update feed. The file carries no user data.
--
-- 200MB limit: the arm64 build is ~114MB and the x64 build ~116MB, and a
-- universal build would be larger still. Note the PROJECT-level upload limit
-- caps this independently — a bucket limit above it does not raise it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('desktop', 'desktop', true, 209715200,
        array['application/x-apple-diskimage', 'application/octet-stream'])
on conflict (id) do nothing;

-- Read: public (bucket is public; policy kept explicit for clarity, matching
-- the `avatars` precedent).
create policy desktop_obj_select on storage.objects
  for select to public
  using (bucket_id = 'desktop');

-- Writes are deliberately service-role only: releases are published from the
-- build machine, never from the app. No insert/update/delete policy is granted
-- to `authenticated`, so RLS denies by default and only the service role — which
-- bypasses RLS — can publish a build.
