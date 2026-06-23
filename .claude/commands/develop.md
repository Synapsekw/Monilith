# /develop — Build a brief to a merged feature: scope it, enter the worktree, finish it

Take a one-line brief and drive it **all the way to a merged, cleaned-up feature on `develop`** the
way a senior engineer owns a ticket end-to-end. Cut a worktree, re-root into it, scope with
`brainstorming → writing-plans`, then build the plan with subagents, run the gates, and merge — and
do **not** stop until the work is **merged into `develop` AND the worktree/branch are deleted**.

This is the **execution counterpart to `/whats-next`**. `/whats-next` reads the vault and stops at
"spec written, awaiting review." `/develop` takes a single brief and carries it through to done.
Usage:

```
/develop dashboard that shows workloads per user
```

There are exactly **two human checkpoints** — the `brainstorming` questions and the plan approval.
After the plan is approved the command runs **autonomously** to a merged feature.

## Precondition — run from the main checkout

Run this from the **main checkout** (`/Users/danijeljovanovic/Dev/Monolith`, parked on `develop`).
It creates a worktree nested at `.claude/worktrees/<slug>` **inside** the primary working dir, which
is the only place dispatched subagents can write
(`vault/decisions/2026-06-21-gotcha-28-subagents-cant-write-outside-primary-dir.md`).

If you are invoked from **inside a worktree**, **stop**: print the `start-task.sh` command for the
derived slug and tell the user to re-run `/develop` from the main checkout. Do not build in a
worktree you did not create here.

## Definition of done (non-negotiable)

A `/develop` run is **not complete** until:

1. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass, **and**
2. `task/<slug>` is **merged into `develop`** and pushed, **and**
3. the worktree is **removed** and the branch **deleted** (via `scripts/finish-task.sh`).

Never report success with the `task/*` branch still open or the worktree still on disk. If you stop
short of this for any reason (gate failure, rebase conflict, user halt), **say so explicitly** and
state exactly where it stopped — see AGENTS.md working-agreement #1.

## Steps to follow

You MUST create a TodoWrite item per step and work them in order.

### 1. Derive slug + cut the worktree

- Derive a short kebab-case `<slug>` from the brief (e.g. "dashboard that shows workloads per user"
  → `workload-dashboard`). Keep it terse and descriptive.
- Run `scripts/start-task.sh <slug>` → fresh worktree `.claude/worktrees/<slug>` on `task/<slug>`
  cut from the latest `origin/develop`, commit identity pinned, `pnpm install` run, `.env.local`
  symlinked.
- **`EnterWorktree({ path: ".claude/worktrees/<slug>" })`** to re-root the whole session (this
  orchestrator **and** every subagent) into the worktree. From here, all work happens on
  `task/<slug>`.

### 2. Gate 1 — scope (brainstorming → writing-plans)

Inside the worktree, invoke **`superpowers:brainstorming`**. Run it for real:

- Ask clarifying questions **one at a time** (this is the first human checkpoint).
- Load the UI design skills (`pulse-ui` + `frontend-design`) before any visual decisions
  (AGENTS.md #3).
- Brainstorming writes the spec to `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md`, commits it,
  and chains to **`superpowers:writing-plans`**.

The plan MUST satisfy the working-agreement gates that block a build:

- **Perf/data-fetching budget** (AGENTS.md #5): first-paint vs interaction, in-page toggles = 0 new
  server round-trips, client-state+History API vs Server Action, bounded/indexed hot-path reads.
- **Execution DAG** (AGENTS.md #6): dependency edges, parallel batches, critical path — this is what
  step 4 fans out on.

### 3. Gate 2 — approve the plan

Present the written plan and **wait for the user's OK**. This is the second and final human
checkpoint.

- If the user requests changes, revise (loop back through `writing-plans`) and re-present.
- If the user abandons the work, offer to tear down the worktree
  (`scripts/finish-task.sh` is for the merge path; to abandon, remove the worktree and delete the
  `task/<slug>` branch) and stop.

**After approval, do not pause again for routine decisions** — run to a merge.

### 4. Build — autonomous, subagent-driven

Execute the approved plan with **`superpowers:subagent-driven-development`**:

- Dispatch the plan's tasks to subagents. Where the **execution DAG** has a parallel batch
  (disjoint footprints), dispatch that batch in **one message** as concurrent subagents
  (`superpowers:dispatching-parallel-agents`); run dependent batches in DAG order.
- Every task is **TDD** (`superpowers:test-driven-development`) — tests written and executed, not
  promised (AGENTS.md #4).
- Review each task's output before moving on; on a bug, use
  `superpowers:systematic-debugging` — fix the root cause, never paper over it.
- All subagents already operate inside the worktree (the session is re-rooted), so they use natural
  relative paths on `task/<slug>`.

### 5. Verify — gates green

Invoke **`superpowers:verification-before-completion`**, then run the four gates **in the worktree**
and confirm real passing output before claiming anything:

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # ESLint
pnpm test        # Vitest
pnpm build       # production build
```

Any failure → back to step 4 (debug + fix). Do **not** proceed to finish with a red gate.

### 6. Finish — merge + clean up

Run **`scripts/finish-task.sh`** from inside the worktree. It auto-integrates: fetches + rebases
`task/<slug>` onto the latest `develop`, re-runs the gates against the **merged** state, merges to
`develop`, pushes, then removes the worktree and deletes the branch.

- **On a real rebase conflict** it aborts cleanly. Do **not** force anything: surface the conflict,
  tell the user to resolve `git rebase develop` and re-run, and stop — this is an incomplete run,
  say so.

### 7. Handover — how to test + wrapup

- Print a **numbered, concrete "How to test this" walkthrough** for the user: where to go
  (URL/page), what to click/enter, and the expected result at each step (mention setup like "pull
  `develop`"). If the change is not user-observable, say so in one line instead (AGENTS.md #1).
- Suggest running **`/wrapup`** to log the session and bump the north-star.

## Discipline

- **Two checkpoints only** — `brainstorming` questions and plan approval. Everything after the plan
  runs to a merge without pausing for routine calls.
- **Build only inside the worktree you cut.** Never build in the main checkout; never
  `git checkout`/`git stash`-and-switch (it clobbers live sessions — AGENTS.md #1).
- **Commit your own work only** — stage by path (`git add <paths>`); never `git add -A`/`.`/`-a`.
  Commit identity stays `Danijel Jovanovic <info@synapse-solutions.ai>` (`start-task.sh` pins it).
- **Evidence before claims** — gates must show real passing output before "done"
  (`superpowers:verification-before-completion`).
- **Single brief = single worktree.** Parallelism lives _inside_ the build (subagents per the DAG),
  not multiple top-level worktrees. For multi-task triage across the roadmap, use `/whats-next`.
- **No emoji** in output unless the user asked for them.

## Edge cases

- **Invoked from inside a worktree** — stop; print the `start-task.sh` command and tell the user to
  re-run from the main checkout (see precondition).
- **Trivial brief** (typo, one-liner) — note that a worktree is overkill per AGENTS.md's
  trivial-edit exemption, but honor the explicit invocation if the user confirms.
- **Offline / `git fetch` fails** — `start-task.sh` still cuts locally off the last-known
  `origin/develop`; note the base may be slightly behind and continue.
- **Gate failure during build** — `systematic-debugging`, fix, re-run; never merge a red tree.
- **Rebase conflict at finish** — abort cleanly, hand back to the user, report the run as incomplete.
- **User halts mid-build** — stop, report exactly what's merged vs. still on `task/<slug>`, and that
  the worktree is still open.
