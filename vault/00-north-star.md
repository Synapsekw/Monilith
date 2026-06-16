---
type: north-star
status: active
last-updated: 2026-06-16
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
- **2 — Boards core** — <span style="color:#22c55e">**[Done]**</span>
  Workspaces→boards→groups→items, Table view (Text/Status/People/Date/Numbers/Dropdown), inline editing, optimistic updates, realtime.
  _Done 2026-06-15. **2a** (PR #9 `abb8e4e`): schema+RLS+RPCs, queries/actions, live sidebar + `/boards/[boardId]`, read-only virtualized Table. **2b** (PR #12 `3620c69`): inline editors for all 6 kinds, optimistic TanStack-Query board cache, Supabase realtime reconciliation, migration squash + default Status seed. 110 tests + live RLS + e2e green. See [[2026-06-15-1053-phase2a-boards-core]], [[2026-06-15-1259-phase2b-boards-interactive]]._
- **3 — Views** — <span style="color:#22c55e">**[Done]**</span>
  Kanban + Calendar + Timeline/Gantt with dependencies; view switcher + saved config.
  _**3a**: `board_views` + RLS + RPCs, view switcher (client-side `?view=` switching, no RSC refetch),
  Kanban. **3b** (2026-06-16): Calendar (`CalendarBoard` + `dates.ts`/`calendar.ts`) and Timeline/Gantt
  (`GanttBoard` + `gantt.ts`) with the `item_dependencies` model (cycle-safe RPC + RLS, 23 integration
  tests). Per-kind view config; ViewSwitcher add-view menu. See [[2026-06-16-2009-dark-reskin-calendar-timeline]]._
- **4 — Collaboration** — **[Not started]**
  Item detail panel, updates/comments/@mentions, attachments, activity log, notifications inbox.
- **5 — Automations + Rules** — **[Not started]**
  Trigger/condition/action builder; Postgres triggers + Edge Functions; common recipes.
- **6 — ClickUp depth** — **[Not started]**
  Subitems/nesting, time tracking, Docs, custom statuses/fields, relations + mirror columns.
- **7 — Asana polish** — **[Not started]**
  Goals/OKRs, Portfolios, Workload/capacity.
- **8 — Dashboards + templates + ⌘K polish** — **[Not started]**
- **9 — Hardening** — **[Not started]**
  Performance (virtualization, indexes), advisors clean, tests, a11y audit, Vercel deploy.

**RS — Design refresh (dark-first reskin)** — <span style="color:#22c55e">**[Shipped — dark; light pending]**</span>
Dark-first near-black palette translated into `.dark` `@theme`/OKLch tokens (+ elevation, scrollbar,
animations), dark set as default, and "direction C" density applied to the board surfaces (table, pills,
kanban, chrome). User-verified. **Light-mode pass still pending.** Target + reuse map:
[[2026-06-16-decision-08-dark-first-monday-reskin]].

**Where we are:** Phases 0–3 done on `develop` (3b Calendar + Timeline/Gantt + dependencies shipped + user-verified). Dark reskin shipped. Remaining near-term: Dashboard view (needs `dashboard` view_kind migration + `recharts`), ItemPanel (needs updates/comments schema), light-mode reskin.

## 3. Now

- **Phase:** 3 done (incl. 3b) + dark reskin shipped → pick next from {light-mode, Dashboard, ItemPanel}
- **Branch:** `develop` (pushed through `a74b71a`)
- **Latest (2026-06-16):** Dark-first reskin + Calendar + Timeline/Gantt all shipped on `develop` and user-verified. Reskin: prototype near-black palette → `.dark` `@theme`/OKLch tokens, dark default, direction-C density on board surfaces. Calendar: `CalendarBoard` + `dates.ts`/`calendar.ts` (month grid, drag-reschedule, add-on-day). Timeline: `GanttBoard` + `gantt.ts` + `item_dependencies` (cycle-safe RPC + RLS, 23 integration tests); milestone markers fixed. Two enum migrations applied by Danijel (MCP read-only). Built brainstorm→spec→plan→subagent-driven. typecheck/lint/build + tests green. New gotcha: [[2026-06-16-gotcha-10-stage-untracked-subagent-files]] (committed a component without its untracked import → caught + fixed in `a74b71a`). See [[2026-06-16-2009-dark-reskin-calendar-timeline]]. **Next:** light-mode reskin (no prereq), or Dashboard (`dashboard` view_kind migration + `recharts`), or ItemPanel (updates/comments schema).
- **🧑 Manual gates (Danijel):** Supabase keys done. **MCP is read-only** — schema migrations are applied by Danijel (`supabase db push --linked` or the SQL editor); agents prep the migration file + regenerate types after (note: `pnpm db:types` can leak a PostHog telemetry line into the file — filter `'"_tag"'` before prettier). Untracked `docs/superpowers/plans/2026-06-16-board-view-perf-amplifiers.md` left as-is for the owner.

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
