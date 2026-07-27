---
type: spec
status: draft
date: 2026-07-06
topic: avatar-upload
tags: [project/pulse, spec, storage, profile]
related:
  - "[[00-north-star]]"
  - "docs/superpowers/specs/2026-06-16-phase-4-collaboration-design.md"
---

# Avatar upload — design spec

> Migration-gated deferral from the north-star §3 "Owed" queue. `profiles.avatar_url`
> already exists and is already rendered everywhere; this spec adds the **bucket + upload
> path** that lets a user actually set one.

## 1. Problem & intent

Every avatar surface in Monolith already reads `profiles.avatar_url` and renders it, falling
back to initials when it is `null`:

- `listOrgMembersCached` (`src/lib/org/queries-cached.ts`) selects `avatar_url` → `OrgMember.avatarUrl`.
- `CreatedByCell` (`src/components/boards/cells/created.tsx`) and `PresenceAvatarStack`
  render `<Image src={avatarUrl} unoptimized>` in a circular, `object-cover` chip.
- `next.config.ts` **already** allowlists `https://*.supabase.co/storage/v1/object/public/**`
  for `next/image`, with a comment naming it the "Supabase Storage **public** avatar host".

The only missing pieces are (a) a storage bucket to hold the bytes, (b) its RLS, and (c) a
UI + Server Action for a user to upload/replace/remove **their own** avatar. `avatar_url` is
today always `null` in practice — no code path ever writes it.

**Goal:** let a signed-in user set, replace, and remove their own profile picture from
Settings → Profile. Every existing consumer picks it up automatically (roster, board cells,
presence, dashboards, panels) with no per-surface work.

**Non-goals (v1, YAGNI):**

- No interactive crop UI (drag/zoom/rotate). See §5 — we auto-normalize to a square instead.
- No org-admin management of _other_ people's avatars. Own-profile only.
- No animated GIF avatars (normalization flattens to a static frame; we reject GIF outright).
- No Gravatar / OAuth-provider avatar import.
- No default/generated avatar art — the existing **initials** fallback is the default and is
  untouched.

## 2. Key decisions

### 2.1 Public bucket (decided)

The bucket is **public-read**. Rationale — this is forced by the existing architecture, not a
fresh preference:

- `avatar_url` is a **stored string** rendered directly by `<Image src>` across many surfaces,
  including the **cached** org-member roster (`listOrgMembersCached`, `"use cache"`). A private
  bucket would require minting a short-lived **signed URL per render of every avatar** — impossible
  to store in a cached roster column and re-sign on the hot path. Public `getPublicUrl()` yields a
  **stable, cacheable URL** that lives happily in the column and the RSC cache.
- `next.config.ts` already commits to the public host (`/storage/v1/object/public/**`).

**Contrast with `attachments`** (private bucket + signed URLs): board files are tenant-sensitive
documents; avatars are low-sensitivity profile images that appear to every teammate anyway.

**Tradeoff, accepted & documented:** bucket objects are readable by anyone holding the URL. We
mitigate by (a) unguessable UUID object keys, (b) keys containing **no PII** (just `{user_id}/{uuid}.ext`),
(c) the bucket allowing only image MIME types under a hard size cap. This matches how essentially
every SaaS serves avatars and is the same posture `next.config.ts` already anticipated.

### 2.2 Path convention & ownership

Object key: **`{user_id}/{uuid}.{ext}`** — the **leading segment is `auth.uid()`**, which is what
Storage RLS authorizes writes against (mirrors how `attachments` authorizes on the leading `org_id`
segment). `ext` ∈ `png | jpg | webp` derived from the normalized output MIME.

- **Read:** public (anyone) — the bucket is public.
- **Insert / Update / Delete:** only the owner, i.e. `((storage.foldername(name))[1])::uuid = auth.uid()`.
  A user can only ever write under their own `{user_id}/` prefix. No org-admin bypass.

### 2.3 One-object-per-user via fresh UUID + old-object cleanup

Each upload writes a **new** `{uuid}.ext` object (immutable URL → **no CDN/browser cache staleness**,
unlike overwriting a stable key). The Server Action then **best-effort deletes the previous object**
(derived from the old `avatar_url`) so a user's prefix holds at most one live object. Remove = delete
the object + set `avatar_url = null` (surfaces fall back to initials).

### 2.4 Cache invalidation (read-your-own-writes)

The `avatar_url` write must expire **two** cache families (the roster comment in
`queries-cached.ts` explicitly calls this out — _"any future full_name/avatar edit action MUST
`updateTag(orgMembersTag(orgId))` for each of the user's orgs"_):

1. `profileTag(user.id)` — the user's own cached profile (header/settings).
2. `orgMembersTag(orgId)` for **each** org the user belongs to — the cached roster that renders the
   avatar in board cells / pickers / workload.

We also mirror `avatar_url` into **auth `user_metadata.avatar_url`** (same as `updateProfileFullName`
mirrors `full_name`), so any surface reading `raw_user_meta_data` (account menu, `get_org_members`
RPC) stays consistent.

## 3. Approaches considered

**A. Client-direct upload + register Server Action (chosen).** The browser uploads the (normalized,
small) blob straight to Storage via `supabase.storage.from("avatars").upload(...)` — authorized by
the Insert policy — then calls `updateProfileAvatar({ storagePath })`. The action validates the path
is under `${user.id}/`, computes the public URL, writes `avatar_url` + auth metadata, invalidates
caches, and cleans up the old object. **This mirrors the proven `use-attachment-mutations` pattern**
and keeps bytes out of the Server-Action JSON body (which has an 8 MB base64 ceiling, per
`next.config.ts`).

**B. Bytes through the Server Action.** Send the file as base64 to the action; the action uploads
server-side. Simpler auth story, but wastes the 8 MB action-body budget and re-encodes bytes through
JSON. Rejected — no benefit over A for a bounded-size image.

**C. Signed-URL private bucket.** Rejected in §2.1 — incompatible with the cached roster.

## 4. Architecture & data flow

```
Settings → Profile card
  └─ <AvatarUploader currentAvatarUrl name/>            (client)
       1. pick file → validate (type/size) → processAvatarImage()  → square Blob (§5)
       2. supabase.storage.from("avatars").upload(`${uid}/${uuid}.ext`, blob)   [Insert policy]
       3. updateProfileAvatar({ storagePath })          (Server Action)
            ├─ zod-validate path starts with `${user.id}/`
            ├─ publicUrl = storage.getPublicUrl(path)
            ├─ profiles.update({ avatar_url: publicUrl }).eq(id, uid)   [RLS: update self]
            ├─ auth.updateUser({ data: { avatar_url: publicUrl } })     (best-effort mirror)
            ├─ updateTag(profileTag(uid)); for org in myOrgs: updateTag(orgMembersTag(org.id))
            └─ best-effort remove(oldPathFrom(previous avatar_url))
       4. Remove button → removeProfileAvatar()
            ├─ profiles.update({ avatar_url: null })
            ├─ auth.updateUser({ data: { avatar_url: null } })
            ├─ same updateTag set
            └─ best-effort remove(current object)
```

**Bucket (migration, Task 0):**

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880,
        array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

-- public read; owner-only write (leading path segment = auth.uid())
create policy avatars_obj_select on storage.objects
  for select using (bucket_id = 'avatars');
create policy avatars_obj_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = (select auth.uid()));
create policy avatars_obj_update on storage.objects
  for update to authenticated using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = (select auth.uid()));
create policy avatars_obj_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1])::uuid = (select auth.uid()));
```

(A malformed key with no `[1]` segment → `NULL::uuid = uid` → `NULL` → deny. Safe.)

No new `public`-schema columns (`avatar_url` already exists), so `database.types.ts` is expected to
be a **no-op regen** — we still run `pnpm db:types` + advisors per the invariant to prove it.

## 5. Client-side image normalization (in scope; interactive cropping is not)

Instead of a crop UI, we **auto-normalize** on the client before upload:

1. Load the `File` into an `Image`/`createImageBitmap`.
2. **Center-crop to a square** (min of width/height, centered).
3. **Downscale** to a fixed edge (e.g. `512px`) via `<canvas>`.
4. **Re-encode** to `image/webp` (fallback `image/jpeg`) at ~0.85 quality → a small `Blob`
   (typically < 100 KB).

Benefits: consistent square avatars (all consumers render `object-cover` circles anyway),
bounded upload size independent of the source, and no heavy crop-library dependency. The bucket's
5 MB cap + `allowed_mime_types` are **defense-in-depth** behind the client's own type/size guard.

The normalization core is factored so its geometry (target square, dimensions) is **unit-testable**
without a real browser canvas; the thin canvas/DOM wrapper is exercised in the component test with a
mocked canvas.

## 6. Validation (Zod, at the boundary)

`src/lib/validations/profile.ts` gains:

- `AVATAR_MAX_BYTES` (5 MB) and `AVATAR_ACCEPTED_TYPES` (`png/jpeg/webp`) consts (shared by client
  guard + bucket doc).
- `updateProfileAvatarSchema = z.object({ storagePath: z.string().min(1) })` — the action
  additionally enforces `storagePath.startsWith(`${user.id}/`)` (path-spoof guard, mirroring
  `createAttachment`).

## 7. Permissions summary

| Actor                    | Read avatar     | Set/replace own     | Remove own | Manage others'    |
| ------------------------ | --------------- | ------------------- | ---------- | ----------------- |
| Any authenticated member | ✅ (public URL) | —                   | —          | ❌                |
| Owner of the profile     | ✅              | ✅                  | ✅         | ❌                |
| Org admin/owner          | ✅              | ❌ (only their own) | ❌         | ❌ (out of scope) |

## 8. Performance & data-fetching budget (working-agreement rule 5)

- **First paint:** the Settings page already fetches `myProfile`; we add `avatar_url` to that
  existing `select` (`email_digest_opt_out, full_name` → `+ avatar_url`) — **0 new round-trips**.
- **Interaction:** upload/remove **changes server data** → **Server Action + targeted `updateTag`**
  (profile + roster tags), not `<Link>`/router nav. No in-page view toggles.
- **Hot-path reads unchanged:** the roster stays bounded (`ORG_MEMBERS_LIMIT`) over the indexed
  `org_members` PK; avatars ride along in the same cached query.
- Upload payload is **bounded by client normalization** (§5) to well under the action-body and
  bucket limits.

## 9. Testing strategy (TDD, mandatory)

1. **Unit — path/URL helpers** (`avatar-path.ts`): `buildAvatarPath` shape (`{uid}/{uuid}.ext`),
   ext derivation, `pathFromPublicUrl` round-trip (for old-object cleanup), validation consts.
2. **Unit — normalization geometry:** square center-crop + target-edge math on synthetic dimensions.
3. **Unit — Server Actions** (`actions.test.ts`, mocked Supabase, mirroring existing profile
   action tests): rejects unauthenticated; rejects a `storagePath` not under `${user.id}/`;
   on success writes `avatar_url`, mirrors metadata, calls the correct `updateTag`s, removes the
   old object; `removeProfileAvatar` nulls the column + removes the object.
4. **Integration — storage RLS** (`avatars.rls.integration.test.ts`, `describe.skipIf` like
   `attachments.rls.integration.test.ts`): owner can upload under their own `{uid}/`; a second
   user is **denied** uploading under someone else's prefix; public read works via the public URL.
5. **Component — `AvatarUploader`** (jsdom + mocked canvas + mocked action): preview render,
   disabled/pending states, remove flow, error surfacing.

Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green.

## 10. Independent units (for the plan's DAG)

- **U0 — Migration + gate** (bucket + storage RLS; user-applied; types + advisors). Blocks all.
- **U1 — Path/URL helpers + Zod schema** (pure). Depends only on the decision to use `{uid}/{uuid}.ext`.
- **U2 — Image normalization util** (client, canvas). Independent of U1.
- **U3 — Server Actions** (`updateProfileAvatar`, `removeProfileAvatar`). Consumes U1.
- **U4 — RLS integration test.** Consumes U0 (+ U1 path helper).
- **U5 — UI: `AvatarUploader` + wire into `ProfileForm` + settings `select`.** Consumes U1, U2, U3.

U1 ∥ U2 are concurrent; U3 ∥ U4 are concurrent after U1; U5 is the join. Critical path:
**U0 → U1 → U3 → U5**.

## 11. Open risks / notes

- `updateProfileFullName` today does **not** invalidate `orgMembersTag` (TTL-covered). This spec
  does it correctly for avatars; optionally fold the same `updateTag` into `updateProfileFullName`
  while we're here (small, same file) — flagged in the plan as an optional cleanup, not required.
- Migration is **user-applied** (agent cannot push migrations to dev/prod) — the plan's Task 0 is an
  explicit human gate.
