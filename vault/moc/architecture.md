---
type: moc
status: active
tags: [moc/architecture]
related: ["[[00-north-star]]"]
---

# Architecture — Map of Content

> System + code structure for Pulse. Authoritative detail lives in the master spec
> (`docs/superpowers/specs/2026-06-14-pulse-design.md`, §2 / §5 / §6); this is the navigation layer.

## Tech stack (spec §2)

- **Framework:** Next.js 16.2.9 (App Router, RSC, Server Actions), React 19.2, TypeScript strict.
- **UI:** Tailwind v4 + shadcn/ui (Radix), Lucide icons, Framer Motion.
- **Backend:** Supabase — Postgres, Auth, RLS, Realtime, Storage, Edge Functions.
- **Data layer:** `@supabase/ssr` (auth-aware clients), TanStack Query (client cache), Zod
  (validation), react-hook-form (forms).
- **Misc:** dnd-kit (drag & drop), Zustand (ephemeral UI state only), TanStack Table + Virtual.
- **Deploy:** Vercel + Supabase Cloud.

## Code layout (current)

- `src/app/` — App Router routes, layouts, the themed app shell.
- `src/lib/supabase/` — SSR clients: `client.ts` (browser), `server.ts` (RSC/server actions),
  `service.ts` (service-role, server-only).
- `src/lib/env.ts` — Zod-validated environment variables.
- `src/proxy.ts` — session-refresh proxy (Next 16; must live under `src/` — see [[2026-06-14-gotcha-02-proxy-must-live-in-src]]).
- `supabase/migrations/` — versioned SQL migrations.
- `src/types/database.types.ts` — generated from the DB after each migration (`generate_typescript_types`).

## Data model (spec §5)

Normalized, multi-tenant; `org_id` on every tenant-scoped table. Core tables (non-exhaustive):
organizations, org_members (owner/admin/member/guest), workspaces, folders, boards, groups,
items (self-referencing `parent_id` for subitems), columns (type + settings jsonb),
cell_values (item × column × value jsonb, EAV), views (config jsonb), automations,
comments/updates, activity_log, time_entries, docs, goals, goal_links, notifications,
board_connections.

**Rules:** RLS on every table, default deny; policies key off `org_members` for `auth.uid()`;
no cross-org access. jsonb for flexible settings/values; index hot paths (`board_id`, `group_id`,
`item_id`, `org_id`). Realtime on items, cell_values, comments, notifications.

## Design system

See [[product]] §design-system and master spec §6.

## Live: architecture/design docs by recency

```dataview
TABLE type, status, file.mtime as "Updated"
FROM "docs"
WHERE type AND (type = "architecture" OR type = "design" OR type = "spec")
SORT file.mtime DESC
```

## Related MOCs

- [[platform-roadmap]] — where the architecture is heading
- [[operations]] — how it runs (Supabase, MCP, deploy)
- [[specs]] — the master design spec
