---
type: session
date: 2026-06-19-0825
branch: develop
trigger: wrapup
status: complete
tags: [session, project/pulse, phase-5, automations, observability]
related:
  - "[[2026-06-19-phase-5c1-automations-design]]"
  - "[[2026-06-18-2222-phase5b2-date-triggers]]"
---

# Phase 5c-1 — Automations run-history (spec + plan)

## What changed

- **Brainstormed + specced + planned Phase 5c-1 (run-history)** — no code yet. Spec `a8c470b` (`docs/superpowers/specs/2026-06-19-phase-5c1-automations-design.md`), plan `9e1637c` (`docs/superpowers/plans/2026-06-19-phase-5c1-run-history.md`).
- **Decomposed Phase 5c → 5c-1 (run-history, in-DB) + 5c-2 (external/webhook actions via `pg_net`, later).** Confirmed `pg_net` (0.20.3) is available; no Edge Functions scaffolding exists.
- **Design decisions (locked):** one `automation_runs` row per rule-fire with per-action outcomes in jsonb; statuses `ran`/`blocked`/`error`; logging inside `_automation_run` (single chokepoint, +`p_trigger_type`); per-rule "Recent runs" disclosure in `AutomationsDialog` (lazy fetch-on-expand); keep last 50 runs/rule via daily `pg_cron` prune.
- **Notable behavior change designed in:** wrapping `_automation_run`'s action loop in `begin/exception` makes automations **fault-isolated** — a broken action logs an `error` run instead of aborting the user's triggering edit.
- 6-task plan (migration incl. full `_automation_run` recreation + 3 caller updates + prune; query; formatters; `RecentRuns` UI; cloud integration tests; e2e+gate). Self-reviewed.

## Why

Automations are currently a black box — no record of whether/when/why a rule fired. Run-history makes them observable (the foundation 5c-2's webhook outcomes will also land in), and the fault-isolation change stops a buggy rule from breaking a user's edit.

## Open threads

- **Execution not started** — user invoked /wrapup at the execute-choice prompt. Resume by choosing subagent-driven (recommended) vs inline, then build the 6 tasks.
- **Task 1 pushes a cloud migration** — needs per-session authorization (re-confirm at that step).
- **5c-2** (external/HTTP webhook actions via `pg_net` + SSRF guards + async outcome → same run-history) still to spec/build.
- Do NOT promote `develop`→`main` yet (WebGL landing dep needs a manual cross-browser check; carried over).

## Next session entry point

Execute the 5c-1 plan (`docs/superpowers/plans/2026-06-19-phase-5c1-run-history.md`) via subagent-driven-development, starting at Task 1 (migration — confirm cloud auth first). 5b-2 already shipped + pushed.
