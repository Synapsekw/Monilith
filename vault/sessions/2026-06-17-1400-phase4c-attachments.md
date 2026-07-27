---
type: session
date: 2026-06-17-1400
branch: develop
trigger: wrapup
status: complete
tags: [session, phase/4, collaboration, attachments, storage]
related:
  - "[[2026-06-17-0920-phase4b-mentions-notifications]]"
  - "[[2026-06-16-phase-4-collaboration-design]]"
  - "[[00-north-star]]"
---

# Phase 4c — Attachments (built + shipped to develop)

## What changed

Implemented **Phase 4c attachments** end-to-end via the full skill pipeline
(brainstorming → spec → writing-plans → subagent-driven-development), 16 commits
on `develop` (`bc2a0fb` → `7b018cb`). The repo's **first use of Supabase Storage**.

- **DB:** `attachments` table (denormalized `org_id`/`board_id`, `item_id`-indexed, unique
  `storage_path`, size check) + private `attachments` bucket (50 MB, any mime) + **table RLS**
  (mirrors `item_updates`) and **Storage object RLS** on `storage.objects` (org derived from the
  path's leading segment) + added to the Realtime publication. Two migrations
  (`20260617110000`, `20260617110001` board_id cascade-FK index). Applied via `db push --linked`.
- **Server layer:** 4 Zod schemas; pure helpers `attachments-path` (sanitize + `<org>/<board>/<item>/<uuid>-<name>`)
  and `attachments-format` (`formatSize`/`fileKind`/`isPreviewable` — **SVG excluded**); bounded
  `getItemAttachments`; 4 Server Actions — `createAttachment` (path-spoof guard), `getAttachmentDownloadUrl`
  (`{ download }` attachment-disposition), `getAttachmentPreviewUrls` (batch, inline, previewable-only),
  `deleteAttachment` (object-before-row).
- **Client:** `attachments-cache`, lazy `use-item-attachments` (enabled on first Files-tab open;
  batch preview-URL mint), optimistic `use-attachment-mutations` (client-direct upload + orphan cleanup),
  and the per-item Realtime channel extended to `attachments`.
- **UI (Monday-style, Monolith dark):** new **Files tab** in `ItemPanel` — gallery (default) / list toggle,
  drag-and-drop + Add files, hover Preview/Download/Delete (delete uploader-gated), and a **preview
  lightbox** (inline image/video, ←/→/Esc nav, icon+Download fallback). Mocked visually first in the
  brainstorming companion.
- **Tests:** unit (path/format/cache/actions), **RLS integration** against the cloud DB (two orgs +
  a non-admin member — verifies cross-tenant row/object denial, cross-org upload denial, non-uploader
  delete survival), component tests (FilesTab + lightbox), and a **Playwright e2e** (upload → card →
  preview → download HTTP 200 → delete) — passing in a real browser.

## Why

4c was the last Collaboration slice (item detail panel → updates → activity → mentions →
notifications → **attachments**). Item-level only for v1 (update-level deferred); 50 MB / any type
relying on private bucket + RLS rather than a mime allow-list; chips→**gallery** reframed to match
Monday's files UX on the user's call.

## Verification

Full gate green: `pnpm typecheck` · `pnpm lint` (0 errors) · **`pnpm test` 310 passing (52 files)** ·
`pnpm build` · `supabase db lint` clean for our changes (only the pre-existing unrelated
`delete_board_view` finding). Final holistic review verdict: **SHIP** (no Critical/Important) —
security surfaces (table+Storage RLS, path-spoof guard, download disposition, SVG-excluded inline
allow-list, no service-role leak) verified and test-backed.

## Open threads

- Review minors (non-blocking, mostly pre-existing patterns): peer **DELETE realtime** won't fire for
  _other_ viewers' Files tabs without `replica identity full` on `attachments` (mirrors shipped 4a
  `item_updates` — accepted project-wide pattern, deferred); `getAttachmentPreviewUrls` breadth is
  org-wide not item-scoped (RLS-permitted, inline-safe rasters/video only); `getItemAttachments`
  `cursor` + `useItemAttachments` `key` are forward-compat (unused today).
- **Admin-delete UI affordance deferred:** Delete is shown only to the uploader; org admins remain
  RLS-permitted but need their role plumbed into the panel for a UI affordance (fast-follow).
- Intentional fast-follows: **update-level** attachments (4d), orphan-object sweep, board Files-column.

## Process / environment notes

- **Subagents were Write-blocked after a mid-session process restart** — T1–T5 ran as subagents;
  T6–T10 executed **inline** (the implementer subagent confirmed the integration points, then I
  applied them). Reviews still ran as read-only subagents.
- Plan review caught + fixed an internal spec inconsistency (`getAttachmentPreviewUrls` schema vs
  fixture) and a poor delete-UX (gated delete to uploader). Build review fixed a `react-hooks/set-state-in-effect`
  lint and a commitlint subject-case reject.

## Next session entry point

Phase 4 (Collaboration) is **complete** (4a+4b+4c shipped). Remaining near-term, per north-star:
`develop → main` promotion, light-mode reskin, Dashboard view, or Phase 5 (Automations).
**North-star bump deferred** this session — a concurrent landing-page session held uncommitted
`vault/00-north-star.md` edits in the shared checkout; bump 4c → Done when that settles.
**These 4c commits are NOT yet pushed** (`develop` was 20 ahead of origin, interleaved with the
landing session's commits — push left to Danijel to coordinate).
