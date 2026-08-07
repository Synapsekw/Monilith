-- Let the `desktop` bucket hold an electron-updater feed, not just the installer.
--
-- The bucket was created for exactly one artifact type — the .dmg a human
-- downloads from Settings — so `allowed_mime_types` listed exactly that. The
-- auto-update feed needs two more file types alongside it, and Storage enforces
-- this array on upload: anything else is rejected with a 415 at publish time,
-- which is a confusing place to discover a bucket policy.
--
--   application/zip  — the update payload. NOT the .dmg: electron-updater's
--                      MacUpdater does `findFile(files, "zip", ["pkg", "dmg"])`,
--                      which looks for a zip and EXPLICITLY EXCLUDES dmg,
--                      because Squirrel.Mac installs from a zip. A dmg-only
--                      feed parses fine and then yields nothing installable.
--   application/yaml — `latest-mac.yml`, the feed index itself. RFC 9512
--   text/yaml          registers `application/yaml`; `text/yaml` is the older
--                      spelling still emitted by plenty of tooling. Both are
--                      allowed so the publish script can't fail on a spelling.
--
-- The .blockmap files (used for differential downloads) need no entry: they are
-- uploaded as application/octet-stream, which is already allowed.
--
-- Read stays public and writes stay service-role-only — unchanged from
-- 20260806113351_desktop_bucket.sql. Releases are still published from the
-- build machine, never from the app.
update storage.buckets
set allowed_mime_types = array[
      'application/x-apple-diskimage',
      'application/octet-stream',
      'application/zip',
      'application/yaml',
      'text/yaml'
    ]
where id = 'desktop';
