---
type: adr
status: accepted
date: 2026-07-09
tags: [project/monolith, adr, gotcha, worktrees, testing, ci]
related:
  - "[[2026-07-09-2140-carryover-cleanups-trash-ledger-retire]]"
---

# Gotcha 54 — concurrent worktree gate runs exhaust vitest fork workers → false test failures + agent stalls

## Context

Three build/finish-task sessions were running gates (`pnpm test` + `pnpm build`) at once while six
**other** sessions' worktrees (nine total) were also active on the same 10-core machine. Under that
load, `finish-task.sh` aborted with **9 "failed" test files / 12 errors** — but the error was
`[vitest-pool]: Failed to start forks worker for test files …attachments-format.test.ts`, i.e.
vitest could not **spawn a worker process**, not a real assertion failure. The same suite had passed
clean (2499/0) minutes earlier in the isolated build agent, and the offending change was dead-code
deletion that touched none of the "failing" suites. The run took **62 minutes** (vs ~5 clean) and two
dispatched agents were killed by the no-progress watchdog mid-test-run.

## Decision

When multiple worktree gate suites may run concurrently, **serialize the heavy runs** — run
`finish-task.sh` (and any full `pnpm test`/`build`) **one worktree at a time**, and check machine load
(`uptime` vs `hw.ncpu`) before kicking one off. Treat a `Failed to start forks worker` / mass
cross-suite failure with an inflated wall-clock as **environmental**, not a regression: confirm load
cleared, then re-run — do not "debug" the phantom failures or force the merge. `finish-task` gates
before merging and aborts cleanly on failure, so `develop` stays safe through the flake; the fix is a
retry, not a code change.

## Consequences

- **Don't fan out finish-tasks.** Parallel _builds_ in isolated worktrees are fine (disjoint files),
  but their _merges/gates_ should be sequenced — the auto-rebase already makes serialization correct
  (each gates against the prior merge).
- **Long-running dispatched agents are fragile under load** — the stream watchdog kills an agent whose
  test run stalls >600s. For multi-minute gate work on a contended box, prefer running the gate from
  the main thread in the background (`run_in_background`) and polling, over a subagent that can be
  reaped mid-run.
- Symptom vocabulary to recognize as contention (not bugs): `Failed to start forks worker`, wall-clock
  many× the clean baseline, many unrelated suites failing at once, agent "no progress for 600s".
