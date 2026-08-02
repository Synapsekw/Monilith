---
type: session
date: 2026-06-18-2222
branch: develop
trigger: wrapup
status: complete
tags: [session, project/monolith, phase-5, automations, scheduler]
related:
  - "[[2026-06-18-phase-5b2-automations-design]]"
  - "[[2026-06-18-1653-phase5b1-automations-triggers-condition]]"
---

# Phase 5b-2 — Automations: date-based (scheduled) triggers

## What changed

- **Spec + plan** ([[2026-06-18-phase-5b2-automations-design]], `docs/superpowers/plans/2026-06-18-phase-5b2-date-triggers.md`), then **subagent-driven build** (10 plan tasks + 2 review-nit fixes), 13 commits `59a2175..8b53c08`.
- **Key correction:** 5b-1's spec assumed "no `pg_cron`" — it IS available (1.6.4). So 5b-2 stayed fully in-DB: a `pg_cron` hourly sweep, no Edge Functions/Vercel/external cron.
- **Engine (2 migrations, applied to cloud):** `organizations.timezone` (default UTC) + `automation_date_fires` once-only ledger (PK `(automation_id,item_id,fire_date)`, org-scoped read RLS, definer-only write) + `date_reached` partial index + `cell_values` date functional index; `pg_cron` + `_automation_date_sweep(p_now)` (08:00 **org-local** via `at time zone`, per-org `exception` block, reuses `_automation_run` with `actor:=null`).
- **Validation/action/client:** `date_reached` Zod union member; `updateOrgTimezone` action (RLS admin-gated); minimal `/settings` page + `TimezoneForm` + UserMenu nav link (pulse-ui); builder "Date reached" control (offset↔offsetDays + rehydration); `summarize()` branch + 2 recipes.
- **Tests:** 7/7 cloud engine integration + 3 §7 security cases (ledger cross-org RLS, non-admin tz denial, two-org local firing) + 2 e2e + unit; full gate green (typecheck/lint/**560+ tests**/build). Advisor parity verified by SQL.
- **Review nits fixed:** dropped a redundant `organizations` UPDATE policy (corrective migration — an identical owner/admin policy already shipped at init); backfilled the three §7 tests.

## Why

Phase 5 needs date/SLA automations ("3 days before due", "overdue"). Unlike 5a/5b-1's reactive row triggers, these require a scheduler — solved in-DB with `pg_cron` to keep one coherent automations engine and zero new infra.

## Open threads

- **Not user-verified live** (engine proven by cloud integration + e2e, but no manual click-through). Final review: SHIP-WITH-NITS (Important nits fixed).
- **Deferred (documented):** per-org target hour (fixed 08:00), per-user timezones, recurring board schedules, business-day offsets — and **5c** (external/HTTP actions + run-history, which can read this ledger).
- Minor/known: `_automation_date_sweep`'s `exception when others` surfaces deterministic engine errors only as `raise warning` (acceptable; revisit in 5c). Builder rehydration + cron-registration assertions untested (low risk).
- `develop` is ahead of origin (this work + parallel-session changelog/vault/landing commits); pushing per user choice.

## Next session entry point

Phase 5 remaining: **5c** (Edge-Function external actions + run-history) or pivot to **Phase 6 (ClickUp depth)**. Optionally user-verify 5b-2 in the live app (build a "Due date reached → set Status" rule, set org tz in /settings, watch the 8am sweep fire). Do NOT promote `develop`→`main` yet (WebGL landing dep needs a manual cross-browser check).
