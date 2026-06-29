---
type: session
date: 2026-06-29-2129
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-06-29-1744-promote-41-sync-purge-gantt-calendar]]"
  - "[[2026-06-23-gotcha-43-shared-db-integration-test-flake]]"
---

# Isolated test DB + TOUCH Batch 2 complete (8/8)

## What changed

- `/whats-next` triage on a clean slate (`develop == origin` at `7278820`, nothing in flight). Recommended Batch A = 3 disjoint worktrees; scoped each to a spec, then built all three.
- **Isolated test DB** (`e2f43fc`): new `src/test/integration-env.ts` is the single source of truth — `loadIntegrationEnv()` (`.env.local` then `.env.test` override) + `integrationTargetReady()` + `isSafeTestTarget()` guard (requires `PULSE_TEST_DB=1`, deny-lists PROD ref `jzsyqhxynswolgijkktn` + DEV ref `hjqcahbbbdaknbbnfnvl`). Mechanically swapped the byte-identical `config({path:".env.local"})` line across all 38 `*.integration.test.ts(x)` + teardown. **Absent `.env.test` → suites skip cleanly** (235 skipped) — stops DEV re-pollution. `.env.example` + `CONTRIBUTING.md` document provisioning.
- **TOUCH ⑧ command palette/menus** (`f306636`): `pointer-coarse:min-h-11 pointer-coarse:py-2.5` on `CommandItem` + all four `dropdown-menu` row types. gotcha-47 confirmed N/A here.
- **TOUCH ⑥ dashboard canvas** (`55ee445`): new `dashboards.touch.css` `@media (pointer: coarse)` override of react-grid-layout's 20px hover-only resize handle → 44px visible; `DashboardItemMenu` `⋯` wrapped in `<RevealOnHover>` + `pointer-coarse:size-11`.
- All three TDD'd, four-gates-green, merged via `finish-task.sh`. Sequenced #1 first so #4/#5 inherited the skip behavior → **zero DEV pollution this batch**.

## Why

The integration suites re-polluted remote DEV within ~2h of every purge (proven to recur), so until DEV had an isolated test target every `/sync-prod` risked pushing `@example.com` fixtures toward prod — the recurring infra tax. Landing the `.env.test` isolation first, then the two remaining touch surfaces, both removed that tax and closed TOUCH Batch 2.

## How to test (for the user)

1. **Test DB (infra):** pull `develop`; with no `.env.test`, `pnpm test` → `~1620 passed | 235 skipped` + `[global-teardown] … skipping purge to protect DEV/PROD`; DEV Auth shows no new `@example.com` users. To run integration against an isolated DB: provision a "Pulse TEST" Supabase project, `supabase link` + `db push` the migrations (relink to DEV after), then add gitignored `.env.test` (URL/anon/service-role + `PULSE_TEST_DB=1`).
2. **Command palette/menus (iPad / DevTools coarse pointer):** ⌘K rows and every dropdown row (incl. checkbox/radio/sub-menu) ≥44px and tappable; desktop/trackpad unchanged (compact).
3. **Dashboard canvas (iPad / coarse pointer):** Dashboards → open one → **Edit** → widget bottom-right resize grip is visible + finger-sized (44px), drag resizes + persists, page doesn't scroll; nav-rail dashboard `⋯` menu visible without hover; **Done** hides grips; desktop unchanged.

## Open threads

- **CI integration coverage:** integration is now opt-in via `.env.test` and **never runs in CI** (unit-only by design). Wiring `.env.test` secrets into GitHub Actions is a deliberate separate follow-up if wanted.
- **Test-DB provisioning is a manual remote prerequisite** — not done this session; integration suites stay skipped until someone creates the TEST project + `.env.test`.
- **Dashboard resize-handle override** relies on CSS import source-order (no `!important`); documented fallback is a higher-specificity selector if a real iPad ever shows the coarse rules losing.
- **Not promoted:** Batch A is on `develop` only — run `/promote` to ship to production.

## Next session entry point

Run `/promote` to ship Batch A (test-DB isolation + final 2 touch surfaces) to production. Optionally provision the isolated TEST Supabase project + `.env.test` so integration suites actually run. Then Phase 7 remaining polish / Phase 10.
