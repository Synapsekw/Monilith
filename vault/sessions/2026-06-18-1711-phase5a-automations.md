---
type: session
date: 2026-06-18-1711
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-06-18-phase-5a-automations-design]]"
  - "[[2026-06-18-1711-gotcha-17-empty-string-custom-guc]]"
---

# Phase 5a — Automations engine + lean When/Then

## What changed

- **Phase 5 started; 5a shipped** (`cabb5f3..b846778`, 11 commits, on `develop`). Spec + plan:
  `docs/superpowers/specs/2026-06-18-phase-5a-automations-design.md`, `.../plans/2026-06-18-phase-5a-automations.md`.
- **In-DB engine:** new `automations` table (jsonb `trigger`/`actions`, org-RLS mirroring `columns`)
  - an `AFTER INSERT OR UPDATE` trigger on `cell_values` (`tg_run_automations`, `SECURITY DEFINER`,
    `search_path=''`) that matches enabled Status/Dropdown-change rules and runs notify-person +
    set-Status/Dropdown actions, with a transaction-local **depth-cap loop guard**. `notification_kind`
    gained `'automation'` + `notifications.automation_id`. Two migrations applied to cloud.
- **Server Actions** (`automation-actions.ts`: create/update/delete + `getAutomations`) + `listAutomations`
  query; **Zod schemas** (`validations/automations.ts`).
- **UI:** per-board `AutomationsDialog` + guided sentence `AutomationBuilder` + recipe quick-starts,
  wired into `BoardHeader` (threaded `columns`/`members` through all 4 view components). Inbox renders
  the `'automation'` kind.
- **Tests:** 12-case cloud RLS + engine integration (fire/notify/set/loop/disabled/self-exclusion/
  cross-org/unresolved-owner/skip-if-equal) + builder unit + e2e (create→fire→notify→toggle-off).
  Gate green: typecheck/lint/**471 tests**/build. Holistic review verdict **SHIP-WITH-NITS** (nits closed).
- **Caught + fixed a production-breaking engine bug** mid-build (see ADR): empty-string custom GUC →
  `22P02` aborted every `cell_values` write on automated boards. Fix `85d0584`.

## Why

Phase 5 (PRD F-9) is no-code When/If/Then automations. 5a deliberately ships the smallest safe,
useful engine (Postgres-native, in-DB) to avoid the PRD's "feature-soup" risk, expandable in 5b/5c.
The integration test paid for itself by catching the GUC bug before it could break cell writes globally.

## Open threads

- **5b (next automations slice):** more triggers (item created, person assigned, date-based), more
  actions (set any column kind, move group, post update), the optional "If" condition step.
- **5c:** external actions via Edge Functions (webhooks/Slack), run history/audit.
- **Nits (deferred, low):** inbox copy is generic ("an automation ran on an item" — no item name);
  the engine trigger fires on every board `cell_values` write (cheap early-exits + indexed lookup —
  revisit only at very high write volume).
- A `vitest.server-only-stub.ts` alias was added so Vitest can resolve the client→`"use server"`→
  `server-only` import graph (build-time/RPC boundary intact; not a real violation).
- Not yet user-verified in the live app.

## Next session entry point

Phase 5a is shipped + pushed. Either start **Phase 5b** (brainstorm → spec the expanded
trigger/action menu + the "If" condition), or pick another phase. The 5a engine/table/builder are the
foundation 5b extends (jsonb shapes were designed to grow without migrations).
