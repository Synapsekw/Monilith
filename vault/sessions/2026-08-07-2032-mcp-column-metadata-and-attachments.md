---
type: session
date: 2026-08-07-2032
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  [
    "[[2026-08-06-1343-mcp-full-surface-22-tools]]",
    "[[2026-08-07-gotcha-81-a-plan-can-prescribe-a-test-run-a-guard-forbids]]",
  ]
---

# MCP column metadata + attachment tools (22 → 24)

## What changed

- Executed all 7 tasks of `docs/superpowers/plans/2026-08-06-mcp-column-metadata-and-attachments.md`; merged as `753765a2` (19 files, +1651/-68). Two new MCP tools — **24 registered**.
- **`attach_file`** — inline `contentBase64` under 128 KB, or a `storagePath` from a ticket. Size and MIME are read from **Storage**, never the caller's claim. Strict base64 decode (`Buffer.from` silently ignores junk). Only the inline branch deletes its object on a failed register; the ticket branch leaves the bytes so a retry is cheap.
- **`create_attachment_upload`** — 2-hour signed URL, 50 MB cap. Validates the Files column **before** minting, so an agent never uploads bytes it can't register. TTL is not configurable — `createSignedUploadUrl` takes only `{ upsert }` (verified against the installed typings, not assumed).
- **`get_board`** now selects `settings` and maps columns through new `describeColumn`: per-column `writable`, `valueShape`, `options` (with ids), and a **settings allow-list** so the tool contract isn't pinned to the DB jsonb. Anti-drift suite pins all 18 kinds to the real `cellValueSchema`.
- Extracted `createAttachmentCore(supabase, input, actorId)` (the `upsertCellCore` precedent) — the core never calls `supabase.auth.*`; the Server Action survives as a thin cookie-binding wrapper, and the pre-existing collaboration suite passed with **zero assertion edits**.
- Consent table + its sync test updated in the same commit. `create_attachment_upload` is labelled **Write**: it inserts nothing, but hands out a URL that puts bytes in the tenant's bucket.

## Why

Hermes reported the gap directly: the MCP "exposes the Files column but provides no binary upload/attachment operation," and its OAuth credential can't authenticate the web app, so there was no safe workaround. [[2026-08-06-1343-mcp-full-surface-22-tools]] finished reads; this closes the one write verb an agent could see but not use — plus the metadata that stops agents guessing status option ids.

## How to test (for the user)

Setup: this is on `develop`, which never deploys — pull and run locally, or promote to `main` first. Steps 1-6 need an MCP client (Hermes).

1. Call `get_board` on a board with a Status column. Each column now carries `writable` and `valueShape`; Status lists `options` with `id`, `label`, `color`.
2. Call `update_item` setting that column to `{ "optionId": "<an id from step 1>" }`. Expect success, then confirm the change on the board in the browser.
3. Confirm a `relation`/`mirror` column reports `"writable": false`, and a `files` column shows `"note": "use the attach_file tool"`.
4. Call `attach_file` with `fileName: "test.txt"` and `contentBase64` of a short string. Open the item → the file is in its Files tab with the right name and size.
5. Call `create_attachment_upload`, PUT the bytes to the returned `uploadUrl`, then `attach_file` with the returned `storagePath`. The size shown must match the real file.
6. Negative: `attach_file` with a `storagePath` from a different item → `Storage path does not match this item.`, no attachment created.
7. Settings → MCP: both new tools listed, both labelled **Write**.

## Open threads

- **`attachments.rls.integration.test.ts` has never executed.** The plan's Task 7 Step 3 prescribed `PULSE_TEST_DB=1` against DEV, but `integration-env.ts` deny-lists the DEV **and** PROD project refs and there is no `.env.test` — so it skips even with the marker forced. Written and typechecked; unrun. See [[2026-08-07-gotcha-81-a-plan-can-prescribe-a-test-run-a-guard-forbids]].
- Compensating evidence gathered live on DEV (read-only): `items` SELECT is `board_id IN (SELECT readable_board_ids())`; `attachments` INSERT WITH CHECK requires `is_org_member AND can_edit_board AND board_in_org AND item_in_org`; storage `attachments_obj_insert` independently checks `can_edit_board(foldername(name)[2])`. Mechanism confirmed — not a substitute for running the suite.
- The plan again supplied the defects: Task 6 Step 9 listed only `register.ts`, which would have failed the consent-table sync guard. Third session running where findings originate in the plan, not the implementation.
- Carried, undecided: dashboard aggregate widgets possibly erroring in production since 2026-07-04; `queries-cached.ts` doc comments now false.

## Next session entry point

**Promote `develop` → `main`** — it is now several merges ahead (MCP full-surface reads, offline read-only, long-text editor, invitation realtime, and this) and Hermes cannot use any of it until then. The invite fix in particular is a user-visible bug sitting undeployed. Otherwise the owner's chosen track is Plan 2, the macOS desktop shell.
