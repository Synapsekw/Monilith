---
type: north-star
status: active
last-updated: 2026-06-29-1320
tags: [project/pulse, north-star]
related:
  - "[[README]]"
  - "[[product]]"
---

# Pulse — North Star

> Single canonical entry point. Where are we, where are we going, why. Open this first.
> **When state changes, update the relevant section and bump `last-updated` in the frontmatter.**
> Keep this concise — phase detail lives in [[platform-roadmap]], history in `vault/sessions/`.

## 1. Pitch

**Pulse** is a cloud-native **"Work OS"** in the spirit of Monday.com — folding in the best of
ClickUp (nested hierarchy, docs, native time tracking) and Asana (goals/OKRs, workload, portfolios)
into one coherent product. Not a clone: the _ultimate_ version. Monday's visual, color-coded board
experience as the foundation; ClickUp's depth; Asana's polish. Design language: modern monochromatic
(neutral grayscale) with a single configurable accent, **dark-first** (layered near-black surfaces +
indigo accent; light supported but secondary), Linear-grade restraint applied to a colorful category.
Built on **Next.js 16 + React 19 + Tailwind v4 + Supabase**, multi-tenant (org-scoped RLS) from day one.

Master spec: [[2026-06-14-pulse-design]] (`docs/superpowers/specs/2026-06-14-pulse-design.md`).
Visual reskin target + prototype reuse map: [[2026-06-16-decision-08-dark-first-monday-reskin]].

## 2. Product north star — phased build (0 → 9)

From the master spec §7 — **status + one-line outcome only**. Per-slice detail and full history live in
[[platform-roadmap]] and the session notes. **Commit + checkpoint after each phase; run tests +
advisors + regenerate types before moving on.**

- **0 — Setup** — <span style="color:#22c55e">**[Done]**</span> — Scaffold, deps, theming tokens, Supabase + MCP wired; themed shell + dark/light toggle + ⌘K stub. ([[2026-06-14-phase0-setup]])
- **1 — Auth & tenancy** — <span style="color:#22c55e">**[Done]**</span> — Email/password auth, org creation + membership, protected routes, RLS baseline. ([[2026-06-15-phase1-auth-tenancy]])
- **2 — Boards core** — <span style="color:#22c55e">**[Done]**</span> — Workspaces→boards→groups→items, Table view (6 column kinds), inline editing, optimistic updates, realtime. _(2a schema+Table · 2b inline editors · 2c column management)_
- **3 — Views** — <span style="color:#22c55e">**[Done]**</span> — Kanban + Calendar + Timeline/Gantt with dependencies; view switcher + saved config (client-side, no RSC refetch).
- **4 — Collaboration** — <span style="color:#22c55e">**[Done]**</span> — Item detail panel, updates/comments/@mentions, attachments, activity log, notifications inbox. _(4a panel+updates+activity · 4b mentions+notifications · 4c attachments — spec [[2026-06-16-phase-4-collaboration-design]])_
- **5 — Automations + Rules** — <span style="color:#22c55e">**[Done]**</span> — Trigger/condition/action builder on Postgres triggers + `pg_cron`/`pg_net` (no Edge Functions); recipes, run-history, webhook actions. _(5a → 5c-2 + move_to_group)_
- **6 — ClickUp depth** — <span style="color:#eab308">**[In progress — 6a–6h done; 6e Docs deferred]**</span> — Subitems, custom fields/statuses, time tracking, relations + mirror columns + aggregation, workspace management, real-time presence. 6e Docs deferred ([[2026-06-21-decision-24-defer-phase-6e-docs]]: too complex + not fully cloud-native).
- **7 — Asana polish** — <span style="color:#eab308">**[In progress — 7a + 7b + 7c + time-allocation done]**</span> — Portfolios, Goals/OKRs, Workload/capacity (v2: workspace/board filtering + planned/actual metric; v3: variance + per-day actuals drill-down). Time allocation: `/time` weekly "My Time" card (manual decimal-hours per task/category/day, save-as-you-go) unified with timers into one actuals ledger; Workload reworked to full-canvas (utilization % + capacity bars). ([[2026-06-23-2059-time-allocation-my-time-card]])
- **8 — Dashboards + templates + ⌘K polish** — <span style="color:#22c55e">**[Done + v2 polish + AI gen]**</span> — Cross-board widgets (Number/Chart/Battery/List + filter), board templates, ⌘K nav + create. v2 polish: 9 chart types (line/area/stacked/grouped/combo/donut/radial) via `dashboard_series` (date-bucket + multi-series; group by date/status/dropdown/people), unified edit drawer w/ live preview, bordered-card reskin. **AI generation:** Opus 4.8 reads a board's schema+stats (no raw cells) and proposes a full dashboard via a Generate-with-AI wizard + Keep/Discard/Regenerate review banner. ([[2026-06-23-1953-dashboards-polish-v2]], [[2026-06-24-0912-ai-dashboard-generation]])
- **9 — Hardening & Optimization** — <span style="color:#22c55e">**[Done — 9.1 + 9.2 + 9.3 + 9.3b + 9.4 + 9.5a + 9.6]**</span> — Perf + perceived-perf program (Track A actual speed, Track B perceived speed). 9.1 auth fast-path + 9.2 streaming shell + 9.3 tagged `use cache` shell reads + **9.3b widget-aggregation cache** + 9.4 route skeletons + 9.5a interaction responsiveness + **9.6 Web-Vitals gate** (Lighthouse CI budget + `next/web-vitals` RUM) all shipped. Spec `docs/superpowers/specs/2026-06-22-phase-9-performance-optimization-design.md`. ([[2026-06-28-1743-phase-9-close-parallel-batch]])
- **RS — Design refresh (dark-first reskin)** — <span style="color:#22c55e">**[Done — dark + light]**</span> — Dark-first near-black palette as `.dark` OKLch tokens (dark default); light-mode pass shipped. ([[2026-06-16-decision-08-dark-first-monday-reskin]])
- **TOUCH — iPad optimization** — <span style="color:#eab308">**[In progress — Batch 1 foundation + Batch 2 (Table/Item-Panel/Nav/Kanban) done]**</span> — iPad-first, full authoring parity, touch-ergonomics (no layout reflow). Batch 1 shared primitives shipped: `useCoarsePointer`, touch-aware dnd sensors (long-press lift), `<DragHandle>`, `<RevealOnHover>`, 44px tap targets, touch-aware tooltip; Kanban reference integration. Batch 2 four-surface parallel ship: Table, Item Panel, Nav (incl. gotcha-47 a11y label fix), Kanban — all `pointer-coarse:`-gated, zero desktop change. **Remaining:** Gantt + Calendar drag surfaces. Spec `docs/superpowers/specs/2026-06-26-ipad-touch-optimization-design.md` + per-surface specs `2026-06-29-touch-batch2-*`. ([[2026-06-28-1822-ipad-touch-foundation]], [[2026-06-29-1235-touch-batch-2-parallel-ship]])

## 3. Now

- **Phase:** Phase 6 (ClickUp depth) complete except deferred 6e Docs · Phase 7 (Asana polish) in progress — 7a + 7b + 7c + Workload analytics v3 + **time allocation** shipped · **Phase 9 (Hardening) DONE** · **TOUCH (iPad) Batch 1 foundation DONE** · **TOUCH Batch 2: Table + Item Panel + Nav (incl. gotcha-47 a11y) + Kanban shipped** — Gantt + Calendar surfaces remain.
- **Branch:** `develop == origin/develop` at `f75fe32` (squash-divergence heal post-#41); `main ⊆ develop`, nothing unpromoted. **Last production promotion is #41** (2026-06-29, `bf01836`): TOUCH Batch 2 (Table + Item Panel + Nav gotcha-47 a11y + Kanban) + `finish-task` changelog guard. Main CI green + Vercel prod deploy confirmed. (Preceded by **#38** `3423ee9`, **#37** `19e86e0`.) CI tuning from #38 still stands: Lighthouse informational/warn (`94aea1c`, `ba4981e`), CI verify unit-only (`4da5c30`).
- **In flight:** nothing open. **`/sync-prod` completed this session** (2026-06-29) — dev → prod full replace, then **test-fixture purge on BOTH dev + prod**: deleted 199 test orgs (cascade) + 4 audit rows + 220 `@example.com` users on each, guarded by a 10/10 count check (auto-rollback). Both DBs now identical at **10 orgs / 8 boards / 154 items / 10 users / 9 storage** (the 10 real accounts only). Pre-cleanup backups: `*-precleanup-20260629-143107.sql`. ⚠️ Root cause persists: integration tests write `@example.com` fixtures to the remote DEV DB, so pollution **will re-accumulate** — durable fix is the planned isolated test DB (`.env.test`) so fixtures never reach the dev→prod source ([[2026-06-23-gotcha-43-shared-db-integration-test-flake]]).
- **Next:** **finish TOUCH Batch 2**: the two remaining surfaces still on old `PointerSensor` with `TODO(touch-batch-2)` markers — **`GanttBoard.tsx`** (bar drag) + **`CalendarBoard.tsx`** (event drag); `ColumnOptionsDialog`/`BoardsNav` markers were already cleared by the Table/Nav passes. Then Phase 7 remaining polish / Phase 10. Optional carryover: optimistic board mutations — **recommended skip**; `/roast` follow-ups — minor.
- **Owed:** **Migration-ledger repair** — `20260625120000_item_created_by` was **repaired this session** (`supabase migration repair --status applied`, DEV ledger now records it). **Still owed:** `20260623000000` (percent*enum) shows the same drift — DEV ledger lacks it though the DDL is applied (and PROD's ledger has it) — run `supabase migration repair --status applied 20260623000000` to reconcile. See [[2026-06-26-1044-item-creation-metadata]]. \_Integration-test gate:* cross-run teardown cascade flake is FIXED (`56180fb`; [[2026-06-26-1014-integration-flake-root-cause]]); the live-DB suites still run against remote Supabase — durable fix is a dedicated isolated test database (a separate test-only Supabase project) via `.env.test` ([[2026-06-23-gotcha-43-shared-db-integration-test-flake]]). _finish-task vs CI changelog gap:_ `finish-task.sh` gates on `typecheck/lint/test/build` but **not** `pnpm changelog:gen`, while CI has a `develop`-only **changelog-drift** job that fails if `src/lib/changelog/generated.ts` is stale vs the `Changelog:` commit trailers. TOUCH Batch 2 (Kanban) tripped this — local gate green, CI red — fixed by a manual regen commit (`45a2bbe`). **Fix forward:** add `pnpm changelog:gen` (+ stage generated.ts) to `finish-task.sh`, or have build agents run it before finishing whenever a commit carries a `Changelog:` trailer.

### Last session

```dataviewjs
const sessions = dv.pages('"vault/sessions"')
  .where(p => p.type === "session" && p.status === "complete")
  .array();
sessions.sort((a, b) => String(b.file.name).localeCompare(String(a.file.name)));
const latest = sessions[0];

if (!latest) {
  dv.paragraph("_No finalized session notes yet — capture one at the end of a working session._");
} else {
  dv.paragraph(`**[[${latest.file.name}]]** · _${latest.date}_`);
  dv.paragraph(`![[${latest.file.name}]]`);
}
```

### Recent sessions (last 10)

```dataview
TABLE branch, date as "Session"
FROM "vault/sessions"
WHERE type = "session"
SORT file.name DESC
LIMIT 10
```

### Recent activity — specs/docs (last 14d)

Any spec or doc touched in the last two weeks (whole repo is the vault now).

```dataview
TABLE type, status, file.mtime as "Updated"
FROM "docs" OR "specs"
WHERE file.mtime > date(today) - dur(14 days)
SORT file.mtime DESC
```

## 4. Engineering guardrails (from spec §8)

- TS strict, no unjustified `any`, **Zod at every boundary**.
- **Server Components by default**; Client only when interactive; **Server Actions for mutations**.
- **RLS is the real security boundary** — never trust the client. Default deny on every table; policies key off `org_members` for `auth.uid()`; no cross-org access.
- `SUPABASE_SERVICE_ROLE_KEY` never reaches the browser.
- All schema via **versioned migrations** (never dashboard click-ops). After each migration: `generate_typescript_types` → `src/types/database.types.ts`, then run `get_advisors`.
- Every feature ships with at least basic tests. **No phase complete with failing tests or advisor warnings.** Small conventional-commit commits.
- This is **Next.js 16, not the version in training data** — read `node_modules/next/dist/docs/` before writing framework code (see `AGENTS.md`).

## 5. Decision log (last 10)

```dataview
TABLE status, file.cday as "Created"
FROM "vault/decisions"
WHERE type = "adr"
SORT file.cday DESC
LIMIT 10
```

## 6. Entry points

- [[product]] — what we're building and for whom
- [[architecture]] — system + code structure, data model
- [[platform-roadmap]] — phase 0–9 detail
- [[specs]] — design spec index
- [[operations]] — runbooks, Supabase/MCP, deploy
- [[memory]] — what lives where (this vault's self-map)
