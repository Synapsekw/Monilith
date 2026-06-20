---
type: session
date: 2026-06-20-2253
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-06-20-2024-board-sharing-spec-plan]]"
  - "[[2026-06-20-board-level-sharing-design]]"
  - "[[2026-06-20-gotcha-27-storage-objects-separate-rls-from-table]]"
  - "[[2026-06-20-gotcha-26-per-board-privacy-all-board-scoped-tables]]"
---

# Board-Level Sharing — build

## What changed

- Built the whole feature subagent-driven from the locked 7-task plan; **10 commits `efbf937`→`0dcb8e9`, pushed** (`develop == origin/develop` at `e39047e`).
- DB (`efbf937`): `board_members` + `board_access`, `can_read_board`/`can_edit_board`, READ→per-board / WRITE→`can_edit_board` rewrite across all 15 board-scoped tables, 6 hardened write RPCs, `share_board`/`unshare_board`/`is_org_member_of`, back-fill (editor-to-all on existing boards). Two cloud migrations applied. Fixed a plan bug live: `automation_webhook_deliveries` scopes via `run_id`→`automation_runs.board_id`, not a non-existent `automation_id`.
- App layer: share/unshare server actions + Zod (`f4e2d71`); `listBoards`→`listMyBoards`/`listSharedBoards`/`getBoardAccess` (`6fca7ad`); `ShareBoardDialog` (`63ff7ee`); sidebar My-boards/Shared-with-me + indicators (`007aab6`, `0dcb8e9`); end-to-end wiring + owner-only Share + viewer read-only across all view surfaces (`13ebf9d`).
- **Security review caught a Critical**: the table RLS was locked but attachment **file bytes** stayed org-readable (`storage.objects` has its own policy). Fixed in `bf2a727` — board-scope the 3 storage policies on path segment `[2]`, drop admin-bypass — proven by a live cross-user download-denial test. New ADR [[2026-06-20-gotcha-27-storage-objects-separate-rls-from-table]].
- Verified: `typecheck·lint·build` green, 878 unit/integration passing, all sharing suites green; live two-user browser smoke test PASS on all 5 criteria.

## Why

Org-level membership already existed but every board was visible to every org member; per-board private-by-default sharing (Viewer/Editor, private even from admins) was the gap. RLS is the security boundary, so the real work was narrowing reads/writes on **every** board-scoped table + the separate storage layer, not just the core five.

## Open threads

- **Bug (share-only discoverability):** `src/app/page.tsx` hard-codes `sharedBoards={[]}` and never calls `listSharedBoards()`, so a user who owns 0 boards but has one shared to them lands on `/` with an empty sidebar and can't reach it (renders fine on any `/boards/*` route). Fix = mirror `boards/layout.tsx` in `page.tsx` (call `listSharedBoards`, redirect to first shared board when owned is empty). **Deferred** because `page.tsx` currently holds another session's uncommitted branding edit — fix once it's clean.
- Known limitations (intentional): dashboards stay org-scoped v1; no commenter tier; no share-with-whole-org one-click. Owner row shows in the Share dialog (harmless, could filter).
- Pre-existing/unrelated flakes (not ours): `org/admin.rls` auth-provisioning flake; `automations.5b2` 5s timeout under full-suite cloud load (passes alone).

## Next session entry point

Fix the `page.tsx` share-only discoverability bug (once its branding edit lands), then resume Phase 6 → **6d relations + mirror** (still unstarted; needs brainstorm→spec→plan). Board-sharing is shipped to `develop`; `main` not promoted.
