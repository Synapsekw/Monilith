# decision-43 — Vercel functions run in the database's region

**Date:** 2026-11-13
**Status:** accepted, live (PR #147)
**Session:** [[2026-11-13-1232-performance-audit-region-and-quick-wins]]

## Context

The production deployment ran its functions in Vercel's default region, `iad1` (Washington DC). The Supabase project it reads — DEV, `hjqca…`, the one holding live data ([[2026-08-02-decision-32-production-runs-the-dev-database]]) — is in `ap-northeast-1` (Tokyo). Only `/api/mono` had been pinned to `hnd1`.

A performance audit measured database time at 0.05–10 ms per query, while a board open makes 3–5 sequential round-trips and a cell edit 3. Every one of them crossed the Pacific twice. Median function duration over seven days was 2.7 s for a board and 1.9 s for My Work.

## Decision

`vercel.json` carries a top-level `"regions": ["hnd1"]`. Functions follow the database, not the users.

The user-to-function hop is paid once per request; the function-to-database hop is paid once per round-trip. With several round-trips per request, compute beside the data wins wherever the user sits.

## Consequences

- First-hour medians after the change: board 283 ms, My Work 275 ms, folder 503 ms. The sample is thin (mostly warm test loads); the direction is not in doubt.
- **At the DEV → PROD database cutover the line must become `fra1` in the same release.** PROD (`jzsyq…`) is in `eu-central-1`. Leaving `hnd1` reproduces this problem in reverse.
- With the network removed, database time is now visible. The folder rollup RPCs (80–180 ms, computed three or four times per page) are the slowest server work left.
- Check a deployment's actual region with the Vercel `get_deployment` call (`regions` field). `get_project` does not report it.
