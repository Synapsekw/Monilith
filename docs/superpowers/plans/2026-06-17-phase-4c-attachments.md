# Phase 4c — Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add item-level file attachments to the item detail panel — a private Supabase Storage bucket, a `public.attachments` metadata table with table + Storage RLS, client-direct upload, server-minted signed URLs, and a Monday-style **Files** tab (gallery + list toggle + preview lightbox).

**Architecture:** Bytes live in a private `attachments` Storage bucket keyed `<org_id>/<board_id>/<item_id>/<uuid>-<name>`; metadata lives in `public.attachments` (RLS-scoped, denormalized `org_id`/`board_id` like `item_updates`). The browser uploads directly (anon key + Storage INSERT RLS); Server Actions mint short-TTL signed URLs (server client only) for inline preview and attachment-disposition download. The Files tab is a lazy React-Query surface (`enabled` on first open) extended into the existing per-item Realtime channel; in-page Gallery/List toggle and lightbox nav are pure client state (0 round-trips, per gotcha-09).

**Tech Stack:** Next.js 16 (App Router, RSC) + React 19, Supabase (Postgres + Storage, anon-key clients, RLS as the security boundary), TanStack Query v5 + Supabase Realtime, Zod v4 at boundaries, Vitest (unit + RLS integration) + Playwright (e2e), Tailwind v4 + shadcn primitives (`pulse-ui` dark tokens).

---

## File Structure

| File                                                            | Create/Modify | Single responsibility                                                                                                                   |
| --------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260617110000_attachments.sql`            | Create        | `attachments` table + indexes + checks + table RLS; private `attachments` bucket; Storage object RLS; add table to Realtime publication |
| `src/types/database.types.ts`                                   | Modify        | Regenerated Supabase types (includes `attachments` row) — never hand-edited                                                             |
| `src/lib/validations/collaboration-actions.ts`                  | Modify        | Add `createAttachmentSchema`, `deleteAttachmentSchema`, `attachmentUrlSchema`, `attachmentUrlsSchema` + inferred types                  |
| `src/lib/collaboration/attachments-path.ts`                     | Create        | Pure `sanitizeFileName` + `buildStoragePath` (object-key construction)                                                                  |
| `src/lib/collaboration/attachments-path.test.ts`                | Create        | Unit tests for sanitize/build edge cases                                                                                                |
| `src/lib/collaboration/attachments-format.ts`                   | Create        | Pure `formatSize`, `fileKind`, `isPreviewable` (raster/video allow-list; SVG → not previewable)                                         |
| `src/lib/collaboration/attachments-format.test.ts`              | Create        | Unit tests for format/kind/previewable                                                                                                  |
| `src/lib/collaboration/attachments.ts`                          | Create        | `getItemAttachments(itemId, cursor?)` bounded query (metadata only)                                                                     |
| `src/lib/collaboration/attachments.test.ts`                     | Create        | Unit test for the bounded query shape                                                                                                   |
| `src/lib/collaboration/actions.ts`                              | Modify        | Add `createAttachment`, `getAttachmentDownloadUrl`, `getAttachmentPreviewUrls`, `deleteAttachment` Server Actions                       |
| `src/lib/collaboration/attachments-actions.test.ts`             | Create        | Unit tests: path-spoof reject, size reject, download disposition, preview filter, delete order, uploader/admin auth                     |
| `src/lib/collaboration/attachments-cache.ts`                    | Create        | Pure `prependAttachment` / `removeAttachment` cache helpers + types                                                                     |
| `src/lib/collaboration/attachments-cache.test.ts`               | Create        | Unit tests for cache helpers                                                                                                            |
| `src/lib/collaboration/use-item-attachments.ts`                 | Create        | Lazy list query (`["item-attachments", itemId]`, `enabled` on Files-tab open) + batched preview-URL map                                 |
| `src/lib/collaboration/use-attachment-mutations.ts`             | Create        | Optimistic `upload` (client-direct upload → `createAttachment`) + `remove`                                                              |
| `src/lib/collaboration/use-item-collab.ts`                      | Modify        | Subscribe the `item:${itemId}` channel to `attachments` INSERT/DELETE filtered `item_id`                                                |
| `src/components/boards/item-panel/ItemPanel.tsx`                | Modify        | Add the 4th tab `Fields / Updates / Activity / Files`; mount `FilesTab`                                                                 |
| `src/components/boards/item-panel/FilesTab.tsx`                 | Create        | Toolbar (count/size + Gallery/List toggle + Add files), drop zone, gallery/list render, empty state, lightbox host                      |
| `src/components/boards/item-panel/AttachmentCard.tsx`           | Create        | Gallery card: thumbnail/badge, name, size, uploader, hover Preview/Download/Delete, uploading/error states                              |
| `src/components/boards/item-panel/AttachmentRow.tsx`            | Create        | List-view compact row (icon, name, size, uploader, date, actions)                                                                       |
| `src/components/boards/item-panel/FilePreviewLightbox.tsx`      | Create        | Modal: inline image/video or icon+Download fallback, thumbnail-strip + ←/→ + Esc nav, top-bar actions                                   |
| `src/components/boards/item-panel/FilesTab.test.tsx`            | Create        | Component tests: gallery/empty render, toggle, optimistic upload card, non-previewable fallback                                         |
| `src/components/boards/item-panel/FilePreviewLightbox.test.tsx` | Create        | Component tests: open + ←/→ + Esc nav, fallback render                                                                                  |
| `src/lib/collaboration/attachments.rls.integration.test.ts`     | Create        | Two-user harness: table policies (read/cross-org/delete-auth) + Storage object policies (own-org OK, cross-org path denied)             |
| `e2e/item-attachments.spec.ts`                                  | Create        | upload → card → preview → download 200 → delete                                                                                         |

---

## Task 1 — Migration: table + indexes + table RLS + bucket + Storage RLS + Realtime publication

**Files:**

- Create: `supabase/migrations/20260617110000_attachments.sql`

This task has no unit test (DDL); verification is `supabase db push --linked` succeeding and advisors reporting clean. The data-layer tests in Tasks 4 and 9 exercise the policies.

- [ ] Create `supabase/migrations/20260617110000_attachments.sql` with the table, indexes, checks, table RLS, bucket, Storage RLS, and the Realtime publication line:

```sql
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
```

- [ ] Apply the migration: run `supabase db push --linked` and confirm it reports the migration applied with no error.
- [ ] Run advisors and confirm clean (no new security/performance findings for `attachments`): run `supabase db lint --linked` (or the MCP `get_advisors` tool for `security` and `performance`). If an advisor flags an unindexed FK on `attachments.update_id` (always null in v1), note it as an accepted deferral in the migration comment — do not add an index for a column never written in v1.
- [ ] Commit: `git add supabase/migrations/20260617110000_attachments.sql && git commit -m "feat(db): attachments table + private bucket + table/storage RLS"`

---

## Task 2 — Regenerate + commit types

**Files:**

- Modify: `src/types/database.types.ts`

- [ ] Regenerate the Supabase types from the linked project: run `pnpm db:types` (the script is `supabase gen types typescript --linked --schema public | prettier --parser typescript > src/types/database.types.ts`).
- [ ] Verify `attachments` is present in the generated file: run `grep -n "attachments:" src/types/database.types.ts` and confirm a `Row`/`Insert`/`Update` block exists.
- [ ] Guard against the known telemetry leak: run `head -1 src/types/database.types.ts` and confirm the file starts with valid TS (e.g. `export type Json =` / a comment), NOT a stray PostHog line. Per the project's north-star, `pnpm db:types` can occasionally leak a `"_tag"` telemetry line; if `pnpm typecheck` reports a parse error on line 1 of `database.types.ts`, regenerate filtering it out — `supabase gen types typescript --linked --schema public | grep -v '"_tag"' | pnpm exec prettier --parser typescript > src/types/database.types.ts` — then re-run typecheck.
- [ ] Confirm typecheck still passes against the new types: run `pnpm typecheck` (expected: no errors).
- [ ] Commit: `git add src/types/database.types.ts && git commit -m "chore(db): regenerate types for attachments table"`

---

## Task 3 — Zod schemas + pure helpers (path + format) with unit tests first

**Files:**

- Modify: `src/lib/validations/collaboration-actions.ts`
- Create: `src/lib/collaboration/attachments-path.ts`
- Create: `src/lib/collaboration/attachments-path.test.ts`
- Create: `src/lib/collaboration/attachments-format.ts`
- Create: `src/lib/collaboration/attachments-format.test.ts`

### 3a. Zod schemas

- [ ] Add the four schemas + inferred types to `src/lib/validations/collaboration-actions.ts` (append after the existing exports, matching the existing `z.string().uuid()` / `z.string().trim()` idiom):

```ts
const FILE_NAME = z.string().trim().min(1, "File name required").max(255);
const MIME = z.string().trim().min(1).max(255);
const SIZE = z.number().int().positive().max(52_428_800, "File exceeds 50 MB");
const STORAGE_PATH = z.string().min(1).max(1024);

export const createAttachmentSchema = z.object({
  itemId: z.string().uuid(),
  storagePath: STORAGE_PATH,
  fileName: FILE_NAME,
  mimeType: MIME,
  sizeBytes: SIZE,
});

export const deleteAttachmentSchema = z.object({
  attachmentId: z.string().uuid(),
});

export const attachmentUrlSchema = z.object({
  attachmentId: z.string().uuid(),
});

export const attachmentUrlsSchema = z.object({
  attachmentIds: z.array(z.string().uuid()).max(60),
});

export type CreateAttachmentInput = z.infer<typeof createAttachmentSchema>;
export type DeleteAttachmentInput = z.infer<typeof deleteAttachmentSchema>;
export type AttachmentUrlInput = z.infer<typeof attachmentUrlSchema>;
export type AttachmentUrlsInput = z.infer<typeof attachmentUrlsSchema>;
```

- [ ] Verify typecheck: run `pnpm typecheck` (expected: PASS — schemas are self-contained).
- [ ] Commit: `git add src/lib/validations/collaboration-actions.ts && git commit -m "feat(collab): zod schemas for attachment actions"`

### 3b. `attachments-path.ts` — write failing test first

- [ ] Create `src/lib/collaboration/attachments-path.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  sanitizeFileName,
  buildStoragePath,
} from "@/lib/collaboration/attachments-path";

const ORG = "11111111-1111-4111-8111-111111111111";
const BOARD = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";

describe("sanitizeFileName", () => {
  it("takes the basename (drops path segments) and strips control chars, keeping the extension", () => {
    // basename of the path is `pa ss\x00wd.PNG`; the NUL is removed, the space
    // becomes a hyphen → `pa-sswd.PNG`.
    expect(sanitizeFileName("../../etc/pa ss\x00wd.PNG")).toBe("pa-sswd.PNG");
  });
  it("collapses whitespace and trims", () => {
    expect(sanitizeFileName("  my   report .pdf ")).toBe("my-report.pdf");
  });
  it("falls back to 'file' for an empty/all-stripped name", () => {
    expect(sanitizeFileName("///")).toBe("file");
  });
  it("strips characters outside the safe set", () => {
    expect(sanitizeFileName("ré$umé (final)!.pdf")).toBe("rum-final.pdf");
  });
  it("caps the length while preserving the extension", () => {
    const long = "a".repeat(300) + ".txt";
    const out = sanitizeFileName(long);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith(".txt")).toBe(true);
  });
});

describe("buildStoragePath", () => {
  it("prefixes org/board/item then a uuid-<name> object key", () => {
    const path = buildStoragePath({
      orgId: ORG,
      boardId: BOARD,
      itemId: ITEM,
      fileName: "Design Spec.pdf",
    });
    expect(path).toMatch(
      new RegExp(`^${ORG}/${BOARD}/${ITEM}/[0-9a-f-]{36}-Design-Spec\\.pdf$`),
    );
  });
});
```

- [ ] Run the test and confirm it FAILS (module not found): run `pnpm test src/lib/collaboration/attachments-path.test.ts` (expected: FAIL — `Cannot find module '@/lib/collaboration/attachments-path'`).
- [ ] Create `src/lib/collaboration/attachments-path.ts` (minimal implementation):

```ts
const MAX_NAME = 120;

/**
 * Make an arbitrary upload filename safe for a Storage object key. Pure.
 * Steps, in order:
 *   1. take the basename (drop everything before the last `/` or `\`),
 *   2. split off a short trailing `.ext`,
 *   3. on the base: remove control chars, keep only `[A-Za-z0-9._ -]`,
 *      collapse runs of whitespace/hyphens to a single `-`, trim stray
 *      leading/trailing `-`/`.`,
 *   4. fall back to `"file"` if nothing safe remains,
 *   5. cap length, preserving the extension.
 */
export function sanitizeFileName(raw: string): string {
  const basename = (raw.split(/[\\/]/).pop() ?? "").trim();
  const extMatch = basename.match(/\.[A-Za-z0-9]{1,12}$/);
  const ext = extMatch ? extMatch[0] : "";
  const rawBase = ext
    ? basename.slice(0, basename.length - ext.length)
    : basename;
  const base = rawBase
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "") // control chars
    .replace(/[^A-Za-z0-9._ -]/g, "") // conservative safe set
    .replace(/[\s-]+/g, "-") // collapse whitespace + hyphen runs
    .replace(/^[-.]+|[-.]+$/g, ""); // trim stray leading/trailing -/.
  const safeBase = base.length > 0 ? base : "file";
  const room = Math.max(1, MAX_NAME - ext.length);
  return `${safeBase.slice(0, room)}${ext}`;
}

/**
 * Build the bucket object key: <org>/<board>/<item>/<uuid>-<sanitized name>.
 * The leading org segment is what Storage RLS authorizes against. Pure.
 */
export function buildStoragePath(input: {
  orgId: string;
  boardId: string;
  itemId: string;
  fileName: string;
}): string {
  const safe = sanitizeFileName(input.fileName);
  return `${input.orgId}/${input.boardId}/${input.itemId}/${crypto.randomUUID()}-${safe}`;
}
```

- [ ] Run the test and confirm it PASSES: run `pnpm test src/lib/collaboration/attachments-path.test.ts` (expected: PASS). Adjust the implementation (not the assertions) until green.
- [ ] Commit: `git add src/lib/collaboration/attachments-path.ts src/lib/collaboration/attachments-path.test.ts && git commit -m "feat(collab): pure storage-path builder + filename sanitizer"`

### 3c. `attachments-format.ts` — write failing test first

- [ ] Create `src/lib/collaboration/attachments-format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  formatSize,
  fileKind,
  isPreviewable,
} from "@/lib/collaboration/attachments-format";

describe("formatSize", () => {
  it("formats bytes/KB/MB", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(900)).toBe("900 B");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(5_242_880)).toBe("5 MB");
  });
});

describe("fileKind", () => {
  it("classifies by mime then by extension", () => {
    expect(fileKind("image/png", "a.png")).toBe("image");
    expect(fileKind("video/mp4", "a.mp4")).toBe("video");
    expect(fileKind("application/pdf", "a.pdf")).toBe("pdf");
    expect(fileKind("application/zip", "a.zip")).toBe("archive");
    expect(fileKind("application/octet-stream", "a.xlsx")).toBe("sheet");
    expect(fileKind("application/octet-stream", "a.docx")).toBe("doc");
    expect(fileKind("application/octet-stream", "a.bin")).toBe("other");
  });
});

describe("isPreviewable", () => {
  it("allows raster images and mp4/webm video", () => {
    for (const m of [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "video/mp4",
      "video/webm",
    ])
      expect(isPreviewable(m)).toBe(true);
  });
  it("treats SVG as NOT previewable (navigated SVG can execute script)", () => {
    expect(isPreviewable("image/svg+xml")).toBe(false);
  });
  it("treats pdf/other as not previewable inline", () => {
    expect(isPreviewable("application/pdf")).toBe(false);
    expect(isPreviewable("application/octet-stream")).toBe(false);
  });
});
```

- [ ] Run the test and confirm it FAILS (module not found): run `pnpm test src/lib/collaboration/attachments-format.test.ts` (expected: FAIL).
- [ ] Create `src/lib/collaboration/attachments-format.ts`:

```ts
export type FileKind =
  | "image"
  | "video"
  | "pdf"
  | "doc"
  | "sheet"
  | "archive"
  | "other";

const PREVIEWABLE = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
]);

/** Inline-preview allow-list: raster images + mp4/webm only. SVG is excluded
 *  on purpose — a navigated SVG can execute script; rasters loaded via <img>
 *  cannot. Everything else renders as icon + Download. Pure. */
export function isPreviewable(mime: string): boolean {
  return PREVIEWABLE.has(mime.toLowerCase());
}

/** Human-readable size: B / KB / MB, ≤1 decimal, no trailing ".0". Pure. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${trim(kb)} KB`;
  return `${trim(kb / 1024)} MB`;
}

function trim(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Coarse type bucket for icons/badges — mime first, extension fallback. Pure. */
export function fileKind(mime: string, name: string): FileKind {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m === "application/pdf") return "pdf";
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archive";
  if (["xls", "xlsx", "csv", "numbers"].includes(ext)) return "sheet";
  if (["doc", "docx", "txt", "rtf", "md", "pages"].includes(ext)) return "doc";
  return "other";
}
```

- [ ] Run the test and confirm it PASSES: run `pnpm test src/lib/collaboration/attachments-format.test.ts` (expected: PASS).
- [ ] Commit: `git add src/lib/collaboration/attachments-format.ts src/lib/collaboration/attachments-format.test.ts && git commit -m "feat(collab): pure size/kind/previewable file helpers"`

---

## Task 4 — Server Actions + bounded query (tests first)

**Files:**

- Create: `src/lib/collaboration/attachments.ts`
- Create: `src/lib/collaboration/attachments.test.ts`
- Modify: `src/lib/collaboration/actions.ts`
- Create: `src/lib/collaboration/attachments-actions.test.ts`

### 4a. `getItemAttachments` bounded query — failing test first

- [ ] Create `src/lib/collaboration/attachments.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from }) }));

import { getItemAttachments } from "@/lib/collaboration/attachments";

const ITEM = "33333333-3333-4333-8333-333333333333";

describe("getItemAttachments", () => {
  it("reads the latest 50 for the item, newest first, no URL minting", async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [{ id: "x", item_id: ITEM }],
      error: null,
    });
    const order = vi.fn().mockReturnValue({ limit });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    from.mockReturnValue({ select });

    const rows = await getItemAttachments(ITEM);

    expect(from).toHaveBeenCalledWith("attachments");
    expect(select).toHaveBeenCalledWith("*");
    expect(eq).toHaveBeenCalledWith("item_id", ITEM);
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(limit).toHaveBeenCalledWith(50);
    expect(rows).toEqual([{ id: "x", item_id: ITEM }]);
  });
});
```

- [ ] Run the test and confirm it FAILS (module not found): run `pnpm test src/lib/collaboration/attachments.test.ts` (expected: FAIL).
- [ ] Create `src/lib/collaboration/attachments.ts`:

```ts
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/types/database.types";

export type Attachment = Tables<"attachments">;

const ATTACHMENTS_LIMIT = 50;

/**
 * Bounded list of an item's attachments — latest 50, item_id-indexed,
 * newest first. Metadata only; signed URLs are minted separately in the
 * Files surface so this read stays cheap. `cursor` (created_at) enables
 * a future "load more" without changing the call sites.
 */
export async function getItemAttachments(
  itemId: string,
  cursor?: string,
): Promise<Attachment[]> {
  const supabase = createClient();
  let q = supabase
    .from("attachments")
    .select("*")
    .eq("item_id", itemId)
    .order("created_at", { ascending: false })
    .limit(ATTACHMENTS_LIMIT);
  if (cursor) q = q.lt("created_at", cursor);
  const { data } = await q;
  return (data ?? []) as Attachment[];
}
```

> Note: the test mocks the chain `select().eq().order().limit()`. The optional `cursor` branch adds `.lt(...)` only when supplied, so the no-cursor test path (used by the hook on first load) hits exactly that chain.

- [ ] Run the test and confirm it PASSES: run `pnpm test src/lib/collaboration/attachments.test.ts` (expected: PASS).
- [ ] Commit: `git add src/lib/collaboration/attachments.ts src/lib/collaboration/attachments.test.ts && git commit -m "feat(collab): bounded getItemAttachments query"`

### 4b. Server Actions — failing test first

- [ ] Create `src/lib/collaboration/attachments-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
const getUser = vi.fn();
const createSignedUrl = vi.fn();
const createSignedUrls = vi.fn();
const remove = vi.fn();
const storageFrom = vi.fn(() => ({
  createSignedUrl,
  createSignedUrls,
  remove,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from,
    auth: { getUser },
    storage: { from: storageFrom },
  }),
}));

import {
  createAttachment,
  getAttachmentDownloadUrl,
  getAttachmentPreviewUrls,
  deleteAttachment,
} from "@/lib/collaboration/actions";

const ORG = "11111111-1111-4111-8111-111111111111";
const BOARD = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const ATT = "44444444-4444-4444-8444-444444444444";
const USER = "99999999-9999-4999-8999-999999999999";

function mockItemLookup() {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: { org_id: ORG, board_id: BOARD },
          error: null,
        }),
      }),
    }),
  };
}

beforeEach(() => {
  from.mockReset();
  getUser.mockReset();
  createSignedUrl.mockReset();
  createSignedUrls.mockReset();
  remove.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
});

describe("createAttachment", () => {
  it("rejects a storage_path that is not under the item's org/board/item prefix", async () => {
    from.mockImplementation((t: string) =>
      t === "items" ? (mockItemLookup() as never) : ({} as never),
    );
    const res = await createAttachment({
      itemId: ITEM,
      storagePath: `${ORG}/${BOARD}/SOMEONE-ELSE/abc-x.png`,
      fileName: "x.png",
      mimeType: "image/png",
      sizeBytes: 10,
    });
    expect(res.ok).toBe(false);
  });

  it("rejects a file over 50 MB before touching the db", async () => {
    const res = await createAttachment({
      itemId: ITEM,
      storagePath: `${ORG}/${BOARD}/${ITEM}/abc-x.png`,
      fileName: "x.png",
      mimeType: "image/png",
      sizeBytes: 52_428_801,
    });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("inserts the row when the path is under the correct prefix", async () => {
    const insert = vi.fn().mockReturnValue({
      select: () => ({
        single: async () => ({ data: { id: ATT }, error: null }),
      }),
    });
    from.mockImplementation((t: string) => {
      if (t === "items") return mockItemLookup() as never;
      if (t === "attachments") return { insert } as never;
      return {} as never;
    });
    const res = await createAttachment({
      itemId: ITEM,
      storagePath: `${ORG}/${BOARD}/${ITEM}/abc-x.png`,
      fileName: "x.png",
      mimeType: "image/png",
      sizeBytes: 10,
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: ORG,
        board_id: BOARD,
        item_id: ITEM,
        uploaded_by: USER,
        storage_path: `${ORG}/${BOARD}/${ITEM}/abc-x.png`,
        file_name: "x.png",
        mime_type: "image/png",
        size_bytes: 10,
      }),
    );
    expect(res).toEqual({ ok: true, data: { attachmentId: ATT } });
  });
});

describe("getAttachmentDownloadUrl", () => {
  it("mints a signed URL with an attachment-disposition download filename", async () => {
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              storage_path: `${ORG}/${BOARD}/${ITEM}/abc-x.png`,
              file_name: "x.png",
            },
            error: null,
          }),
        }),
      }),
    }));
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://signed/x" },
      error: null,
    });
    const res = await getAttachmentDownloadUrl({ attachmentId: ATT });
    expect(storageFrom).toHaveBeenCalledWith("attachments");
    expect(createSignedUrl).toHaveBeenCalledWith(
      `${ORG}/${BOARD}/${ITEM}/abc-x.png`,
      60,
      { download: "x.png" },
    );
    expect(res).toEqual({ ok: true, data: { url: "https://signed/x" } });
  });
});

describe("getAttachmentPreviewUrls", () => {
  // Real UUIDs — the action validates ids with attachmentUrlsSchema (UUIDs).
  const PNG = "55555555-5555-4555-8555-555555555555";
  const SVG = "66666666-6666-4666-8666-666666666666";
  it("mints inline (no-download) URLs only for previewable rows", async () => {
    from.mockImplementation(() => ({
      select: () => ({
        in: async () => ({
          data: [
            { id: PNG, storage_path: "p/x.png", mime_type: "image/png" },
            { id: SVG, storage_path: "s/x.svg", mime_type: "image/svg+xml" },
          ],
          error: null,
        }),
      }),
    }));
    createSignedUrls.mockResolvedValue({
      data: [{ path: "p/x.png", signedUrl: "https://signed/p" }],
      error: null,
    });
    const res = await getAttachmentPreviewUrls({ attachmentIds: [PNG, SVG] });
    expect(createSignedUrls).toHaveBeenCalledWith(["p/x.png"], 300);
    expect(res).toEqual({
      ok: true,
      data: { urls: { [PNG]: "https://signed/p" } },
    });
  });
});

describe("deleteAttachment", () => {
  it("removes the Storage object BEFORE deleting the row", async () => {
    const order: string[] = [];
    const del = vi.fn(() => ({
      eq: async () => {
        order.push("row");
        return { error: null };
      },
    }));
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: ATT,
              storage_path: `${ORG}/${BOARD}/${ITEM}/abc-x.png`,
              uploaded_by: USER,
              org_id: ORG,
            },
            error: null,
          }),
        }),
      }),
      delete: del,
    }));
    remove.mockImplementation(async () => {
      order.push("object");
      return { error: null };
    });
    const res = await deleteAttachment({ attachmentId: ATT });
    expect(order).toEqual(["object", "row"]);
    expect(remove).toHaveBeenCalledWith([`${ORG}/${BOARD}/${ITEM}/abc-x.png`]);
    expect(res).toEqual({ ok: true, data: undefined });
  });
});
```

- [ ] Run the test and confirm it FAILS (the four actions don't exist yet): run `pnpm test src/lib/collaboration/attachments-actions.test.ts` (expected: FAIL).
- [ ] Add the imports to `src/lib/collaboration/actions.ts` (extend the existing validations import and add the format/previewable helper):

```ts
import {
  addUpdateSchema,
  editUpdateSchema,
  deleteUpdateSchema,
  markNotificationReadSchema,
  createAttachmentSchema,
  deleteAttachmentSchema,
  attachmentUrlSchema,
  attachmentUrlsSchema,
} from "@/lib/validations/collaboration-actions";
import { isPreviewable } from "@/lib/collaboration/attachments-format";
```

- [ ] Append the four Server Actions to `src/lib/collaboration/actions.ts` (after `markAllNotificationsRead`, reusing the existing `fail` helper and `ActionResult` shape):

```ts
const DOWNLOAD_TTL = 60; // short-lived; re-minted per click
const PREVIEW_TTL = 300; // inline preview window for the gallery/lightbox

export async function createAttachment(input: {
  itemId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<ActionResult<{ attachmentId: string }>> {
  const parsed = createAttachmentSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  // Re-derive org/board from the item (RLS-scoped) and reject any path not
  // under this org/board/item — a client cannot register a row pointing at
  // another tenant's object (path-spoof guard).
  const { data: item, error: itemErr } = await supabase
    .from("items")
    .select("org_id, board_id")
    .eq("id", parsed.data.itemId)
    .maybeSingle();
  if (itemErr || !item) return fail("Item not found.");

  const prefix = `${item.org_id}/${item.board_id}/${parsed.data.itemId}/`;
  if (!parsed.data.storagePath.startsWith(prefix))
    return fail("Storage path does not match this item.");

  const { data, error } = await supabase
    .from("attachments")
    .insert({
      org_id: item.org_id,
      board_id: item.board_id,
      item_id: parsed.data.itemId,
      uploaded_by: user.id,
      storage_path: parsed.data.storagePath,
      file_name: parsed.data.fileName,
      mime_type: parsed.data.mimeType,
      size_bytes: parsed.data.sizeBytes,
    })
    .select("id")
    .single();
  if (error || !data)
    return fail(error?.message ?? "Could not register attachment.");
  return { ok: true, data: { attachmentId: data.id } };
}

export async function getAttachmentDownloadUrl(input: {
  attachmentId: string;
}): Promise<ActionResult<{ url: string }>> {
  const parsed = attachmentUrlSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("attachments")
    .select("storage_path, file_name")
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();
  if (error || !row) return fail("Attachment not found.");

  // Attachment disposition forces a download (never a top-level render) — the
  // "any type" XSS mitigation for HTML/SVG uploads.
  const { data: signed, error: signErr } = await supabase.storage
    .from("attachments")
    .createSignedUrl(row.storage_path, DOWNLOAD_TTL, {
      download: row.file_name,
    });
  if (signErr || !signed) return fail("Could not sign download URL.");
  return { ok: true, data: { url: signed.signedUrl } };
}

export async function getAttachmentPreviewUrls(input: {
  attachmentIds: string[];
}): Promise<ActionResult<{ urls: Record<string, string> }>> {
  const parsed = attachmentUrlsSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  if (parsed.data.attachmentIds.length === 0)
    return { ok: true, data: { urls: {} } };

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("attachments")
    .select("id, storage_path, mime_type")
    .in("id", parsed.data.attachmentIds);
  if (error || !rows) return fail("Could not load attachments.");

  // Inline preview only for the safe raster/video allow-list (no `download`).
  const previewable = rows.filter((r) => isPreviewable(r.mime_type));
  if (previewable.length === 0) return { ok: true, data: { urls: {} } };

  const paths = previewable.map((r) => r.storage_path);
  const { data: signed, error: signErr } = await supabase.storage
    .from("attachments")
    .createSignedUrls(paths, PREVIEW_TTL);
  if (signErr || !signed) return fail("Could not sign preview URLs.");

  const byPath = new Map(
    signed
      .filter((s) => s.signedUrl)
      .map((s) => [s.path as string, s.signedUrl as string]),
  );
  const urls: Record<string, string> = {};
  for (const r of previewable) {
    const u = byPath.get(r.storage_path);
    if (u) urls[r.id] = u;
  }
  return { ok: true, data: { urls } };
}

export async function deleteAttachment(input: {
  attachmentId: string;
}): Promise<ActionResult> {
  const parsed = deleteAttachmentSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("attachments")
    .select("id, storage_path, uploaded_by, org_id")
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();
  // RLS already hides rows outside the caller's org; a missing row is a no-op.
  if (error || !row) return fail("Attachment not found.");

  // Object first so a metadata row never dangles pointing at live bytes.
  // Storage RLS independently enforces uploader-or-admin on the object.
  const { error: rmErr } = await supabase.storage
    .from("attachments")
    .remove([row.storage_path]);
  if (rmErr) return fail("Could not remove file.");

  // Table RLS enforces uploader-or-admin on the row delete (the real guard).
  const { error: delErr } = await supabase
    .from("attachments")
    .delete()
    .eq("id", row.id);
  if (delErr) return fail(delErr.message);
  return { ok: true, data: undefined };
}
```

- [ ] Run the test and confirm it PASSES: run `pnpm test src/lib/collaboration/attachments-actions.test.ts` (expected: PASS). Also run the existing `actions.test.ts` to confirm no regression: `pnpm test src/lib/collaboration/actions.test.ts`.
- [ ] Commit: `git add src/lib/collaboration/actions.ts src/lib/collaboration/attachments-actions.test.ts && git commit -m "feat(collab): attachment server actions (create/download/preview/delete)"`

---

## Task 5 — Cache helpers (test first)

**Files:**

- Create: `src/lib/collaboration/attachments-cache.ts`
- Create: `src/lib/collaboration/attachments-cache.test.ts`

- [ ] Create `src/lib/collaboration/attachments-cache.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  prependAttachment,
  removeAttachment,
  type AttachmentsCache,
} from "@/lib/collaboration/attachments-cache";
import type { Tables } from "@/types/database.types";

function a(id: string): Tables<"attachments"> {
  return {
    id,
    org_id: "o",
    board_id: "b",
    item_id: "i",
    update_id: null,
    uploaded_by: "u",
    storage_path: `o/b/i/${id}-x.png`,
    file_name: "x.png",
    mime_type: "image/png",
    size_bytes: 10,
    created_at: "2026-06-17T00:00:00Z",
  } as Tables<"attachments">;
}

describe("attachments cache", () => {
  it("prepends + de-dupes by id", () => {
    let c: AttachmentsCache = { attachments: [a("a")] };
    c = prependAttachment(c, a("b"));
    expect(c.attachments.map((x) => x.id)).toEqual(["b", "a"]);
    c = prependAttachment(c, a("b"));
    expect(c.attachments).toHaveLength(2);
  });
  it("removes by id", () => {
    const c = removeAttachment({ attachments: [a("a"), a("b")] }, "a");
    expect(c.attachments.map((x) => x.id)).toEqual(["b"]);
  });
});
```

- [ ] Run the test and confirm it FAILS (module not found): run `pnpm test src/lib/collaboration/attachments-cache.test.ts` (expected: FAIL).
- [ ] Create `src/lib/collaboration/attachments-cache.ts` (mirrors `cache.ts`):

```ts
import type { Tables } from "@/types/database.types";

export type Attachment = Tables<"attachments">;
export type AttachmentsCache = { attachments: Attachment[] };

export function prependAttachment(
  c: AttachmentsCache,
  row: Attachment,
): AttachmentsCache {
  if (c.attachments.some((x) => x.id === row.id)) return c;
  return { attachments: [row, ...c.attachments] };
}

export function removeAttachment(
  c: AttachmentsCache,
  id: string,
): AttachmentsCache {
  return { attachments: c.attachments.filter((x) => x.id !== id) };
}
```

- [ ] Run the test and confirm it PASSES: run `pnpm test src/lib/collaboration/attachments-cache.test.ts` (expected: PASS).
- [ ] Commit: `git add src/lib/collaboration/attachments-cache.ts src/lib/collaboration/attachments-cache.test.ts && git commit -m "feat(collab): attachments cache helpers (prepend/remove)"`

---

## Task 6 — Hooks + Realtime (lazy query, optimistic mutations, extend channel)

**Files:**

- Create: `src/lib/collaboration/use-item-attachments.ts`
- Create: `src/lib/collaboration/use-attachment-mutations.ts`
- Modify: `src/lib/collaboration/use-item-collab.ts`

These are `"use client"` React-Query/Realtime hooks. They are integration-covered by the component tests (Task 8) and e2e (Task 9); the data-layer logic they call is unit-covered in Tasks 4–5. No standalone hook unit test is added here (matches the repo: `use-update-mutations.ts` has no isolated test).

### 6a. Lazy list query + batched preview URLs

- [ ] Create `src/lib/collaboration/use-item-attachments.ts`:

```ts
"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getItemAttachments } from "@/lib/collaboration/attachments";
import { getAttachmentPreviewUrls } from "@/lib/collaboration/actions";
import { isPreviewable } from "@/lib/collaboration/attachments-format";
import type { AttachmentsCache } from "@/lib/collaboration/attachments-cache";

export function itemAttachmentsKey(itemId: string) {
  return ["item-attachments", itemId] as const;
}

/**
 * Lazy attachments surface for the Files tab. The list query is `enabled`
 * only once the tab has been opened (`active`), so opening the panel costs 0
 * round-trips. After the list resolves it batch-mints inline preview URLs for
 * the previewable rows in one Server Action call (re-minted as the list grows).
 */
export function useItemAttachments(itemId: string | null, active: boolean) {
  const qc = useQueryClient();
  const enabled = !!itemId && active;

  const list = useQuery({
    queryKey: itemAttachmentsKey(itemId ?? "none"),
    enabled,
    staleTime: Infinity,
    queryFn: async (): Promise<AttachmentsCache> => {
      const attachments = await getItemAttachments(itemId!);
      return { attachments };
    },
  });

  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  // Batch-mint inline preview URLs for the previewable rows. Keyed on the set
  // of previewable ids so it re-mints when the list grows but not on every
  // render. URLs are short-TTL; re-running on cache change keeps them fresh.
  const previewableIds = (list.data?.attachments ?? [])
    .filter((a) => isPreviewable(a.mime_type))
    .map((a) => a.id);
  const previewKey = previewableIds.join(",");

  useEffect(() => {
    if (!enabled || previewableIds.length === 0) {
      setPreviewUrls({});
      return;
    }
    let cancelled = false;
    void getAttachmentPreviewUrls({ attachmentIds: previewableIds }).then(
      (res) => {
        if (!cancelled && res.ok) setPreviewUrls(res.data.urls);
      },
    );
    return () => {
      cancelled = true;
    };
    // previewKey captures the id set; previewableIds is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, previewKey]);

  return { list, previewUrls, key: itemAttachmentsKey(itemId ?? "none") };
}
```

- [ ] Verify typecheck: run `pnpm typecheck` (expected: PASS).

### 6b. Optimistic upload + remove mutations

- [ ] Create `src/lib/collaboration/use-attachment-mutations.ts`:

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  createAttachment,
  deleteAttachment,
} from "@/lib/collaboration/actions";
import { buildStoragePath } from "@/lib/collaboration/attachments-path";
import {
  prependAttachment,
  removeAttachment,
  type Attachment,
  type AttachmentsCache,
} from "@/lib/collaboration/attachments-cache";
import { itemAttachmentsKey } from "@/lib/collaboration/use-item-attachments";

export const MAX_FILE_BYTES = 52_428_800; // 50 MB

type UploadVars = { file: File };
type UploadCtx = {
  previous?: AttachmentsCache;
  optimisticId?: string;
  path?: string;
};
type RemoveVars = { attachmentId: string };
type RemoveCtx = { previous?: AttachmentsCache };

export function useAttachmentMutations(
  itemId: string,
  uploaderId: string,
  ctx: { orgId: string; boardId: string },
) {
  const qc = useQueryClient();
  const key = itemAttachmentsKey(itemId);

  const upload = useMutation<
    { attachmentId: string },
    Error,
    UploadVars,
    UploadCtx
  >({
    mutationFn: async ({ file }) => {
      if (file.size > MAX_FILE_BYTES) throw new Error("File exceeds 50 MB.");
      if (file.size === 0) throw new Error("File is empty.");
      const path = buildStoragePath({
        orgId: ctx.orgId,
        boardId: ctx.boardId,
        itemId,
        fileName: file.name,
      });
      // Client-direct upload (authorized by the Storage INSERT policy).
      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from("attachments")
        .upload(path, file, {
          contentType: file.type || "application/octet-stream",
        });
      if (upErr) throw new Error(upErr.message);
      // Register the metadata row.
      const res = await createAttachment({
        itemId,
        storagePath: path,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
      if (!res.ok) {
        // Best-effort orphan cleanup if the register failed.
        await supabase.storage.from("attachments").remove([path]);
        throw new Error(res.error);
      }
      return res.data;
    },
    onMutate: async ({ file }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<AttachmentsCache>(key);
      const optimisticId = `optimistic-${crypto.randomUUID()}`;
      const path = buildStoragePath({
        orgId: ctx.orgId,
        boardId: ctx.boardId,
        itemId,
        fileName: file.name,
      });
      const optimistic: Attachment = {
        id: optimisticId,
        org_id: ctx.orgId,
        board_id: ctx.boardId,
        item_id: itemId,
        update_id: null,
        uploaded_by: uploaderId,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        created_at: new Date().toISOString(),
      } as Attachment;
      qc.setQueryData<AttachmentsCache>(
        key,
        prependAttachment(previous ?? { attachments: [] }, optimistic),
      );
      return { previous, optimisticId, path };
    },
    onError: (_e, _v, c) => {
      qc.setQueryData<AttachmentsCache>(key, (prev) =>
        c?.optimisticId && prev ? removeAttachment(prev, c.optimisticId) : prev,
      );
    },
    onSuccess: () => {
      // Refetch authoritative list rather than swap the optimistic id — the
      // Realtime INSERT echo can prepend the real row first and the id-swap
      // would duplicate it (staleTime: Infinity would never heal). Same
      // reasoning as use-update-mutations.
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const remove = useMutation<void, Error, RemoveVars, RemoveCtx>({
    mutationFn: async ({ attachmentId }) => {
      const res = await deleteAttachment({ attachmentId });
      if (!res.ok) throw new Error(res.error);
    },
    onMutate: async ({ attachmentId }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<AttachmentsCache>(key);
      if (previous)
        qc.setQueryData<AttachmentsCache>(
          key,
          removeAttachment(previous, attachmentId),
        );
      return { previous };
    },
    onError: (_e, _v, c) => {
      if (c?.previous) qc.setQueryData(key, c.previous);
    },
  });

  return {
    uploadFile: (file: File) => upload.mutate({ file }),
    deleteAttachment: (attachmentId: string) => remove.mutate({ attachmentId }),
    isUploading: upload.isPending,
    uploadError: upload.error?.message ?? null,
  };
}
```

- [ ] Verify typecheck: run `pnpm typecheck` (expected: PASS).

### 6c. Extend the per-item Realtime channel

- [ ] Modify `src/lib/collaboration/use-item-collab.ts` to also subscribe to `attachments` INSERT/DELETE for the item. Add these imports at the top alongside the existing cache imports:

```ts
import {
  prependAttachment,
  removeAttachment,
  type Attachment,
  type AttachmentsCache,
} from "@/lib/collaboration/attachments-cache";
import { itemAttachmentsKey } from "@/lib/collaboration/use-item-attachments";
```

- [ ] Inside the `useEffect`, after `const aKey = itemActivityKey(itemId);`, add the attachments key and handler, then add the `.on(...)` to the channel chain. The handler:

```ts
const atKey = itemAttachmentsKey(itemId);

function onAttachment(p: RealtimePostgresChangesPayload<Attachment>) {
  if (p.eventType === "DELETE") {
    const id = (p.old as Partial<Attachment>).id;
    if (id)
      qc.setQueryData<AttachmentsCache>(atKey, (prev) =>
        prev ? removeAttachment(prev, id) : prev,
      );
    return;
  }
  if (p.eventType !== "INSERT") return;
  const row = p.new as Attachment;
  qc.setQueryData<AttachmentsCache>(atKey, (prev) =>
    prev ? prependAttachment(prev, row) : prev,
  );
}
```

- [ ] Add the third subscription to the channel chain (after the `item_activities` `.on(...)`, before `.subscribe()`):

```ts
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attachments", filter },
        onAttachment,
      )
```

> Note: `qc.setQueryData(atKey, ...)` only mutates the cache when it already exists (the `prev ? ... : prev` guard), so the lazy `enabled` gating is respected — a peer's INSERT before the local Files tab has opened is a no-op, and the bounded list query picks it up on first open.

- [ ] Verify typecheck + lint: run `pnpm typecheck && pnpm lint` (expected: PASS).
- [ ] Commit: `git add src/lib/collaboration/use-item-attachments.ts src/lib/collaboration/use-attachment-mutations.ts src/lib/collaboration/use-item-collab.ts && git commit -m "feat(collab): lazy attachments query, optimistic mutations, item realtime"`

---

## Task 7 — UI: Files tab + card + row + lightbox

**Files:**

- Modify: `src/components/boards/item-panel/ItemPanel.tsx`
- Create: `src/components/boards/item-panel/AttachmentCard.tsx`
- Create: `src/components/boards/item-panel/AttachmentRow.tsx`
- Create: `src/components/boards/item-panel/FilePreviewLightbox.tsx`
- Create: `src/components/boards/item-panel/FilesTab.tsx`

> **UI sub-skills required before this task:** load the `pulse-ui` skill (dark monochromatic + single-accent tokens, app primitives) and the generic `frontend-design` skill. Use existing primitives: `Button` (`@/components/ui/button`), `Dialog`/`DialogContent` (`@/components/ui/dialog`), `lucide-react` icons. There is no toast library in the repo — surface upload/delete errors inline in the tab (an error banner + the per-card error state), not via a toast. Component tests come in Task 8; build the components green-by-construction, then write the tests.

> **Delete affordance (v1):** the Delete button is shown only when `canDelete` is true —
> `attachment.uploaded_by === currentUserId` (uploader-only in the UI). Org admins/owners are still
> permitted to delete by **table + Storage RLS** (the `has_org_role(...,['owner','admin'])` policies),
> but a UI affordance for admin-deleting _another_ member's file is a deferred fast-follow — it needs
> the current user's org role plumbed into the panel (today only `currentUserId` + `members` are
> passed). This keeps v1 free of a confusing "click Delete → silent RLS denial → optimistic revert"
> path for non-uploaders.

### 7a. AttachmentCard

- [ ] Create `src/components/boards/item-panel/AttachmentCard.tsx`:

```tsx
"use client";

import { Download, Eye, Trash2, Play, FileText } from "lucide-react";
import {
  fileKind,
  formatSize,
  isPreviewable,
} from "@/lib/collaboration/attachments-format";
import type { Attachment } from "@/lib/collaboration/attachments-cache";
import type { Member } from "@/lib/collaboration/activity";

export function AttachmentCard({
  attachment,
  previewUrl,
  members,
  uploading,
  canDelete,
  onPreview,
  onDownload,
  onDelete,
}: {
  attachment: Attachment;
  previewUrl?: string;
  members: readonly Member[];
  uploading?: boolean;
  canDelete: boolean;
  onPreview: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const kind = fileKind(attachment.mime_type, attachment.file_name);
  const uploader =
    members.find((m) => m.userId === attachment.uploaded_by)?.fullName ??
    "Someone";
  const previewable = isPreviewable(attachment.mime_type);

  return (
    <div className="group border-border bg-card relative flex flex-col overflow-hidden rounded-lg border">
      <div className="bg-muted relative flex aspect-video items-center justify-center">
        {previewable && kind === "image" && previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={attachment.file_name}
            className="h-full w-full object-cover"
          />
        ) : kind === "video" ? (
          <Play className="text-muted-foreground h-8 w-8" aria-hidden />
        ) : (
          <FileText className="text-muted-foreground h-8 w-8" aria-hidden />
        )}

        {uploading && (
          <div className="bg-background/60 absolute inset-0 grid place-items-center text-xs">
            Uploading…
          </div>
        )}

        {!uploading && (
          <div className="bg-background/70 absolute inset-0 flex items-center justify-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
            {previewable && (
              <button
                onClick={onPreview}
                aria-label="Preview"
                className="hover:text-primary"
              >
                <Eye className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onDownload}
              aria-label="Download"
              className="hover:text-primary"
            >
              <Download className="h-4 w-4" />
            </button>
            {canDelete && (
              <button
                onClick={onDelete}
                aria-label="Delete"
                className="hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-0.5 p-2">
        <span
          className="truncate text-sm font-medium"
          title={attachment.file_name}
        >
          {attachment.file_name}
        </span>
        <span className="text-muted-foreground text-xs">
          {formatSize(attachment.size_bytes)} · {uploader}
        </span>
      </div>
    </div>
  );
}
```

### 7b. AttachmentRow

- [ ] Create `src/components/boards/item-panel/AttachmentRow.tsx`:

```tsx
"use client";

import { Download, Eye, Trash2, File } from "lucide-react";
import {
  formatSize,
  isPreviewable,
} from "@/lib/collaboration/attachments-format";
import type { Attachment } from "@/lib/collaboration/attachments-cache";
import type { Member } from "@/lib/collaboration/activity";

export function AttachmentRow({
  attachment,
  members,
  canDelete,
  onPreview,
  onDownload,
  onDelete,
}: {
  attachment: Attachment;
  members: readonly Member[];
  canDelete: boolean;
  onPreview: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const uploader =
    members.find((m) => m.userId === attachment.uploaded_by)?.fullName ??
    "Someone";
  const previewable = isPreviewable(attachment.mime_type);

  return (
    <div className="group hover:bg-accent flex items-center gap-3 rounded-md px-2 py-1.5 text-sm">
      <File className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate" title={attachment.file_name}>
        {attachment.file_name}
      </span>
      <span className="text-muted-foreground w-20 shrink-0 text-right text-xs">
        {formatSize(attachment.size_bytes)}
      </span>
      <span className="text-muted-foreground w-28 shrink-0 truncate text-xs">
        {uploader}
      </span>
      <div className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
        {previewable && (
          <button
            onClick={onPreview}
            aria-label="Preview"
            className="hover:text-primary"
          >
            <Eye className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={onDownload}
          aria-label="Download"
          className="hover:text-primary"
        >
          <Download className="h-4 w-4" />
        </button>
        {canDelete && (
          <button
            onClick={onDelete}
            aria-label="Delete"
            className="hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
```

### 7c. FilePreviewLightbox

- [ ] Create `src/components/boards/item-panel/FilePreviewLightbox.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Trash2,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  fileKind,
  formatSize,
  isPreviewable,
} from "@/lib/collaboration/attachments-format";
import type { Attachment } from "@/lib/collaboration/attachments-cache";

export function FilePreviewLightbox({
  attachments,
  index,
  previewUrls,
  currentUserId,
  onIndexChange,
  onClose,
  onDownload,
  onDelete,
}: {
  attachments: readonly Attachment[];
  index: number;
  previewUrls: Record<string, string>;
  currentUserId: string;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  onDownload: (a: Attachment) => void;
  onDelete: (a: Attachment) => void;
}) {
  const current = attachments[index];
  const count = attachments.length;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      if (e.key === "ArrowRight" && index < count - 1) onIndexChange(index + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, count, onClose, onIndexChange]);

  if (!current) return null;
  const url = previewUrls[current.id];
  const kind = fileKind(current.mime_type, current.file_name);
  const previewable = isPreviewable(current.mime_type);
  const canDelete = current.uploaded_by === currentUserId;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogTitle className="sr-only">{current.file_name}</DialogTitle>
        <div className="mb-2 flex items-center justify-between">
          <span className="truncate text-sm font-medium">
            {current.file_name}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onDownload(current)}
              aria-label="Open in new tab"
              className="hover:text-primary"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
            <button
              onClick={() => onDownload(current)}
              aria-label="Download"
              className="hover:text-primary"
            >
              <Download className="h-4 w-4" />
            </button>
            {canDelete && (
              <button
                onClick={() => onDelete(current)}
                aria-label="Delete"
                className="hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              className="hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="bg-muted relative grid min-h-64 place-items-center rounded-md">
          {index > 0 && (
            <button
              onClick={() => onIndexChange(index - 1)}
              aria-label="Previous"
              className="absolute top-1/2 left-2 -translate-y-1/2"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}

          {previewable && kind === "image" && url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={current.file_name}
              className="max-h-[60vh] object-contain"
            />
          ) : previewable && kind === "video" && url ? (
            <video src={url} controls className="max-h-[60vh]" />
          ) : (
            <div className="flex flex-col items-center gap-2 p-8 text-sm">
              <span className="text-muted-foreground">No inline preview.</span>
              <button
                onClick={() => onDownload(current)}
                className="text-primary underline"
              >
                Download
              </button>
            </div>
          )}

          {index < count - 1 && (
            <button
              onClick={() => onIndexChange(index + 1)}
              aria-label="Next"
              className="absolute top-1/2 right-2 -translate-y-1/2"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between">
          <div className="flex gap-1 overflow-x-auto">
            {attachments.map((a, i) => (
              <button
                key={a.id}
                onClick={() => onIndexChange(i)}
                aria-label={`Preview ${a.file_name}`}
                className={`h-10 w-10 shrink-0 overflow-hidden rounded border ${
                  i === index ? "border-primary" : "border-border"
                }`}
              >
                {isPreviewable(a.mime_type) && previewUrls[a.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrls[a.id]}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="bg-muted block h-full w-full" />
                )}
              </button>
            ))}
          </div>
          <span className="text-muted-foreground shrink-0 text-xs">
            {formatSize(current.size_bytes)}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### 7d. FilesTab

- [ ] Create `src/components/boards/item-panel/FilesTab.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { Plus, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAttachmentDownloadUrl } from "@/lib/collaboration/actions";
import { formatSize } from "@/lib/collaboration/attachments-format";
import type { AttachmentsCache } from "@/lib/collaboration/attachments-cache";
import type { Member } from "@/lib/collaboration/activity";
import { AttachmentCard } from "./AttachmentCard";
import { AttachmentRow } from "./AttachmentRow";
import { FilePreviewLightbox } from "./FilePreviewLightbox";

type ViewMode = "gallery" | "list";

export function FilesTab({
  cache,
  previewUrls,
  members,
  currentUserId,
  isUploading,
  uploadError,
  onUpload,
  onDelete,
}: {
  cache: AttachmentsCache | undefined;
  previewUrls: Record<string, string>;
  members: readonly Member[];
  currentUserId: string;
  isUploading: boolean;
  uploadError: string | null;
  onUpload: (file: File) => void;
  onDelete: (attachmentId: string) => void;
}) {
  const [mode, setMode] = useState<ViewMode>("gallery");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const attachments = cache?.attachments ?? [];
  const totalBytes = attachments.reduce((n, a) => n + a.size_bytes, 0);

  function pick(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) onUpload(f);
  }

  async function download(attachmentId: string) {
    const res = await getAttachmentDownloadUrl({ attachmentId });
    if (res.ok) window.open(res.data.url, "_blank", "noopener");
  }

  return (
    <div
      className={`flex flex-col gap-4 rounded-md ${dragOver ? "ring-primary ring-2" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        pick(e.dataTransfer.files);
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">
          {attachments.length} file{attachments.length === 1 ? "" : "s"} ·{" "}
          {formatSize(totalBytes)}
        </span>
        <div className="flex items-center gap-2">
          <div className="border-border flex rounded-md border">
            <button
              onClick={() => setMode("gallery")}
              aria-label="Gallery view"
              aria-pressed={mode === "gallery"}
              className={`px-2 py-1 ${mode === "gallery" ? "bg-accent" : ""}`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setMode("list")}
              aria-label="List view"
              aria-pressed={mode === "list"}
              className={`px-2 py-1 ${mode === "list" ? "bg-accent" : ""}`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
          <Button
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
          >
            <Plus className="mr-1 h-4 w-4" /> Add files
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            aria-label="Add files"
            onChange={(e) => pick(e.target.files)}
          />
        </div>
      </div>

      {uploadError && (
        <p className="text-destructive text-xs" role="alert">
          {uploadError}
        </p>
      )}

      {attachments.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center text-sm">
          No files yet. Drop files here or use “Add files”.
        </p>
      ) : mode === "gallery" ? (
        <div className="grid grid-cols-2 gap-3">
          {attachments.map((a, i) => (
            <AttachmentCard
              key={a.id}
              attachment={a}
              previewUrl={previewUrls[a.id]}
              members={members}
              uploading={a.id.startsWith("optimistic-")}
              canDelete={a.uploaded_by === currentUserId}
              onPreview={() => setLightboxIndex(i)}
              onDownload={() => download(a.id)}
              onDelete={() => onDelete(a.id)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col">
          {attachments.map((a, i) => (
            <AttachmentRow
              key={a.id}
              attachment={a}
              members={members}
              canDelete={a.uploaded_by === currentUserId}
              onPreview={() => setLightboxIndex(i)}
              onDownload={() => download(a.id)}
              onDelete={() => onDelete(a.id)}
            />
          ))}
        </div>
      )}

      {lightboxIndex !== null && (
        <FilePreviewLightbox
          attachments={attachments}
          index={lightboxIndex}
          previewUrls={previewUrls}
          currentUserId={currentUserId}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onDownload={(a) => download(a.id)}
          onDelete={(a) => {
            onDelete(a.id);
            setLightboxIndex(null);
          }}
        />
      )}
    </div>
  );
}
```

### 7e. Wire the Files tab into ItemPanel

- [ ] Modify `src/components/boards/item-panel/ItemPanel.tsx`: add the `"files"` tab type, the new hooks, and the rendered tab. Replace the `Tab` type and the destructured hook line:

```ts
type Tab = "fields" | "updates" | "activity" | "files";
```

- [ ] Add the new imports near the existing hook imports:

```ts
import { useItemAttachments } from "@/lib/collaboration/use-item-attachments";
import { useAttachmentMutations } from "@/lib/collaboration/use-attachment-mutations";
import { FilesTab } from "./FilesTab";
```

- [ ] After `const { updates, activity } = useItemCollab(itemId);`, add the attachments hooks (the Files query is lazy — `active` is true only once the Files tab has been selected):

```ts
const filesOpened = tab === "files";
const { list: attachments, previewUrls } = useItemAttachments(
  itemId,
  filesOpened,
);
const attachmentMutations = useAttachmentMutations(
  itemId ?? "none",
  currentUserId,
  { orgId, boardId },
);
```

> Note: `tab` is declared above with `useState`. Reference `filesOpened` after the `tab` declaration. Keep `useItemAttachments` enabled by `active` so opening the panel itself stays 0 round-trips; the query only fires on first Files-tab selection and then holds (`staleTime: Infinity`).

- [ ] Add `"files"` to the tab-button array and render the tab content. Change the array literal `(["fields", "updates", "activity"] as const)` to `(["fields", "updates", "activity", "files"] as const)`, and add the content block after the `activity` block:

```tsx
{
  tab === "files" && (
    <FilesTab
      cache={attachments.data}
      previewUrls={previewUrls}
      members={members}
      currentUserId={currentUserId}
      isUploading={attachmentMutations.isUploading}
      uploadError={attachmentMutations.uploadError}
      onUpload={attachmentMutations.uploadFile}
      onDelete={attachmentMutations.deleteAttachment}
    />
  );
}
```

- [ ] Verify typecheck + lint + build: run `pnpm typecheck && pnpm lint && pnpm build` (expected: PASS).
- [ ] Commit: `git add src/components/boards/item-panel/ && git commit -m "feat(collab): Files tab — gallery/list + drop zone + preview lightbox"`

---

## Task 8 — Component tests (Files tab + lightbox)

**Files:**

- Create: `src/components/boards/item-panel/FilesTab.test.tsx`
- Create: `src/components/boards/item-panel/FilePreviewLightbox.test.tsx`

These use Testing Library + jsdom (the repo's Vitest env). They mock the download Server Action so no network is hit.

- [ ] Create `src/components/boards/item-panel/FilesTab.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilesTab } from "@/components/boards/item-panel/FilesTab";
import type { AttachmentsCache } from "@/lib/collaboration/attachments-cache";
import type { Tables } from "@/types/database.types";

vi.mock("@/lib/collaboration/actions", () => ({
  getAttachmentDownloadUrl: vi.fn().mockResolvedValue({
    ok: true,
    data: { url: "https://signed/x" },
  }),
}));

const members = [{ userId: "u", fullName: "Ada" }];

function att(
  id: string,
  over: Partial<Tables<"attachments">> = {},
): Tables<"attachments"> {
  return {
    id,
    org_id: "o",
    board_id: "b",
    item_id: "i",
    update_id: null,
    uploaded_by: "u",
    storage_path: `o/b/i/${id}-x.png`,
    file_name: "report.png",
    mime_type: "image/png",
    size_bytes: 2048,
    created_at: "2026-06-17T00:00:00Z",
    ...over,
  } as Tables<"attachments">;
}

const base = {
  previewUrls: {} as Record<string, string>,
  members,
  currentUserId: "u", // att() default uploaded_by is "u" → Delete affordance shown
  isUploading: false,
  uploadError: null,
  onUpload: vi.fn(),
  onDelete: vi.fn(),
};

describe("FilesTab", () => {
  it("renders the empty state when there are no files", () => {
    render(<FilesTab cache={{ attachments: [] }} {...base} />);
    expect(screen.getByText(/No files yet/i)).toBeInTheDocument();
  });

  it("renders gallery cards with name + size", () => {
    const cache: AttachmentsCache = { attachments: [att("a")] };
    render(<FilesTab cache={cache} {...base} />);
    expect(screen.getByText("report.png")).toBeInTheDocument();
    expect(screen.getByText(/2 KB/)).toBeInTheDocument();
  });

  it("toggles to list view", () => {
    const cache: AttachmentsCache = { attachments: [att("a")] };
    render(<FilesTab cache={cache} {...base} />);
    fireEvent.click(screen.getByLabelText("List view"));
    expect(screen.getByLabelText("List view")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows the uploading state for an optimistic card", () => {
    const cache: AttachmentsCache = {
      attachments: [att("optimistic-1")],
    };
    render(<FilesTab cache={cache} {...base} />);
    expect(screen.getByText(/Uploading/i)).toBeInTheDocument();
  });

  it("surfaces an upload error inline", () => {
    render(
      <FilesTab
        cache={{ attachments: [] }}
        {...base}
        uploadError="File exceeds 50 MB."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("File exceeds 50 MB.");
  });
});
```

- [ ] Run the test and confirm it PASSES: run `pnpm test src/components/boards/item-panel/FilesTab.test.tsx` (expected: PASS).
- [ ] Create `src/components/boards/item-panel/FilePreviewLightbox.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilePreviewLightbox } from "@/components/boards/item-panel/FilePreviewLightbox";
import type { Tables } from "@/types/database.types";

function att(
  id: string,
  over: Partial<Tables<"attachments">> = {},
): Tables<"attachments"> {
  return {
    id,
    org_id: "o",
    board_id: "b",
    item_id: "i",
    update_id: null,
    uploaded_by: "u",
    storage_path: `o/b/i/${id}-x.png`,
    file_name: `${id}.png`,
    mime_type: "image/png",
    size_bytes: 2048,
    created_at: "2026-06-17T00:00:00Z",
    ...over,
  } as Tables<"attachments">;
}

describe("FilePreviewLightbox", () => {
  const files = [att("a"), att("b")];
  const urls = { a: "https://signed/a", b: "https://signed/b" };

  it("navigates with ArrowRight/ArrowLeft and closes on Escape", () => {
    const onIndexChange = vi.fn();
    const onClose = vi.fn();
    render(
      <FilePreviewLightbox
        attachments={files}
        index={0}
        previewUrls={urls}
        currentUserId="u"
        onIndexChange={onIndexChange}
        onClose={onClose}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onIndexChange).toHaveBeenCalledWith(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("renders a Download fallback for a non-previewable file", () => {
    const pdf = [
      att("p", { mime_type: "application/pdf", file_name: "p.pdf" }),
    ];
    render(
      <FilePreviewLightbox
        attachments={pdf}
        index={0}
        previewUrls={{}}
        currentUserId="u"
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText(/No inline preview/i)).toBeInTheDocument();
  });
});
```

- [ ] Run the test and confirm it PASSES: run `pnpm test src/components/boards/item-panel/FilePreviewLightbox.test.tsx` (expected: PASS). If the Radix `Dialog` portal needs a `matchMedia`/`ResizeObserver` shim under jsdom, add the minimal shim used elsewhere in the repo's component tests (check `BoardViews.test.tsx` for the existing setup) rather than changing the assertions.
- [ ] Commit: `git add src/components/boards/item-panel/FilesTab.test.tsx src/components/boards/item-panel/FilePreviewLightbox.test.tsx && git commit -m "test(collab): FilesTab + lightbox component tests"`

---

## Task 9 — RLS integration test + e2e

**Files:**

- Create: `src/lib/collaboration/attachments.rls.integration.test.ts`
- Create: `e2e/item-attachments.spec.ts`

### 9a. RLS integration (table + Storage object policies)

- [ ] Create `src/lib/collaboration/attachments.rls.integration.test.ts` (two-user harness mirroring `collaboration.rls.integration.test.ts`; `.env.local` skip guard; provisions org+board+item per user, plus a third org-admin co-member to exercise the admin-delete branch):

```ts
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/types/database.types";

config({ path: ".env.local", override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

describe.skipIf(!SERVICE_ROLE_KEY)("RLS: attachments (table + storage)", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  type U = {
    id: string;
    orgId: string;
    boardId: string;
    itemId: string;
    anon: SupabaseClient<Database>;
  };

  async function makeAnon(): Promise<{
    id: string;
    anon: SupabaseClient<Database>;
  }> {
    const email = `rls-att-${randomUUID()}@example.com`;
    const { data: created } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    const id = created.user!.id;
    createdUserIds.push(id);
    const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await anon.auth.signInWithPassword({ email, password: PASSWORD });
    return { id, anon };
  }

  async function provision(label: string): Promise<U> {
    const { id, anon } = await makeAnon();
    const { data: org } = await anon.rpc("create_organization", {
      p_name: `Org ${label}`,
      p_slug: `att-${label}-${randomUUID().slice(0, 8)}`,
    });
    const orgId = (org as { id: string }).id;
    const { data: ws } = await anon
      .from("workspaces")
      .insert({ org_id: orgId, name: `WS ${label}`, created_by: id })
      .select("id")
      .single();
    const { data: board } = await anon.rpc("create_board", {
      p_workspace_id: (ws as { id: string }).id,
      p_name: `Board ${label}`,
    });
    const boardId = (board as { id: string }).id;
    const { data: group } = await anon
      .from("groups")
      .select("id")
      .eq("board_id", boardId)
      .limit(1)
      .single();
    const { data: item } = await anon.rpc("create_item", {
      p_group_id: (group as { id: string }).id,
      p_name: "Item",
    });
    return { id, orgId, boardId, itemId: (item as { id: string }).id, anon };
  }

  let a: U;
  let b: U; // separate org — cross-tenant
  let member: { id: string; anon: SupabaseClient<Database> }; // member of org A
  let adminUser: { id: string; anon: SupabaseClient<Database> }; // admin of org A

  function path(u: U, who: string) {
    return `${u.orgId}/${u.boardId}/${u.itemId}/${randomUUID()}-${who}.txt`;
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    a = await provision("a");
    b = await provision("b");
    member = await makeAnon();
    adminUser = await makeAnon();
    await admin
      .from("org_members")
      .insert({ org_id: a.orgId, user_id: member.id, role: "member" });
    await admin
      .from("org_members")
      .insert({ org_id: a.orgId, user_id: adminUser.id, role: "admin" });
  });

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  });

  // ── Storage object policies ───────────────────────────────────────────────
  it("allows uploading to your own org's path", async () => {
    const p = path(a, "own");
    const { error } = await a.anon.storage
      .from("attachments")
      .upload(p, new Blob(["hi"], { type: "text/plain" }));
    expect(error).toBeNull();
  });

  it("denies uploading under another org's path", async () => {
    const p = path(a, "spoof"); // org A's prefix, attempted by B
    const { error } = await b.anon.storage
      .from("attachments")
      .upload(p, new Blob(["x"], { type: "text/plain" }));
    expect(error).not.toBeNull();
  });

  // ── Table policies ────────────────────────────────────────────────────────
  it("a member can register + read an attachment row for the item", async () => {
    const p = path(a, "row");
    await a.anon.storage
      .from("attachments")
      .upload(p, new Blob(["hi"], { type: "text/plain" }));
    const { error: insErr } = await a.anon.from("attachments").insert({
      org_id: a.orgId,
      board_id: a.boardId,
      item_id: a.itemId,
      uploaded_by: a.id,
      storage_path: p,
      file_name: "row.txt",
      mime_type: "text/plain",
      size_bytes: 2,
    });
    expect(insErr).toBeNull();
    const { data } = await a.anon
      .from("attachments")
      .select("id")
      .eq("item_id", a.itemId);
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("denies cross-tenant read of another org's attachment rows", async () => {
    const { data } = await b.anon
      .from("attachments")
      .select("id")
      .eq("item_id", a.itemId);
    expect(data ?? []).toHaveLength(0);
  });

  it("denies a non-uploader-non-admin member deleting someone else's row", async () => {
    const { data: row } = await a.anon
      .from("attachments")
      .select("id")
      .eq("item_id", a.itemId)
      .limit(1)
      .single();
    const id = (row as { id: string }).id;
    await member.anon.from("attachments").delete().eq("id", id); // member, not uploader/admin
    const { data: still } = await a.anon
      .from("attachments")
      .select("id")
      .eq("id", id);
    expect(still ?? []).toHaveLength(1); // RLS hid the row → 0 rows affected
  });

  it("allows an org admin to delete another member's row", async () => {
    const { data: row } = await a.anon
      .from("attachments")
      .select("id")
      .eq("item_id", a.itemId)
      .limit(1)
      .single();
    const id = (row as { id: string }).id;
    const { error } = await adminUser.anon
      .from("attachments")
      .delete()
      .eq("id", id);
    expect(error).toBeNull();
    const { data: gone } = await a.anon
      .from("attachments")
      .select("id")
      .eq("id", id);
    expect(gone ?? []).toHaveLength(0);
  });
});
```

- [ ] Run the RLS test (skips cleanly if `.env.local` lacks the service role): run `pnpm test src/lib/collaboration/attachments.rls.integration.test.ts` (expected: PASS if secrets present, otherwise SKIPPED).

### 9b. e2e

- [ ] Create `e2e/item-attachments.spec.ts` (mirrors `e2e/item-panel.spec.ts`: same admin-created confirmed user, onboarding + create-board flow, `.env.local` dotenv load, graceful skip when secrets absent):

```ts
import * as dotenv from "dotenv";
import * as path from "node:path";

dotenv.config({
  path: path.resolve(process.cwd(), ".env.local"),
  override: true,
});

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasSecrets = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);
const PASSWORD = "Test-Password-123!";

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

test.describe("Item panel: attachments", () => {
  test.skip(
    !hasSecrets,
    "Supabase secrets not available — skipping attachments e2e",
  );

  let createdUserId: string | null = null;
  let testEmail: string;

  test.beforeAll(async () => {
    testEmail = `${unique("e2e-att")}@example.com`;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin.auth.admin.createUser({
      email: testEmail,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user)
      throw new Error(`Failed to create test user: ${error?.message}`);
    createdUserId = data.user.id;
  });

  test.afterAll(async () => {
    if (!createdUserId) return;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await admin.auth.admin.deleteUser(createdUserId);
  });

  test("upload → card → preview → download 200 → delete", async ({ page }) => {
    test.setTimeout(180_000);

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });

    await page.getByLabel(/organization name/i).fill(unique("Org"));
    await page.getByLabel(/workspace name/i).fill("Engineering");
    await page.getByRole("button", { name: /create organization/i }).click();
    await page.waitForURL(/localhost:3000\/$/, { timeout: 30_000 });

    const boardName = unique("Sprint");
    await page.getByRole("button", { name: "New board" }).click();
    await page.getByLabel(/board name/i).fill(boardName);
    await page.getByRole("button", { name: /create board/i }).click();
    await page.waitForURL(/\/boards\//);
    await expect(page.getByText("Group 1")).toBeVisible();

    const itemName = unique("Task");
    await page.getByLabel("Add item", { exact: true }).fill(itemName);
    await page.keyboard.press("Enter");
    await expect(page.getByText(itemName)).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: `${itemName} name` }).hover();
    await page.getByRole("button", { name: `Open ${itemName}` }).click();
    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // Open the Files tab and upload a small PNG.
    await panel.getByRole("button", { name: /^files$/i }).click();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await panel.getByLabel("Add files").setInputFiles({
      name: "pixel.png",
      mimeType: "image/png",
      buffer: png,
    });

    // Card appears.
    await expect(panel.getByText("pixel.png")).toBeVisible({ timeout: 30_000 });

    // Preview opens (image card → Preview action).
    await panel.getByText("pixel.png").hover();
    await panel.getByRole("button", { name: "Preview" }).first().click();
    await expect(page.getByRole("dialog").last()).toBeVisible();

    // Download mints a signed URL that actually returns 200. The button opens
    // the signed URL in a popup; capture its URL and fetch it directly so we
    // assert a real HTTP 200 (not just that a tab opened).
    const downloadBtn = page
      .getByRole("dialog")
      .last()
      .getByRole("button", { name: "Download" })
      .first();
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      downloadBtn.click(),
    ]);
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
    const signedUrl = popup.url();
    expect(signedUrl).toMatch(/^https?:\/\//);
    const resp = await page.request.get(signedUrl);
    expect(resp.status()).toBe(200);
    await popup.close();
    // Close the lightbox.
    await page.keyboard.press("Escape");

    // Delete the file → card disappears.
    await panel.getByText("pixel.png").hover();
    await panel.getByRole("button", { name: "Delete" }).first().click();
    await expect(panel.getByText("pixel.png")).toHaveCount(0, {
      timeout: 30_000,
    });
  });
});
```

> Note: the e2e is run with `pnpm e2e` (Playwright), not `pnpm test`. It auto-skips without secrets. If the lightbox's two "Download" buttons (top-bar + open-in-new-tab both call `onDownload`) make the `name: "Download"` selector ambiguous, `.first()` disambiguates; the assertion only needs one popup. Keep the download buttons' `aria-label`s as written in Task 7c.

- [ ] Commit: `git add src/lib/collaboration/attachments.rls.integration.test.ts e2e/item-attachments.spec.ts && git commit -m "test(collab): attachments RLS integration + e2e upload/preview/download/delete"`

---

## Task 10 — Final verification gate + wrap-up

**Files:** none (verification only)

- [ ] Run the full gate and confirm every command passes: run `pnpm typecheck && pnpm lint && pnpm test && pnpm build` (expected: all PASS; the RLS + e2e integration suites skip cleanly if `.env.local` secrets are absent).
- [ ] Re-run advisors against the linked project and confirm clean (no new `attachments` / `storage.objects` security or performance findings): `supabase db lint --linked` (or MCP `get_advisors` for `security` and `performance`).
- [ ] If secrets are present locally, run the e2e once to confirm the full path: run `pnpm e2e e2e/item-attachments.spec.ts` (expected: PASS).
- [ ] Run `/wrapup` to log a session note in `vault/sessions/` and bump `vault/00-north-star.md`.
- [ ] Final commit if `/wrapup` produced vault changes: `git add vault/ && git commit -m "docs(vault): wrapup phase 4c attachments"` and push `develop`.

---

## Appendix — invariant checklist (verify before promoting)

- [ ] Server Components by default; every mutation is a Server Action (`createAttachment`, `deleteAttachment`) — upload bytes go client-direct to Storage under the INSERT policy, never through a Server Action body.
- [ ] Zod validates every action boundary (`createAttachmentSchema`, `deleteAttachmentSchema`, `attachmentUrlSchema`, `attachmentUrlsSchema`).
- [ ] RLS is the security boundary: table policies + Storage object policies are default-deny, org-scoped; the path-spoof + attachment-disposition guards are defense-in-depth on top, not instead.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` never appears in client code — the browser client (`@/lib/supabase/client`) uses the anon key only; signed URLs are minted by the server client (`@/lib/supabase/server`).
- [ ] Schema change is a single versioned migration; types regenerated + committed in the same PR.
- [ ] gotcha-09: opening the panel = 0 added round-trips; first Files-tab open = 2 bounded reads (list ≤50 indexed + 1 batch URL mint); Gallery/List toggle, re-open, lightbox nav = 0 (client state, `staleTime: Infinity`); live peer add/remove = push-only row-level Realtime filtered `item_id`.
