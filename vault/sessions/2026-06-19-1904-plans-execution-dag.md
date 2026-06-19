---
type: session
date: 2026-06-19-1904
branch: develop
trigger: wrapup
status: complete
tags: [session, process, planning, parallelism]
related:
  - "[[2026-06-19-decision-21-plans-must-state-execution-dag]]"
  - "[[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]"
---

# Plans must state an execution DAG (parallelization enforcement)

## What changed

- Added **`AGENTS.md` working agreement #6** — specs name independent units; plans must add an
  **Execution DAG** (dependency graph → parallel batches → critical path) and dispatch ≥2-task
  batches via `dispatching-parallel-agents` with worktree isolation. Closes with a `Rationale:`
  pointer, mirroring #5.
- Wrote **`vault/decisions/2026-06-19-decision-21-plans-must-state-execution-dag.md`** capturing
  the why and the rejected alternative (editing the cached Superpowers skills).
- Commit `5935606` (`docs(process): require execution DAG + parallelization in plans`).
- Removed the stale `_draft-2026-06-19-1547.md` auto-stub (its content was the item-drag-reorder
  work already wrapped in [[2026-06-19-1835-phase6a-subitems]]).

## Why

Superpowers plans kept coming out as flat sequential task lists even though every task already
carries `Consumes / Produces` interface blocks — a latent dependency graph that no pipeline step
synthesizes into concurrent batches. Since `AGENTS.md` outranks skills (and survives plugin
updates, unlike editing the versioned cache), an instruction-level mandate is the durable fix —
the same lever already used for the #5 performance budget.

## Open threads

- Not yet exercised: the next `writing-plans` run is the real test that #6 produces a usable DAG.
- `5935606` is committed locally but **not pushed**; `develop` also carries other sessions'
  interleaved commits.

## Next session entry point

Resume Phase 6b (custom fields/statuses) — and on the first multi-task plan, confirm working
agreement #6 yields an Execution DAG with parallel batches as intended.
