# /whats-next — Tech-lead triage: read the vault, recommend a parallel batch, dispatch worktrees

Answer "what should we work on next?" the way a **senior engineer assigning work to a team** would.
Read the dev-memory vault, reconcile it against live git, ground each candidate next-step in a real
file-footprint, work out which ones are **independent enough to run as concurrent worktree sessions**
without clobbering the tree, then present an interactive picker whose recommendation is a **parallel
batch** (plus what's blocked and what's critical-path). On selection, spin up a worktree per pick and
dispatch a **scoping** agent into each.

This is the read/plan counterpart to `/wrapup`. `/wrapup` records where we landed; `/whats-next`
decides where to go. It **never modifies the vault and never builds** — it stops at written plans.

## Precondition — run from the main checkout

Run this from the **main checkout** (`/Users/danijeljovanovic/Dev/Monolith`, parked on `develop`).
The dispatch step creates worktrees nested at `.claude/worktrees/<name>` **inside** the primary
working dir, which is the only place dispatched subagents can write
(`vault/decisions/2026-06-21-gotcha-28-subagents-cant-write-outside-primary-dir.md`).

If you are invoked from **inside a worktree**, still produce the full triage (steps 1–6), but for
step 7 **do not dispatch** — tell the user to re-run `/whats-next` from the main checkout to launch,
and print the recommended `start-task.sh` commands so they can do it by hand.

## Steps to follow

You MUST create a TodoWrite item per step and work them in order.

### 1. Gather candidates

Read (bounded — do **not** scan the whole vault):

- `vault/00-north-star.md` — **§2** (phase slices + every `Next:` breadcrumb) and **§3 "Now"**
  (`Phase`, `Branch`, `In flight`, `Next`, `Owed`).
- The most recent ~8 `vault/sessions/*.md` — pull `Open threads`, `Known follow-up`, `deferred`,
  and `Next session entry point` lines.

Bucket every candidate by type:

| Source                                                  | Bucket         |
| ------------------------------------------------------- | -------------- |
| §2 phase slices + §3 `Next` breadcrumbs                 | `phase-slice`  |
| §3 `In flight`                                          | `in-flight`    |
| session `Open threads` / `Known follow-up` / `deferred` | `deferred-gap` |
| §3 `Owed` / ops items (promote, advisors, checks)       | `ops`          |

### 2. Reconcile with git (drift detection)

`git fetch` (best-effort; continue if offline), then compare what the vault **claims** against
reality:

- `develop` vs `origin/develop`; any un-pushed / un-merged commits.
- `git worktree list` and `git branch --list 'task/*'` → **work other sessions are already
  building**.
- Emit a **DRIFT** line for each mismatch (e.g. "§3 says 6f _not pushed_ — actually on origin").
- **Drop any candidate an existing `task/*` worktree is already building.** Never recommend a
  collision.

### 3. Explore footprints

Dispatch one short **read-only `Explore` agent per serious candidate** (skip trivial ops) to
estimate the files/subsystems it would touch. Run them **in one batch** (parallel). Ask each to
return only a footprint summary (top dirs/files + rough size S/M/L), not file dumps.

### 4. Build the execution DAG

From the footprints (this is AGENTS.md #6, computed live —
`vault/decisions/2026-06-19-decision-21-plans-must-state-execution-dag.md`):

- **edges** — candidates sharing files or with a sequential dependency;
- **parallel batches** — sets with disjoint footprints that can run at once;
- **critical path** — the longest dependency chain;
- per-candidate **size** (S/M/L) and **blocker** (if any).

### 5. Present the board

Render the candidates as **real markdown tables — never ASCII art** — split into **two clearly
labelled groups** so unfinished carryover reads separately from new feature work. Number rows
**continuously across both tables** (1, 2, 3 …) so the picker in step 6 can reference them.

Open with a **one-line snapshot**: branch state (`develop` vs `origin`, any live worktrees) and the
count of carryover vs new candidates. Example:

> **Snapshot:** `develop` 1 ahead of origin · 1 live worktree (`task/portfolios-7a`) · 3 carryover, 2 new.

The exact columns are yours to shape, but the board must make these legible at a glance using
**plain-text markers** (no emoji — see Discipline):

- **Status** — `ready` / `needs-input` (depends on another row, or on the user) / `blocked`. Only
  `ready` rows are offered in step 6.
- **Type** — the bucket from step 1 (`in-flight`, `deferred-gap`, `ops`, `phase-slice`).
- **Batch** — the parallel group from the DAG (`A`, `B`, …). Same letter = disjoint footprints, safe
  to run at once. `—` = not batchable (blocked or solo).
- **Size** — `S`/`M`/`L` from the Explore footprint.
- **Critical path** — mark the rows on the longest dependency chain (the real wall-clock floor).
- Per row: any **blocker/note** and the **source** (session note / north-star section).

**Group 1 — Carryover (unfinished from prior sessions)** holds the `in-flight`, `deferred-gap`, and
`ops` buckets; **Group 2 — New feature work (roadmap)** holds the `phase-slice` bucket.

Then, **only if there are mismatches**, a short **Drift** callout (vault-vs-reality):

> **Drift:** §2 says 6f PDF preview "not pushed", but §3 says "shipped + pushed" and it's on
> origin — vault is stale.

Then a plain-prose **Recommendation**: which batch to dispatch in parallel (row numbers, worktree
count, no file overlap), what the critical path is, and what's blocked on the user or on another
row.

### 6. Interactive pick

Offer only the **`ready`-status items** for selection — never `needs-input` (dependent) or
`blocked` rows.

- **≤ 4 ready items:** use `AskUserQuestion` (**multiSelect**), one option per ready item, labelled
  with its row number + name, plus the recommended batch noted in the first option's description.
- **> 4 ready items** (AskUserQuestion caps at 4 options): do **not** truncate silently. Present the
  recommended batch as the first `AskUserQuestion` option (e.g. "Dispatch recommended Batch A
  (#1, #2, #4)"), with up to 3 alternative single picks, and tell the user they can instead reply
  with any row numbers to launch a custom set.

(If invoked from inside a worktree, skip this and the next step per the precondition.)

### 7. Dispatch — scope-to-plan, then pause

For **each selected item**:

1. `scripts/start-task.sh <slug>` → fresh worktree `.claude/worktrees/<slug>` on `task/<slug>` off
   the latest `origin/develop`, commit identity pinned.
2. Dispatch a subagent into that worktree told to run **`brainstorming` → `writing-plans`** and
   **STOP at "spec written, awaiting review."** It does **not** build, test, or commit source.

Dispatch all selected agents in **one batch** (parallel). When they return, summarise: N specs
written, each path, and a one-line plan summary per slice, so the user can review all specs together
and green-light builds in follow-up sessions.

**Why stop at plans:** launching several unattended feature _builds_ that auto-merge to `develop`
with no mid-point review is too much blast radius. A senior lead says "go scope these and come back
with plans," reviews, then greenlights. Full-send is intentionally **not** the default.

## Discipline

- **Bounded reads only** — north-star §2/§3 + ~8 recent sessions + per-candidate Explore. Never an
  unbounded vault scan.
- **Read-only until dispatch.** Steps 1–6 touch nothing. Step 7 only runs `start-task.sh` and
  dispatches scoping agents — it does **not** modify the vault or build source.
- **Respect in-flight worktrees** — anything a live `task/*` branch owns is dropped, not recommended.
- **No emoji** in output unless the user asked for them.

## Edge cases

- **Offline / `git fetch` fails** — continue with local refs; note that drift detection is
  best-effort and may be stale.
- **No clear candidates** — if the vault has nothing actionable, say so plainly and suggest
  `/wrapup` first (the vault may be behind reality).
- **Invoked from inside a worktree** — produce steps 1–6, then print the `start-task.sh` commands
  instead of dispatching (see precondition).
- **A single candidate, no parallelism** — still run the pipeline; the "batch" is just one item and
  the recommendation says so.
