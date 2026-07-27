---
type: spec
status: approved
date: 2026-06-17
phase: 4c
tags: [spec, phase/4, collaboration, attachments, storage]
related:
  - "[[2026-06-16-phase-4-collaboration-design]]"
  - "[[2026-06-17-0920-phase4b-mentions-notifications]]"
  - "[[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]"
  - "[[00-north-star]]"
---

# Phase 4c — Attachments (Supabase Storage)

> The third and final slice of Phase 4 Collaboration. Item-level file attachments on the item
> detail panel, served from a private Supabase Storage bucket, with a Monday-style **Files** tab
> (thumbnail gallery + preview lightbox). Builds on 4a (`?item=` panel, per-item Realtime) and 4b
> (notifications). Parent spec: [[2026-06-16-phase-4-collaboration-design]] §3, §8.

## 1. Scope (decided)

**In:**

- **Item-level** attachments only. Files attach to an item; shown on the panel's **Files** tab.
- **50 MB** per-file cap, **any** MIME type (no allow-list — rely on the private bucket + RLS).
- **Monday-style Files tab**: thumbnail **gallery** (default) + **list** toggle; hover actions
  (preview / download / delete); drag-and-drop + an "Add files" button.
- **Preview lightbox**: large inline preview for images/video, arrow + thumbnail-strip + keyboard
  nav across the item's files, download / delete / open-in-new-tab, file-info sidebar.
- Client-direct upload to the bucket (anon key + Storage RLS); server-minted **signed URLs** for
  preview and download; delete removes the Storage object **and** the metadata row.

**Out (deferred / explicit non-goals):**

- **Update-level** attachments (files on an individual comment) — forward-compatible in the schema
  (`update_id` column retained) but no UI in v1. Fast-follow 4d candidate.
- Server-side **thumbnail/transform generation** (we render the original via a signed `<img>`),
  versioning, inline paste, a board **Files column** type, external-link/Drive pickers, annotation.

## 2. Data model

### Table `public.attachments` (metadata; bytes live in Storage)

Exactly the parent-spec §3 shape:

```sql
create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  board_id     uuid not null references public.boards (id) on delete cascade,
  item_id      uuid references public.items (id) on delete cascade,
  update_id    uuid references public.item_updates (id) on delete cascade, -- v1: always null
  uploaded_by  uuid not null references auth.users (id),
  storage_path text not null unique,      -- bucket key: <org_id>/<board_id>/<item_id>/<uuid>-<name>
  file_name    text not null,             -- original display name (sanitized)
  mime_type    text not null,
  size_bytes   bigint not null,
  created_at   timestamptz not null default now(),
  check (item_id is not null or update_id is not null),
  check (size_bytes > 0 and size_bytes <= 52428800)
);
create index attachments_item_id_idx on public.attachments (item_id, created_at desc);
create index attachments_org_id_idx  on public.attachments (org_id);
```

- `storage_path` is **unique** (one metadata row per object) — guards double-register.
- The `size_bytes` check is defense-in-depth alongside the bucket `file_size_limit`.
- `item_id` is **not null** in every v1 write; the nullable column + `update_id` are kept for the
  deferred update-level feature.

### Private bucket `attachments`

Created in the migration (versioned, never click-ops):

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 52428800, null)
on conflict (id) do nothing;
```

- `public = false` → never world-readable; access only through signed URLs minted server-side.
- Object key: `<org_id>/<board_id>/<item_id>/<uuid>-<sanitized_name>`. The **leading segment is
  `org_id`**, which is what Storage RLS authorizes against.

## 3. Security & RLS (first Storage use in the repo)

### Table RLS (`attachments`) — mirrors `item_updates`

```sql
alter table public.attachments enable row level security;

-- read: any org member
create policy attachments_select on public.attachments
  for select using (is_org_member(org_id));

-- insert: member, parent-consistent, self as uploader
create policy attachments_insert on public.attachments
  for insert with check (
    is_org_member(org_id)
    and board_in_org(board_id, org_id)
    and item_in_org(item_id, org_id)
    and uploaded_by = (select auth.uid())
  );

-- delete: uploader or org admin/owner
create policy attachments_delete on public.attachments
  for delete using (
    is_org_member(org_id)
    and (uploaded_by = (select auth.uid()) or has_org_role(org_id, array['owner','admin']::org_role[]))
  );
-- no update policy — attachment rows are immutable
```

### Storage RLS (`storage.objects`, bucket `attachments`)

Org derived from the leading path segment: `((storage.foldername(name))[1])::uuid`.

```sql
-- upload: members of the org named in the path's first segment
create policy attachments_obj_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'attachments'
    and is_org_member(((storage.foldername(name))[1])::uuid)
  );

-- read (signed-url minting requires select): same org-member check
create policy attachments_obj_select on storage.objects
  for select to authenticated using (
    bucket_id = 'attachments'
    and is_org_member(((storage.foldername(name))[1])::uuid)
  );

-- delete: uploader (owner) or org admin/owner
create policy attachments_obj_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'attachments'
    and is_org_member(((storage.foldername(name))[1])::uuid)
    and (owner = (select auth.uid())
         or has_org_role(((storage.foldername(name))[1])::uuid, array['owner','admin']::org_role[]))
  );
```

### Server-layer hardening (two guards the client cannot bypass)

1. **Path-spoof guard.** `createAttachment` re-derives `org_id`/`board_id` from `item_id` (RLS-scoped
   read) and **rejects** any `storage_path` not starting with `${org_id}/${board_id}/${item_id}/`.
   So a client cannot register a metadata row pointing at another org/item's object.
2. **Disposition guard (the "any type" XSS mitigation).** Downloads and "open in new tab" are served
   via `createSignedUrl(path, ttl, { download: file_name })` → short TTL + `Content-Disposition:
attachment`, so an uploaded HTML/SVG opens as a download, never as a top-level rendered document.
   **Inline preview** (gallery thumbnails + lightbox) is restricted to a safe **raster-image/video
   allow-list** (`image/png|jpeg|gif|webp`, `video/mp4|webm`) rendered via `<img>`/`<video>`; **SVG
   and everything else are treated as non-previewable** (icon + Download), since an `<img>`-loaded
   raster can't execute script but a navigated SVG can.

## 4. Server & client layer

### Zod (`src/lib/validations/collaboration-actions.ts`)

```ts
const FILE_NAME = z.string().trim().min(1).max(255);
const MIME = z.string().trim().min(1).max(255);
const SIZE = z.number().int().positive().max(52_428_800);
const STORAGE_PATH = z.string().min(1).max(1024);

createAttachmentSchema = {
  itemId: UUID,
  storagePath: STORAGE_PATH,
  fileName: FILE_NAME,
  mimeType: MIME,
  sizeBytes: SIZE,
};
deleteAttachmentSchema = { attachmentId: UUID };
attachmentUrlSchema = { attachmentId: UUID };
attachmentUrlsSchema = { attachmentIds: z.array(UUID).max(60) }; // batch preview-url mint
```

### Server Actions (`src/lib/collaboration/actions.ts`) — same `ActionResult` shape, `auth.getUser()` gate

- `createAttachment(input)` → path-spoof guard → insert row → `{ attachmentId }`.
- `getAttachmentDownloadUrl({ attachmentId })` → load row (RLS) → `createSignedUrl(path, 60, { download: fileName })` → `{ url }`.
- `getAttachmentPreviewUrls({ attachmentIds })` → load rows (RLS), filter to the previewable
  allow-list → `createSignedUrls(paths, 300)` (inline, no `download`) → `{ urls: Record<id,url> }`.
  One round-trip for all visible image/video cards.
- `deleteAttachment({ attachmentId })` → load row (RLS) → uploader/admin check → `storage.remove([path])`
  **then** delete row (object first so a row never dangles pointing at live bytes).

### Query (`src/lib/collaboration/attachments.ts`)

- `getItemAttachments(itemId, cursor?)` → bounded list (latest **50**, `item_id`-indexed,
  `created_at desc`, cursor "load more"). Returns metadata rows only — **no** URL minting here.

### Pure helpers (`src/lib/collaboration/`)

- `attachments-path.ts`: `buildStoragePath({orgId,boardId,itemId,fileName})` (uuid prefix +
  `sanitizeFileName` — strip path separators/control chars, collapse whitespace, cap length, keep
  extension). Pure + unit-tested.
- `attachments-format.ts`: `formatSize(bytes)`, `fileKind(mime,name)` → `image|video|pdf|doc|sheet|archive|other`,
  `isPreviewable(mime)` (the raster/video allow-list above). Pure + unit-tested.

### Cache, hooks & Realtime

- New query key `["item-attachments", itemId]`; `attachments-cache.ts` with
  `prependAttachment` / `removeAttachment` (mirrors `cache.ts`).
- `use-item-attachments.ts` — the list query, **`enabled` only once the Files tab has been opened**
  (lazy: 0 cost on panel open). After the list loads, it batch-calls `getAttachmentPreviewUrls`
  for the previewable rows and holds the `id→url` map (re-minted as the list grows).
- `use-attachment-mutations.ts` — optimistic `upload` (drives the client-direct upload then
  `createAttachment`) and `remove` (`deleteAttachment`), same optimistic pattern as
  `use-update-mutations.ts` (optimistic `id`, revert on error).
- Realtime: extend the existing `item:${itemId}` channel (`use-item-collab.ts`) to subscribe to
  `attachments` `INSERT`/`DELETE` filtered `item_id=eq.<id>`; reconcile into the attachments cache,
  de-duping on `id` (echo-safe, same as updates). `attachments` joins the Realtime publication.

### Upload flow (client-direct)

1. User picks files (button) or drops them on the panel.
2. Client validates **count** and **size ≤ 50 MB** each (reject early with a toast).
3. For each file: `buildStoragePath(...)` → `browserClient.storage.from('attachments').upload(path, file)`
   (authorized by the Storage INSERT policy) with an optimistic "uploading" card.
4. On upload success → `createAttachment({ itemId, storagePath, fileName, mimeType, sizeBytes })`.
5. On `createAttachment` failure → best-effort `storage.remove([path])` (orphan cleanup) + error toast.
   (Upload-then-register orphan window is acceptable for v1 with this cleanup; a sweep job is a
   later hardening item.)

## 5. UI — the Files tab (Monday-style, Monolith dark)

Built with the `pulse-ui` + `frontend-design` skills at implementation time. Components under
`src/components/boards/item-panel/`:

- **`FilesTab.tsx`** — adds a 4th tab to `ItemPanel` (`Fields / Updates / Activity / Files`).
  Toolbar: file count + total size, a **Gallery / List** segmented toggle (client state; gallery
  default), and an **＋ Add files** button. A drag-and-drop zone over the whole tab. Empty state.
- **`AttachmentCard.tsx`** — gallery card: thumbnail = signed `<img>` for **images**; **video** shows
  a file-type badge with a play glyph (no poster is generated; it previews inline in the lightbox);
  every other type shows a colored file-type badge. Plus filename, size, uploader avatar; hover
  overlay actions **Preview · Download · Delete**. Delete is shown in the UI only to the **uploader**
  (`uploaded_by === currentUserId`); org admins/owners remain RLS-permitted to delete, but a UI
  affordance for admin-deleting another member's file is a deferred fast-follow (needs the current
  user's org role plumbed into the panel). Uploading/error states.
- **`AttachmentRow.tsx`** — list-view compact row (icon, name, size, uploader, date, actions).
- **`FilePreviewLightbox.tsx`** — modal: large inline preview for previewable types (icon +
  "Download" for the rest), top-bar **open-in-new-tab · delete · Download · close**, arrow + bottom
  **thumbnail-strip** nav, **←/→** to move and **Esc** to close, file-info sidebar.
- The Files surface is the **only** consumer of preview/download signed URLs; nothing else loads
  object bytes.

## 6. Perf & data-fetching budget (gotcha-09 — mandatory)

| Interaction                       | Server round-trips                        | Notes                                                                                                 |
| --------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Board first paint                 | unchanged                                 | Attachments not loaded; no new board query.                                                           |
| Open panel (`?item=`)             | **0 added**                               | Files query is lazy (`enabled` on first Files-tab open). 4a/4b reads unchanged.                       |
| First open of **Files** tab       | **2 bounded** (1 list + 1 batch URL mint) | List ≤50, `item_id`-indexed; one `getAttachmentPreviewUrls` batch for previewable rows (image/video). |
| Switch Gallery/List, re-open tab  | **0**                                     | Pure client state; cache `staleTime: Infinity`.                                                       |
| Open preview lightbox / nav files | **0**                                     | Reuses already-minted preview URLs.                                                                   |
| Upload a file                     | direct-to-Storage + **1** Server Action   | Optimistic card; `createAttachment` persists metadata.                                                |
| Download a file                   | **1** Server Action                       | Mints a short-TTL attachment-disposition signed URL.                                                  |
| Delete a file                     | **1** Server Action                       | Removes object then row; peers reconcile via Realtime.                                                |
| Live (peers add/remove)           | **0 (push)**                              | Row-level Realtime deltas filtered `item_id` — never a board firehose.                                |

All hot-path reads are **bounded** (cursor) over **indexed** columns. No interaction that only
changes view state issues an RSC navigation.

## 7. Testing

- **Unit** (Vitest, mocked Supabase): `attachments-path` (sanitize/build edge cases),
  `attachments-format` (size, `fileKind`, `isPreviewable` — incl. **SVG → not previewable**),
  the new Zod schemas, cache helpers, and the actions — **path-spoof rejection**, **size-limit
  rejection**, **download uses attachment disposition**, **delete removes object before row**,
  uploader/admin delete authorization.
- **RLS integration** (`attachments.rls.integration.test.ts`, two-user harness): table policies
  (member read; cross-org denial; non-uploader-non-admin delete denied) **and Storage object
  policies** (upload to own-org path OK; upload/read under another org's path **denied**).
- **Component**: FilesTab gallery render + empty state, optimistic upload card, Gallery/List toggle,
  lightbox open + ←/→ + Esc nav, non-previewable fallback.
- **e2e** (`item-attachments.spec.ts`): upload a file → card appears → preview opens → Download
  returns 200 → delete removes it.
- Gates (every slice): `pnpm typecheck && pnpm lint && pnpm test && pnpm build`; advisors clean.

## 8. Build order (one PR)

1. **Migration** — `attachments` table + indexes + RLS; `attachments` bucket; Storage RLS policies;
   add `attachments` to the Realtime publication. Apply via `supabase db push --linked`.
2. `pnpm db:types` → `src/types/database.types.ts`; run advisors.
3. **Validations + Server Actions** (`createAttachment`, `deleteAttachment`,
   `getAttachmentDownloadUrl`, `getAttachmentPreviewUrls`) + `getItemAttachments` query + pure helpers.
4. **Cache + hooks + Realtime** (`attachments-cache`, `use-item-attachments`,
   `use-attachment-mutations`, extend `use-item-collab`).
5. **UI** — Files tab (gallery + list + drop zone + add) + lightbox.
6. **Tests** (all layers) → full gate → `/wrapup`.

## 9. Open questions / future

- Update-level attachments (4d) — reuse this table via `update_id`; composer affordance + inline
  render on updates.
- Orphan-object sweep (cron/edge) for the rare upload-success / register-failure window.
- Board **Files column** type (Phase 6) — a cell that surfaces an item's attachments inline.
- Server-side thumbnails/transforms if gallery payloads on image-heavy items get expensive.
