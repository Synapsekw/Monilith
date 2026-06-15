---
type: spec
status: approved
date: 2026-06-14
tags: [project/pulse, spec]
related: ["[[00-north-star]]"]
---

# Pulse — Master Design Spec

> Status: Approved (source brief by Danijel, 2026-06-14). This document is the master
> spec; per-phase implementation plans are derived from §7 and live alongside this file.

## 1. Product vision

Build **Pulse** — a cloud-native "Work OS" in the spirit of Monday.com, folding in the
best ideas from ClickUp and Asana into one coherent product. Not a clone: the _ultimate_
version. Monday's visual, color-coded board experience as the foundation; ClickUp's depth
(nested hierarchy, docs, native time tracking); Asana's polish (goals/OKRs tied to work,
workload/capacity, portfolios).

**Design language:** modern monochromatic (neutral grayscale surfaces) with a single
configurable highlight/accent color, full dark and light themes, generous whitespace, crisp
typography, subtle motion. Linear-grade restraint applied to a colorful category.

## 2. Tech stack (decided)

- **Framework:** Next.js (App Router, RSC, Server Actions), TypeScript (strict).
  - NOTE: brief specified Next 15; `create-next-app@latest` shipped **Next 16.2.9** (React
    19.2, Tailwind v4). Approved by Danijel 2026-06-14 to stay on 16 — superset of 15's
    capabilities, current stable.
- **Styling/UI:** Tailwind CSS (v4) + shadcn/ui (Radix primitives). Lucide icons. Framer
  Motion for animation.
- **Backend/data:** Supabase (Postgres, Auth, RLS, Realtime, Storage, Edge Functions).
- **Data layer:** @supabase/ssr for auth-aware clients; TanStack Query for client cache;
  Zod for validation; react-hook-form for forms.
- **Drag & drop:** dnd-kit. **State:** Zustand (ephemeral UI only; server state in
  Supabase/TanStack Query). **Tables/virtualization:** TanStack Table + TanStack Virtual.
- **Tooling:** pnpm, ESLint + Prettier, Vitest + RTL, Playwright (e2e), Husky pre-commit.
- **Deploy:** Vercel (frontend) + Supabase Cloud. Cloud-ready from day one.

## 3. Environment & MCP

- Project scaffolded into repo root (`Monolith/`), package name `pulse`.
- Supabase MCP: hosted server via OAuth, `.mcp.json` at repo root, scoped to project,
  `read_only=true` by default. Flip read-only off (or use `supabase db push`) for migrations.
- 🧑 MANUAL (Danijel): create Supabase project; paste URL/anon key/project ref into
  `.env.local`; run `claude /mcp` → authenticate via browser OAuth; approve MCP tool calls
  and any writing migration; toggle read-only when migrations are ready.
- After each migration: `generate_typescript_types` → `src/types/database.types.ts`; run
  `get_advisors` for missing RLS/policies/indexes.
- Local dev: Supabase CLI, versioned migrations in `supabase/migrations`, `supabase db push`.

## 4. Feature set

### 4.1 Foundation (Monday core)

- Hierarchy: Workspaces → Folders → Boards → Groups → Items → Subitems (multi-level depth).
- Rich column-type system: Text, Long text, Status, Dropdown (multi), People/Owner, Date,
  Timeline, Numbers, Rating, Checkbox, Priority, Tags, Progress, Files, Link, Email, Phone,
  Formula, Connect-boards (relations), Mirror, Last-updated, Created-by, Vote, Country/Location,
  Time-tracking.
- Views (per board): Table/Main, Kanban, Timeline/Gantt (dependencies), Calendar, Cards,
  Chart/Dashboard, Workload, Map, Form (intake → items).
- Dashboards: cross-board widgets (numbers, charts, battery, timeline, workload).
- Collaboration: item detail panel, Updates/activity feed, @mentions, threaded comments,
  attachments, reactions, activity log; realtime presence + live updates via Supabase Realtime.
- Automations: no-code When/If/Then rules — Postgres triggers + Edge Functions/worker.
- Notifications: in-app inbox + email digests; granular subscription, mute/snooze, batching.

### 4.2 ClickUp depth

- Docs/Wiki (rich text, slash commands, embeds, reference items); native time tracking
  (timer, manual entries, timesheets, billable); custom statuses/fields; saved filters/view
  configs; multiple assignees; checklists; relationships/dependencies with blocking logic;
  Everything/zoom-out roll-up view.

### 4.3 Asana polish

- Goals/OKRs (company→team→individual) with contributing work auto-rolling up; Portfolios
  (exec grid: status/owner/timeline/priority/health/budget); Workload/capacity with
  over-allocation flags; clean, reliable Rules UX over the deeper engine.

### 4.4 Cross-cutting

- Performance: virtualize tables, paginate, index, stream — smooth 10k-item boards.
- Multi-tenant (org-scoped RLS) from day one, no artificial seat minimums in the model.
- Command palette (⌘K). AI assist _seams_ only (no build yet). Templates. Mobile-responsive
  PWA-ready layout.

## 5. Data model & Supabase conventions

Normalized, multi-tenant; `org_id` on every tenant-scoped table. Core tables (non-exhaustive):
organizations, org_members (owner/admin/member/guest), workspaces, folders, boards, groups,
items (self-referencing `parent_id` for subitems), columns (type + settings jsonb),
cell_values (item_id × column_id × value jsonb, EAV), views (config jsonb), automations,
comments/updates, activity_log, time_entries, docs, goals, goal_links, notifications,
board_connections.

Rules: RLS on every table, default deny; policies key off `org_members` for `auth.uid()`;
no cross-org access. All schema via versioned migrations (never dashboard click-ops). After
each migration regenerate types + run advisors. jsonb for flexible settings/values; index hot
paths (board_id, group_id, item_id, org_id); consider generated/typed columns for sortable
types. Realtime on items, cell_values, comments, notifications.

## 6. Design system

Semantic CSS variables in `globals.css` for both themes: `--background`, `--surface`,
`--surface-muted`, `--border`, `--foreground`, `--muted-foreground`, and a single
user-configurable `--accent` (+`--accent-foreground`). Everything chromatic derives from
neutrals + accent. Status/label colors are the one controlled multi-color palette; chrome
stays strictly monochrome. next-themes, class-based dark mode, no flash, respect system pref +
manual toggle. One clean sans (Geist/Inter), 4px grid, rounded-md, subtle shadows in light /
hairline borders in dark. Framer Motion 150–250ms, respect prefers-reduced-motion. App-level
primitives: BoardTable, StatusCell, PersonCell, ItemPanel, ViewSwitcher, CommandPalette.
Accessibility: WCAG AA contrast, keyboard nav, focus rings, SR labels.

## 7. Phased build plan (commit + checkpoint after each)

0. **Setup** — scaffold, deps, theming tokens, Supabase project + MCP wired (🧑 gates).
   Deliver themed empty app shell with dark/light toggle + ⌘K stub.
1. **Auth & tenancy** — Supabase Auth, org creation + membership, protected routes, RLS baseline.
2. **Boards core** — workspaces→boards→groups→items, Table view (Text/Status/People/Date/
   Numbers/Dropdown), inline editing, optimistic updates, realtime.
3. **Views** — Kanban + Calendar + Timeline/Gantt with dependencies; switcher + saved config.
4. **Collaboration** — item detail panel, updates/comments/@mentions, attachments, activity
   log, notifications inbox.
5. **Automations + Rules** — trigger/condition/action builder, Postgres triggers + Edge
   Functions, common recipes.
6. **ClickUp depth** — subitems/nesting, time tracking, Docs, custom statuses/fields,
   relations + mirror columns.
7. **Asana polish** — Goals/OKRs, Portfolios, Workload/capacity.
8. **Dashboards + templates + command palette polish.**
9. **Hardening** — performance (virtualization, indexes), advisors clean, tests, a11y audit,
   Vercel deploy.

After each phase: run tests, run advisors, regenerate types, write a CHANGELOG entry, pause
for review.

## 8. Engineering guardrails

TS strict, no unjustified `any`, Zod at boundaries. Server Components by default; Client only
when interactive; Server Actions for mutations with RLS as the real security boundary (never
trust client). Secrets server-side; `SUPABASE_SERVICE_ROLE_KEY` never reaches the browser.
Every feature ships with at least basic tests; no phase complete with failing tests or advisor
warnings. Small conventional-commit commits. Stop at 🧑 MANUAL steps.

## 9. Manual responsibilities (Danijel)

Supabase + Vercel project creation; pasting URL/keys into `.env.local` + Vercel env; running
`claude /mcp` OAuth; approving MCP tool calls + writing migrations; toggling MCP read_only;
OAuth app registrations for third-party integrations later.
