---
type: session
date: 2026-06-19-0957
branch: develop
trigger: wrapup
status: complete
tags: [session, project/monolith, phase-5, automations, observability]
related:
  - "[[2026-06-19-phase-5c1-automations-design]]"
  - "[[2026-06-19-0825-phase5c1-runhistory-plan]]"
  - "[[2026-06-19-gotcha-18-create-or-replace-function-overload]]"
  - "[[2026-06-17-2155-gotcha-15-subagent-scope-overstep-shared-checkout]]"
---

# Phase 5c-1 — Automations run-history (built)

## What changed

- **Executed the 5c-1 plan end-to-end via subagent-driven-development** (6 tasks, fresh
  implementer + spec/quality review each). Commits `9922ff3`→`f37c183` + review fix `22cf632`:
  `automation_runs` table (org-RLS, SELECT-only, definer-writes) + index; `_automation_run`
  recreated with `p_trigger_type` + per-action outcome logging + a `begin/exception` wrapper making
  automations **fault-isolated**; 3 callers repointed; `_automation_runs_prune` + daily `pg_cron`;
  `getAutomationRuns` server action; pure `timeAgo`/`formatRunSummary`; lazy per-rule **"Recent
  runs"** disclosure wired into `AutomationsDialog`.
- **Two migrations applied to cloud** (`20260619100000` run-history, `20260619100001` dropping an
  orphaned 7-arg `_automation_run` overload — see gotcha-18). Required reconnecting the Supabase CLI
  this session (user ran `supabase login`; I completed `link`).
- **Gate green:** typecheck/lint/**573 tests**/build; **7-case cloud integration** (incl.
  fault-isolation: error-run logged AND user's triggering edit survives; prune keeps 50; RLS) + 40
  regression; **e2e** (build rule → fire → "Ran" badge + "set status" in the disclosure); advisors
  clean (`rls_on`, `policies=1`, all engine fns pin `search_path`).
- **Holistic review: SHIP-WITH-NITS** (no Critical). Fixed both Important nits: off-system
  `emerald` `Ran` badge → `bg-primary` (matches `changelog-item-badge.tsx`); added blocked/error
  component render test.
- **Shared-checkout incident:** a parallel session emptied `src/types/database.types.ts` (a failed
  `db:types` regen), turning the tree RED. Regenerated from cloud (validate-then-move) to unblock;
  the parallel session has since committed its `name_column_width` work (`8e0b3c3`).

## Why

Automations were a black box. Run-history makes every fire observable (status + per-action
outcomes), and the fault-isolation change stops a buggy action from aborting a user's edit. It is
also the substrate 5c-2's webhook outcomes will land in.

## Open threads

- **Not yet user-verified live.** App is runnable (tree green); manual-test steps were given.
- **Do not promote `develop`→`main`** — WebGL landing cross-browser check still pending, and
  `develop` now also carries the parallel session's name-column work. **12 commits unpushed.**
- **5c-2 next:** external/webhook actions via `pg_net` (0.20.3, confirmed available) — SSRF guards +
  async outcome → same run-history. To spec/build.

## Next session entry point

Spec + build **Phase 5c-2** (external/webhook actions via `pg_net`, outcomes into `automation_runs`),
or user-verify 5c-1 live first. Push `develop` when ready (12 ahead).
