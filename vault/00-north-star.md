---
type: north-star
status: active
last-updated: 2026-06-17
tags: [project/pulse, north-star]
related:
  - "[[README]]"
  - "[[product]]"
---

# Pulse — North Star

> Single canonical entry point. Where are we, where are we going, why. Open this first.
> **When state changes, update the relevant section and bump `last-updated` in the frontmatter.**

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

From the master spec §7. Each phase: status + one-line outcome. **Commit + checkpoint after each;
run tests + advisors + regenerate types before moving on.**

- **0 — Setup** — <span style="color:#22c55e">**[Done]**</span>
  Scaffold, deps, theming tokens, Supabase + MCP wired. Themed empty app shell, dark/light toggle, ⌘K stub.
  _Done 2026-06-14 (commits `25c3e04` → `fea23fa`). See [[2026-06-14-phase0-setup]]._
- **1 — Auth & tenancy** — <span style="color:#22c55e">**[Done]**</span>
  Email/password auth, org creation + membership, protected routes, RLS baseline.
  _Done 2026-06-15 (commits `d9fc02c` → `31336e5`). RLS isolation proven by integration test; 32 unit tests + e2e green. See [[2026-06-15-phase1-auth-tenancy]]._
- **2 — Boards core** — <span style="color:#22c55e">**[Done — 2a+2b+2c]**</span>
  Workspaces→boards→groups→items, Table view (Text/Status/People/Date/Numbers/Dropdown), inline editing, optimistic updates, realtime.
  _Done 2026-06-15. **2a** (PR #9 `abb8e4e`): schema+RLS+RPCs, queries/actions, live sidebar + `/boards/[boardId]`, read-only virtualized Table. **2b** (PR #12 `3620c69`): inline editors for all 6 kinds, optimistic TanStack-Query board cache, Supabase realtime reconciliation, migration squash + default Status seed. 110 tests + live RLS + e2e green. See [[2026-06-15-1053-phase2a-boards-core]], [[2026-06-15-1259-phase2b-boards-interactive]]. **2c** (designed 2026-06-17, building next): **column management** — add (kind picker) / rename / delete / **resize** (server-shared `width` + Realtime) over the existing `columns` table; the missing boards-core column CRUD (was blocking real board testing). Spec: [[2026-06-17-phase-2c-column-management-design]]. **2c** (Done 2026-06-17, subagent-driven): `columns.width` migration + 4 Server Actions (create/rename/delete/resize, org-derived) + cache mutators + `columns` Realtime + `ColumnHeader`/`AddColumnMenu` + BoardTable per-column-width grid. 337 tests + live RLS + e2e + SHIP review. Verification caught a real add-column bug (realtime-only render → optimistic insert like `addItem`). See [[2026-06-17-1929-phase2c-column-management]]._
- **3 — Views** — <span style="color:#22c55e">**[Done]**</span>
  Kanban + Calendar + Timeline/Gantt with dependencies; view switcher + saved config.
  _**3a**: `board_views` + RLS + RPCs, view switcher (client-side `?view=` switching, no RSC refetch),
  Kanban. **3b** (2026-06-16): Calendar (`CalendarBoard` + `dates.ts`/`calendar.ts`) and Timeline/Gantt
  (`GanttBoard` + `gantt.ts`) with the `item_dependencies` model (cycle-safe RPC + RLS, 23 integration
  tests). Per-kind view config; ViewSwitcher add-view menu. See [[2026-06-16-2009-dark-reskin-calendar-timeline]]._
- **4 — Collaboration** — <span style="color:#22c55e">**[Done]**</span>
  Item detail panel, updates/comments/@mentions, attachments, activity log, notifications inbox.
  _Design done 2026-06-16: [[2026-06-16-phase-4-collaboration-design]]
  (`docs/superpowers/specs/2026-06-16-phase-4-collaboration-design.md`). One spec, three sliced PRs.
  **4a** (Done 2026-06-17): `?item=` drawer (History API, 0 RSC refetch) + Updates
  (optimistic Server Actions) + trigger-driven append-only Activity Log (`item_updates` +
  `item_activities`, RLS, Realtime, render-time resolution). Final review caught a delete-breaking
  trigger FK bug + an optimistic dedup race. See [[2026-06-17-0846-phase4a-item-panel-updates-activity]].
  **4b** (Done 2026-06-17, 19 commits): @mentions (@-autocomplete composer, `body {text,mentions}`,
  fan-out per recipient) + People-cell `assigned` fan-out + per-user `notifications` table (recipient-gated
  RLS, per-user Realtime) + app-shell inbox bell w/ unread badge + deep-link. 266 tests + live RLS
  integration + two-user e2e green; advisors clean. See [[2026-06-17-0920-phase4b-mentions-notifications]].
  **4c** (Done 2026-06-17, 16 commits): item-level attachments — `attachments` table + private Storage
  bucket + table & **Storage-object RLS** (org from path's leading segment) + Realtime; client-direct
  upload, server-minted signed URLs (attachment-disposition download; SVG excluded from inline preview),
  path-spoof guard; Monday-style **Files tab** (gallery/list + drag-drop + preview lightbox). 310 tests +
  cloud RLS integration (table + Storage policies) + Playwright e2e green; review verdict SHIP. See
  [[2026-06-17-1400-phase4c-attachments]]. Informed by a study of the `idandavid1/My-Day` Monday clone —
  UX taxonomy reused, data architecture rejected; see [[2026-06-16-decision-11-myday-clone-donor]]._
- **5 — Automations + Rules** — **[Not started]**
  Trigger/condition/action builder; Postgres triggers + Edge Functions; common recipes.
- **6 — ClickUp depth** — **[Not started]**
  Subitems/nesting, time tracking, Docs, custom statuses/fields, relations + mirror columns.
- **7 — Asana polish** — **[Not started]**
  Goals/OKRs, Portfolios, Workload/capacity.
- **8 — Dashboards + templates + ⌘K polish** — <span style="color:#eab308">**[In progress — D1 shipped]**</span>
  _**Dashboards D1** (2026-06-17, `708a7dc..7aa1fed`, pushed): cross-board workspace dashboards —
  `dashboards`+`dashboard_widgets` tables (org-RLS) + `dashboard_aggregate` RPC spine (count/sum/avg,
  optional grouping) + Server Actions + TanStack hooks + `react-grid-layout` v2 drag-resize canvas
  (0-refetch-on-drag) + **Number/KPI** widget + add-widget dialog + sidebar Dashboards section.
  358 tests + live cross-org RLS/aggregate (4/4) + Playwright e2e; review SHIP-WITH-NITS (2 fixed).
  Spec: [[2026-06-17-dashboards-cross-board-design]]. See [[2026-06-17-2048-dashboards-d1-foundation]],
  [[2026-06-17-2048-gotcha-14-react-grid-layout-v2-api]]. **Next: D2** (Chart bar/pie + Battery,
  reuses the aggregate spine + recharts), then **D3** (List widget). Templates + ⌘K polish later._
- **9 — Hardening** — **[Not started]**
  Performance (virtualization, indexes), advisors clean, tests, a11y audit, Vercel deploy.

**RS — Design refresh (dark-first reskin)** — <span style="color:#22c55e">**[Shipped — dark; light pending]**</span>
Dark-first near-black palette translated into `.dark` `@theme`/OKLch tokens (+ elevation, scrollbar,
animations), dark set as default, and "direction C" density applied to the board surfaces (table, pills,
kanban, chrome). User-verified. **Light-mode pass still pending.** Target + reuse map:
[[2026-06-16-decision-08-dark-first-monday-reskin]].

**Where we are:** Phases 0–4 done on `develop` **and now promoted to `main`** (PR #16 squash-merged 2026-06-17 — `main` carries Phases 0–4 + dark reskin + landing + sidebar; no Vercel project yet, so this is integration, not a live deploy). Phase 2 boards-core fully complete (**2c column management** add/rename/delete/resize shipped + pushed; 3b Calendar + Timeline/Gantt + dependencies shipped + user-verified). Dark reskin shipped. Board-view performance pass shipped. Collapsible sidebar shipped. **Public MONOLITH landing page shipped + pushed 2026-06-17.** **Phase 4 Collaboration complete (4a+4b+4c) + pushed 2026-06-17** — item detail panel (`?item=` drawer) + Updates + Activity Log (4a), @mentions + per-user notifications inbox (4b), and item-level **attachments** (4c — Supabase Storage + table/Storage RLS, Monday-style Files tab), all verified (310 tests, cloud RLS integration, Playwright e2e) with advisors clean. (`develop → main` promotion done 2026-06-17.) **Phase 8 started: Dashboards D1 shipped + pushed 2026-06-17** — cross-board workspace dashboards (aggregation-RPC spine + drag-resize canvas + Number widget; charts are D2). Remaining near-term: user-verify D1, Dashboards **D2** (Chart+Battery) + **D3** (List), light-mode reskin, then Phase 5 (Automations).

## 3. Now

- **Phase:** Phases 0–4 complete + promoted to `main`. **Phase 8 in progress — Dashboards D1 shipped.** **Next:** user-verify D1 in-app, then Dashboards **D2** (Chart+Battery) — short plan off the existing subsystem spec, then D3 (List).
- **Branch:** `develop` (synced with `origin/develop` at `7aa1fed`). `main` at squash commit `30a9cf3`.
- **Latest (2026-06-17):** **Dashboards D1 — foundation + canvas + Number widget** (`708a7dc..7aa1fed`, 16 commits, pushed). Cross-board workspace dashboards: `dashboards`+`dashboard_widgets` tables (org-RLS) + `widget_kind` enum + `dashboard_aggregate` RPC spine (count/sum/avg, optional status grouping, empty-cell LEFT JOIN) + Server Actions + queries + TanStack hooks (per-widget data keyed by config hash) + `react-grid-layout` **v2** drag-resize canvas (debounced layout persist, **0 refetch on drag**) + Number/KPI widget + add-widget dialog + sidebar Dashboards section (both surfaces). 15-task subagent-driven; gate green (typecheck/lint/**358 tests**/build); **live cross-org RLS + aggregate 4/4**; Playwright e2e (create→add→drag→persist) green; final review **SHIP-WITH-NITS** (fixed layout-persist rollback + bounded numbers-column read). Plan deviation: rgl is v2.2.3 (rewritten API) → [[2026-06-17-2048-gotcha-14-react-grid-layout-v2-api]]. Spec [[2026-06-17-dashboards-cross-board-design]]. See [[2026-06-17-2048-dashboards-d1-foundation]].
- **Prior (2026-06-17):** **develop → main promotion.** Squash-merged the standing promotion PR #16 — `main` advanced past Phase 2b to carry Phases 0–4 + dark reskin + landing + sidebar. No code changes. Repo forces squash (merge-commits disabled, rebase fails on `develop`'s merge-commit history), so `main` now diverges permanently from `develop` in history — future promotions still diff correctly (tree-based). No Vercel project yet → integration only, not a live deploy. See [[2026-06-17-1947-develop-main-promotion]].
- **Prior (2026-06-17):** **Phase 2c — Column management** (`36840cf..34f90be`, pushed). 10-task subagent-driven TDD: `columns.width` migration + 4 Zod schemas + pure `defaultColumn` + 4 org-derived Server Actions (create/rename/delete/resize) + cache mutators (insert/replace/remove, idempotent by id) + mutation hooks + `columns` Realtime + shadcn alert-dialog + `ColumnHeader`/`AddColumnMenu` + BoardTable per-column-width grid (dead TanStack-Table model removed; body still virtualizes via react-virtual). Gate green (typecheck/lint/**337 tests**/build; advisors clean); live cross-org RLS + Playwright e2e (add→rename→delete) green; final review **SHIP**. **Verification caught a real bug:** add-column rendered only via the Realtime echo (vanished if it lagged) → fixed to return the full row + optimistic `insertColumn` on success, mirroring `addItem` (`f2fa6f7`). Concurrency trap: a parallel sidebar session shared this checkout — its `git add -A` swept my staged `database.types.ts` into `993c17a` (content correct). See [[2026-06-17-1929-phase2c-column-management]].
- **Earlier (2026-06-17):** **Collapsible sidebar** (`993c17a..d8ac5eb`, pushed). 4-task subagent-driven TDD: persisted `sidebarCollapsed`/`hasHydrated` in `useUIStore` (Zustand `persist`, flash-free hydration guard), `BoardsNav` `collapsed` rail variant, `Brand` module + `Sidebar` client component (w-60⇄w-14, ⌘\\ toggle) replacing the inline `<aside>`. See [[2026-06-17-1858-collapsible-sidebar]].
- **Earlier (2026-06-17):** **MONOLITH public landing page** (`b5dbbe1..cfd3d95`, pushed): public `/` route, pure-RSC `MonolithHero` wrapping `<Link href="/login">`; trap — `src/proxy.ts` had to whitelist `/` as public + invert the `home` e2e → [[2026-06-17-gotcha-12-public-route-needs-proxy-and-e2e-update]]. See [[2026-06-17-1126-monolith-landing-page]]. **Follow-on UI polish** (`2a19fb2`,`70156e4`,`e714eb0`): MONOLITH nav brand (monolith mark + Archivo wordmark, shared `src/lib/fonts.ts`) linking to a new always-on `/landing` splash, org line removed; **collapsible-sidebar spec+plan written, not yet built** ([[2026-06-17-1829-nav-brand-and-sidebar-plan]], plan `docs/superpowers/plans/2026-06-17-sidebar-collapse.md`). (Board-switch perf fix before it: [[2026-06-17-1043-board-switch-perf-layout]].)
- **🧑 Manual gates (Danijel):** Supabase keys done. Project is cloud-native with no local stack — with explicit per-session authorization, agents apply migrations via `supabase db push --linked` (done this session for the three 4a migrations). The **Supabase MCP** was OAuth-authorized this session (read-write scope; used read-only for advisor lints — schema still goes through versioned migration files, never `apply_migration`). Regenerate types after schema changes (note: `pnpm db:types` can leak a PostHog telemetry line — filter `'"_tag"'` before prettier). **Drift watch RESOLVED:** the migration ledger was fully in sync (local == remote) before 4a's pushes — 3b's `timeline_dependencies` out-of-band apply is confirmed complete.

### Last session

```dataviewjs
const latest = dv.pages('"vault/sessions"')
  .where(p => p.type === "session" && p.status === "complete")
  .sort(p => p.date, "desc")[0];

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
SORT date DESC
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
