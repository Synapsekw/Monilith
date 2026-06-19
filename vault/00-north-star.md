---
type: north-star
status: active
last-updated: 2026-06-19-1906
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
- **5 — Automations + Rules** — <span style="color:#22c55e">**[Done — 5a + 5b-1 + 5b-2 + 5c-1 + 5c-2]**</span>
  Trigger/condition/action builder; Postgres triggers + `pg_cron`/`pg_net` (no Edge Functions); recipes.
  \_**5c-2** (Done + pushed 2026-06-19, subagent-driven, **closes Phase 5**): external **webhook
  actions** — a `call_webhook` action enqueues an HTTPS POST via **`pg_net`** (logged `queued`) + an
  `automation_webhook_deliveries` ledger; a 1-min `pg_cron` reconcile sweep folds the async HTTP
  response into the 5c-1 run-history (delivered / failed outcomes). Baseline SSRF URL guard + an
  **admin-gate DB trigger** (42501, `auth.uid()`-guarded so service-role/cron pass) — the real
  boundary; server-action + builder gating are UX. 642 tests + 7-case cloud integration + e2e + a
  real-network reconcile proof (pg_net delivered 405/503/200, mapped correctly); final whole-branch
  review **Ship**. See [[2026-06-19-1316-phase5c2-webhook-actions]], spec
  [[2026-06-19-phase-5c2-automations-design]]. **5a** (Done 2026-06-18): in-DB engine — `automations` table (jsonb trigger/actions, org-RLS) +
  an `AFTER` trigger on `cell_values` (`SECURITY DEFINER`, depth-cap loop guard) running
  Status/Dropdown-change rules → notify-person + set-option actions; per-board `AutomationsDialog`
  guided builder + recipes; `'automation'` notification kind. 12-case cloud RLS+engine integration +
  builder unit + e2e; 471 tests; review SHIP. Caught + fixed a production-breaking empty-string
  custom-GUC bug ([[2026-06-18-1711-gotcha-17-empty-string-custom-guc]]). Spec:
  [[2026-06-18-phase-5a-automations-design]]; see [[2026-06-18-1711-phase5a-automations]]. **5b-1**
  (Done + pushed 2026-06-18): `item_created` + `person_assigned` triggers + the **"If" condition**
  (flat AND/OR gate reusing the D3b filter machinery, evaluated in-DB against the firing item), all
  in-DB; trigger jsonb → discriminated union; shared `_automation_run` + isolated injection-safe
  condition predicate; first-ever `items` AFTER INSERT trigger; builder trigger-type selector + If
  section + 2 recipes. Subagent-driven (10 tasks + 2 review fixes: recipe-remount bug, predicate
  null-guard). 519 tests + 16-case cloud engine integration + 3 e2e; final review SHIP-WITH-NITS
  (nits fixed). Spec [[2026-06-18-phase-5b1-automations-design]], see
  [[2026-06-18-1653-phase5b1-automations-triggers-condition]]. **5b-2** (Done 2026-06-18): in-DB
  **date-based** triggers via `pg_cron` (which turned out to be available — 1.6.4) — a `date_reached`
  trigger ("N days before / on / N days after a date column") + an hourly **`_automation_date_sweep`**
  firing each org once/day at **08:00 org-local** (reusing `_automation_run`, `actor:=null`), an
  `automation_date_fires` once-only ledger, `organizations.timezone` + a minimal `/settings` page,
  builder control + recipes. Subagent-driven; 560+ tests + 7-case cloud engine integration + 3 §7
  isolation cases + 2 e2e; review SHIP-WITH-NITS (fixed). Spec [[2026-06-18-phase-5b2-automations-design]];
  see [[2026-06-18-2222-phase5b2-date-triggers]]. **5c-1** (Done 2026-06-19,
  subagent-driven): **run-history** — `automation_runs` table (org-RLS, SELECT-only, definer-writes) per
  rule-fire (status `ran`/`blocked`/`error` + per-action outcomes jsonb), logged inside `_automation_run`
  (+ a `begin/exception` wrapper making automations **fault-isolated**: a broken action logs an `error` run
  instead of aborting the user's edit), 3 callers repointed, `getAutomationRuns` action + pure
  `timeAgo`/`formatRunSummary`, a lazy per-rule **"Recent runs"** disclosure in `AutomationsDialog`, and a
  daily `pg_cron` prune (keep 50/rule). 573 tests + 7-case cloud integration (incl. fault-isolation + prune
  - RLS) + e2e; advisors clean; holistic review SHIP-WITH-NITS (emerald→`bg-primary` badge + blocked/error
    render test fixed). Caught a `CREATE OR REPLACE FUNCTION` overload trap → cleanup migration
    ([[2026-06-19-gotcha-18-create-or-replace-function-overload]]). Spec
    [[2026-06-19-phase-5c1-automations-design]], plan [[2026-06-19-0825-phase5c1-runhistory-plan]]; see
    [[2026-06-19-0957-phase5c1-run-history]].\_
- **6 — ClickUp depth** — <span style="color:#eab308">**[In progress — 6a subitems done]**</span>
  Subitems/nesting, time tracking, Docs, custom statuses/fields, relations + mirror columns.
  _Phase 6 split into 5 slices (A subitems · B custom fields/statuses · C time tracking · D relations+mirror · E docs);
  each its own spec→plan→build. **6a — Subitems** (Done 2026-06-19, subagent-driven, 15 commits `be48a39..4c424df`):
  single-level subitems reusing `items.parent_id` + a `tg_items_single_level` BEFORE-trigger (self-parent / 2-level /
  cross-board / demote-with-children all rejected — verified live via MCP); subitems **share the board's columns**;
  Table view buckets items → top-level virtualized (dynamic `measureElement`) with an expanded parent's subitems as a
  **normal-flow dnd-sortable sub-block** (add/rename/delete/**drag-reorder**), **read-only rollups on collapsed parents**
  (sum/status-distribution/date-span/people-union); new `addSubitem`/`deleteItem`/`reorderItem` actions+mutations
  (deleteItem filled a real gap — items had no delete path); other views unchanged. Built Wave-1 (5 parallel) → Wave-2
  (3 parallel) → serial BoardTable chain; per-task spec+quality reviews + final whole-branch review **SHIP-WITH-NITS**.
  566 unit/component tests + e2e green; typecheck/lint/build clean. Spec [[2026-06-19-phase-6a-subitems-design]], plan
  [[2026-06-19-phase-6a-subitems]]. **Next: 6b — custom fields/statuses.**_
- **7 — Asana polish** — **[Not started]**
  Goals/OKRs, Portfolios, Workload/capacity.
- **8 — Dashboards + templates + ⌘K polish** — <span style="color:#22c55e">**[Done — widgets (D1+D2+D3a+D3b) + templates + ⌘K]**</span>
  _**⌘K polish** (2026-06-18, `a2d0670..45d498c`, pushed): palette now does **Navigation** (jump to
  any board/dashboard, client-side fuzzy filter, 0 fetch) + **Create** (New board → template picker;
  New dashboard), closing Phase 8. `<CommandPalette>` moved `Providers`→`AppShell` (props, authed-only);
  create reuses existing dialogs via ephemeral `useUIStore` flags. Final review caught a collapsed-sidebar
  bug (dialogs only mounted when expanded) → fixed + regression tests. 434 tests + e2e. Global content
  search deferred. See [[2026-06-18-1323-phase8-cmdk-polish]]._
  _**Board templates** (2026-06-18, `d678094..f99ccb6`, pushed): built-in catalog of 4 templates
  (Blank/Sprint/Content/CRM, donor-ported → Pulse's 6 column kinds) seeding columns+groups+example
  items. TS catalog is the single source of truth → `createBoardFromTemplate` action +
  `buildTemplatePayload` (mints uuids, resolves date offsets) → atomic `create_board_from_template`
  RPC (security definer, membership-checked) → sidebar picker. Subagent-driven; caught a `"use server"`
  sync-export runtime bug ([[2026-06-18-1128-gotcha-16-use-server-sync-export]]). 424 tests + live RLS
  2/2 + e2e; final review **Ship with nits** (both fixed). See [[2026-06-18-1128-phase8-board-templates]]._
  _**Dashboards D1** (2026-06-17, `708a7dc..7aa1fed`, pushed): cross-board workspace dashboards —
  `dashboards`+`dashboard_widgets` tables (org-RLS) + `dashboard_aggregate` RPC spine (count/sum/avg,
  optional grouping) + Server Actions + TanStack hooks + `react-grid-layout` v2 drag-resize canvas
  (0-refetch-on-drag) + **Number/KPI** widget + add-widget dialog + sidebar Dashboards section.
  Spec: [[2026-06-17-dashboards-cross-board-design]]. See [[2026-06-17-2048-dashboards-d1-foundation]],
  [[2026-06-17-2048-gotcha-14-react-grid-layout-v2-api]]._
  _**Dashboards D2** (2026-06-17, `818e4f1..376402e`, pushed): **Chart** (bar/pie, recharts v3) +
  **Battery** (status-distribution bar) widgets grouping by a **Status** column; `shapeBuckets`
  helper + `getWidgetData` columnMeta + generalized add-widget dialog. No RPC change (reused the
  D1 spine). 366 tests + live integration 5/5 (grouped-by-status) + e2e; review SHIP-WITH-NITS
  (board-switch reset fixed). See [[2026-06-17-2119-dashboards-d2-chart-battery]]._
  _**Dashboards D3a** (2026-06-17, `ab1a5d4..3a6d0dd`, pushed): **List** widget — bounded latest-N
  rows of a source board (item name + chosen columns; Status pill). No DB change — `getWidgetRows`
  RLS-scoped bounded selects + `formatCell` + add-widget List option. 378 tests + e2e 3/3; review
  ready-to-merge. D3 split: D3a=list (done), **D3b=multi-condition filter (next)**. See
  [[2026-06-17-2155-dashboards-d3a-list-widget]],
  [[2026-06-17-2155-gotcha-15-subagent-scope-overstep-shared-checkout]]. Then templates + ⌘K polish.
  Deferred: Dropdown/People grouping, People name/avatar rendering._
  _**Dashboards D3b** (2026-06-18, `493e77d..40684d4`, pushed): **List filter** — flat AND/OR
  multi-condition filter, **closing the dashboards widget subsystem**. New bounded `dashboard_list_rows`
  RPC (`SECURITY DEFINER`, membership-checked, per-condition `EXISTS(cell_values)` joined by combinator,
  **LIMIT after filter**, injection-safe `%L` + cast guards) + `getWidgetRows` delegates to it + filter
  Zod schema + `filter-meta` + `FilterBuilder` UI + add-widget wiring + **per-widget List config editor**.
  Subagent-driven (9 tasks, two-stage review each; review caught a stale-config-on-reopen bug). 404
  tests + e2e 4/4 + advisor-parity (search_path pinned); final holistic review verdict **Ship**.
  Deferred (lean tier): dropdown/people value-matching, nested groups, relative dates, `between`.
  See [[2026-06-18-0818-dashboards-d3b-list-filter]]._
- **9 — Hardening** — **[Not started]**
  Performance (virtualization, indexes), advisors clean, tests, a11y audit, Vercel deploy.

**RS — Design refresh (dark-first reskin)** — <span style="color:#22c55e">**[Done — dark + light]**</span>
Dark-first near-black palette translated into `.dark` `@theme`/OKLch tokens (+ elevation, scrollbar,
animations), dark set as default, and "direction C" density applied to the board surfaces (table, pills,
kanban, chrome). **Light-mode pass shipped 2026-06-18** — `pillTextColor` luminance helper (legible pill
text for any color, both modes), off-white `:root` elevation, theme-scoped soft shadows, light scrollbar,
darker light chart ramp; full Playwright light-mode sweep (20 surfaces) verified. Both modes user-verified.
Target + reuse map: [[2026-06-16-decision-08-dark-first-monday-reskin]]. See [[2026-06-18-1541-light-mode-reskin]].

**Where we are:** Phases 0–4 done on `develop` **and now promoted to `main`** (PR #16 squash-merged 2026-06-17 — `main` carries Phases 0–4 + dark reskin + landing + sidebar; no Vercel project yet, so this is integration, not a live deploy). Phase 2 boards-core fully complete (**2c column management** add/rename/delete/resize shipped + pushed; 3b Calendar + Timeline/Gantt + dependencies shipped + user-verified). Dark reskin shipped. Board-view performance pass shipped. Collapsible sidebar shipped. **Public MONOLITH landing page shipped + pushed 2026-06-17.** **Phase 4 Collaboration complete (4a+4b+4c) + pushed 2026-06-17** — item detail panel (`?item=` drawer) + Updates + Activity Log (4a), @mentions + per-user notifications inbox (4b), and item-level **attachments** (4c — Supabase Storage + table/Storage RLS, Monday-style Files tab), all verified (310 tests, cloud RLS integration, Playwright e2e) with advisors clean. (`develop → main` promotion done 2026-06-17.) **Phase 8: Dashboards widget subsystem CLOSED (D1+D2+D3a+D3b) + pushed** — cross-board workspace dashboards (aggregation-RPC spine + drag-resize canvas + Number in D1; **Chart bar/pie + Battery** grouping by status in D2; **List** widget — bounded latest-N rows + chosen columns — in D3a; **multi-condition List filter** — bounded `dashboard_list_rows` RPC + filter-builder UI + per-widget editor — in D3b, 2026-06-18). **Board templates shipped 2026-06-18** — built-in catalog (Blank/Sprint/Content/CRM) seeding columns+groups+example items via an atomic `create_board_from_template` RPC + sidebar picker. **⌘K command-palette polish shipped + pushed 2026-06-18 — closing Phase 8** (navigation to boards/dashboards + create commands, reusing loaded data + existing dialogs). ⌘K palette **user-verified in the live app 2026-06-18**. **Light-mode reskin shipped + pushed 2026-06-18 — RS workstream now complete (dark + light)**: `pillTextColor` luminance helper + light-token polish + full Playwright light-mode sweep. **Phase 5 (Automations + Rules) STARTED — 5a shipped 2026-06-18**: in-DB engine (`automations` table + `cell_values` trigger with depth-cap loop guard) running Status/Dropdown-change rules → notify + set-option, per-board guided builder + recipes, `'automation'` notification kind; 471 tests + 12-case cloud integration; review SHIP. **Phase 5b-1 shipped + pushed 2026-06-18** — `item_created` + `person_assigned` triggers + a multi-condition AND/OR **"If" gate** (in-DB, reusing the D3b filter machinery), built subagent-driven; 519 tests + 16-case cloud engine integration + 3 e2e; review SHIP-WITH-NITS (fixed). **Phase 5b-2 shipped + pushed 2026-06-18** — in-DB **date-based** triggers: `pg_cron` (available after all — 1.6.4) hourly **`_automation_date_sweep`** firing each org once/day at **08:00 org-local**, a `date_reached` trigger + `automation_date_fires` once-only ledger + `organizations.timezone` + minimal `/settings` page + builder control; subagent-driven; 560+ tests + 7-case cloud engine integration + 3 §7 isolation cases + 2 e2e; review SHIP-WITH-NITS (fixed). **Phase 5b-2 shipped + pushed 2026-06-18.** **Phase 5c-1 (run-history) BUILT 2026-06-19** (`9922ff3..f37c183` + `22cf632`, 8 commits, since pushed) — subagent-driven: `automation_runs` log + **fault-isolated** `_automation_run` (begin/exception) + per-rule "Recent runs" UI + `pg_cron` prune; 573 tests + 7-case cloud integration + e2e; review SHIP-WITH-NITS (fixed); two migrations applied to cloud (incl. an overload-cleanup, gotcha-18). Not yet user-verified live. Remaining near-term: **5c-2** (external/webhook actions via `pg_net`), or pivot to **Phase 6 (ClickUp depth)**. **Landing hero reworked to WebGL Light Rays (ReactBits/OGL) 2026-06-18 — replaced the topographic backdrop; `654ab3d`, since pushed.** **Phase 5c-2 (webhook actions via `pg_net` + reconcile sweep) shipped + pushed 2026-06-19 — CLOSING Phase 5 (Automations + Rules); 642 tests + cloud integration + e2e + real-network proof; whole-branch review Ship. `develop` pushed to origin (~40 commits incl. interleaved parallel-session work); `main` not promoted.**

## 3. Now

- **Phase:** Phases 0–4 complete + promoted to `main`. **Phase 8 COMPLETE**. **RS workstream COMPLETE** (dark + light). **Phase 5 (Automations + Rules) COMPLETE — 5a + 5b-1 + 5b-2 + 5c-1 + 5c-2 (webhook actions) all shipped 2026-06-19.** Side: **board group management COMPLETE 2026-06-19**; **top-level item drag-reorder shipped 2026-06-19** (within-group, front-end only). **Phase 6 (ClickUp depth) STARTED — 6a Subitems shipped 2026-06-19** (single-level nesting reusing `items.parent_id` + a DB single-level trigger; subitems share the board's columns; Table nesting + collapsed rollups + drag-reorder). **Next: 6b — custom fields/statuses** (then C time-tracking, D relations+mirror, E docs).
- **Branch:** `develop` **ahead of `origin/develop`** — unpushed local work (plans-execution-dag `5935606` + **item drag-reorder** `9a4b1fd..f9801ff` + interleaved parallel-session auth/email commits). 5c-1 run-history + name-column + add-group + 5c-2 webhook actions + group reorder/color/delete already on origin. `main` at squash commit `30a9cf3` — **do not promote yet** (WebGL landing dep needs a manual cross-browser check).
- **Side feature (2026-06-18):** **Public `/updates` changelog page + landing dev-note** (`fc6b6cf..a4bb9fb`, since pushed). Always-dark static `/updates` route rendering a hand-written changelog (`src/lib/changelog/` + `src/components/changelog/`, curated — not Mubarak's git-auto-gen, but same data shape); landing gains an "In active development" pill + footer "Invitation only" / `Updates →` link. Adopted a parallel session's in-flight `archivo`→`nunito` font rename. Two verification-caught fixes: `/updates` added to `proxy.ts` `PUBLIC_ROUTES` (the new auth proxy was 307→`/login`-ing it), and back link → `/landing` so logged-in users hit the splash. Built subagent-driven (spec+quality review each); runtime-verified on the live dev server. (Since pushed; `develop` typecheck/build is green again now that the parallel 5b automations work has landed.) See [[2026-06-18-1946-public-updates-page-landing-note]]. **Data-driven evolution in progress (2026-06-18-2144):** making the changelog self-maintaining from opt-in `Changelog:` git trailers — pure parser + frozen seed + committed `generated.ts` (since `main` is squashed, a build-time `git log` won't work) + develop-scoped CI drift guard. Tasks 1–5 done + reviewed (`da5c255..673f810`, changelog-scope only, 12 tests green); **Tasks 6–7 pending** (CI job + CONTRIBUTING docs + verification) plus a `\|`-in-description parser fix. Spec [[2026-06-18-data-driven-changelog-design|spec]]; see [[2026-06-18-2144-updates-changelog-data-driven]].
- **Latest (2026-06-19):** **Top-level item drag-reorder (within a group)** (`7b12370` spec + `7ee5617` plan + `9a4b1fd..f9801ff` 4 feature commits, **not pushed**). Closed the last gap in the Monday-style reorder toolkit — main item rows are now drag-reorderable within their group, mirroring the shipped sub-item drag. **Front-end only**: reused the existing `reorderItem` action/mutation (no DB change), within-group scope only (cross-group YAGNI-deferred). `GroupSection` wraps its virtualized list in a per-group `DndContext`+`SortableContext`; `ItemRow` made sortable (`useSortable`, hover `GripVertical` handle, `CSS.Translate` per gotcha-20). Brainstorm→spec→plan→**subagent-driven** (implementer + spec & quality two-stage review per task + final whole-branch review **ready-to-merge**, no Critical/Important). Gate green: typecheck/lint/build + **693 unit tests** (handle-presence + pure position-math/self-drop) + **e2e 1 passed** (real drag→reorder). The pre-existing `subitems.integration.test.ts` failure is unrelated (live-Supabase null org from the parallel auth work). Spec [[2026-06-19-item-drag-reorder-design|spec]], plan [[2026-06-19-item-drag-reorder|plan]]; see [[2026-06-19-1906-item-drag-reorder]]. **Next: 6b.**
- **Prior (2026-06-19):** **Process — plans must state an execution DAG (parallelization enforcement)** (`5935606`, committed locally, **not pushed**). Superpowers plans kept coming out as flat sequential lists even though each task already carries `Consumes / Produces` interface blocks — a latent dependency graph nothing synthesizes into concurrent batches. Fixed at the instruction layer (outranks + outlives the cached skills): **`AGENTS.md` working agreement #6** now requires specs to name independent units and plans to add an **Execution DAG** (dependency graph → parallel batches → critical path), with ≥2-task batches dispatched via `dispatching-parallel-agents` + worktree isolation — the same lever as the #5 perf budget. Rationale ADR [[2026-06-19-decision-21-plans-must-state-execution-dag]]. Not yet exercised on a real plan. See [[2026-06-19-1904-plans-execution-dag]]. **Next: 6b.**
- **Prior (2026-06-19):** **Phase 6a — Subitems (single-level nesting + rollups + drag-reorder)** (`be48a39..4c424df`, 15 commits, **not pushed**). Single-level subitems reusing `items.parent_id` + a `tg_items_single_level` BEFORE-trigger (self-parent / 2-level / cross-board / demote-with-children all rejected — verified live via MCP); subitems **share the board's columns**; Table view buckets items → top-level virtualized (dynamic `measureElement`) with an expanded parent's subitems as a **normal-flow dnd-sortable sub-block** (add / rename / **drag-reorder** / delete), **read-only rollups on collapsed parents** (sum / status-distribution / date-span / people-union); new `addSubitem`/`deleteItem`/`reorderItem` actions+mutations (`deleteItem` filled a real gap — items had no delete path); other views unchanged. Built **subagent-driven**: Wave-1 (5 parallel) → Wave-2 (3 parallel) → serial BoardTable chain; per-task spec+quality reviews + final whole-branch review **SHIP-WITH-NITS** (no Critical/Important). 566 unit/component tests + e2e green; typecheck/lint/build clean. Trigger applied to cloud (2nd push attempt — 1st hit an IPv6 timeout). Not yet user-verified live. Spec [[2026-06-19-phase-6a-subitems-design]], plan [[2026-06-19-phase-6a-subitems]]; see [[2026-06-19-1835-phase6a-subitems]]. **Next: 6b.**
- **Prior (2026-06-19):** **Dropdown + People cell editors — trailing Clear affordance** (`04341e8`, committed; not yet pushed at note time). Housekeeping: only the Status column exposed an explicit **Clear** in its selector popover; the other dropdown-style columns (`DropdownEditor` multi-select, `PeopleEditor`) cleared only via an undiscoverable deselect-all. Extracted a shared `ClearButton` from Status and reused it across all three editors; Clear routes through `onClear` (deletes the cell value) with a dismiss fallback — same contract everywhere. TDD: added Clear→onClear tests for Dropdown + People. Gate green (647 tests + typecheck + lint). See [[2026-06-19-1727-dropdown-people-clear-affordance]].
- **Prior (2026-06-19):** **Dashboard + widget rename + dashboard-load perf** (`d8738ac..8da17a4`, 3 commits, **pushed**). Phase-8 polish: dashboards and widgets could only be named at creation — added **inline click-to-edit titles** on the dashboard header (`DashboardCanvas`) and every widget header (`DashboardWidget`, all kinds) in edit mode, reusing the existing `renameDashboard` action + `editWidget` title (backend/RLS were already there; pure UI gap). New `renameDashboard` cache helper + optimistic mutation; TDD (54 dashboard tests green). Also **perf**: removed the dashboard page's boards→columns query waterfall via an inner-join embed (parallel reads). Plus a **spec+plan** for board `cell_values` payload projection (`select("*")`→`(item_id,column_id,value)`; ~40% payload cut) — windowing ruled out (all views need every item's cells), deferred until boards exceed ~500 items; **plan not yet executed** (held during a concurrent session's boards-file edits, now free). Not yet user-verified live. Spec [[2026-06-19-board-payload-projection-design|spec]], plan [[2026-06-19-board-payload-projection|plan]]; see [[2026-06-19-1644-dashboard-rename-and-perf]].
- **Prior (2026-06-19):** **Group management — reorder / color / delete (board group CRUD complete)** (`a82931b..efb6e70` 7 commits + drag-fix `39dc2a9`, **pushed**; Task-4 helpers landed in parallel automations commit `928d7c7` due to the shared checkout). Completes the Monday-style group toolkit on top of add-group: **drag-to-reorder** (`@dnd-kit/sortable`, `GripVertical` handle), **change color** from a fixed `GROUP_COLORS` palette in a per-group `⋯` menu, and **delete** (AlertDialog confirm; items cascade). Group cache helpers (`insertGroup`/`replaceGroup`) became **position-sorted** (mirror columns → reorder reflects for actor + realtime peers); new `removeGroup` cascades items + cell values; realtime group-INSERT routed through `insertGroup`. 3 Zod schemas + 3 actions (mirror `renameGroup`) + 3 optimistic mutations + pure `reorderPosition` helper (±1 at boundaries to avoid a position-0 tie) + `GroupMenu`. Brainstorm→spec→plan→**subagent-driven** (8 tasks, spec & quality review both **Approved**, only Minor notes). **68 group tests green (suite 642).** **User-verified live.** A drag visual bug — `CSS.Transform.toString` scaled the dragged section, stretching its absolutely-positioned virtual rows — was root-caused + fixed to `CSS.Translate.toString` (translate only, mirrors `KanbanCard`) + opaque lifted shadow ([[2026-06-19-gotcha-20-dnd-kit-transform-scale-stretch]]); user-confirmed. Deferred (YAGNI): bulk ops, item-between-group drag, custom hex. Spec [[2026-06-19-group-management-design|spec]], plan [[2026-06-19-group-management|plan]]; see [[2026-06-19-1633-group-management-reorder-color-delete]].
- **Prior (2026-06-19):** **Phase 5c-2 — Automations: external/webhook actions (closes Phase 5)** (`5d57232..8b7d091`, ~20 commits interleaved with a parallel session, **pushed to `origin/develop`** 2026-06-19). A `call_webhook` action: the in-DB `_automation_run` enqueues an HTTPS POST via **`pg_net`** (outcome `queued`) + records an `automation_webhook_deliveries` ledger row; a 1-min `pg_cron` **`_automation_webhook_reconcile`** reads `net._http_response` and patches the 5c-1 run-history to `delivered_<code>`/`failed_<code>`/`failed_network`. Baseline **SSRF guard** `_webhook_url_safe` (https-only; private/loopback/metadata + IP-literal blocklist; userinfo/port stripped; inet-cast exception-guarded) + an **admin-gate DB trigger** (`tg_automations_guard_webhook`, 42501, guarded on `auth.uid() is not null` so service-role/cron pass) — the real boundary; server-action + builder gating are UX. Two migrations (`20260619130000` schema/engine/guard, `20260619130001` reconcile/cron/prune) applied to cloud. Zod `call_webhook` variant, run-formatter strings, `getBoardAdminStatus` + `actionsContainWebhook` (non-`"use server"` module per gotcha-16), builder `WebhookRow` + admin-gated button, one recipe + dialog wiring (+ `summarize()` exhaustiveness fix). Built **subagent-driven** (9 tasks, fresh implementer + spec/quality review each; review caught the reconcile `get diagnostics row_count`→`boolean` runtime trap, fixed to `FOUND`). Gate green: typecheck/lint/**642 tests** (7-case cloud integration)/build; **e2e** vs live cloud; advisor-parity clean; **real-network reconcile proof** (pg_net delivered 405/503/200 → `_webhook_outcome` mapped + `jsonb_set` sibling-isolation shown); final whole-branch review **Ship**. Not yet user-verified beyond e2e. Spec [[2026-06-19-phase-5c2-automations-design]]; see [[2026-06-19-1316-phase5c2-webhook-actions]].
- **Prior (2026-06-19):** **Add group — board groups creatable from the Table view** (`b1c5a95..03b1aea`, 6 commits, **pushed**). Boards seeded exactly one group with no way to add more; the `createGroup` Server Action existed but had **zero runtime callers** (UI was never wired). Added a subtle **`+ Add group`** button at the bottom of the Table that creates **`Group N`** (auto-increment) and drops the new section straight into its existing inline rename input. Implementation mirrors the established `addColumn`/`addItem` **patch-on-success** pattern: `createGroup` now returns the full row (`.select("*")` → `{ group }`); new `insertGroup` cache helper (mirror of `insertItem`) + `addGroup` optimistic mutation (mirror of `addColumnMutation`, exposes `addGroup(name, { onSuccess(groupId), onError })`); `BoardTable` `renameGroupId` state + `GroupSection` `autoFocusRename`/`onRenameSettled` wiring (the idempotent realtime group handler de-dupes the echo, so no double-add). Brainstorm→spec→plan→**subagent-driven** (one implementer + spec & quality two-stage review; both approved, only Minor findings — count-based default name is intentional, untested `onError` path then covered). Gate green: typecheck/lint/**590 tests**/build; **user-verified live ("working, i can create a new group no issues")**. Deferred (YAGNI): group delete / reorder / color picker. Spec [[2026-06-19-add-group-design|spec]], plan [[2026-06-19-add-group|plan]]; see [[2026-06-19-1142-add-group-table]].
- **Prior (2026-06-19):** **Name column — auto-fit + manual resize** (`6537c6d`, `f9720de`/`27f1147` spec+plan, `8e0b3c3..6fd6e9d` 6 feature commits, **pushed**). The board Table's built-in **Name** column reached parity with the configurable columns: it now **auto-fits** the longest item name by default (pure `fitNameColumnWidth(names, measure)` over all items, offscreen-canvas measurer) and is **manually resizable** — a draggable `NameColumnHeader` (live drag = 0 round-trips, persists px on release; **double-click the handle** clears back to auto-fit). Persists per-board via nullable **`boards.name_column_width`** (`NULL`=auto, int=manual, check 80..1200; migration `20260619110000` pushed to cloud) + `resizeNameColumn` action/schema (mirrors `resizeColumn`, RLS boundary) + optimistic `replaceBoard` mutation. Brainstorm→spec→plan→**TDD inline**. Gate green: typecheck/lint/**583 tests**/build; **user-verified live ("its working")**. The `db:types` regen also dropped a now-stale `_automation_run` overload to match cloud (gotcha-18 family). Also bundled the dep-install warm-up fix (`6537c6d`: pin `turbopack.root` to silence the multi-lockfile warning + document-suppress two React-Compiler `incompatible-library` advisories on `useVirtualizer`). Spec [[2026-06-19-name-column-resize-autofit-design|spec]]; see [[2026-06-19-1018-name-column-resize-autofit]].
- **Prior (2026-06-19):** **Phase 5c-1 — Automations run-history (BUILT)** (`9922ff3..f37c183` + review fix `22cf632`, 8 commits, **since pushed**). Executed the 6-task plan **subagent-driven** (fresh implementer + spec/quality review per task). Shipped: `automation_runs` table (org-RLS, SELECT-only, definer-writes) + index; **`_automation_run`** recreated with `p_trigger_type` + per-action outcome logging + a `begin/exception` wrapper making automations **fault-isolated** (broken action logs an `error` run instead of aborting the user's edit); 3 callers repointed; `_automation_runs_prune` + daily `pg_cron`; `getAutomationRuns` action; pure `timeAgo`/`formatRunSummary`; lazy per-rule **"Recent runs"** disclosure in `AutomationsDialog`. Two migrations applied to cloud (`100000` run-history, `100001` dropping an orphaned 7-arg `_automation_run` overload — gotcha-18; required reconnecting the Supabase CLI this session). Gate green: typecheck/lint/**573 tests**/build; **7-case cloud integration** (fault-isolation asserts error-run AND surviving user edit; prune keeps 50; RLS) + 40 regression + **e2e**; advisors clean. Holistic review **SHIP-WITH-NITS** (off-system emerald `Ran` badge → `bg-primary`; blocked/error render test — both fixed). **Shared-checkout incident:** a parallel session emptied `database.types.ts` (failed `db:types` regen) → regenerated from cloud to unblock; parallel session has since committed its `name_column_width` work (`8e0b3c3`). **First live test (2026-06-19) caught + fixed a latent 5a-engine bug** ([[2026-06-19-gotcha-19-set-option-value-shape-per-column-kind]]): `set_option` always wrote the status shape `{optionId}`, so automations targeting a **dropdown** column wrote an unreadable shape → blank cell (run-history logged `set` accurately — that's what surfaced it). Fixed to write the target column's native shape (`dropdown → {optionIds:[x]}`) + a backfill repairing 6 corrupted cells (`251a7be`, migration `20260619120000` pushed; full suite 584). Spec [[2026-06-19-phase-5c1-automations-design]], plan [[2026-06-19-0825-phase5c1-runhistory-plan]]; see [[2026-06-19-0957-phase5c1-run-history]], [[2026-06-19-gotcha-18-create-or-replace-function-overload]].
- **Prior (2026-06-18):** **Phase 5b-2 — Automations: date-based (scheduled) triggers** (`59a2175..8b53c08`, 13 commits, pushed). Adds a `date_reached` trigger ("when {date column} is N days before / on / N days after") — the one non-reactive trigger family, needing a scheduler. **Key correction:** 5b-1's spec assumed no `pg_cron`; it IS available (1.6.4), so 5b-2 stayed fully **in-DB** — a `pg_cron` hourly **`_automation_date_sweep(p_now)`** firing each org once per local day at **08:00 org-local** (`at time zone`, per-org `exception` block, reuses `_automation_run` with `actor:=null`), an `automation_date_fires` once-only ledger (PK `(automation_id,item_id,fire_date)` + `on conflict do nothing` = exactly-once, no backfill, re-fires on date change), `organizations.timezone` + a minimal **`/settings`** page (admin-gated `updateOrgTimezone`, `Intl` picker), a builder "Date reached" control (signed `offsetDays` + rehydration), `summarize()` + 2 recipes. Two migrations applied to cloud (+ a corrective one dropping a redundant org UPDATE policy). Built **subagent-driven** (10 plan tasks + 2 review-nit fixes: redundant policy, 3 backfilled §7 security tests). Gate green: typecheck/lint/**560+ tests**/build; **7-case cloud engine integration** + 3 §7 isolation cases (ledger cross-org RLS, non-admin tz denial, two-org local firing) + 16/16 5b-1 regression + **2 e2e** (settings-tz persist, date_reached→set_option via UI builder → sweep). Advisor parity verified via SQL. Final review **SHIP-WITH-NITS** (Important nits fixed). Not yet user-verified live. **5c** next (external actions + run-history can read this ledger). Spec [[2026-06-18-phase-5b2-automations-design]]; see [[2026-06-18-2222-phase5b2-date-triggers]].
- **Prior (2026-06-18):** **Phase 5b-1 — Automations: more triggers + the "If" condition** (`e8765dc..797e4a2`, pushed to `origin/develop`). Extends the 5a in-DB engine with `item_created` + `person_assigned` triggers and an optional multi-condition flat AND/OR **"If" gate** (reuses the dashboards D3b filter Zod + `FilterBuilder` + operator set, evaluated in-DB against the firing item via an isolated injection-safe predicate). `trigger` jsonb → discriminated union; shared `_automation_run` (condition-gate + 5a action loop); a `person_assigned` branch on the `cell_values` trigger (fires on userId addition) + the **first-ever `items` AFTER INSERT trigger** (`item_created`); depth-cap loop guard + gotcha-17 GUC fix preserved. Builder gains a trigger-type selector + collapsible If section + 2 recipes; dialog summarizes the union + condition; condition threaded through the Server Actions (no new actions). Two corrective migrations (`160000` condition column + index, `160001` engine, `160002` predicate null-guard) applied to cloud. Built **subagent-driven** (10 plan tasks + 2 review fixes — a recipe-remount bug where recipes clicked from the build view didn't populate, and a defense-in-depth predicate null-guard). Gate green: typecheck/lint/**519 tests**/build; **16-case cloud engine integration** + 12/12 5a regression + **3 e2e** (item_created→set_option, two-user person_assigned→notify); final holistic review **SHIP-WITH-NITS** (nits fixed). Not yet user-verified live. Date-based triggers split to **5b-2**. Spec [[2026-06-18-phase-5b1-automations-design]]; see [[2026-06-18-1653-phase5b1-automations-triggers-condition]].
- **Prior (2026-06-18):** **Landing hero — WebGL Light Rays** (`654ab3d`, since pushed). Replaced the topographic-contour backdrop with a mouse-reactive **OGL god-ray** effect (ReactBits shader ported verbatim, typed, tuned: top-center, brand-indigo `#bcc4ff`, spread 0.62, length 2.6). New `LightRays` client component with reduced-motion static frame + `IntersectionObserver` offscreen pause + full `WEBGL_lose_context` teardown + SSR/jsdom inert fallback; retired `TopographyCanvas`; global `ogl` test mock; `ogl@^1.0.11`. Earlier in the session the wordmark also moved Archivo→Nunito. Chosen via an extended live-prototype design exploration (font comparison → 4 hero concepts → 4 horizon variants → perspective-fix research → 5 field iterations → Light Rays). Gate green (typecheck/lint/**513 tests**, 5 new/build) + verified rendering on the live `/landing` route. **Note: WebGL is now a runtime dep — manual cross-browser/perf check before promoting to `main`.** See [[2026-06-18-1957-landing-light-rays-hero]].
- **Prior (2026-06-18):** **Phase 5a — Automations engine + lean When/Then** (`cabb5f3..b846778`, 11 commits). Postgres-native in-DB engine: `automations` table (jsonb trigger/actions, org-RLS mirroring `columns`) + an `AFTER INSERT OR UPDATE` trigger on `cell_values` (`tg_run_automations`, `SECURITY DEFINER`/`search_path=''`, transaction-local **depth-cap loop guard**) matching enabled Status/Dropdown-change rules → **notify-person** + **set-option** actions; `'automation'` notification kind + `automation_id`. Four Server Actions + Zod schemas; per-board `AutomationsDialog` guided sentence builder + recipe quick-starts wired into `BoardHeader` (across all 4 view components); inbox renders the new kind. Built subagent-driven (parallel where disjoint, two-stage + holistic review = **SHIP**). The cloud integration test **caught a production-breaking bug** — empty-string custom GUC → `22P02` aborting every `cell_values` write — root-caused + fixed via corrective migration ([[2026-06-18-1711-gotcha-17-empty-string-custom-guc]]). Two migrations applied to cloud. Gate green: typecheck/lint/**471 tests** (12-case cloud RLS+engine integration)/build; e2e create→fire→notify→toggle-off. Not yet user-verified live. See [[2026-06-18-1711-phase5a-automations]].
- **Prior (2026-06-18):** **Landing rework — CTAs + topographic backdrop** (`486db75..0c2970a`). Reworked the MONOLITH landing from a single click-anywhere art piece into one with explicit entry points + a mouse-reactive backdrop. Brainstorm→spec→plan→subagent build (both review stages passed) added a `signedIn`-driven hero: `MagneticButton` (cursor-pull CTA), `MonolithScene` (staggered reveal), `matchMedia` jsdom stub. Then two user-feedback passes: **dropped the top nav** (brand + auth buttons), **white-pill primary CTA** (was indigo), subtitle → "The only work surface you need.", tighter spacing; and a **background redesign** — showed 4 mockups, user picked **topography**, so `TopographyCanvas` (marching-squares contour field raising a hill toward the cursor, behind a central aura glow) **replaced the monolith slab + parallax**. Reduced-motion → static field; SSR/jsdom-safe. Gate green (typecheck/lint/**446 tests**/build); e2e home spec updated. **User-verified via screenshots.** See [[2026-06-18-1549-landing-rework-topography]].
- **Prior (2026-06-18):** **Light-mode reskin — RS workstream complete** (`3ad2326..1a62fa4`, pushed; interleaved with a parallel session's landing commits). Light mode is now a polished, AA-checked counterpart to dark. New `pillTextColor` (WCAG-luminance pick of near-black/white pill text for any color — fixes light, hardens dark) wired into all 4 pill sites (dropping hardcoded `text-white`); `globals.css` light-token polish (off-white `:root` page so white surfaces lift, theme-scoped soft shadows via `--shadow-*`→`var(--elevation-*)`, `html:not(.dark)` scrollbar, darker light chart ramp); dark tokens untouched. Subagent-driven (helper/CSS in parallel → wiring → review SHIP). Full **Playwright light-mode sweep across 20 surfaces** — screenshots inspected directly, all pass. The sweep also surfaced a **pre-existing, theme-independent bug**: the Activity Log rendered cell changes as `[object Object]` because the cell-activity trigger logs the full wrapped `cell_values.value` JSON but `describeCell` indexed it as the bare inner value (broken for every kind except date) — root-caused + fixed via TDD (real-shape regression tests; the old test masked it with bare-value fixtures), `1a62fa4`. Gate green (typecheck/lint/**446 tests**/build). See [[2026-06-18-1541-light-mode-reskin]].
- **Prior (2026-06-18):** **⌘K command-palette polish — closes Phase 8** (`a2d0670..45d498c`, pushed). Palette now navigates to any board/dashboard (client-side fuzzy filter, 0 fetch) and creates (New board → template picker; New dashboard), reusing already-loaded data + existing dialogs. `<CommandPalette>` moved from root `Providers` into `AppShell` (props, authed-only mount); create commands flip ephemeral `useUIStore` flags read by the now-controllable `NewBoardDialog`/DashboardsNav dialogs. Subagent-driven; final review caught a collapsed-sidebar bug (create-dialogs only mounted while expanded → palette create no-opped + flag stuck) which was fixed with regression tests. Gate green (typecheck/lint/**434 tests**/build); e2e 1/1. Global content search deferred (needs indexed search RPC). **User-verified in the live app 2026-06-18.** See [[2026-06-18-1323-phase8-cmdk-polish]].
- **Prior (2026-06-18):** **Board templates (Phase 8)** (`d678094..f99ccb6`, pushed) — built-in catalog of 4 templates (Blank/Sprint/Content/CRM, donor-ported → Pulse's 6 column kinds) seeding columns+groups+example items. Single-source-of-truth TS catalog → `createBoardFromTemplate` action + pure `buildTemplatePayload` (mints uuids, resolves date offsets) → atomic `create_board_from_template` RPC (security definer, membership-checked, applied to cloud) → sidebar picker. Subagent-driven; caught + fixed a `"use server"` sync-export runtime bug that 500'd board pages ([[2026-06-18-1128-gotcha-16-use-server-sync-export]]). Also bundled a parallel session's completed inline group/board-header rename + a command-palette `<Command>` wrapper fix found uncommitted in the shared checkout, and allowlisted test/build/git commands so background subagents can run them. Gate green (typecheck/lint/**424 tests**/build); live RLS 2/2; e2e 1/1; final review **Ship with nits** (both fixed). **User-verified in the live app 2026-06-18.** See [[2026-06-18-1128-phase8-board-templates]].
- **Prior (2026-06-18):** **Dashboards D3b — List multi-condition filter** (`493e77d..40684d4`, 13 commits, pushed) — **closes the dashboards widget subsystem**. Flat AND/OR filter on the List widget. New bounded **`dashboard_list_rows` RPC** (`SECURITY DEFINER`, membership-checked → 42501; per-condition `EXISTS(cell_values)` joined by combinator; **LIMIT applied after filtering**; injection-safe `format(%L)` + numeric/date regex guards) + `getWidgetRows` delegates to it (cells query unchanged) + filter Zod schema + `filter-meta` operators-per-kind + `FilterBuilder` UI + add-widget wiring (columns carry `options`) + **per-widget List config editor**. Built subagent-driven (9 tasks, fresh implementer + two-stage review each, one-file-per-agent per gotcha-15; review caught a real stale-config-on-reopen bug). Gate green (typecheck/lint/**404 tests**/build); **e2e 4/4**; both new functions pin `search_path` (advisor parity, `get_advisors` MCP tool not exposed). Final holistic review verdict **Ship**. Deferred (lean tier): dropdown/people value-matching, nested groups, relative dates, `between`. See [[2026-06-18-0818-dashboards-d3b-list-filter]].
- **Prior (2026-06-17):** **Dashboards D2 — Chart + Battery** (`818e4f1..376402e`, 8 commits, pushed). **Chart** (bar/pie, recharts v3.8.1) + **Battery** (status-distribution bar) grouping by a **Status** column. No DB/RPC change — reused D1's `dashboard_aggregate`. `shapeBuckets`/`bucketsTotal` + `getWidgetData` `columnMeta` (server-side label/color) + generalized add-widget dialog. 366 tests + live integration 5/5 (grouped-by-status) + e2e 2/2; review SHIP-WITH-NITS (board-switch reset fixed). See [[2026-06-17-2119-dashboards-d2-chart-battery]].
- **Earlier (2026-06-17):** **Dashboards D1 — foundation + canvas + Number widget** (`708a7dc..7aa1fed`, 16 commits, pushed). `dashboards`+`dashboard_widgets` (org-RLS) + `dashboard_aggregate` RPC spine + `react-grid-layout` v2 canvas (0-refetch-on-drag) + Number widget + sidebar section. Gate green; live RLS/aggregate 4/4; e2e green; review SHIP-WITH-NITS. rgl v2 API gotcha → [[2026-06-17-2048-gotcha-14-react-grid-layout-v2-api]]. See [[2026-06-17-2048-dashboards-d1-foundation]].
- **Earlier (2026-06-17):** **develop → main promotion.** Squash-merged the standing promotion PR #16 — `main` advanced past Phase 2b to carry Phases 0–4 + dark reskin + landing + sidebar. No code changes. Repo forces squash (merge-commits disabled, rebase fails on `develop`'s merge-commit history), so `main` now diverges permanently from `develop` in history — future promotions still diff correctly (tree-based). No Vercel project yet → integration only, not a live deploy. See [[2026-06-17-1947-develop-main-promotion]].
- _(Earlier 2026-06-17 work — Phase 2c column management, collapsible sidebar, MONOLITH landing page — see the Recent sessions table below.)_
- **🧑 Manual gates (Danijel):** Supabase keys done. Project is cloud-native with no local stack — with explicit per-session authorization, agents apply migrations via `supabase db push --linked` (done this session for the three 4a migrations). The **Supabase MCP** was OAuth-authorized this session (read-write scope; used read-only for advisor lints — schema still goes through versioned migration files, never `apply_migration`). Regenerate types after schema changes (note: `pnpm db:types` can leak a PostHog telemetry line — filter `'"_tag"'` before prettier). **Drift watch RESOLVED:** the migration ledger was fully in sync (local == remote) before 4a's pushes — 3b's `timeline_dependencies` out-of-band apply is confirmed complete.

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
