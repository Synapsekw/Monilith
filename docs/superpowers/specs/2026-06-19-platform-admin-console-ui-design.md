# Platform Admin Console — UI Restructure — Design

- **Date:** 2026-06-19
- **Status:** Approved (brainstorming) — pending implementation plan
- **Author:** danijel + Claude
- **Phase:** Follow-up to [[2026-06-19-org-admin-and-platform-console-design]] (UI layer only)

## 1. Summary

The platform super-admin tier shipped functionally but its UI is one cramped `/admin`
page (an orgs list + a user search + an audit feed stacked together) and it has **no
navigation entry point in the sidebar**. This restructures it into a **proper multi-page
admin area** reachable from a **collapsible, admin-only "Platform" section in the left
sidebar**.

No change to the security model, RPCs, or RLS from the original design — this is the
presentation/IA layer plus one search-quality fix. Pages stay server-guarded by
`requirePlatformAdmin()`; queries stay fail-closed via `isPlatformAdmin()`.

## 2. Goals / Non-goals

**Goals**

- A collapsible **Platform** sidebar section (admins only) with: Overview, Organizations,
  Users, Audit log — mirroring the existing `BoardsNav`/`DashboardsNav` pattern, including
  collapsed-rail icon+tooltip behavior and active-route highlighting.
- A redesigned **Overview** page: stat cards (organizations, users, platform admins,
  events·24h) + recent organizations + recent activity.
- A dedicated **Organizations** page: searchable, paginated table → drill into an org.
- A dedicated **Users** page: global search + ban/unban + which orgs a user belongs to,
  backed by a **real filtered query** (fixes the current first-200-only in-memory cap).
- A dedicated **Audit log** page: the full platform feed, paginated.
- Monolith dark-first monochromatic + indigo styling throughout (pulse-ui).

**Non-goals (YAGNI)**

- No new privileged operations beyond what exists (assign/revoke role, ban/unban).
- No platform Settings page yet (no setting to manage).
- No charts/graphs on the overview (counts only).
- No realtime on admin pages (bounded reads, refresh on navigation).

## 3. Routes

| Route                       | Page                            | Replaces                   |
| --------------------------- | ------------------------------- | -------------------------- |
| `/admin`                    | Overview                        | current combined page      |
| `/admin/organizations`      | Orgs list (search + pagination) | (part of current page)     |
| `/admin/organizations/[id]` | Org drill-in (members/admins)   | **moves** `/admin/[orgId]` |
| `/admin/users`              | Global user search + ban/unban  | (part of current page)     |
| `/admin/audit`              | Full platform audit feed        | (part of current page)     |

`src/app/admin/[orgId]/` is **removed**; its page moves to
`src/app/admin/organizations/[id]/`. The `platformSetOrgRole` action's
`revalidatePath` target updates to `/admin/organizations/${orgId}`.

## 4. Sidebar — `PlatformNav`

New client component `src/components/platform/PlatformNav.tsx`, mirroring
`src/components/dashboards/DashboardsNav.tsx`:

- Renders **only** when `isPlatformAdmin` is true (threaded as a prop:
  `AppShell` → `Sidebar` → `PlatformNav`; the layouts already compute `isPlatformAdmin()`).
- A collapsible section header **"Platform"** (chevron, small `SUPER` accent badge) with a
  fixed list of 4 links (icons: Overview, Organizations, Users, Audit). Collapsed/expanded
  state persisted like the other nav sections (reuse the established `useUIStore`/local
  pattern that `DashboardsNav` uses — match it exactly).
- **Collapsed rail:** icon-only buttons + tooltips, matching the `nav` stubs in `Sidebar`.
- **Active route:** highlight the current link via `usePathname()` (indigo left-border +
  tint, as in the mockup).
- The existing user-menu "Platform admin" link (shipped in `41b896a`) stays as a secondary
  entry point and points to `/admin` (Overview).

## 5. Data / queries

Extend `src/lib/platform/queries.ts` (all `server-only`, all fail-closed via
`isPlatformAdmin()`, all using the existing `createServiceClient()`):

- `getPlatformStats()` → `{ orgs, users, admins, events24h }` via cheap `count` queries
  (`organizations` head-count; `auth` user count; `platform_admins` count;
  `admin_audit_log` where `created_at > now()-24h`).
- `listAllOrgs(page, pageSize)` — already exists; add a `count` for pagination and an
  optional `query` substring filter (ilike on name/slug) + member counts per row.
- `platformAuditFeed(limit, offset)` — already exists; add `offset` for pagination.
- **`searchUsers` fix:** replace the in-memory first-200 scan with a new
  `platform_search_users(p_query text, p_limit int, p_offset int)` **`SECURITY DEFINER`**
  RPC (gated by `is_platform_admin()`, `set search_path=''`) that `ilike`-filters
  `auth.users.email` and returns `{ id, email, banned_until, created_at }`, plus the user's
  org memberships. One small migration `20260619220000_platform_search_users.sql`. This
  retires the accepted follow-up from the original design.

## 6. Components

- `src/app/admin/page.tsx` — Overview: `StatCard` grid + "Recent organizations" panel
  (top 5 from `listAllOrgs`) + "Recent activity" panel (reuse `ActivityFeed`, top ~8).
- `src/components/platform/stat-card.tsx` — label + big number, pulse-ui surface card.
- `src/app/admin/organizations/page.tsx` — search box + `OrgTable` + pager.
- `src/components/platform/org-table.tsx` (client) — rows (name, slug, created, members,
  Manage link); search submits via History API / query param (server reads the page).
- `src/app/admin/organizations/[id]/page.tsx` — the moved drill-in (reuses `MembersTable`
  `mode="platform"` + `ActivityFeed`; `await params`).
- `src/app/admin/users/page.tsx` — wraps the existing `UserSearch`, enhanced to show org
  memberships per result and to use the new RPC via the `searchUsersAction` wrapper.
- `src/app/admin/audit/page.tsx` — full feed via `ActivityFeed` + pager.
- `src/components/admin/user-search.tsx` — keep; point at the improved action; show org
  memberships. (Filename stays under `admin/`; new shared bits go under `platform/`.)

## 7. Performance & data-fetching budget (AGENTS.md §5)

- These are **distinct server pages** with their own server data, so moving between them is
  legitimate **RSC navigation** (not in-page toggles) — `<Link>`/router is correct here; the
  "0-round-trip view toggle" rule does not apply (there are no same-data view toggles).
- All hot-path reads are **bounded**: orgs list + audit are **paginated** (`pageSize` ~25–50)
  over indexed columns (`organizations.created_at`, `admin_audit_log (org_id, created_at desc)`);
  user search is `ilike` + `limit/offset` in the new RPC; overview uses `count` + small
  `limit` slices. No unbounded `select *`.
- Search inputs change a **query param** (`?q=&page=`) → server re-reads that page's data.
  No realtime.
- Mutations (role change, ban/unban) remain Server Actions + targeted `revalidatePath`.

## 8. Security

- `src/app/admin/layout.tsx` keeps `await requirePlatformAdmin()`; every page additionally
  re-guards (defense in depth) and every query fails closed via `isPlatformAdmin()`.
- The new `platform_search_users` RPC is `SECURITY DEFINER`, `search_path=''`, and raises
  `42501` unless `is_platform_admin()` — same posture as `platform_set_org_role`.
- No change to org-tenant RLS.

## 9. Testing (mandatory)

- **Component:** `PlatformNav` (renders links when admin / nothing when not; active-route
  highlight; collapsed-rail tooltips), `StatCard`, `OrgTable` (search submit, pager),
  enhanced `UserSearch` (org memberships render).
- **Integration:** `platform_search_users` RPC — fails closed for a non-platform user;
  returns ilike matches for a platform admin; honors limit/offset. Added to
  `src/lib/platform/platform.integration.test.ts`.
- **Regression:** existing platform + admin suites stay green; `MembersTable` reuse in the
  moved drill-in route still works.
- Four gates (typecheck/lint/test/build) green; `/admin/*` routes compile.

## 10. Independent units (for the plan's Execution DAG — AGENTS.md §6)

- **U1 — `platform_search_users` migration + `queries.ts` expansion** (`getPlatformStats`,
  paginated/filtered `listAllOrgs`, `platformAuditFeed` offset, `searchUsers` repoint).
  _(foundation; apply migration + regen types)_
- **U2 — `PlatformNav` sidebar section + threading** (`AppShell`→`Sidebar`→`PlatformNav`).
  _(no dep on U1; uses existing `isPlatformAdmin`)_
- **U3 — Overview page + `StatCard`.** _(needs U1)_
- **U4 — Organizations list page + `OrgTable` + route move of the drill-in.** _(needs U1)_
- **U5 — Users page (enhanced search).** _(needs U1)_
- **U6 — Audit log page.** _(needs U1)_

Rough batches: **[U1, U2]** → **[U3, U4, U5, U6]**. The plan produces the full DAG.

## 11. Open questions / risks

- **Route move** of `/admin/[orgId]` → `/admin/organizations/[id]`: update the
  `platformSetOrgRole` revalidate path and any links; the old user-menu link points at
  `/admin` (Overview), so no dead links.
- **`auth.users` count / search via RPC:** confirm the `SECURITY DEFINER` function can read
  `auth.users` (it runs as owner) and that `banned_until` is exposed for the ban-state badge.
- **Stats cost:** `count` over `auth.users` / `organizations` is fine at current scale; if it
  grows, switch to estimated counts. Bounded everywhere else.

## 12. Related

- [[2026-06-19-org-admin-and-platform-console-design]] (the functional feature)
- `src/components/dashboards/DashboardsNav.tsx` (collapsible-section pattern to mirror)
- `src/lib/platform/queries.ts`, `src/lib/platform/guard.ts`, `src/components/settings/members-table.tsx`
- AGENTS.md §5 (perf budget), §6 (execution DAG)
