---
type: session
date: 2026-07-05-0811
branch: develop
trigger: wrapup
status: complete
tags: [session, security, performance, features]
related:
  - "[[next16-searchparams-suspense-build]]"
---

# Full audit → parallel fix sweep (security, perf, stability, features)

## What changed

- **11 task branches** built by parallel subagents across 4 waves, all merged to `develop`
  (`46ea505` → `d90d1c9`, +9,280/−712 over 157 files, unit suite 2,148 → 2,326).
- **Security:** 9 migrations (`20260704110000`–`114000`) — `can_read_board` on all 5 dashboard
  read RPCs, dropped `org_members` direct-insert policy, `item_updates` author-freeze trigger,
  `_automation_run` recipient/target guards, template payload confinement, `_webhook_url_safe`
  SSRF hardening, `relation_links` cross-org guard, `goal_links(org_id)` index. App layer: auth
  open-redirect, `provision_account` check, signup enumeration, security headers, CSV formula
  injection, AI/portfolio Zod gaps.
- **Perf/stability:** killed dead `revalidatePath` on ~25 hot-path board mutations; presence
  re-render storm fixed (per-cell store + `memo(BoardTable/KanbanBoard)`); realtime reconnect
  refetch + targeted rollback + stale-echo guard; silent-failure surfacing app-wide; import
  parse hardening (EU numbers, zip-bomb, blank-name); timezone-correct time bucketing.
- **Features:** board filter/sort/search toolbar, My Work page, ⌘K item search, onboarding
  first-board CTA, bulk multi-select + action bar, mobile nav drawer + profile name editing.
- **DB:** all 9 security migrations applied to DEV + verified live; fixed a latent duplicate
  migration-version bug (gotcha-43: two files on `20260703110000` → renumbered `priority_enum`
  to `110001`) that blocked `db push`. Ledger now Local==Remote, zero drift.

## Why

A full four-agent audit (security, perf, stability, features/UX) found the product's depth was
well ahead of its everyday ergonomics and had real intra-org data-leak + silent-failure gaps.
This sweep closed the audit findings and shipped the top table-stakes features in one pass.

## How to test (for the user)

1. Pull `develop`. **Board toolbar:** open a board → Filter → "My items" + a Status; Sort a
   column; type in Search — all live, URL updates, reload persists, Kanban mirrors it.
2. **My Work** (sidebar) → items grouped Overdue/Today/This week/Later; click one → opens on board.
3. **⌘K** → type an item name → Items group → select → item panel opens.
4. **New user** (fresh account) → home shows template cards → click one → board created.
5. **Bulk:** select rows (shift-click ranges) → floating bar → Move/Status/Assign/Delete.
6. **Mobile:** resize below 768px → hamburger drawer. Settings → Profile → set name.
7. **Security:** as an org member without a share on a private board, its dashboard widgets
   return "not authorized"; `/auth/callback?next=//evil.com` lands on `/`.

## Open threads

- **Deferred (each needs a migration first):** soft-delete/archive/undo (`archived_at`),
  avatar upload (`avatars` bucket + RLS), similarity-ranked ⌘K search. Non-schema slice of each
  shipped (bulk hard-delete, name editing, recency search).
- Ambiguous slash-dates now import as text (safe) — a per-column format picker is the upgrade.
- `.mcp.json` still uncommitted; untracked `scripts/sync-prod/push-schema.sh` (foreign).

## Next session entry point

Promote `develop → main` (`/promote`) to ship to prod. Then pick up any of the three
migration-gated deferrals (write `archived_at` / `avatars` migration, user applies, build the
feature slice). See [[next16-searchparams-suspense-build]] for the build-only Suspense trap hit
this session.
