# /develop — Build a brief to a merged feature: scope it, enter the worktree, finish it

Take a one-line brief and drive it **all the way to a merged, cleaned-up feature on `develop`** the
way a senior engineer owns a ticket end-to-end. Cut a worktree, re-root into it, scope with
`brainstorming → writing-plans`, build the plan with subagents, verify, and merge.

This is the **execution counterpart to `/whats-next`**. `/whats-next` reads the vault and stops at
"spec written, awaiting review." `/develop` takes a single brief and carries it through to done.
Usage:

```
/develop dashboard that shows workloads per user
```

There are exactly **two human checkpoints** — the `brainstorming` questions and the plan approval.
After the plan is approved the command runs **autonomously** to a merged feature.

Definition of done, worktree mechanics, commit hygiene, identity pinning, and the four gates are
canonical in **AGENTS.md working agreement #1 and #4** — this command follows them without
restating them. A run that stops short for any reason (gate failure, rebase conflict, user halt)
is **incomplete: say so explicitly** and state exactly where it stopped.

## Precondition — run from the main checkout

Run this from the **main checkout** (`/Users/danijeljovanovic/Dev/Monolith`, parked on `develop`):
the worktree must be nested inside the primary working dir for subagents to write into it
(AGENTS.md #1). If you are invoked from **inside a worktree**, **stop**: print the `start-task.sh`
command for the derived slug and tell the user to re-run `/develop` from the main checkout.

## Steps to follow

You MUST create a TodoWrite item per step and work them in order.

### 1. Derive slug + cut the worktree

- Derive a short kebab-case `<slug>` from the brief (e.g. "dashboard that shows workloads per user"
  → `workload-dashboard`). Keep it terse and descriptive.
- Run `scripts/start-task.sh <slug>`, then **`EnterWorktree({ path: ".claude/worktrees/<slug>" })`**
  to re-root the whole session (this orchestrator **and** every subagent) onto `task/<slug>`.

### 2. Gate 1 — scope (brainstorming → writing-plans)

Inside the worktree, invoke **`superpowers:brainstorming`** and run it for real: clarifying
questions **one at a time** (the first human checkpoint); UI design skills before any visual
decisions (AGENTS.md #3). It writes the spec to `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md`,
commits it, and chains to **`superpowers:writing-plans`**. The plan MUST satisfy the two
build-blocking gates: **perf/data-fetching budget** (AGENTS.md #5) and **Execution DAG**
(AGENTS.md #6) — step 4 fans out on that DAG.

### 3. Gate 2 — approve the plan

Present the written plan and **wait for the user's OK** — the second and final human checkpoint.
Changes requested → revise via `writing-plans` and re-present. Work abandoned → offer to tear down
(remove the worktree, delete `task/<slug>`) and stop. **After approval, do not pause again for
routine decisions** — run to a merge.

### 4. Build — autonomous, subagent-driven

Execute the approved plan with **`superpowers:subagent-driven-development`**: dispatch each of the
DAG's parallel batches in **one message** of concurrent subagents
(`superpowers:dispatching-parallel-agents`); dependent batches in DAG order. Every task is TDD
(AGENTS.md #4). Review each task's output; on a bug, `superpowers:systematic-debugging` — fix the
root cause, never paper over it.

### 5. Verify — gates green

Invoke **`superpowers:verification-before-completion`**, run the four gates (AGENTS.md #4) **in
the worktree**, and confirm real passing output. Any failure → back to step 4; never proceed with
a red gate.

### 6. Finish — merge + clean up

Run **`scripts/finish-task.sh`** from inside the worktree (auto-rebases, re-gates the merged
state, merges, pushes, cleans up — AGENTS.md #1). On a real rebase conflict it aborts cleanly: do
**not** force anything — tell the user to resolve `git rebase develop` and re-run, and report the
run as incomplete.

### 7. Handover — how to test + wrapup

Print the **"How to test this" walkthrough** per AGENTS.md #1 (numbered concrete steps — or the
one-line "not user-observable" note), then suggest **`/wrapup`**.

## Discipline

- **Two checkpoints only** — `brainstorming` questions and plan approval. Everything after the plan
  runs to a merge without pausing for routine calls.
- **Build only inside the worktree you cut.** Worktree isolation, stage-by-path, and pinned commit
  identity: AGENTS.md #1.
- **Evidence before claims** (`superpowers:verification-before-completion`).
- **Single brief = single worktree.** Parallelism lives _inside_ the build (subagents per the DAG),
  not multiple top-level worktrees. For multi-task triage across the roadmap, use `/whats-next`.
- **No emoji** in output unless the user asked for them.

## Edge cases

- **Invoked from inside a worktree** — stop; print the `start-task.sh` command (see precondition).
- **Trivial brief** (typo, one-liner) — note AGENTS.md's trivial-edit exemption, but honor the
  explicit invocation if the user confirms.
- **Offline / `git fetch` fails** — `start-task.sh` still cuts locally off the last-known
  `origin/develop`; note the base may be slightly behind and continue.
- **Gate failure / rebase conflict / user halt** — never merge a red tree; report the run as
  incomplete and state exactly what's merged vs. still on `task/<slug>` (worktree still open).
