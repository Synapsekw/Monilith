---
type: session
date: 2026-06-17-1043
branch: develop
trigger: wrapup
status: complete
tags: [session, performance, boards, rsc]
related:
  - "[[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]"
  - "[[2026-06-17-gotcha-10-board-payload-unbounded-reads]]"
  - "[[2026-06-17-0920-phase4b-mentions-notifications]]"
---

# Board-to-board switching perf — shell hoisted to a persistent layout

## What changed

- New `src/app/boards/layout.tsx` holds the `AppShell` + shell data (orgs/boards/workspaces);
  Next.js 16 preserves shared layouts across `/boards/A → /boards/B`, so the shell is fetched once
  and the sidebar/realtime no longer remount on every switch.
- New `src/app/boards/[boardId]/loading.tsx` — instant skeleton (also enables default prefetch of the
  loading boundary). Slimmed `page.tsx` to board-only data (payload + members).
- `getUser` wrapped in React `cache()` (`session.ts`) so layout + page share one `auth.getUser()`.
- `AppShell` lost `activeBoardId`; `BoardsNav` derives active board via `useParams()` + `aria-current="page"`.
  Notifications feature (4b) left untouched (`currentUserId` + `NotificationsBell` preserved).
- Spec + plan under `docs/superpowers/`; deferred unbounded-read risk logged as ADR gotcha-10.
- 8 commits `d342e56..89b195e`, pushed to `origin/develop`. Gate green: typecheck/lint/268 tests/build.

## Why

Switching boards felt slow. Root cause was wiring, not data (DB is tiny): no `loading.tsx` (zero
click feedback) + the whole app shell living in the page (re-fetched/remounted every switch) + a
serial query waterfall. User confirmed the fix is "significantly better."

## Open threads

- Deferred (ADR gotcha-10): bound the unbounded `items`/`cell_values`/`item_dependencies` reads in
  `getBoardPayload` before boards grow to hundreds of items.
- No perf harness exists — improvement is user-verified by feel, not measured numbers.
- Coordination note: a concurrent session was committing Phase 4b into this same checkout mid-task;
  paused and re-baselined on top rather than clobber. Watch the one-checkout/one-branch hazard.

## Next session entry point

Resume Phase **4c** (attachments — Supabase Storage), or the `develop → main` promotion PR. Board
perf is done and pushed.
