---
type: session
date: 2026-08-10-1659
branch: develop
trigger: wrapup
status: complete
tags: [session, admin, testing, e2e, dev-database]
related:
  [
    "[[2026-08-10-gotcha-88-a-leak-whose-collector-is-forbidden-from-where-it-leaks]]",
  ]
---

# Test-account purge, admin accordion, and an E2E guard for DEV

## What changed

- **Deleted 56 leaked E2E accounts + their 56 throwaway orgs from DEV** (62 boards, 3 items,
  1 AI conversation). One guarded statement with count assertions on both users and orgs.
  Verified: profiles **74 → 18**, orgs **71 → 15**, `auth.users` in sync, Synapse Solutions'
  **429 items untouched**.
- **Kept the 4 load-bearing accounts** — `pulse-autopilot@pulse.internal` (agent actor, seeded
  by `20260720120517`) and `pulse-tier2-fixture-a/b/c@example.com`. Proven, not assumed:
  `pnpm test:fixtures` passes **56/56** signing in against DEV after the purge.
- **`/admin/users` collapses non-customer accounts** behind a native `<details>` accordion —
  no client JS, so the page stays a Server Component and stays keyboard-operable. New
  `src/lib/platform/test-accounts.ts` + `src/components/admin/user-row.tsx` (row extracted so
  both sections render identical markup, actions included).
- **E2E provisioning is guarded** — `e2e/support/e2e-target.ts` + `global-setup.ts`, wired into
  **both** playwright configs. PROD refused outright; DEV refused unless `PULSE_E2E_ALLOW_DEV=1`.
- Merged as `2d7294a0` (9 files, +427/−26). ADR: gotcha-88.
- **`/updates`: nothing announced.** The only user-visible surface is the platform-admin console,
  reachable by platform admins alone — not a user-facing change.

## Why

`/admin/users` listed 74 profiles of which 14 were real people; the rest was E2E debris burying
the actual users. The pile existed because `global-teardown.ts` — the sweeper written for exactly
this — refuses DEV by design, while every `e2e/` spec loads `.env.local` (DEV) and provisions
freely. Deleting the rows without fixing that would have bought a few weeks. Full reasoning:
[[2026-08-10-gotcha-88-a-leak-whose-collector-is-forbidden-from-where-it-leaks]].

## How to test (for the user)

1. Pull `develop` (`git pull`), run `pnpm dev`, sign in as `info@synapse-solutions.ai`.
2. Go to **`/admin/users`**. Expect **14 real people** listed directly — no `Org-1786…`,
   `Probe Org …` or `Northwind Labs` noise anywhere.
3. Below the table, find the collapsed **"System & test accounts"** row showing **4**.
4. Click it (or focus and press Enter — it is keyboard-operable). It expands to reveal
   `pulse-autopilot@pulse.internal` and the three `pulse-tier2-fixture-*` accounts, each with
   its normal row actions.
5. Hover the collapsed row: the hairline **brightens**; it must not thicken or shift.
6. Toggle light/dark — both read correctly.
7. Guard check: `pnpm e2e` against `.env.local` now **fails immediately** naming DEV;
   `PULSE_E2E_ALLOW_DEV=1 pnpm e2e` proceeds as before.

## Open threads

- **`finish-task.sh`'s test gate flaked once** — 7 files / 9 tests failed with vitest
  `Failed to start forks worker` / `Timeout waiting for worker to respond`, at 727s against the
  same suite's usual 137s. A clean re-run passed 5158/5158 and the merge went through untouched.
  Machine contention, not a regression — but worth watching, since a flaky gate that aborts
  after the rebase is expensive.
- The **14 remaining humans include stale entries** worth a decision later: `djovanovic@eand.com`
  has never signed in and belongs to no org, and several `e&`/`Accenture` accounts have one
  duplicate org each from repeated onboarding. Left alone — they are real people, not debris.
- Partitioning is **per page** (the RPC paginates at 25). Correct at 4 such accounts; if the
  fixture count ever grows past a page, the count line would need the RPC to filter server-side.

## Next session entry point

Unchanged from before this session: nothing is undeployed (`develop == main == production`).
Strongest candidate remains the dashboard-widget `SECURITY DEFINER` / service-client denial —
verify in the running app before "fixing" the guard.
