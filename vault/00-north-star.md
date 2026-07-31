---
type: north-star
status: active
last-updated: 2026-07-31-1708
tags: [project/monolith, north-star]
related:
  - "[[README]]"
  - "[[product]]"
---

# Monolith — North Star

> Single canonical entry point. Where are we, where are we going, why. Open this first.
> **When state changes, update the relevant section and bump `last-updated` in the frontmatter.**
> Keep this concise — phase detail lives in [[platform-roadmap]], history in `vault/sessions/`.

## 1. Pitch

**Monolith** is a cloud-native **"Work OS"** in the spirit of Monday.com — folding in the best of
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
- **10 — AI & Agents** — <span style="color:#eab308">**[In progress — E1 + Batch 2 (E2/E3/E4) + E5 in prod (E5 inert until prod Vault is provisioned); E6 open]**</span> — Reusable AI platform layer + feature wave, sold two ways (managed **or** BYO). **E1 complete (2026-07-11, reconciled hybrid model):** `ai_mode = off|managed|org_byo|per_user` (default `per_user` — the shipped per-user store kept as an explicit mode), one gateway (`resolveAiAdapter`/`runAi`) metering every call into `ai_usage`, entitlements w/ managed credit ceiling, org Settings AI card + platform-admin plan lever, dashboard-gen migrated onto the gateway, and **Ask Monolith** (workspace NL Q&A via RLS-scoped read tools, Anthropic-gated, 6-round tool loop, ⌘K + header entry). Client write path to `org_ai_settings` removed (entitlements are platform-controlled). Reconciliation spec `docs/superpowers/specs/2026-07-11-ai-e1-scope-reconciliation-design.md`. **E5 agentic automations + semantic search — done on `develop`, not yet promoted (built ~2026-07-21):** F13 AI action step in automations (decide loop + confined apply + dry-run), F14 Autopilot scheduled board agent (bot identity + bounded housekeeping), F15 pgvector semantic search (`match_items` RPC + find-similar). Guardrails: [[2026-07-20-decision-29-agentic-automation-guardrails]]. Build session: [[2026-07-21-1123-e5-agentic-semantic-full-build]] — written on a different local checkout and only landed in this vault on 2026-07-25, which is why earlier revisions of this doc recorded it as missing. _Embeddings still need a backfill (`POST /api/ai/embed?mode=backfill`) before semantic surfaces return results in prod._ **Open epics: E6 Stripe only** — E2/E3/E4 shipped to prod via #62 (an earlier revision of this bullet contradicted its own status badge by listing them as open). **Ask Monolith Phase 2 shipped 2026-07-27** — `/ask` now proposes writes and executes them behind a confirm card: the turn ends at the card, the proposal persists in `ai_messages.tool_trace` (no migration), and Approve/Cancel append an outcome turn because `ai_messages` has no UPDATE policy ([[2026-07-27-0659-batch-a-builds-conformance-probes]]). **E6 is now the only open AI epic.** **MCP server (agent connectivity) shipped 2026-07-24:** hosted remote MCP server (`/api/mcp`) + from-scratch OAuth 2.1 authorization server so Claude Desktop/claude.ai can connect as a real Monolith user and read/write board items through a genuinely RLS-scoped session (no service-role bypass) — 6 tools (list/get boards+items, create/update item, no delete), Settings → Connected Apps. Built subagent-driven, 14-task plan; final whole-branch review caught and fixed a real concurrency bug in the session-bridge before merge ([[2026-07-24-gotcha-56-per-request-session-refresh-race]]). Spec/plan: `docs/superpowers/specs/2026-07-24-mcp-server-design.md`, `docs/superpowers/plans/2026-07-24-mcp-server.md`. ([[2026-07-24-1950-mcp-server-oauth]]) **In-app setup guide shipped 2026-07-25** as part of the settings redesign — server URL, per-client steps, tool/permission table, revoke ([[2026-07-25-1056-settings-redesign-mcp-guide]]). **Ask Monolith full-page (shipped to prod 2026-07-17 as "Ask AI"):** owner-approved expansion promoting the Ask Monolith popup to a standalone `/ask` chat page — persisted per-user cross-board history, multi-turn (rolling summary), token streaming (Phase 1 = E1 F5 expansion), then confirm-before-execute write actions (Phase 2 = E3 F6 pulled forward). Deliberately reverses the "AI at the seams, no standalone chat" stance ([[2026-07-12-decision-27-ask-becomes-standalone-surface]]). Spec `docs/superpowers/specs/2026-07-12-ask-pulse-full-page-conversational-design.md`, Phase-1 plan `docs/superpowers/plans/2026-07-12-ask-pulse-full-page-conversational.md`. ([[2026-07-11-2116-ai-e1-hybrid-gateway-ask-pulse]], [[2026-07-05-decision-26-ai-platform-dual-billing]])
- **TOUCH — iPad optimization** — <span style="color:#22c55e">**[Done — Batch 1 + Batch 2 8/8 surfaces]**</span> — iPad-first, full authoring parity, touch-ergonomics (no layout reflow). Batch 1 shared primitives (`useCoarsePointer`, touch dnd sensors, `<DragHandle>`, `<RevealOnHover>`, 44px targets, touch-aware tooltip) + all 8 Batch 2 surfaces shipped: Table, Item Panel, Nav, Kanban, Gantt, Calendar, Dashboard canvas, Command palette/menus. Spec `docs/superpowers/specs/2026-06-26-ipad-touch-optimization-design.md` + per-surface specs `2026-06-29-touch-batch2-*`. Deferred: phone reflow, PWA/offline, iPad E2E matrix. ([[2026-06-28-1822-ipad-touch-foundation]], [[2026-07-02-1218-quality-triage-promote-43-scoping]])
- **PF — Polish & Fluidity (perf follow-on)** — <span style="color:#22c55e">**[Shipped to prod 2026-07-17 — A4 skipped]**</span> — Second perf pass beyond Phase 9's program, from a 4-dimension scan (rendering/caching · data-fetching · client smoothness · bundle). Baseline confirmed strong; this closes the remaining **targeted gaps** as 4 independent worktree batches: **A — server latency** (parallelize board/dashboard payload head-reads, batch the `/home` dispatch + last-board cookie fast path, `/my-work` + `/boards` route skeletons, collapse the My Work 4-phase chain into one SECURITY-INVOKER RPC); **B — board interaction** (debounce+`useDeferredValue` quick-search, hoist dependents-map + memoize row/cell components, virtualize Gantt rows, clamp Calendar agenda); **C — bundle** (lazy `@dnd-kit` out of the shell, lazy `DashboardCanvas`/react-grid-layout, working Turbopack bundle-analyze, bound sidebar lists, landing rAF resize); **D — polish** (kill per-field `router.refresh()` in Goal drawer + TimeCard, stream timezone so content never blanks, transformed thumbnails, truthful `unstable_instant` comment per [[2026-07-04-gotcha-48-unstable-instant-blocked-by-shell-searchparams]]). Plan: `docs/superpowers/plans/2026-07-09-perf-polish-fluidity.md` (20 TDD tasks, execution DAG, per-batch manual test guide). Disjoint from Phase 10 (AI) — can run in parallel.

## 3. Now

- **Phase:** **The gates had gone amber long enough that nobody read them — now all four are green and mean something** ([[2026-07-31-1708-quality-sweep-crlf-dead-code]]). `format:check` reported **1775 files** and lint carried **31 warnings**; both were noise, and noise is where the real problems were hiding. Underneath: **42 genuinely unformatted files**, an unused import, a dead `let`, and **five reachable-but-uncalled server actions**. `typecheck` / `lint` / `test` / `format:check` are now clean (510 files, 3669 tests), with exactly one warning left standing on purpose.
- **The CRLF write-off cost more than the noise.** `core.autocrlf=true` with no `.gitattributes` expanded the tree to CRLF on disk — but git had **always stored LF**, so pinning `eol=lf` was a **zero-content diff**, not the feared 1775-file rewrite. That single fact had gone unchecked for months while the symptoms were dismissed as "just Windows". Worse, the `$`-anchored conformance parsers only *threw* by luck: the sibling probes would have **degraded silently**, and a security probe that matches nothing still reports green ([[2026-07-31-gotcha-65-crlf-working-tree-masks-real-lint-and-breaks-anchored-parsers]]).
- **Dead code in a `"use server"` module is reachable surface, not clutter.** `renamePortfolio`, `deletePortfolio`, `updatePortfolioMapping`, `reorderGoal` and `askPulse` had **zero call sites** yet each compiled to a live POST endpoint with a stable action ID — least-reviewed code, invisible regressions, drifting away from the guards its live siblings gain. The detection trap: **their tests kept them looking alive** (`askPulse` had 328 lines of passing tests). The real signal is _imported by something that is not its own test_ ([[2026-07-31-gotcha-66-an-uncalled-use-server-export-is-still-a-live-endpoint]]). ~620 lines and five endpoints removed, plus Ask's whole superseded non-streaming path.
- **Both halves of the security boundary are now gated.** `pnpm test:conformance` (anon) was re-run against **production**: 129 function signatures + 53 tables, **0 reachable, 0 readable**, both allow-lists empty — verified on the publishable key _and_ the still-enabled legacy anon JWT. `pnpm test:fixtures` (Tier 2, DEV-only, non-privileged, read-only) covers the `authenticated` half via two permanent seeded tenants ([[2026-07-27-decision-31-tier2-permanent-tenant-fixtures]]). The load-bearing detail: `selectPurgeableUserIds` exempts the fixtures — without it the age-based purge would delete them and the suite would pass **vacuously**.
- **Branch:** `main` @ `1121796` == production. `develop` @ `ffee1820` == `origin/develop` — 20 commits ahead of `main`: the 7 changelog trailers plus this sweep. **No user-facing behaviour changed** in either, so promotion stays documentation-only apart from the ordering constraint below. Ledger **118 files = 118 DEV rows = 118 PROD rows** (unverified this session — `pnpm db:ledger-check` needs `psql` on PATH, absent on this machine, so `finish-task.sh`'s ledger gate was **skipped**). All `task/*` worktrees merged + cleaned.
- **In flight:** none.
- **Next:** **promote `develop → main` to publish the 19 entries — but drain the embedding queue first** (see Owed; two of the entries announce semantic search, which currently returns nothing on prod). Then **Report Builder v2 roll-ups + org templates** as the critical path — one migration dropping `reports.board_id NOT NULL`, after which the single-board assumption must be unwound across access checks, payload fetch, shaping, routing and ~1.4k lines of tests. **E6** Stripe remains blocked on your creds.
- **Owed — three items, all needing _you_ rather than an agent.** **E5 semantic search is still inert** (`item_embeddings` = 0 vs 439 live prod items) — and this is now a **promotion blocker, not just a nice-to-have**: the backfilled changelog announces "Find similar items" and "Ask AI searches by meaning" the moment `main` advances. `OPENAI_EMBEDDING_API_KEY` **was** provisioned on Vercel 2026-07-25; all that remains is enqueueing existing items into `item_embed_queue`, after which the `embed-sweep` cron drains 50 every 2 min and signs its own call — no secret handling needed. **`supabase-prod` MCP is read-only (`25006`)**, so that enqueue must be pasted into the prod SQL editor. **`digest_secret` is still absent from prod Vault**, but the schema half is live, so provisioning is finally safe: ping `_health_digest_ping()`, confirm a `blocked` row naming the secret appears (the alarm that was missing for three weeks), then add it — noting prod has **no `RESEND_API_KEY`**, so the first runs file in-app notifications and send **no email** regardless. **The Ask Monolith write path is still unexercised on prod.**
- **Left standing on purpose:** the `max-lines` tripwire on `landing-sections.tsx` (837/800) — it exists to keep god-file accretion visible until a split is scheduled, so silencing it would defeat it. Also deliberately untouched: ~242 unused **type** exports (cheap surface), and the `as unknown as Json` casts on `.from().insert()/.update()`, which `typedRpc` structurally cannot wrap — a real ergonomic gap, left open rather than papered over with a new abstraction.
- **Do not run `/sync-prod`'s data phase without excluding the fixtures.** The guard passes — prod holds no independent orgs or users — but a full replace copies DEV-only rows into production, **including the two Tier 2 fixture accounts whose passwords are committed to the repo**. Schema-only pushes (`supabase db push`) are unaffected and remain the right tool.

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
