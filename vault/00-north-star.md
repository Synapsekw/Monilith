---
type: north-star
status: active
last-updated: 2026-06-15
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
- **3 — Views** — <span style="color:#eab308">**[In progress]**</span>
  Kanban + Calendar + Timeline/Gantt with dependencies; view switcher + saved config.
  _**3a** (PR #15, open): `board_views` + RLS + create/delete RPCs, view switcher (`?view=` routing,
  Table fallback), Kanban (group-by-Status, dnd drag-to-restatus, per-column add, grouping picker) on
  the 2b cache/realtime layer. 155 tests + e2e green. See [[2026-06-15-1946-phase3a-views-kanban]].
  **3b** next: Calendar + Timeline/Gantt + dependencies._
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

**RS — Design refresh (dark-first reskin)** — <span style="color:#eab308">**[Queued — next]**</span>
Cross-cutting workstream (not a renumber of 0–9): align shipped surfaces (app shell, sidebar, board
Table/Kanban, cells + editors) to the dark-first near-black look, translating the in-repo prototype's
palette/density/animations into `@theme`/OKLch tokens; reuse the prototype's portable code (exporters,
templates, filter/formula logic) and port its views (Calendar/Timeline/Dashboard, item panel, filter
builder, label editor) onto Pulse's Supabase + Server-Actions + cache/realtime spine. Sequenced first
among near-term work. Target + reuse map: [[2026-06-16-decision-08-dark-first-monday-reskin]].

**Where we are:** Phases 0, 1, 2 done; Phase 3a (Views infra + Kanban) integrated on `develop`. **Dark-first reskin (RS) queued as the immediate near-term pass.** Phase 3b (Calendar + Timeline/Gantt + dependencies) follows, landing on the reskinned surface.

## 3. Now

- **Phase:** 3 in progress — 3a built (PR open) → 3b next
- **Branch:** `feat/phase-3a-views-kanban` (PR #15 → `main`)
- **Latest:** **Phase 3a built — PR #15 open** (16 commits, off `main`). `board_views` table + org-scoped RLS + `create_board_view`/`delete_board_view` RPCs (last-view delete blocked transactionally via `FOR UPDATE`); `create_board` seeds a default Table view, existing boards backfilled. View switcher (`ViewSwitcher` + shared `BoardHeader`) with `?view=<id>` routing + Table fallback (`resolveSelectedView`). Kanban view (`KanbanBoard` + pure `buildKanbanColumns`/`onCardDropped`): group-by-Status, "No status" bucket, dnd-kit drag-to-restatus through the existing `setCell` mutation, per-column add that sets the column's status, grouping-column picker. Built subagent-driven (10 tasks + final review + 2 fixes). typecheck/lint/build + **155** tests + Kanban e2e green. New gotchas: [[2026-06-15-gotcha-06-commitlint-subject-case]], [[2026-06-15-gotcha-07-shared-worktree-subagents]]. See [[2026-06-15-1946-phase3a-views-kanban]]. **Next:** merge PR #15 (rebase if `fix/status-cell-popover` lands first), then Phase 3b — Calendar + Timeline/Gantt + dependencies, reusing the switcher + cache/realtime layer.
- **🧑 Manual gates (Danijel):** Supabase project + keys done. MCP authed (read-only); migrations applied via `supabase db push` (CLI linked). For the official `get_advisors`, add `debugging` to `.mcp.json` features + re-auth (optional). **PR #15 awaits review/CI + merge.** Note: `fix/status-cell-popover` PR is also in flight; its uncommitted files sit untouched in this branch's working tree — rebase 3a onto `main` after it merges.

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
