---
type: session
date: 2026-06-20-1835
branch: develop
trigger: wrapup
status: complete
tags: [session, testing, vitest, supabase]
related:
  [
    "[[2026-06-20-gotcha-24-integration-suite-auth-rate-limit]]",
    "[[2026-06-19-gotcha-23-activity-trigger-blocks-cascade-delete]]",
  ]
---

# Integration suite auth rate-limit fix + signInWithRetry helper

## What changed

- New `src/test/integration-auth.ts` — `signInWithRetry()` (exponential backoff on GoTrue `429
over_request_rate_limit`); all 18 `*.integration.test.ts` suites now call it instead of raw
  `signInWithPassword`.
- `vitest.config.ts` split into a parallel `unit` project and a serial (`fileParallelism: false`)
  `integration` project; `globalSetup` kept at root so teardown runs once.
- Fixed a real `subitems` bug: uppercase org slug violated `organizations.slug` CHECK → lowercased.
- ADR [[2026-06-20-gotcha-24-integration-suite-auth-rate-limit]] (gotcha 24).
- Committed as `b3d94a4` (21 files). Verified green on fresh develop: typecheck, lint (0 err),
  `pnpm test` 819/819, 0 skipped.

## Why

`pnpm test` was intermittently red locally — 5 integration suites failing with a null-`id` NPE that
looked like flake. Root cause: ~40 concurrent sign-ins tripped GoTrue's auth rate limit; the silent
symptom was an unauthenticated client whose `create_organization` returned null. These suites skip in
CI, so the breakage (incl. the deterministic slug bug) only ever showed locally.

## Open threads

- `b3d94a4` (+ concurrent 6c commits) is **not pushed** — `develop` is ahead of `origin/develop`.
- `.playwright-mcp/` left untracked (not mine); `time-format.test.ts` working-tree edit belongs to
  the concurrent 6c session — left untouched.

## Next session entry point

Push `develop` when ready, or continue with 6c time-tracking (Tasks 1–2 apply two cloud migrations).
If integration provisioning flakes again, suspect a new suite using raw `signInWithPassword` or a
non-lowercase slug.
