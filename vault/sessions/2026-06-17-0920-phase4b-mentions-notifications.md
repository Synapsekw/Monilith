---
type: session
date: 2026-06-17-0920
branch: develop
trigger: wrapup
status: complete
tags: [session, phase/4, collaboration, notifications]
related:
  - "[[2026-06-17-0846-phase4a-item-panel-updates-activity]]"
  - "[[2026-06-16-phase-4-collaboration-design]]"
  - "[[00-north-star]]"
---

# Phase 4b — @mentions + notifications inbox (built + shipped)

## What changed

- Wrote the **4b plan** (`docs/superpowers/plans/2026-06-17-phase-4b-mentions-notifications.md`) from the Phase-4 spec, then executed all 16 tasks inline (subagents are Write-blocked this session). **19 commits**, pushed to `develop` (`9158214`→`730038a`).
- New `notifications` table + `notification_kind` enum (per-user fan-out; RLS read/update gated on `recipient_id = auth.uid()`, insert as `is_org_member + actor_id = auth.uid()`; recipient/unread/org/item indexes; on Realtime). Two perf migrations applied via `db push --linked`.
- `addUpdate` stores `body {text,mentions}` + fans out one `mention` notification per recipient (deduped, excl. author); `upsertCell` diffs People-cell assignees → `assigned` fan-out. New mark-read / mark-all actions.
- Client: `notifications-cache` (pure), `use-notifications` (fetch + per-user Realtime), `use-notification-mutations` (optimistic), `mentions` (pure @-extraction), `MentionTextarea` (@-autocomplete) wired into the composer, and a `NotificationsBell` + inbox in the app-shell (new `currentUserId` prop, deep-links to `?item=`).
- Tests: unit (validation, fan-out, cache, mentions, textarea, bell), live RLS integration, two-user e2e (@mention → inbox → deep-link). Gate green: **266 tests**, typecheck, lint (0 err), build; advisors clean (RLS + 3 policies; indexed item_id cascade FK).

## Why

4b was the next collaboration slice and @mentions are how Monday-style item discussion drives engagement. Scoped to full mentions+assignment (user's call). The per-user `notifications` table keeps the inbox bounded + RLS-isolated, avoiding My-Day's board-doc-array anti-pattern.

## Open threads

- Final review folded (no Criticals): hardened the notifications insert policy (org-integrity guards) + pruned stale mention ids. Remaining review minors deferred: `editUpdate` drops `body.mentions` (no edit UI yet, zero impact today); unread badge is window-bounded (≤30, not partial-index-counted); duplicate-name mentions ambiguous to readers.
- Intentional fast-follows: `editUpdate` still has no UI affordance; `update_on_item` notifications deferred (needs a watcher model); mention list filters by name only (null-name members show as "Someone").
- `develop → main` promotion PR still open.

## Next session entry point

Phase 4 is at **4c next** (attachments: Supabase Storage bucket + signed URLs). Or pick {`develop → main` promotion, light-mode reskin, Dashboard view}. Address the 4b final-review findings first if any are Critical.
