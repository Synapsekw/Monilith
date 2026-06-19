---
type: adr
date: 2026-06-17
status: accepted
tags: [decision, gotcha]
related:
  [
    "[[2026-06-15-gotcha-07-shared-worktree-subagents]]",
    "[[2026-06-17-2155-dashboards-d3a-list-widget]]",
  ]
---

# gotcha-15 — subagents must stay in task scope; one agent per file in a shared checkout

## Context

During the D3a subagent-driven build, the implementer dispatched for Tasks 4–5 **overstepped its
assigned scope** and went on to implement Tasks 6–7 itself (e2e, code review, push). At the same
time the orchestrator had dispatched a **separate Task 6 agent** against the same file
(`e2e/dashboards.spec.ts`). Two agents were live in the one shared checkout, both targeting the same
file — the classic collision setup from [[2026-06-15-gotcha-07-shared-worktree-subagents]], here
caused by scope drift rather than two human sessions.

This time no harm landed (the second agent left no conflicting commit; the tree stayed clean and the
gate was green), but it was luck, not design — a duplicate or conflicting commit was entirely possible.

## Decision

Two rules for subagent-driven execution in a single checkout:

1. **Implementer subagents do ONLY their assigned task(s).** The dispatch brief must say so
   explicitly ("implement Task N and ONLY Task N; do not proceed to later tasks"). The orchestrator
   owns sequencing, verification, and the final review/push — not the implementer.
2. **One agent per file at a time.** Never dispatch the next task's agent while a prior agent might
   still be writing overlapping files. Confirm the prior agent has reported done (or verify via
   `git log`/clean tree) before dispatching work that touches the same files.

## Rationale

A single working directory = one set of files shared by every agent. Concurrent writers race; an
overstepping agent silently widens the set of files a "later" task touches, defeating the
orchestrator's per-task isolation. Keeping each agent's blast radius to its named task + files keeps
the two-stage review meaningful and avoids lost-update / duplicate-commit races.

## Consequences

- Positive: predictable, reviewable per-task commits; no concurrent-writer races.
- Negative: slightly less parallelism (must serialize agents that share files — usually fine, since
  plan tasks in one checkout are already sequential).
- Open follow-ups: when genuine parallelism is needed, use a git worktree per agent (gotcha-07), not
  concurrent agents in the shared checkout.

## Related

- [[2026-06-15-gotcha-07-shared-worktree-subagents]]
- [[2026-06-17-2155-dashboards-d3a-list-widget]]
