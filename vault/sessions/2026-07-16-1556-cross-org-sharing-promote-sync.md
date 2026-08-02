---
type: session
date: 2026-07-16-1556
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-07-16-1552-audit-batch-a-scope-build-ship]]"
---

# Cross-org reciprocal board sharing — build, promote, sync prod

## What changed

- **Built cross-org reciprocal membership** (brainstorm to spec to plan to subagent build): accepting
  an org invite now also adds the inviter into the invitee's owned org as a `guest`, so board-sharing
  works both directions with **zero RLS-boundary change**. Migration `20260716100326` `create or
replace`s `accept_invitation` + `redeem_invitations` (reciprocal `org_members` insert, `on conflict
do nothing`, skips zero-owned-org invitees). Merged to `develop` (`b49965a`). Spec + plan in
  `docs/superpowers/{specs,plans}/2026-07-16-*cross-org*`.
- **Proved it live on DEV** in a rolled-back txn (impersonate via `request.jwt.claims`): forward =
  `member`, reciprocal = `guest`, zero rows left behind. Integration suite self-skips (no `.env.test`).
- **Promoted the whole `develop` delta to `main` as PR #64** (`db8cb9c`): 5 features (org switcher,
  cross-org, notif prefs, auth rate limiting, boards-rollup fix). Healed squash divergence (`394f3d9`,
  `-s ours`). Vercel prod deploy green; main CI green.
- **`/sync-prod`**: prod was **missing all 3 new migrations** (contradicting the sibling note's
  "ledger verified" claim) -> `supabase db push` applied them, then data + storage full-replace.
  Parity verified dev == prod (orgs 14, boards 15, items 417, users 14, storage 11). Independent-prod-
  data guard passed (identical id sets).

## Why

Removes the "invite me back to your org just to share a board" friction: inviting a collaborator now
makes sharing bidirectional automatically, without touching the multi-tenant security boundary.

## How to test (for the user)

Prod + `develop`. As **User A**: Settings -> Members -> invite **User B**. As **B**: open the
notification bell -> the invite shows a new "Accepting also lets the person who invited you
collaborate..." line -> **Accept**. Then B opens one of B's **own** boards -> **Share** -> **A now
appears** -> share as Viewer. As **A**: that board is now visible/readable. Forward direction (A
shares with B) still works. (B must own their own org for the reciprocal to fire.)

## Open threads

- v1 limitations (in the spec): `guest` is not capability-restricted (same as any invited member); no
  auto-teardown when you remove someone; no reciprocation for invitees who own no org. Follow-ups if
  wanted: restrict `guest` in RLS + symmetric teardown in `remove_member`.
- Migration version drift: MCP `apply_migration` stamped `20260716100546`; relabeled the DEV ledger
  to the file version `20260716100326` (gotcha-55 reconcile). Prod got the file version via `db push`.
- Carryover Owed: **rotate the prod DB password** (printed during `/sync-prod`); wordmark-mark revert
  (conditional); perf tier-3 Task A spec.

## Next session entry point

Build **Ask Monolith full-page** (`/develop`, plan ready, unblocks E5) — highest-value roadmap item; or
E6 billing / PF batch A (plans ready), or E5 after folding its review risks.
