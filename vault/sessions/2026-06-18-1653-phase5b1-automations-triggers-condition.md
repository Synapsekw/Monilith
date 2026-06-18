---
type: session
date: 2026-06-18-1653
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

> Reconstructed from the auto-draft stub + git history (`19c1b43..ab2351c`, 11 commits) when
> folding `_draft-2026-06-18-1653.md` into a real note. The build below is per commit history.

## What changed

- **Spec + plan** for Phase 5b-1 (`19c1b43`, `f450560`): extend the 5a in-DB engine with two new
  triggers (`item_created`, `person_assigned`) and the **"If" condition** step — no new
  infrastructure, still reactive/in-DB. Spec: [[2026-06-18-phase-5b1-automations-design]].
- **Schema** (`e8765dc`, `28e9cc3`): `condition` column on `automations` + an `item_created` index;
  discriminated-union **trigger** schema + condition Zod schema (`src/lib/validations/automations.ts`).
- **Engine** (`8346608`, `a689d67`): `cell_values` trigger extended — condition gate +
  `item_created` / `person_assigned` triggers; condition persisted via create/update actions
  (migration `20260618160001_automations_5b1_engine.sql`, 243 lines).
- **Builder UI** (`d8b8a01`, `b77f127`, `101cfc7`): trigger-type selector + "If condition" section
  in `AutomationBuilder`; `AutomationsDialog` summary sentence for union triggers + condition; new
  recipe quick-starts.
- **Tests** (`fddc399`, `ab2351c`): 1146-line engine integration suite (item_created /
  person_assigned / condition gate) + builder unit tests + e2e for the two new triggers.

## Why

Phase 5 is no-code **When / If / Then** automations. 5a shipped the smallest safe slice
(status-change → notify/set-option). 5b-1 turns "When/Then" into real "When/**If**/Then" and adds
the two most-wanted triggers — staying inside the in-DB execution model so it remains testable on
the live cloud DB exactly like 5a. Date-based triggers (need a scheduler) are deliberately split out
to 5b-2; external actions + run history to 5c.

## Open threads

- **Verification status unconfirmed in this note.** The 5a wrap flagged `develop` typecheck/build as
  **RED from the parallel 5b automations refactor** (north-star §3). Before promoting, confirm the
  full gate is green: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- Migrations `20260618160000` + `20260618160001` — confirm both are applied to cloud and that
  `database.types.ts` is regenerated/committed (one-line type bump is in `28e9cc3`).
- Not yet user-verified in the live app.

## Next session entry point

Run the full gate on `develop` to clear the known-red flag from the 5a refactor; if green, this
closes 5b-1. Then Phase **5b-2** (date-based / scheduled triggers — needs a scheduler subsystem:
`pg_cron`/`pg_net` or Edge Functions + a once-only run-ledger), per the 5b-1 spec's decomposition.
