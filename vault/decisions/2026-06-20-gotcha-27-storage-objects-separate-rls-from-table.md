---
type: adr
status: accepted
date: 2026-06-20
tags: [adr, gotcha, security, rls, storage, attachments]
related:
  - "[[2026-06-20-gotcha-26-per-board-privacy-all-board-scoped-tables]]"
  - "[[2026-06-20-board-level-sharing-design]]"
  - "[[2026-06-20-2253-board-sharing-build]]"
---

# Gotcha 27 — `storage.objects` has its own RLS, separate from the table that records the file

## Context

Board-level sharing rewrote the `attachments` **table** SELECT from `is_org_member` to
`can_read_board(board_id)`. Tests proved the table rows were private. But the attachment **file
bytes** live in the `attachments` Storage bucket, gated by a _completely separate_ policy on
`storage.objects` (`attachments_obj_select`) that still checked only the org-id path segment. So an
ungranted org member could still download a private board's files straight from the Storage API —
the table metadata was locked, the blob was not. Found in security review, not by the table tests.

## Decision

When a feature changes who may read/write a row that **also has an associated storage object**,
rewrite the `storage.objects` policies in the **same migration** as the table policies. They do not
inherit from each other.

- The attachment storage path is `<org_id>/<board_id>/<item_id>/<uuid>-<name>`, so the board id is
  already in the path: `(storage.foldername(name))[2]`. Gate SELECT on
  `can_read_board(((storage.foldername(name))[2])::uuid)`, INSERT/DELETE on `can_edit_board(...)`.
- A malformed path with no `[2]` yields NULL → helper returns false → safe deny. No permissive
  fallback.
- Drop any `has_org_role` admin-bypass on the storage policy too if the feature is "private even
  from admins" — the table rewrite is meaningless if the blob has a bypass.

## Consequences

- Supabase's advisor lints (`rls_disabled_in_public`, `function_search_path_mutable`) do **not**
  flag this — Storage RLS is outside their scope. Only a live cross-user _download_ test catches it.
  Always include a storage download-denial test, not just a table-read test, when a feature makes
  attachments private. See `board-sharing-satellites.rls.integration.test.ts`.
- The plan had deferred this as a "known limitation" on the false premise that the path lacked a
  board segment — it didn't. **Verify deferral rationales against the actual schema** before
  shipping a security hole as "follow-up."
- Same trap applies to any future bucket (avatars, exports): the bucket policy is a second surface.
