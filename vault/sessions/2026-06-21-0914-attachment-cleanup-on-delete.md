---
type: session
date: 2026-06-21-0914
branch: develop
trigger: wrapup
status: complete
tags: [session, attachments, storage, bugfix]
related: []
---

# Free attachment storage objects on item/board delete

## What changed

- New `src/lib/collaboration/attachment-cleanup.ts` — `removeAttachmentObjects(paths)`: service-role, batched (100/call), best-effort (logs, never throws) removal of objects from the `attachments` bucket.
- `deleteItem` (`src/lib/boards/actions.ts`) now gathers `storage_path` for the item + its subitems before the cascade, then frees the files after the RLS-guarded row delete succeeds.
- `deleteBoard` does the same via the denormalized `board_id` (one query covers the whole board).
- 6 new tests (helper: batching / empty no-op / error-resilience; deleteItem: item+subitem cleanup + not-found guard; deleteBoard: cleanup).
- Spec `docs/superpowers/specs/2026-06-21-attachment-cleanup-on-delete-design.md`. Commits `dd31e0d` (spec) + `54a77ee` (fix), pushed (`84fb185..7e104db`, CI green).

## Why

Cascade deletes (`attachments.item_id`/`board_id` FKs) removed the metadata rows but left the underlying Storage bytes orphaned — a silent, billable leak that grew with every item/board deletion. Service-role is required because the per-object storage-delete RLS is uploader-or-admin, so a member couldn't clear files others uploaded.

## Open threads

- **Historical orphans** — files orphaned by deletes before this fix are not reclaimed (sync-only was chosen; a one-off sweep was declined). Optional follow-up.
- **Org delete** — no code path exists today; the helper is path-agnostic and ready to wire when org-delete lands.

## Next session entry point

Back to **Phase 6d — relations + mirror columns** (design already at `docs/.../phase 6d-1 relations`). This attachment-cleanup fix was an out-of-band bugfix, not a phase deliverable.
