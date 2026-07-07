# Avatar Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user set, replace, and remove their own profile picture from Settings → Profile, backed by a public `avatars` Storage bucket; every existing `avatar_url` consumer (roster, board cells, presence) picks it up automatically.

**Architecture:** Public Supabase Storage bucket `avatars` with owner-only-write RLS keyed on the leading `{user_id}/` path segment. Browser normalizes the image to a small square blob and uploads it client-direct (Insert policy), then a Server Action writes the public URL to `profiles.avatar_url`, mirrors it into auth metadata, invalidates the profile + roster caches, and cleans up the previous object. No interactive crop UI (auto center-crop instead); private-bucket/signed-URL rejected because the cached roster renders `avatar_url` as a stored string.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, Supabase JS + Storage, Zod, Vitest, shadcn/Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-07-06-avatar-upload-design.md`

---

## File Structure

| File                                                    | Responsibility                                                       | Task |
| ------------------------------------------------------- | -------------------------------------------------------------------- | ---- |
| `supabase/migrations/20260706NNNNNN_avatars_bucket.sql` | Create public `avatars` bucket + storage.objects RLS                 | 0    |
| `src/lib/profile/avatar-path.ts`                        | Pure: build object key, derive ext, parse path from public URL       | 1    |
| `src/lib/profile/avatar-path.test.ts`                   | Unit tests for the above                                             | 1    |
| `src/lib/validations/profile.ts` (modify)               | Avatar Zod schema + size/type consts                                 | 1    |
| `src/lib/profile/avatar-image.ts`                       | Client-side normalize-to-square-blob util (+ testable geometry core) | 2    |
| `src/lib/profile/avatar-image.test.ts`                  | Unit tests for the geometry core                                     | 2    |
| `src/lib/profile/actions.ts` (modify)                   | `updateProfileAvatar`, `removeProfileAvatar` Server Actions          | 3    |
| `src/lib/profile/actions.test.ts` (modify)              | Unit tests (mocked Supabase) for the two actions                     | 3    |
| `src/lib/profile/avatars.rls.integration.test.ts`       | Storage RLS integration test (`describe.skipIf`)                     | 4    |
| `src/components/settings/avatar-uploader.tsx`           | Client uploader (preview, pick, remove, pending/error)               | 5    |
| `src/components/settings/avatar-uploader.test.tsx`      | Component test (jsdom + mocked canvas + mocked actions)              | 5    |
| `src/components/settings/profile-form.tsx` (modify)     | Mount `AvatarUploader`, accept `currentAvatarUrl`                    | 5    |
| `src/app/(app)/settings/page.tsx` (modify)              | Add `avatar_url` to the `myProfile` select; pass to `ProfileForm`    | 5    |

---

## Task 0: Migration + gate (USER-APPLIED)

> Agents **cannot** push migrations. This task writes the migration file and then **stops for the
> user to apply it** and hand the build back. Nothing downstream can run against the DB until this
> is done.

**Files:**

- Create: `supabase/migrations/20260706NNNNNN_avatars_bucket.sql` (use `date +%Y%m%d%H%M%S` for the stamp; must sort after the latest existing migration)

- [ ] **Step 1: Confirm `avatar_url` already exists (no column migration needed)**

Run: `grep -n "avatar_url" src/types/database.types.ts`
Expected: matches under `profiles` Row/Insert/Update (~lines 1689/1699/1709). If present, the migration is **bucket + storage RLS only**.

- [ ] **Step 2: Write the migration**

```sql
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
```

- [ ] **Step 3: Commit the migration file**

```bash
git add supabase/migrations/20260706NNNNNN_avatars_bucket.sql
git commit -m "feat(storage): add avatars bucket + owner-only-write RLS migration"
```

- [ ] **Step 4: STOP — hand to the user**

Tell the user, verbatim intent: _"Migration written. Please apply it to the **dev** project
(`supabase db push` or the dev MCP `apply_migration`), then run `pnpm db:types` and the Supabase
**advisors**, and confirm before I continue."_ The user applies it (agent cannot).

- [ ] **Step 5 (after user confirms): Regenerate types + advisors**

Run: `pnpm db:types` → expect **no diff** in `src/types/database.types.ts` (no new `public` columns; bucket/policies live in the `storage` schema). Run Supabase advisors (dev MCP `get_advisors`) → expect no new security/perf warnings. If `db:types` produced a diff, commit it:

```bash
git add src/types/database.types.ts && git commit -m "chore(db): regenerate types after avatars bucket migration" || echo "no type changes (expected)"
```

**Interfaces:**

- **Consumes:** nothing.
- **Produces:** the applied `avatars` bucket + storage.objects RLS policies (`avatars_obj_select|insert|update|delete`); confirmed-unchanged `database.types.ts`.

---

## Task 1: Path/URL helpers + Zod schema

**Files:**

- Create: `src/lib/profile/avatar-path.ts`
- Test: `src/lib/profile/avatar-path.test.ts`
- Modify: `src/lib/validations/profile.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/profile/avatar-path.test.ts
import { describe, expect, it } from "vitest";
import {
  buildAvatarPath,
  extForMime,
  pathFromPublicUrl,
} from "@/lib/profile/avatar-path";

const UID = "11111111-1111-1111-1111-111111111111";

describe("avatar-path", () => {
  it("builds a key under the user's own prefix with a uuid + ext", () => {
    const p = buildAvatarPath(UID, "image/webp");
    expect(p).toMatch(new RegExp(`^${UID}/[0-9a-f-]{36}\\.webp$`));
  });

  it("maps mime types to extensions", () => {
    expect(extForMime("image/png")).toBe("png");
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("image/webp")).toBe("webp");
  });

  it("throws on an unsupported mime type", () => {
    expect(() => extForMime("image/gif")).toThrow();
  });

  it("round-trips the object key out of a public URL", () => {
    const url = `https://ref.supabase.co/storage/v1/object/public/avatars/${UID}/abc.webp`;
    expect(pathFromPublicUrl(url)).toBe(`${UID}/abc.webp`);
  });

  it("returns null for a URL that is not an avatars public URL", () => {
    expect(pathFromPublicUrl("https://example.com/x.png")).toBeNull();
    expect(pathFromPublicUrl(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/lib/profile/avatar-path.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```ts
// src/lib/profile/avatar-path.ts
/** Pure helpers for avatar object keys. The leading path segment MUST be the
 *  owner's user id — Storage RLS authorizes writes against it. Object key shape:
 *  `{user_id}/{uuid}.{ext}`. A fresh uuid per upload gives every replacement an
 *  immutable public URL (no CDN/browser cache staleness). */

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function extForMime(mime: string): string {
  const ext = MIME_EXT[mime];
  if (!ext) throw new Error(`Unsupported avatar type: ${mime}`);
  return ext;
}

export function buildAvatarPath(userId: string, mime: string): string {
  return `${userId}/${crypto.randomUUID()}.${extForMime(mime)}`;
}

/** Extract the storage object key from a Supabase public avatars URL, or null
 *  if the string is not one (used to delete the previous object on replace). */
export function pathFromPublicUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = "/storage/v1/object/public/avatars/";
  const i = url.indexOf(marker);
  if (i === -1) return null;
  const key = url.slice(i + marker.length).split("?")[0];
  return key.length > 0 ? key : null;
}
```

- [ ] **Step 4: Add the Zod schema + consts to `src/lib/validations/profile.ts`**

Append:

```ts
/** Avatar upload bounds. Client guards on these before normalizing; the bucket
 *  enforces the same size + mime set as defense-in-depth (see the avatars
 *  migration). Normalization re-encodes to webp/jpeg, so accepted *input* types
 *  are broad but bounded to the three the bucket allows. */
export const AVATAR_MAX_BYTES = 5_242_880; // 5 MB
export const AVATAR_ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

/** The Server Action receives only the uploaded object key. The action ALSO
 *  enforces `storagePath.startsWith(`${user.id}/`)` (path-spoof guard) — the
 *  schema just bounds the shape. */
export const updateProfileAvatarSchema = z.object({
  storagePath: z.string().min(1).max(200),
});
export type UpdateProfileAvatarInput = z.infer<
  typeof updateProfileAvatarSchema
>;
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm test src/lib/profile/avatar-path.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/profile/avatar-path.ts src/lib/profile/avatar-path.test.ts src/lib/validations/profile.ts
git commit -m "feat(profile): avatar path helpers + upload validation schema"
```

**Interfaces:**

- **Consumes:** (design only) Task 0's path convention.
- **Produces:** `buildAvatarPath(userId, mime)`, `extForMime(mime)`, `pathFromPublicUrl(url)`; `AVATAR_MAX_BYTES`, `AVATAR_ACCEPTED_TYPES`, `updateProfileAvatarSchema`.

---

## Task 2: Client-side image normalization

**Files:**

- Create: `src/lib/profile/avatar-image.ts`
- Test: `src/lib/profile/avatar-image.test.ts`

- [ ] **Step 1: Write the failing test (geometry core only — no real canvas)**

```ts
// src/lib/profile/avatar-image.test.ts
import { describe, expect, it } from "vitest";
import { squareCrop } from "@/lib/profile/avatar-image";

describe("squareCrop", () => {
  it("center-crops a landscape image to a centered square", () => {
    expect(squareCrop(200, 100)).toEqual({ sx: 50, sy: 0, size: 100 });
  });
  it("center-crops a portrait image to a centered square", () => {
    expect(squareCrop(100, 200)).toEqual({ sx: 0, sy: 50, size: 100 });
  });
  it("leaves a square image unchanged", () => {
    expect(squareCrop(100, 100)).toEqual({ sx: 0, sy: 0, size: 100 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/lib/profile/avatar-image.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the util (pure core + canvas wrapper)**

```ts
// src/lib/profile/avatar-image.ts
"use client";

/** Target edge (px) for the normalized square avatar. Consumers render small
 *  circular chips; 512 is crisp on retina without bloating the upload. */
export const AVATAR_EDGE = 512;
export const AVATAR_OUTPUT_MIME = "image/webp";
export const AVATAR_OUTPUT_QUALITY = 0.85;

/** Pure geometry: the centered square source rect for a WxH image. Testable
 *  without a DOM. */
export function squareCrop(
  width: number,
  height: number,
): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height);
  return {
    sx: Math.round((width - size) / 2),
    sy: Math.round((height - size) / 2),
    size,
  };
}

/** Load a File, center-crop to a square, downscale to AVATAR_EDGE, and re-encode
 *  to a small webp Blob. Browser-only (uses Image + canvas). Throws on decode
 *  failure so the caller can surface an error. */
export async function processAvatarImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Could not read that image.");
  });
  const { sx, sy, size } = squareCrop(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_EDGE;
  canvas.height = AVATAR_EDGE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available.");
  ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, AVATAR_EDGE, AVATAR_EDGE);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, AVATAR_OUTPUT_MIME, AVATAR_OUTPUT_QUALITY),
  );
  if (!blob) throw new Error("Could not process that image.");
  return blob;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/lib/profile/avatar-image.test.ts`
Expected: PASS (3 tests). `processAvatarImage` is exercised via the component test in Task 5 (mocked canvas).

- [ ] **Step 5: Commit**

```bash
git add src/lib/profile/avatar-image.ts src/lib/profile/avatar-image.test.ts
git commit -m "feat(profile): client-side avatar normalization (square crop + downscale)"
```

**Interfaces:**

- **Consumes:** nothing.
- **Produces:** `squareCrop(w,h)`, `processAvatarImage(file) → Promise<Blob>`, `AVATAR_EDGE`, `AVATAR_OUTPUT_MIME`.

---

## Task 3: Server Actions `updateProfileAvatar` + `removeProfileAvatar`

**Files:**

- Modify: `src/lib/profile/actions.ts`
- Test: `src/lib/profile/actions.test.ts`

> Read `src/lib/profile/actions.ts` first — copy the existing `ActionResult`/`fail` helper,
> `createClient()` + `auth.getUser()` pattern, and `updateTag` usage from `updateProfileFullName`.
> Read `src/lib/auth/session.ts` for `getUserOrgs()` (returns the user's orgs; used to invalidate
> each `orgMembersTag`).

- [ ] **Step 1: Write the failing tests (mocked Supabase)**

Mirror the existing `actions.test.ts` mock setup. Cover:

```ts
// additions to src/lib/profile/actions.test.ts
// (reuse the file's existing supabase mock; these assert the new behavior)

it("rejects a storagePath outside the caller's own prefix", async () => {
  // auth.getUser → { id: "user-1" }
  const res = await updateProfileAvatar({ storagePath: "someone-else/x.webp" });
  expect(res.ok).toBe(false);
});

it("writes avatar_url, mirrors metadata, invalidates profile + roster tags", async () => {
  // auth.getUser → { id: "user-1" }; getUserOrgs → [{ id: "org-1" }]
  // profiles.select(avatar_url).eq(id).maybeSingle → { avatar_url: null } (no old object)
  // getPublicUrl → { data: { publicUrl: "https://ref.supabase.co/storage/v1/object/public/avatars/user-1/new.webp" } }
  const res = await updateProfileAvatar({ storagePath: "user-1/new.webp" });
  expect(res.ok).toBe(true);
  expect(updateProfileMock).toHaveBeenCalledWith({
    avatar_url:
      "https://ref.supabase.co/storage/v1/object/public/avatars/user-1/new.webp",
  });
  expect(updateUserMock).toHaveBeenCalledWith({
    data: { avatar_url: expect.stringContaining("/avatars/user-1/new.webp") },
  });
  expect(updateTagMock).toHaveBeenCalledWith("profile:user:user-1");
  expect(updateTagMock).toHaveBeenCalledWith("org-members:org:org-1");
});

it("removeProfileAvatar nulls the column and deletes the object", async () => {
  // profiles.select(avatar_url) → { avatar_url: ".../avatars/user-1/old.webp" }
  const res = await removeProfileAvatar();
  expect(res.ok).toBe(true);
  expect(updateProfileMock).toHaveBeenCalledWith({ avatar_url: null });
  expect(storageRemoveMock).toHaveBeenCalledWith(["user-1/old.webp"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/lib/profile/actions.test.ts`
Expected: FAIL — `updateProfileAvatar` / `removeProfileAvatar` not exported.

- [ ] **Step 3: Implement the actions**

Add to `src/lib/profile/actions.ts` (imports: `updateProfileAvatarSchema` from validations, `buildAvatarPath`/`pathFromPublicUrl` from `avatar-path`, `orgMembersTag` from cache tags, `getUserOrgs` from `@/lib/auth/session`):

```ts
const AVATARS_BUCKET = "avatars";

/** Expire the user's own profile cache AND every org roster that renders their
 *  avatar. The roster comment in lib/org/queries-cached.ts mandates the latter. */
async function invalidateProfileEverywhere(userId: string): Promise<void> {
  updateTag(profileTag(userId));
  const orgs = await getUserOrgs();
  for (const org of orgs) updateTag(orgMembersTag(org.id));
}

/**
 * Point the signed-in user's `profiles.avatar_url` at an object they just
 * uploaded to the public `avatars` bucket, mirror it into auth metadata, and
 * clean up their previous avatar object. The client uploads bytes directly
 * (Storage Insert policy); this action only receives the resulting object key.
 */
export async function updateProfileAvatar(input: {
  storagePath: string;
}): Promise<ActionResult> {
  const parsed = updateProfileAvatarSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  // Path-spoof guard: the object must be under the caller's own prefix. This
  // matches what the Storage Insert policy already enforced on upload; we
  // re-check so a spoofed key can never be persisted into avatar_url.
  if (!parsed.data.storagePath.startsWith(`${user.id}/`))
    return fail("Invalid avatar path.");

  // Read the current avatar so we can delete the old object after switching.
  const { data: prev } = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  const {
    data: { publicUrl },
  } = supabase.storage
    .from(AVATARS_BUCKET)
    .getPublicUrl(parsed.data.storagePath);

  // RLS ("profiles: update self") scopes the write to the caller's row.
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: publicUrl })
    .eq("id", user.id);
  if (error) return fail("Could not update your avatar.");

  // Best-effort mirror into auth metadata (account menu / get_org_members RPC).
  await supabase.auth.updateUser({ data: { avatar_url: publicUrl } });

  await invalidateProfileEverywhere(user.id);

  // Best-effort: remove the previous object (skip if it's the same key).
  const oldPath = pathFromPublicUrl(prev?.avatar_url ?? null);
  if (oldPath && oldPath !== parsed.data.storagePath)
    await supabase.storage.from(AVATARS_BUCKET).remove([oldPath]);

  return { ok: true, data: undefined };
}

/** Clear the signed-in user's avatar (surfaces fall back to initials) and
 *  delete the stored object. */
export async function removeProfileAvatar(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  const { data: prev } = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: null })
    .eq("id", user.id);
  if (error) return fail("Could not remove your avatar.");

  await supabase.auth.updateUser({ data: { avatar_url: null } });
  await invalidateProfileEverywhere(user.id);

  const oldPath = pathFromPublicUrl(prev?.avatar_url ?? null);
  if (oldPath) await supabase.storage.from(AVATARS_BUCKET).remove([oldPath]);

  return { ok: true, data: undefined };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/lib/profile/actions.test.ts`
Expected: PASS (existing tests + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/profile/actions.ts src/lib/profile/actions.test.ts
git commit -m "feat(profile): updateProfileAvatar + removeProfileAvatar server actions"
```

**Interfaces:**

- **Consumes:** Task 1 (`updateProfileAvatarSchema`, `buildAvatarPath` used by UI, `pathFromPublicUrl`); existing `getUserOrgs`, `profileTag`, `orgMembersTag`, `updateTag`; Task 0's applied bucket (runtime).
- **Produces:** `updateProfileAvatar({ storagePath })`, `removeProfileAvatar()` → `ActionResult`.

---

## Task 4: Storage RLS integration test

**Files:**

- Create: `src/lib/profile/avatars.rls.integration.test.ts`

> Copy the harness header from `src/lib/collaboration/attachments.rls.integration.test.ts`
> (`loadIntegrationEnv`, `integrationTargetReady`, `signInWithRetry`, admin service client,
> `describe.skipIf`, `afterAll` user cleanup). Reuse the `@example.com` fixture-user convention.
> Requires Task 0 applied (skips cleanly otherwise).

- [ ] **Step 1: Write the integration test**

```ts
// core assertions (inside describe.skipIf(!integrationTargetReady()))
const BUCKET = "avatars";

it("owner can upload under their own {uid}/ prefix", async () => {
  const path = `${userA.id}/${randomUUID()}.webp`;
  const { error } = await userA.anon.storage
    .from(BUCKET)
    .upload(path, new Blob(["x"], { type: "image/webp" }));
  expect(error).toBeNull();
});

it("a user CANNOT upload under another user's prefix", async () => {
  const path = `${userA.id}/${randomUUID()}.webp`; // userB writing into userA's prefix
  const { error } = await userB.anon.storage
    .from(BUCKET)
    .upload(path, new Blob(["x"], { type: "image/webp" }));
  expect(error).not.toBeNull(); // RLS denies
});

it("public read works via the public URL (no auth)", async () => {
  const path = `${userA.id}/${randomUUID()}.webp`;
  await userA.anon.storage
    .from(BUCKET)
    .upload(path, new Blob(["x"], { type: "image/webp" }));
  const { data } = userA.anon.storage.from(BUCKET).getPublicUrl(path);
  const res = await fetch(data.publicUrl);
  expect(res.ok).toBe(true);
});
```

- [ ] **Step 2: Run the integration test**

Run: `pnpm test src/lib/profile/avatars.rls.integration.test.ts`
Expected: PASS if integration env is configured and Task 0 is applied; otherwise SKIPPED (not failed).

- [ ] **Step 3: Commit**

```bash
git add src/lib/profile/avatars.rls.integration.test.ts
git commit -m "test(profile): avatars storage RLS integration (owner-write, public-read)"
```

**Interfaces:**

- **Consumes:** Task 0 (applied bucket + policies), Task 1 (path shape).
- **Produces:** RLS coverage proving owner-only-write + public-read.

---

## Task 5: UI — `AvatarUploader` + wire into Profile card

**Files:**

- Create: `src/components/settings/avatar-uploader.tsx`
- Test: `src/components/settings/avatar-uploader.test.tsx`
- Modify: `src/components/settings/profile-form.tsx`
- Modify: `src/app/(app)/settings/page.tsx`

> **Load the `pulse-ui` + `frontend-design` skills before styling** (working-agreement rule 3).
> Match the existing Profile-card idiom in `profile-form.tsx`: inline status message (no toast
> primitive), `Button` from `@/components/ui/button`, small circular avatar chip with `initials`
> fallback (same visual as `PresenceAvatarStack`/`CreatedByCell`).

- [ ] **Step 1: Write the failing component test**

```tsx
// src/components/settings/avatar-uploader.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AvatarUploader } from "@/components/settings/avatar-uploader";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: () => ({ upload: vi.fn().mockResolvedValue({ error: null }) }),
    },
  }),
}));
vi.mock("@/lib/profile/actions", () => ({
  updateProfileAvatar: vi.fn().mockResolvedValue({ ok: true }),
  removeProfileAvatar: vi.fn().mockResolvedValue({ ok: true }),
}));

describe("AvatarUploader", () => {
  it("shows the current avatar image when a url is provided", () => {
    render(
      <AvatarUploader
        userId="u1"
        name="Ada Lovelace"
        currentAvatarUrl="https://x/y.webp"
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      expect.stringContaining("y.webp"),
    );
  });
  it("falls back to initials and hides Remove when there is no avatar", () => {
    render(
      <AvatarUploader
        userId="u1"
        name="Ada Lovelace"
        currentAvatarUrl={null}
      />,
    );
    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/components/settings/avatar-uploader.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `AvatarUploader`**

```tsx
// src/components/settings/avatar-uploader.tsx
"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  removeProfileAvatar,
  updateProfileAvatar,
} from "@/lib/profile/actions";
import { buildAvatarPath } from "@/lib/profile/avatar-path";
import {
  processAvatarImage,
  AVATAR_OUTPUT_MIME,
} from "@/lib/profile/avatar-image";
import {
  AVATAR_ACCEPTED_TYPES,
  AVATAR_MAX_BYTES,
} from "@/lib/validations/profile";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function AvatarUploader({
  userId,
  name,
  currentAvatarUrl,
}: {
  userId: string;
  name: string;
  currentAvatarUrl: string | null;
}) {
  const [url, setUrl] = useState(currentAvatarUrl);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setMsg(null);
    if (!AVATAR_ACCEPTED_TYPES.includes(file.type as never)) {
      setMsg("Use a PNG, JPEG, or WebP image.");
      setIsError(true);
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setMsg("Image must be 5 MB or smaller.");
      setIsError(true);
      return;
    }
    start(async () => {
      try {
        const blob = await processAvatarImage(file);
        const path = buildAvatarPath(userId, AVATAR_OUTPUT_MIME);
        const supabase = createClient();
        const { error } = await supabase.storage
          .from("avatars")
          .upload(path, blob, {
            contentType: AVATAR_OUTPUT_MIME,
            upsert: true,
          });
        if (error) throw new Error(error.message);
        const res = await updateProfileAvatar({ storagePath: path });
        if (!res.ok) {
          await supabase.storage.from("avatars").remove([path]); // orphan cleanup
          throw new Error(res.error);
        }
        // Read-your-own-writes locally: point the preview at the new object.
        const { data } = supabase.storage.from("avatars").getPublicUrl(path);
        setUrl(data.publicUrl);
        setMsg("Saved.");
        setIsError(false);
      } catch (err) {
        setMsg(err instanceof Error ? err.message : "Upload failed.");
        setIsError(true);
      }
    });
  }

  function onRemove() {
    setMsg(null);
    start(async () => {
      const res = await removeProfileAvatar();
      if (res.ok) {
        setUrl(null);
        setMsg("Removed.");
        setIsError(false);
      } else {
        setMsg(res.error);
        setIsError(true);
      }
    });
  }

  return (
    <div className="flex items-center gap-4">
      <span className="bg-surface-muted flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-medium">
        {url ? (
          <Image
            src={url}
            alt=""
            width={56}
            height={56}
            unoptimized
            className="size-full object-cover"
          />
        ) : (
          initials(name)
        )}
      </span>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={AVATAR_ACCEPTED_TYPES.join(",")}
            className="sr-only"
            onChange={onPick}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
          >
            {pending ? "Uploading…" : url ? "Change" : "Upload"}
          </Button>
          {url && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={onRemove}
            >
              Remove
            </Button>
          )}
        </div>
        {msg ? (
          <span
            className={cn(
              "text-xs",
              isError ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {msg}
          </span>
        ) : (
          <p className="text-muted-foreground text-xs">
            PNG, JPEG, or WebP. Squared and resized automatically.
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Mount it in `profile-form.tsx`**

Change `ProfileForm`'s props to also accept `userId` and `currentAvatarUrl`, and render
`<AvatarUploader userId={userId} name={name || currentFullName || "?"} currentAvatarUrl={currentAvatarUrl} />`
above the display-name field. (Keep the existing name field/logic intact.)

```tsx
// profile-form.tsx — signature + top of JSX
export function ProfileForm({
  userId,
  currentFullName,
  currentAvatarUrl,
}: {
  userId: string;
  currentFullName: string | null;
  currentAvatarUrl: string | null;
}) {
  // …existing state…
  return (
    <div className="space-y-5">
      <AvatarUploader
        userId={userId}
        name={(currentFullName ?? "").trim() || "?"}
        currentAvatarUrl={currentAvatarUrl}
      />
      {/* existing display-name block unchanged */}
    </div>
  );
}
```

- [ ] **Step 5: Feed the data from `settings/page.tsx`**

In the `myProfile` select, add `avatar_url`:

```ts
supabase
  .from("profiles")
  .select("email_digest_opt_out, full_name, avatar_url")
  .eq("id", user.id)
  .maybeSingle(),
```

And update the render:

```tsx
<ProfileForm
  userId={user.id}
  currentFullName={myProfile?.full_name ?? null}
  currentAvatarUrl={myProfile?.avatar_url ?? null}
/>
```

- [ ] **Step 6: Run tests + full gates**

Run: `pnpm test src/components/settings/avatar-uploader.test.tsx` → PASS.
Then the full suite: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → all green.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/avatar-uploader.tsx src/components/settings/avatar-uploader.test.tsx src/components/settings/profile-form.tsx "src/app/(app)/settings/page.tsx"
git commit -m "feat(settings): avatar uploader in the Profile card"
```

**Interfaces:**

- **Consumes:** Task 1 (`buildAvatarPath`, `AVATAR_ACCEPTED_TYPES`, `AVATAR_MAX_BYTES`), Task 2 (`processAvatarImage`, `AVATAR_OUTPUT_MIME`), Task 3 (`updateProfileAvatar`, `removeProfileAvatar`), Supabase browser client, Task 0 bucket (runtime).
- **Produces:** `<AvatarUploader>`; `ProfileForm` now renders it; settings page supplies `userId` + `avatar_url`.

---

## Optional cleanup (not required)

`updateProfileFullName` currently does NOT invalidate `orgMembersTag` (TTL-covered, ≤60 s stale).
While in `actions.ts`, optionally call `invalidateProfileEverywhere(user.id)` there too so a name
change also refreshes the roster immediately. Small, same file; skip if it risks scope creep.

---

## Execution DAG

**Dependency edges** (from the Interfaces blocks):

- Task 0 → (gate) everything with a runtime DB dependency (Tasks 3, 4, 5 at runtime; and the whole build proceeds only after Task 0 is applied).
- Task 1 → Task 3, Task 4, Task 5 (helpers + schema).
- Task 2 → Task 5 (image util).
- Task 3 → Task 5 (actions).
- Task 4 depends on Task 0 (+ Task 1).

**Parallel batches (waves of concurrent agents):**

| Batch  | Tasks               | Notes                                                                                                 |
| ------ | ------------------- | ----------------------------------------------------------------------------------------------------- |
| **B0** | **Task 0**          | User-applied migration gate. Nothing else starts until applied + types/advisors confirmed.            |
| **B1** | **Task 1 ∥ Task 2** | Pure code, no shared files, no interdependency → dispatch concurrently.                               |
| **B2** | **Task 3 ∥ Task 4** | Both depend only on B1 (and B0). Different files (`actions.ts` vs new integration test) → concurrent. |
| **B3** | **Task 5**          | Join node — needs Tasks 1, 2, 3. Single task; touches shared UI/page files.                           |

**Critical path (wall-clock floor):** **Task 0 → Task 1 → Task 3 → Task 5** (4 nodes). Task 2 hides
under Task 1+3 on the path; Task 4 hides under Task 3.

**Worktree note:** this plan already runs inside the `task/avatar-upload` worktree. If B1/B2 are
dispatched as parallel subagents that write files, keep them to their **disjoint file sets** (listed
per task) so they don't clobber each other — no extra worktrees needed since the file sets don't
overlap. Task 5 runs alone.

---

## How to test this (manual acceptance — after merge to `develop`)

1. Pull `develop`; ensure the `avatars` bucket migration is applied on your target Supabase (dev).
2. Go to **Settings → Profile** card. You should see your initials in a circle + an **Upload** button.
3. Click **Upload**, pick a non-square PNG/JPEG. Expect: brief "Uploading…", then the circle shows
   your image (auto center-cropped square) and a **Change** + **Remove** appear, message "Saved."
4. Open any **board** where you're the creator/assignee, or the **Members** list — your new avatar
   should appear there too (roster cache invalidated).
5. Back in Settings, click **Remove** → the circle falls back to initials, message "Removed.", and it
   reverts on boards/roster as well.
6. Negative: try a `.gif` or a >5 MB file → inline error, no upload.
7. (Optional) In Supabase Storage, confirm the `avatars` bucket holds **one** object under your
   `{user_id}/` prefix after several re-uploads (old objects cleaned up).
