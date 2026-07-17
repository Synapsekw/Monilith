---
type: session
date: 2026-07-16-1552
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-07-14-2127-whats-next-triage-promote-batch2]]"
---

# Audit Batch A — scope, build, ship (org switcher · notification prefs · auth rate limiting)

## What changed

- **`/whats-next` triage** reconciled a stale north-star §3 (claimed `develop @ 31b2b2b`; it was
  actually two commits ahead with the collapsed-parent-cell fix already on `origin/develop`),
  footprinted the deferred Audit Batch B backlog, and dropped **saved views** — already implemented
  server-side via the `board_views` table.
- **Scoped three slices in parallel worktrees** (brainstorming → writing-plans, stop-at-spec):
  auth rate limiting, org switcher, notification preferences — three build-ready plans + specs.
- **Built and merged all three to `develop`** via `finish-task` with **serialized merges**:
  - **Auth rate limiting** (`a5afda9…0b3545c`): `auth_rate_limits` table + `SECURITY DEFINER
check_rate_limit()` RPC (service-client only), per-IP / per-(IP+email) / global-per-email limits,
    enumeration-safe throttle copy, **fails open**.
  - **Org switcher** (`fd45e96…841df18`): cookie-backed active-org resolver
    (`resolveActiveOrg`/`getActiveOrgId`), sidebar switcher (hidden for single-org), **28 index-0
    call-sites migrated** across 22 files (incl. the whole `src/lib/ai/*` subtree); no DB migration;
    membership re-verified against RLS-scoped `getUserOrgs()` on every read.
  - **Notification prefs** (`58ceddc…fd610e3`): `notification_preferences` table + `BEFORE INSERT`
    gating trigger on `notifications`; toggleable in-app kinds `mention`/`assigned`/`health_digest`
    (`feedback_response` stays always-on); `email_digest_opt_out` left standalone.
- **Promoted to prod in PR #64** (`db8cb9c`, bundled with a separately-built cross-org board-sharing
  task), then healed squash divergence (`394f3d9`, gotcha-32). **Prod migration ledger verified** to
  carry all three new migrations — features are live, not broken.

## Why

Drains the long-deferred Audit Batch B hardening backlog into shipped features: multi-org users
finally get an active-org switcher, users get per-type in-app notification control, and the auth
surface is rate-limited against brute-force / enumeration / signup abuse. All were open gaps from the
security/quality audit, low-priority until now.

## How to test (for the user)

All three are in prod (and on `develop`). Local `.env.local` points at DEV.

1. **Auth rate limiting** — `/forgot-password`, submit the same email ~6× fast → after the cap a
   _"Too many attempts…"_ banner and no more reset emails. Repeat with an unregistered email → the
   banner is byte-identical (no enumeration leak). Wrong-password ×6 on `/login` and ~6 signups from
   one browser also throttle. A limiter outage never locks anyone out (fail-open).
2. **Org switcher** — log in as a user in 2+ orgs; an org switcher appears atop the sidebar (single-org
   users see nothing new). Switch orgs → sidebar workspaces/boards/dashboards, Settings, and ⌘K all
   reflect the new org; reload persists (cookie). Tampering the `pulse_active_org` cookie safely falls
   back to your first org — no cross-tenant leak.
3. **Notification prefs** — Settings → Notifications → uncheck **Mentions** (optimistic, persists);
   have a co-member @-mention you → no in-app notification; re-check → it arrives. Same for
   **Assignments**. `feedback_response` has no toggle by design.

## Open threads

- **E5 (agentic + semantic)** scoping worktree `task/e5-agentic-semantic` still parked (uncommitted
  spec/plan); fold review risks before building — and build **Ask Pulse full-page first** (shared
  `src/lib/ai/ask/`).
- **Audit Batch B is now cleared**: org switcher, auth rate limiting, notification prefs all shipped;
  saved views was already implemented. Nothing left in that bucket.
- Cross-org reciprocal membership shipped in #64 (separate session) — reciprocal `org_members` on
  invite-accept; not this session's work but now live.
- Carryover Owed: wordmark-mark revert (conditional), perf tier-3 Task A (`unstable_instant`) needs a
  spec, **rotate the prod DB password** (from the earlier `/sync-prod`).

## Next session entry point

Build **Ask Pulse full-page** (`/develop`, plan ready, unblocks E5) — the highest-value roadmap item;
alternatively E6 billing or PF batch A (plans ready), or refine + build E5 after folding its review
risks.
