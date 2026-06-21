---
type: spec
status: approved
date: 2026-06-21
slug: whats-next-skill
tags: [spec, tooling, dev-memory, vault, orchestration]
related:
  - "[[2026-06-21-decision-22-worktree-temp-branches-and-pinned-commit-identity]]"
  - "[[2026-06-21-gotcha-28-subagents-cant-write-outside-primary-dir]]"
  - "[[2026-06-19-decision-21-plans-must-state-execution-dag]]"
---

# `/whats-next` — tech-lead triage command

## Purpose

A `/`-command that answers "what should we work on next?" the way a **senior engineer assigning
work to a team** would: read the dev-memory vault, reconcile it against live git, ground each
candidate next-step in a real file-footprint, compute which ones are independent enough to run as
**concurrent worktree sessions** without clobbering the tree, and present an interactive picker
whose recommendation is a **parallel batch** (plus what's blocked and what's critical-path). On
selection it spins up a worktree per pick and dispatches a scoping agent into each.

It is the read/plan counterpart to [[wrapup]] (which writes session state). `/wrapup` records where
we landed; `/whats-next` decides where to go.

## Location & invocation

- File: `.claude/commands/whats-next.md` — sibling to `.claude/commands/wrapup.md`.
- Invoked as `/whats-next`.
- **Precondition: run from the main checkout** (`/Users/danijeljovanovic/Dev/Monolith`, parked on
  `develop`). The dispatch step creates worktrees nested at `.claude/worktrees/<name>` **inside**
  the primary working dir so dispatched subagents can write into them
  ([[2026-06-21-gotcha-28-subagents-cant-write-outside-primary-dir]] — this is why worktrees are
  nested, per AGENTS.md). If invoked from inside a worktree, the command still produces the full
  triage but instructs the user to run the **dispatch** step from the main checkout instead of
  silently failing.

## Pipeline

### 1. Gather candidates

Parse, and bucket every candidate next-step by type:

| Source                                                                      | Bucket         |
| --------------------------------------------------------------------------- | -------------- |
| north-star §2 phase slices + `Next:` breadcrumbs                            | `phase-slice`  |
| north-star §3 `In flight`                                                   | `in-flight`    |
| session notes `Open threads` / `Known follow-up` / `deferred`               | `deferred-gap` |
| north-star §3 `Manual gates` / ops lines (promote, advisors, cross-browser) | `ops`          |

Read: `vault/00-north-star.md` (§2 + §3), and the most recent ~8 `vault/sessions/*.md` for open
threads. Do not read the whole vault — bounded reads only.

### 2. Reconcile with git (drift detection)

`git fetch` (best-effort), then compare what the vault claims against reality:

- un-pushed / un-merged commits, `develop` vs `origin/develop`;
- `git worktree list` + `git branch --list 'task/*'` → **work other sessions are already building**;
- surface any mismatch as a **DRIFT** line (e.g. "§3 says 6f _not pushed_ — actually on origin").

**Drop any candidate that an existing `task/*` worktree is already building** — never recommend a
collision.

### 3. Explore footprints

Dispatch one short read-only `Explore` agent **per serious candidate** (skip trivial ops) to
estimate the files/subsystems it would touch. These run in parallel and only return a footprint
summary, not file dumps.

### 4. Build the execution DAG

From the footprints (this is AGENTS.md #6 / [[2026-06-19-decision-21-plans-must-state-execution-dag]]
computed live):

- **edges**: candidates sharing files or with a sequential dependency;
- **parallel batches**: sets with disjoint footprints that can run concurrently;
- **critical path**: longest dependency chain;
- per-candidate **size** (S/M/L) and **blocker** (if any).

### 5. Present the board

**Real markdown tables — never ASCII art** — split into two clearly labelled groups so unfinished
carryover reads separately from new feature work. Rows numbered **continuously across both tables**
so the picker can reference them. Lead with a one-line snapshot + a colour legend:

> **🚦 Status:** 🟢 ready now · 🟡 needs input / depends on another row · 🔴 blocked
> **Type:** ⏳ in-flight · 🐛 deferred-gap · 🛠️ ops · ✨ new feature

- **Group 1 — 🔄 Carryover** (`in-flight` + `deferred-gap` + `ops`): columns `# · 🚦 · Work · Type ·
Size · Batch · Blocker/note · From`.
- **Group 2 — ✨ New feature work** (`phase-slice`): columns `# · 🚦 · Work · Phase · Size · Batch ·
Blocker/note · Critical-path?` (⭐ marks the critical path).

**Batch** = the parallel group from the DAG (same letter ⇒ disjoint footprints, safe to run at once;
`—` ⇒ blocked/solo). Follow the tables with a **Drift** callout (only if mismatches exist) and a
plain-prose **Recommendation** naming the batch to dispatch, the critical path, and what's blocked.

### 6. Interactive pick

Use `AskUserQuestion` (multi-select) listing only the **🟢-status** items. If more than 4 are ready
(AskUserQuestion caps at 4 options), offer the recommended batch as option 1 + up to 3 single picks,
and tell the user they can reply with row numbers for a custom set. The user selects which to launch.

### 7. Dispatch (scope-to-plan, then pause)

For each selected item:

1. `scripts/start-task.sh <slug>` → fresh worktree `.claude/worktrees/<slug>` on `task/<slug>` off
   latest `origin/develop`, commit identity pinned.
2. Dispatch a subagent into that worktree that runs **`brainstorming` → `writing-plans`** and
   **STOPS at "spec written, awaiting review."** It does **not** build.

When all dispatched agents return, summarise: N specs written, each path, and a one-line per-slice
plan summary, so the user can review all specs together and green-light builds in follow-up
sessions.

Rationale for stop-at-plan: launching several unattended feature **builds** that auto-merge to
`develop` with no mid-point review is too much blast radius. A senior lead says "go scope these and
come back with plans," reviews the plans, then greenlights. Full-send is intentionally **not** the
default.

## What this command does NOT do

- Does not build or merge anything (stops at plans).
- Does not modify the vault (that's `/wrapup`'s job).
- Does not read the entire vault or do unbounded scans — bounded reads + per-candidate Explore only.

## Acceptance (dry-run rehearsal)

The artifact is a prose command file; verification is a rehearsal against the **current real vault**.
The command is correct if a run today:

1. Identifies **6d — relations + mirror** as the critical-path phase-slice (north-star §2/§3 `Next:`).
2. Catches the **6f drift** (§3 says "not pushed"; reconcile against origin).
3. Produces a **parallel batch** of genuinely disjoint candidates and a **blocked** group
   (promote `develop→main` blocked on the manual cross-browser check).
4. **Drops** any candidate already owned by a live `task/*` worktree.
5. Honours the run-location precondition (warns when invoked from inside a worktree).

## Future improvements (out of scope for v1)

- Cache the triage to a scratch file for fast resume.
- Effort estimates from historical session velocity.
- `--build` opt-in to flip dispatch to full-send for trusted slices.
