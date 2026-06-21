---
type: adr
date: 2026-06-19
status: accepted
aliases: [execution-dag, plan-parallelization]
tags: [decision, process, planning, parallelism, subagents, superpowers]
related:
  - "[[00-north-star]]"
  - "[[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]"
  - "[[2026-06-17-2155-gotcha-15-subagent-scope-overstep-shared-checkout]]"
  - "[[2026-06-15-gotcha-07-shared-worktree-subagents]]"
  - "[[2026-06-19-1904-plans-execution-dag]]"
---

# Decision 21 — Plans and specs must state a parallelization plan (execution DAG)

## Context

We run almost all non-trivial work through the Superpowers `brainstorming` → `writing-plans`
pipeline. The plans it produces are correct and well-decomposed, but they keep coming out as a
**flat, sequential task list**, so we execute one task at a time even when tasks are independent
and could run as concurrent agents. We do own the parallel-execution machinery
(`superpowers:dispatching-parallel-agents`, `subagent-driven-development`, git worktrees), but
nothing was telling the planner to schedule for it.

Tracing the pipeline showed why the linearity is structural, not incidental:

- **`brainstorming`** only decomposes into independent units when a project is _too large for a
  single spec_. For a normally-scoped feature it never flags which units are independent.
- **`writing-plans`** already captures the raw dependency data — every task carries an
  `Interfaces: Consumes / Produces` block, which is literally a dependency edge list — but the
  skill never asks the author to **synthesize those edges into "which tasks can run
  concurrently."** It emits Task 1…N top to bottom.
- The default **Execution Handoff** points at `subagent-driven-development`, which dispatches
  **one subagent per task, sequentially, with review between**. Even the execution step defaults
  to serial.

So the dependency information exists in every plan; no step turns it into a parallel schedule.
The one good counter-example (`04b72eb`, "add execution DAG + parallelization to registration
plan") only happened because it was done by hand.

Editing the Superpowers skill files directly was rejected: they live in a versioned plugin cache
(`~/.claude/plugins/cache/.../superpowers/6.0.3/...`, with `5.1.0` also present) and are
overwritten on update. Per `using-superpowers`, **`AGENTS.md` outranks skills** — and we already
enforce one cross-cutting plan/spec requirement this exact way (working agreement #5, the
performance & data-fetching budget, see [[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]).
Parallelization is the same shape of requirement, so it belongs in the same place.

## Decision

Add **working agreement #6** to `AGENTS.md`: every spec and plan for multi-task work must make
concurrency explicit. Because instructions outrank skills, this makes `writing-plans` emit a
parallel schedule every time without touching Superpowers.

- **Spec (`brainstorming`):** name the independent units — pieces with no shared state and no
  sequential dependency — so the plan can schedule them concurrently.
- **Plan (`writing-plans`):** add an **Execution DAG** section synthesizing the per-task
  `Consumes / Produces` blocks into (a) a dependency graph, (b) **parallel batches** (sets of
  tasks with no unmet dependency, each batch a wave of concurrent agents), and (c) the critical
  path (longest dependency chain = the real wall-clock floor).
- **Execution:** a batch with ≥2 tasks is dispatched via `dispatching-parallel-agents` /
  parallel `subagent-driven-development` subagents, not one-at-a-time. Tasks that mutate files in
  parallel get isolated **git worktrees** to avoid clobbering the shared `develop` checkout.

A plan whose tasks are a flat sequential list with no DAG isn't ready to build.

## Consequences

- Plans now surface their own parallelism; we stop leaving concurrent agents on the table.
- The critical path becomes the honest wall-clock estimate, not the task count.
- Parallel file-mutating work is steered onto worktrees by the rule itself, closing the
  shared-checkout clobber risk documented in
  [[2026-06-17-2155-gotcha-15-subagent-scope-overstep-shared-checkout]] and
  [[2026-06-15-gotcha-07-shared-worktree-subagents]].
- Survives Superpowers plugin updates, because the enforcement lives in `AGENTS.md`, not in the
  cached skill files.

## How to apply

When `brainstorming`/`writing-plans` (agent or human) plans multi-task work, treat the Execution
DAG section as a required deliverable on the same footing as the #5 performance budget. The
`Consumes / Produces` blocks are the input; the DAG is the output. If you can't draw the batches,
the dependencies aren't pinned down yet — finish the plan before building.
