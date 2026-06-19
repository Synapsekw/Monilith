---
type: session
date: 2026-06-18-2013
branch: develop
trigger: wrapup
status: complete
tags: [session, phase-5, automations]
related:
  - "[[2026-06-18-phase-5b1-automations-design]]"
  - "[[2026-06-18-1711-phase5a-automations]]"
  - "[[00-north-star]]"
---

# Phase 5b-1 — Automations: more triggers + the "If" condition

Brainstorm → spec → plan → subagent-driven build, all on `develop` (`19c1b43..797e4a2`). Spec:
[[2026-06-18-phase-5b1-automations-design]]; plan: `docs/superpowers/plans/2026-06-18-phase-5b1-automations.md`.

## What changed

- **Spec + plan** (`19c1b43`, `f450560`): decomposed Phase 5b → **5b-1** (this — `item_created` +
  `person_assigned` triggers + the multi-condition "If" gate, all in-DB) and **5b-2** (date-based,
  needs a scheduler — split out). The "If" reuses the dashboards D3b filter (`listFilterSchema` +
  `FilterBuilder` + operator set), evaluated in-DB against the firing item.
- **Schema** (`e8765dc`, `28e9cc3`): nullable `automations.condition` jsonb + `item_created` partial
  index; `trigger` → discriminated union (`status_changed`|`item_created`|`person_assigned`) +
  condition Zod schema.
- **Engine** (`8346608`): migration `20260618160001` — isolated injection-safe condition predicate,
  `_automation_conditions_pass` gate, shared `_automation_run`, a `person_assigned` branch on the
  `cell_values` trigger, and the **first-ever `items` AFTER INSERT trigger** for `item_created`.
  Depth-cap loop guard + gotcha-17 GUC fix preserved. Condition threaded through the actions (`a689d67`).
- **Builder/dialog** (`101cfc7`, `d8b8a01`, `b77f127`): trigger-type selector + collapsible "If"
  section, union-aware rule summaries, two new recipe quick-starts; no new Server Actions.
- **Tests** (`fddc399`, `ab2351c`): 16-case cloud engine integration + builder unit + 3 e2e.
- **Two review-driven fixes:** recipe-remount bug — recipes clicked from the build view didn't
  populate (no `key` remount) → `key`-based remount + regression test (`7637dd0`); defense-in-depth
  null-value guard on the condition predicate via corrective migration `20260618160002` (`797e4a2`).

## Why

Phase 5 is no-code When/If/Then automations. 5a shipped the smallest safe slice; 5b-1 turns
"When/Then" into real "When/**If**/Then" and adds the two most-wanted triggers — staying inside the
reactive in-DB model so it stays testable on the live cloud DB exactly like 5a. Date-based triggers
need a scheduler, so they were deliberately deferred to 5b-2.

## Open threads

- **Not yet user-verified in the live app** (gate + cloud integration + e2e are green, but no manual
  walkthrough yet).
- Deferred to later slices: more action types, multi-assignee notify fan-out, dropdown/people
  **conditions**, dropdown "option removed" triggers; DRY-consolidate the two predicate helpers.

## Next session entry point

5b-1 is shipped, gate-green, and pushed (`origin/develop` at `797e4a2`). Next: **Phase 5b-2** —
date-based / scheduled triggers (a new subsystem: `pg_cron`/`pg_net` or a scheduled Edge Function +
a once-only run-ledger), per the 5b-1 spec's decomposition. Brainstorm → spec it first.
