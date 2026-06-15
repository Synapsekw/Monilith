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
(neutral grayscale) with a single configurable accent, full dark/light themes, Linear-grade restraint
applied to a colorful category. Built on **Next.js 16 + React 19 + Tailwind v4 + Supabase**,
multi-tenant (org-scoped RLS) from day one.

Master spec: [[2026-06-14-pulse-design]] (`docs/superpowers/specs/2026-06-14-pulse-design.md`).

## 2. Product north star — phased build (0 → 9)

From the master spec §7. Each phase: status + one-line outcome. **Commit + checkpoint after each;
run tests + advisors + regenerate types before moving on.**

- **0 — Setup** — <span style="color:#22c55e">**[Done]**</span>
  Scaffold, deps, theming tokens, Supabase + MCP wired. Themed empty app shell, dark/light toggle, ⌘K stub.
  _Done 2026-06-14 (commits `25c3e04` → `fea23fa`). See [[2026-06-14-phase0-setup]]._
- **1 — Auth & tenancy** — <span style="color:#22c55e">**[Done]**</span>
  Email/password auth, org creation + membership, protected routes, RLS baseline.
  _Done 2026-06-15 (commits `d9fc02c` → `31336e5`). RLS isolation proven by integration test; 32 unit tests + e2e green. See [[2026-06-15-phase1-auth-tenancy]]._
- **2 — Boards core** — **[Not started]**
  Workspaces→boards→groups→items, Table view (Text/Status/People/Date/Numbers/Dropdown), inline editing, optimistic updates, realtime.
- **3 — Views** — **[Not started]**
  Kanban + Calendar + Timeline/Gantt with dependencies; view switcher + saved config.
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

**Where we are:** Phases 0 and 1 done. Phase 2 (boards core) is next, on `main`.

## 3. Now

- **Phase:** 1 done → starting 2 — Boards core
- **Branch:** `main`
- **Latest:** Phase 1 complete (`d9fc02c` → `31336e5`): RLS-backed multi-tenant schema, `@supabase/ssr` clients + `src/proxy.ts` session refresh, email/password auth, onboarding (org + workspace) + authed shell, and tests (32 unit + RLS isolation integration + e2e). Since then, the dev-memory `vault/` is git-tracked (`7a1771d`, `6e9fc1f`) and `/wrapup` is installed — see [[2026-06-15-0742-dev-memory-vault-and-wrapup]]. **Next:** Phase 2 — boards/groups/items hierarchy + EAV cell-values, Table view with core column types, inline editing + optimistic updates, Realtime.
- **🧑 Manual gates (Danijel):** Supabase project + keys done. MCP authed (read-only); migrations applied via `supabase db push` (CLI linked). For the official `get_advisors`, add `debugging` to `.mcp.json` features + re-auth (optional).

### Last session

```dataviewjs
const latest = dv.pages('"vault/sessions"')
  .where(p => p.type === "session" && p.status === "complete")
  .sort(p => p.file.name, "desc")[0];

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
