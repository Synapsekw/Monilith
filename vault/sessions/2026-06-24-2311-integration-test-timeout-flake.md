---
type: session
date: 2026-06-24-2311
branch: develop
trigger: wrapup
status: complete
tags: [session, testing, integration-tests, flake]
related:
  - "[[2026-06-23-gotcha-43-shared-db-integration-test-flake]]"
  - "[[2026-06-24-0751-test-fixture-prod-db-cleanup]]"
---

# Integration-test timeout flake — diagnosis + timeouts/retry mitigation

## What changed

- Diagnosed a "20-ish failing tests" report (`11 failed files / 9 failed tests`) as **flake, not a regression** — both Vitest projects pass 100% in isolation and combined across 3 clean re-runs.
- Identified a third flake mechanism for [[2026-06-23-gotcha-43-shared-db-integration-test-flake]]: **default-timeout breach under CPU load** (network-bound live-cloud ops run 3–5.3s vs Vitest's 5s/10s compute defaults; a timed-out `beforeAll` fails a whole file → the "N files but fewer tests" signature).
- `vitest.config.ts` (integration project only): `testTimeout: 30_000`, `hookTimeout: 60_000`, `retry: 1`. Commit `1e93f03`.
- Appended an "Update 2026-06-24" mitigation section to gotcha-43.
- Left unrelated working-tree edits (`DashboardsNav.tsx/.test.tsx`, deleted `GenerateWithAiButton.tsx`) untouched — they were clean (no lingering imports, no failures).

## Why

The failing run was 45% slower than the clean re-runs (649s vs 446s) — the failures correlate with machine load, not code. Raising the integration project's network timeouts removes the load-induced flake; `retry: 1` absorbs a transient cloud/setup blip without masking real bugs (assertions still fail fast).

## How to test (for the user)

No user-facing behavior to test — test infra. Verified by config load (`vitest list --project integration` enumerates all 227 tests, exit 0) and by both projects passing clean.

## Open threads

- Band-aid only. The real fix per gotcha-43 / north-star "Owed" is an **isolated/local Docker Supabase** (`.env.test` → `127.0.0.1:54321`) so the gate is deterministic and stops writing to prod.
- If flake persists at high load, consider splitting the gate (unit vs integration as separate steps) to kill CPU contention entirely.

## Next session entry point

Integration gate should be steadier now. Resume the queued work: run `/promote` (after adding `ANTHROPIC_API_KEY` to Vercel) to ship the `develop` bundle.
