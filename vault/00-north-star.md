---
type: north-star
status: active
last-updated: 2026-07-25-1056
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
(neutral grayscale) with a single configurable accent, **dark-first** ("Monolith Keystone": layered near-black surfaces +
periwinkle accent; light supported but secondary), Linear-grade restraint applied to a colorful category.
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
- **7 — Asana polish** — <span style="color:#22c55e">**[Done — 7a + 7b + 7c + time-allocation]**</span> (Workload v3 variance/drill-down is optional future depth) — Portfolios, Goals/OKRs, Workload/capacity (v2: workspace/board filtering + planned/actual metric; v3: variance + per-day actuals drill-down). Time allocation: `/time` weekly "My Time" card (manual decimal-hours per task/category/day, save-as-you-go) unified with timers into one actuals ledger; Workload reworked to full-canvas (utilization % + capacity bars). ([[2026-06-23-2059-time-allocation-my-time-card]])
- **8 — Dashboards + templates + ⌘K polish** — <span style="color:#22c55e">**[Done + v2 polish + AI gen]**</span> — Cross-board widgets (Number/Chart/Battery/List + filter), board templates, ⌘K nav + create. v2 polish: 9 chart types (line/area/stacked/grouped/combo/donut/radial) via `dashboard_series` (date-bucket + multi-series; group by date/status/dropdown/people), unified edit drawer w/ live preview, bordered-card reskin. **AI generation:** Opus 4.8 reads a board's schema+stats (no raw cells) and proposes a full dashboard via a Generate-with-AI wizard + Keep/Discard/Regenerate review banner. **Chart engine reskin:** `ChartWidget` moved onto shadcn chart primitives (P1) then an expressive "Direction C" restyle (P2) — spectrum-hero for single metrics, categorical palette for real multi-series, configured colors preserved (data layer stops inventing color), gradients + Signature motion. ([[2026-06-23-1953-dashboards-polish-v2]], [[2026-06-24-0912-ai-dashboard-generation]], [[2026-07-05-2018-shadcn-charts-phase1-2-expressive]])
- **9 — Hardening & Optimization** — <span style="color:#22c55e">**[Done — 9.1–9.6 + audit-fix sweep]**</span> — Perf + perceived-perf program (Track A actual speed, Track B perceived speed). 9.1 auth fast-path + 9.2 streaming shell + 9.3 tagged `use cache` shell reads + **9.3b widget-aggregation cache** + 9.4 route skeletons + 9.5a interaction responsiveness + **9.6 Web-Vitals gate** all shipped. **Audit-fix sweep (2026-07-05):** 4-agent audit → 11 parallel fix branches — intra-org RLS leak on dashboard RPCs closed, SSRF/open-redirect/enumeration/CSV-injection fixed, hot-path `revalidatePath` + presence re-render storm removed, realtime self-heal, silent-failure surfacing, import/timezone correctness. Spec `docs/superpowers/specs/2026-06-22-phase-9-performance-optimization-design.md`. ([[2026-06-28-1743-phase-9-close-parallel-batch]], [[2026-07-05-0811-audit-fix-sweep]])
- **RS — Design refresh (dark-first reskin)** — <span style="color:#22c55e">**[Done — dark + light]**</span> — Dark-first near-black palette as `.dark` OKLch tokens (dark default); light-mode pass shipped. ([[2026-06-16-decision-08-dark-first-monday-reskin]])
- **MVP-F — MVP Final Features (user-feedback backlog)** — <span style="color:#22c55e">**[Done — 9/9 shipped to prod]**</span> — All open in-app feature requests built and promoted same-day (`docs/superpowers/plans/2026-07-03-mvp-final-features.md`, `/goal`). Batch A: Excel export formatting, calendar/timeline quick-edit peek, overdue tint + percent sync, currency + dirham sign, column reorder, completion widget. Batch B: per-group summary rows, priority + auto-critical, health widget + weekly digest. ([[2026-07-03-1154-mvp-final-features-wave]], [[2026-07-03-1512-mvp-final-batch-b-promote]])
- **10 — AI & Agents** — <span style="color:#eab308">**[In progress — E1 + Batch 2 (E2/E3/E4) in prod; E5 done on develop (not yet promoted); E6 open]**</span> — Reusable AI platform layer + feature wave, sold two ways (managed **or** BYO). **E1 complete (2026-07-11, reconciled hybrid model):** `ai_mode = off|managed|org_byo|per_user` (default `per_user` — the shipped per-user store kept as an explicit mode), one gateway (`resolveAiAdapter`/`runAi`) metering every call into `ai_usage`, entitlements w/ managed credit ceiling, org Settings AI card + platform-admin plan lever, dashboard-gen migrated onto the gateway, and **Ask Pulse** (workspace NL Q&A via RLS-scoped read tools, Anthropic-gated, 6-round tool loop, ⌘K + header entry). Client write path to `org_ai_settings` removed (entitlements are platform-controlled). Reconciliation spec `docs/superpowers/specs/2026-07-11-ai-e1-scope-reconciliation-design.md`. **E5 agentic automations + semantic search — done on `develop`, not yet promoted (built ~2026-07-21):** F13 AI action step in automations (decide loop + confined apply + dry-run), F14 Autopilot scheduled board agent (bot identity + bounded housekeeping), F15 pgvector semantic search (`match_items` RPC + find-similar). Guardrails: [[2026-07-20-decision-29-agentic-automation-guardrails]]. Build session: [[2026-07-21-1123-e5-agentic-semantic-full-build]] — written on a different local checkout and only landed in this vault on 2026-07-25, which is why earlier revisions of this doc recorded it as missing. _Embeddings still need a backfill (`POST /api/ai/embed?mode=backfill`) before semantic surfaces return results in prod._ **Open epics:** E2 item assist · E3 ⌘K NL actions · E4 generation · E6 Stripe. **MCP server (agent connectivity) shipped 2026-07-24:** hosted remote MCP server (`/api/mcp`) + from-scratch OAuth 2.1 authorization server so Claude Desktop/claude.ai can connect as a real Pulse user and read/write board items through a genuinely RLS-scoped session (no service-role bypass) — 6 tools (list/get boards+items, create/update item, no delete), Settings → Connected Apps. Built subagent-driven, 14-task plan; final whole-branch review caught and fixed a real concurrency bug in the session-bridge before merge ([[2026-07-24-gotcha-56-per-request-session-refresh-race]]). Spec/plan: `docs/superpowers/specs/2026-07-24-mcp-server-design.md`, `docs/superpowers/plans/2026-07-24-mcp-server.md`. ([[2026-07-24-1950-mcp-server-oauth]]) **In-app setup guide shipped 2026-07-25** as part of the settings redesign — server URL, per-client steps, tool/permission table, revoke ([[2026-07-25-1056-settings-redesign-mcp-guide]]). **Ask Pulse full-page (shipped to prod 2026-07-17 as "Ask AI"):** owner-approved expansion promoting the Ask Pulse popup to a standalone `/ask` chat page — persisted per-user cross-board history, multi-turn (rolling summary), token streaming (Phase 1 = E1 F5 expansion), then confirm-before-execute write actions (Phase 2 = E3 F6 pulled forward). Deliberately reverses the "AI at the seams, no standalone chat" stance ([[2026-07-12-decision-27-ask-becomes-standalone-surface]]). Spec `docs/superpowers/specs/2026-07-12-ask-pulse-full-page-conversational-design.md`, Phase-1 plan `docs/superpowers/plans/2026-07-12-ask-pulse-full-page-conversational.md`. ([[2026-07-11-2116-ai-e1-hybrid-gateway-ask-pulse]], [[2026-07-05-decision-26-ai-platform-dual-billing]])
- **TOUCH — iPad optimization** — <span style="color:#22c55e">**[Done — Batch 1 + Batch 2 8/8 surfaces]**</span> — iPad-first, full authoring parity, touch-ergonomics (no layout reflow). Batch 1 shared primitives (`useCoarsePointer`, touch dnd sensors, `<DragHandle>`, `<RevealOnHover>`, 44px targets, touch-aware tooltip) + all 8 Batch 2 surfaces shipped: Table, Item Panel, Nav, Kanban, Gantt, Calendar, Dashboard canvas, Command palette/menus. Spec `docs/superpowers/specs/2026-06-26-ipad-touch-optimization-design.md` + per-surface specs `2026-06-29-touch-batch2-*`. Deferred: phone reflow, PWA/offline, iPad E2E matrix. ([[2026-06-28-1822-ipad-touch-foundation]], [[2026-07-02-1218-quality-triage-promote-43-scoping]])
- **PF — Polish & Fluidity (perf follow-on)** — <span style="color:#22c55e">**[Shipped to prod 2026-07-17 — A4 skipped]**</span> — Second perf pass beyond Phase 9's program, from a 4-dimension scan (rendering/caching · data-fetching · client smoothness · bundle). Baseline confirmed strong; this closes the remaining **targeted gaps** as 4 independent worktree batches: **A — server latency** (parallelize board/dashboard payload head-reads, batch the `/home` dispatch + last-board cookie fast path, `/my-work` + `/boards` route skeletons, collapse the My Work 4-phase chain into one SECURITY-INVOKER RPC); **B — board interaction** (debounce+`useDeferredValue` quick-search, hoist dependents-map + memoize row/cell components, virtualize Gantt rows, clamp Calendar agenda); **C — bundle** (lazy `@dnd-kit` out of the shell, lazy `DashboardCanvas`/react-grid-layout, working Turbopack bundle-analyze, bound sidebar lists, landing rAF resize); **D — polish** (kill per-field `router.refresh()` in Goal drawer + TimeCard, stream timezone so content never blanks, transformed thumbnails, truthful `unstable_instant` comment per [[2026-07-04-gotcha-48-unstable-instant-blocked-by-shell-searchparams]]). Plan: `docs/superpowers/plans/2026-07-09-perf-polish-fluidity.md` (20 TDD tasks, execution DAG, per-batch manual test guide). Disjoint from Phase 10 (AI) — can run in parallel.

## 3. Now

- **Phase:** **Settings redesigned + the MCP server finally has an in-app front door** ([[2026-07-25-1056-settings-redesign-mcp-guide]]). `/settings` went from a 4-column masonry of 8 unequal cards to a left sub-nav over **nine nested routes** (Account · Organization · Integrations), with `SettingsSection`/`SettingRow` primitives putting every control on one alignment grid. The headline addition is a real **Connect via MCP** page — per-request server URL with copy, per-client setup steps (Claude Desktop / claude.ai / Claude Code / generic), the six tools with Read/Write pills, access-and-safety notes, connected apps, troubleshooting — closing the gap where the MCP server shipped 2026-07-24 was undiscoverable to anyone who hadn't built it. Also fixed a real bug: connected-app **revoke errors were silently swallowed** (inline `form action` discarding the `ActionResult`). Added org rename, leave-organization, appearance, and a security section; merged the two adjacent "AI" cards. Per-route data means `/settings/profile` costs one query instead of ~10, and the members RPC only runs on `/settings/members`. No migrations. **MCP server** ([[2026-07-24-1950-mcp-server-oauth]]) and **E5** still sit on `develop`, ahead of prod.
- **Branch:** `develop` @ `1555dc1` == `origin/develop` (MCP server + E5 agentic/semantic + the ACL migration + the settings redesign ahead of prod — everything else promoted via #69). **`main` @ `8b4d648`**. All `task/*` worktrees merged + cleaned.
- **In flight:** none building.
- **Next:** **promote `develop → main`** (deferred to the owner) — it now carries MCP server + E5 + the ACL migration **+ the settings redesign**; E5 needs its env vars set + an embeddings backfill first (see Owed). A real end-to-end MCP connection test (Claude Desktop/claude.ai against a deployed `develop`) still hasn't been run — do that before calling MCP done-done, and it now also validates the new guide's per-client steps. Or a fresh roadmap build — **Report Builder v2** (charts + wide-board table) or **E6** (Stripe billing; F16 blocked on your creds).
- **Owed:** **MCP server follow-ups:** `/login` doesn't honor `?next=` so the OAuth connect flow can't resume post-login for a not-yet-signed-in user (pre-existing app-wide gap, first flow it actually bites); `/api/oauth/register` has no rate limit. **Delete account** — deferred to its own spec: 28 columns reference `auth.users` without `on delete cascade` (~15 `not null`), so deleting the auth user raises an FK violation even after a sole-owner check; needs a migration to `on delete set null` plus every consumer assuming non-null authorship ([[2026-07-25-1056-settings-redesign-mcp-guide]]). **Carry `20260724134101_mcp_oauth_vault_cleanup_acl` to prod:** that ACL lockdown was applied to DEV but had no committed file until 2026-07-25 — it must ride the next `/sync-prod`, or prod ships the definer trigger function publicly executable ([[2026-07-25-gotcha-57-dev-applied-migration-with-no-committed-file]]). Follow-ups from it: nothing diffs `list_migrations` against `supabase/migrations/` (teach `finish-task.sh` or a `/sync-prod` pre-check), and the other definer functions added 07-20/07-24 want the same ACL audit. **E5 pre-promotion:** set E5 env vars, then backfill embeddings (`POST /api/ai/embed?mode=backfill`) so semantic surfaces actually return results once promoted — full detail in [[2026-07-21-1123-e5-agentic-semantic-full-build]], which landed in this vault on 2026-07-25. **Report Builder v2** = charts + wide-board table continuation. **Wordmark mark** in prod — one-line revert in `brand.tsx` if busy. **Rotate the prod DB password** (still owed from an earlier `/sync-prod`).

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

- **Mission-control board (visual):** https://claude.ai/code/artifact/eb984761-bee4-4d1a-b6ba-30c6bc05119c — derived view of this doc + worktrees + sessions; refreshed by `/board` (see `.claude/commands/board.md`) and at every `/wrapup`
- [[product]] — what we're building and for whom
- [[architecture]] — system + code structure, data model
- [[platform-roadmap]] — phase 0–9 detail
- [[specs]] — design spec index
- [[operations]] — runbooks, Supabase/MCP, deploy
- [[memory]] — what lives where (this vault's self-map)
