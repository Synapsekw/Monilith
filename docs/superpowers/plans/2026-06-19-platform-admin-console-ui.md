# Platform Admin Console — UI Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the cramped single `/admin` page into a proper multi-page platform admin area (Overview · Organizations · Users · Audit log) reached from a collapsible, admin-only "Platform" section in the left sidebar, styled in Pulse's dark monochromatic + indigo system.

**Architecture:** Pure UI/IA layer on top of the existing platform tier (no change to the security model). Distinct server pages under `/admin/*`, each guarded by `requirePlatformAdmin()`; bounded/paginated reads via expanded `src/lib/platform/queries.ts` + two new `SECURITY DEFINER` RPCs (`platform_stats`, `platform_search_users` — the latter retires the first-200-only user-search cap). A new client `PlatformNav` sidebar section mirrors the existing `DashboardsNav` pattern.

**Tech Stack:** Next.js 16 (RSC + Server Actions + `next/form`), Supabase (`SECURITY DEFINER` RPCs, service-role client), Tailwind v4 / shadcn (pulse-ui), Vitest + Testing Library.

**Source spec:** `docs/superpowers/specs/2026-06-19-platform-admin-console-ui-design.md`

---

## Execution DAG (AGENTS.md §6)

- **T1 (U1)** — migration (2 RPCs) + `queries.ts` expansion + types regen. _depends on nothing (foundation)_
- **T2 (U2)** — `PlatformNav` + thread `isPlatformAdmin` through `Sidebar`. _depends on nothing_
- **T3 (U3)** — Overview page + `StatCard`. _depends on T1_
- **T4 (U4)** — Organizations list page + route move of the drill-in. _depends on T1_
- **T5 (U5)** — Users page (enhanced search). _depends on T1_
- **T6 (U6)** — Audit log page. _depends on T1_

**Parallel batches:** **[T1, T2]** → **[T3, T4, T5, T6]**. **Critical path:** `T1 → {T3|T4|T5|T6}` (depth 2).

**⚠️ Execution note (gotcha-22):** This is a shared `develop` checkout with a concurrent session. Do **NOT** run two committing implementers at once — they race on the branch ref. **Serialize**: one implementer commits, then the next (or use worktrees). Stage by explicit path; never `git add -A`.

**⚠️ Manual gate:** T1 applies a migration to cloud (`supabase db push --linked`) — already authorized this session (CLI linked to `fafhckxawcjtuhpicsha`).

---

## File Structure

**Created:**

- `supabase/migrations/20260619220000_platform_admin_console.sql` — `platform_stats()` + `platform_search_users()` RPCs.
- `src/components/platform/PlatformNav.tsx` — collapsible admin-only sidebar section.
- `src/components/platform/PlatformNav.test.tsx`
- `src/components/platform/stat-card.tsx` — overview stat card.
- `src/app/admin/organizations/page.tsx` — orgs list (search + pagination).
- `src/app/admin/organizations/[id]/page.tsx` — org drill-in (moved from `[orgId]`).
- `src/app/admin/users/page.tsx` — users page wrapper.
- `src/app/admin/audit/page.tsx` — audit feed page.
- `src/components/platform/pager.tsx` — shared Prev/Next pager (Links).

**Modified:**

- `src/lib/platform/queries.ts` — add `getPlatformStats`, `listOrgsPage`, `platformAuditFeed` offset, repoint `searchUsers` to the RPC.
- `src/lib/platform/actions.ts` — `platformSetOrgRole` revalidate path → `/admin/organizations/${orgId}`.
- `src/app/admin/page.tsx` — becomes the Overview page.
- `src/components/admin/user-search.tsx` — show org memberships + ban state; use offset.
- `src/components/sidebar.tsx` — render `PlatformNav`; accept `isPlatformAdmin` prop.
- `src/components/app-shell.tsx` — pass `isPlatformAdmin` to `Sidebar`.
- `src/types/database.types.ts` — regenerated after the migration.

**Removed:**

- `src/app/admin/[orgId]/` — moved to `src/app/admin/organizations/[id]/`.

---

## Task 1 (U1): RPCs migration + queries expansion

**Files:**

- Create: `supabase/migrations/20260619220000_platform_admin_console.sql`
- Modify: `src/lib/platform/queries.ts`, `src/types/database.types.ts`

- [ ] **Step 1: Write the migration**

```sql
-- 20260619220000_platform_admin_console.sql
-- Platform admin console reads: aggregate stats + filtered/paginated user search.
-- Both SECURITY DEFINER + search_path='' + fail-closed via is_platform_admin().

create function public.platform_stats()
returns table (orgs bigint, users bigint, admins bigint, events_24h bigint)
language sql security definer set search_path = '' as $$
  select
    (select count(*) from public.organizations),
    (select count(*) from auth.users),
    (select count(*) from public.platform_admins),
    (select count(*) from public.admin_audit_log
      where created_at > now() - interval '24 hours')
  where public.is_platform_admin();
$$;
grant execute on function public.platform_stats() to authenticated;

-- ilike user search with each user's org names; recent-first; empty query = recent.
create function public.platform_search_users(
  p_query text default '', p_limit int default 25, p_offset int default 0
)
returns table (
  id uuid, email text, banned_until timestamptz, created_at timestamptz,
  org_names text[]
)
language sql security definer set search_path = '' as $$
  select u.id, u.email::text, u.banned_until, u.created_at,
    coalesce(
      array_agg(o.name order by o.name) filter (where o.name is not null),
      '{}'::text[]
    ) as org_names
  from auth.users u
  left join public.org_members m on m.user_id = u.id
  left join public.organizations o on o.id = m.org_id
  where public.is_platform_admin()
    and (coalesce(p_query, '') = '' or u.email ilike '%' || p_query || '%')
  group by u.id, u.email, u.banned_until, u.created_at
  order by u.created_at desc
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;
grant execute on function public.platform_search_users(text, int, int) to authenticated;
```

- [ ] **Step 2: Apply + regen types**

Run: `supabase db push --linked` → expect `Applying migration 20260619220000... Finished`.
Run: `pnpm db:types` (strip any stray `'"_tag"'` PostHog line). Confirm `platform_stats` + `platform_search_users` appear in `src/types/database.types.ts`.
Run: `pnpm typecheck` → PASS.

- [ ] **Step 3: Expand `src/lib/platform/queries.ts`**

Replace the file body's exports with (keep `import "server-only"`, `createServiceClient`, `isPlatformAdmin`):

```ts
export type PlatformOrg = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  member_count: number;
};

export type PlatformStats = {
  orgs: number;
  users: number;
  admins: number;
  events24h: number;
};

const ZERO_STATS: PlatformStats = {
  orgs: 0,
  users: 0,
  admins: 0,
  events24h: 0,
};

export async function getPlatformStats(): Promise<PlatformStats> {
  if (!(await isPlatformAdmin())) return ZERO_STATS;
  const { data } = await createServiceClient().rpc("platform_stats");
  const row = data?.[0];
  if (!row) return ZERO_STATS;
  return {
    orgs: Number(row.orgs),
    users: Number(row.users),
    admins: Number(row.admins),
    events24h: Number(row.events_24h),
  };
}

function shapeOrg(r: {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  org_members: { count: number }[];
}): PlatformOrg {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    created_at: r.created_at,
    member_count: r.org_members?.[0]?.count ?? 0,
  };
}

/** Recent orgs for the overview (bounded). */
export async function listAllOrgs(
  page = 0,
  pageSize = 50,
): Promise<PlatformOrg[]> {
  if (!(await isPlatformAdmin())) return [];
  const from = page * pageSize;
  const { data } = await createServiceClient()
    .from("organizations")
    .select("id, name, slug, created_at, org_members(count)")
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  return (data ?? []).map((r) => shapeOrg(r as Parameters<typeof shapeOrg>[0]));
}

/** Paginated + optionally filtered org list with total count, for the orgs page. */
export async function listOrgsPage(
  page = 0,
  pageSize = 25,
  query = "",
): Promise<{ rows: PlatformOrg[]; total: number }> {
  if (!(await isPlatformAdmin())) return { rows: [], total: 0 };
  const from = page * pageSize;
  let q = createServiceClient()
    .from("organizations")
    .select("id, name, slug, created_at, org_members(count)", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  const trimmed = query.trim();
  if (trimmed) q = q.or(`name.ilike.%${trimmed}%,slug.ilike.%${trimmed}%`);
  const { data, count } = await q;
  return {
    rows: (data ?? []).map((r) =>
      shapeOrg(r as Parameters<typeof shapeOrg>[0]),
    ),
    total: count ?? 0,
  };
}

export type PlatformAuditRow = {
  id: string;
  org_id: string | null;
  actor_id: string;
  actor_kind: string;
  action: string;
  target_email: string | null;
  created_at: string;
};

export async function platformAuditFeed(
  limit = 50,
  offset = 0,
): Promise<PlatformAuditRow[]> {
  if (!(await isPlatformAdmin())) return [];
  const { data } = await createServiceClient()
    .from("admin_audit_log")
    .select(
      "id, org_id, actor_id, actor_kind, action, target_email, created_at",
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  return (data as PlatformAuditRow[] | null) ?? [];
}

export type PlatformUser = {
  id: string;
  email: string | null;
  bannedUntil: string | null;
  orgNames: string[];
};

/** Filtered user search via the SECURITY DEFINER RPC (no in-memory cap). */
export async function searchUsers(
  query = "",
  limit = 25,
  offset = 0,
): Promise<PlatformUser[]> {
  if (!(await isPlatformAdmin())) return [];
  const { data } = await createServiceClient().rpc("platform_search_users", {
    p_query: query.trim(),
    p_limit: limit,
    p_offset: offset,
  });
  return (data ?? []).map((u) => ({
    id: u.id,
    email: u.email,
    bannedUntil: u.banned_until,
    orgNames: u.org_names ?? [],
  }));
}
```

- [ ] **Step 4: Verify + advisors + commit**

Run: `pnpm typecheck` → PASS. Run security advisors via MCP/SQL (both new functions pin `search_path` → no new lints).

```bash
git add supabase/migrations/20260619220000_platform_admin_console.sql src/types/database.types.ts src/lib/platform/queries.ts
git commit -m "feat(admin): platform stats + filtered user-search rpcs + queries"
```

---

## Task 2 (U2): Collapsible Platform sidebar section

**Files:**

- Create: `src/components/platform/PlatformNav.tsx`, `src/components/platform/PlatformNav.test.tsx`
- Modify: `src/components/sidebar.tsx`, `src/components/app-shell.tsx`

> Mirror `src/components/dashboards/DashboardsNav.tsx` (collapsed-rail Tooltip pattern, `cn` active styling). Active state comes from `usePathname()` (these are routes). The section header toggles a local `open` state (chevron) — "collapsible pages" — when the sidebar is expanded; when the whole sidebar is collapsed, render icon-only links with tooltips (no accordion).

- [ ] **Step 1: Write `PlatformNav`**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  Building2,
  Users,
  ScrollText,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const LINKS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/organizations", label: "Organizations", icon: Building2 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
] as const;

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  return exact ? pathname === href : pathname.startsWith(href);
}

export function PlatformNav({
  isPlatformAdmin = false,
  collapsed = false,
}: {
  isPlatformAdmin?: boolean;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);

  if (!isPlatformAdmin) return null;

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-0.5 px-2 py-2">
        {LINKS.map((l) => (
          <Tooltip key={l.href}>
            <TooltipTrigger asChild>
              <Link
                href={l.href}
                aria-label={l.label}
                aria-current={
                  isActive(pathname, l.href, l.exact) ? "page" : undefined
                }
                className={cn(
                  "flex size-9 items-center justify-center rounded-md transition-colors",
                  isActive(pathname, l.href, l.exact)
                    ? "bg-surface text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <l.icon className="size-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{l.label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-0.5 border-t px-2 pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground flex items-center gap-2 rounded-md px-3 py-1 text-xs font-semibold tracking-wide transition-colors"
      >
        {open ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
        <Shield className="size-3.5" />
        PLATFORM
        <span className="bg-primary/15 text-primary ml-auto rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider">
          SUPER
        </span>
      </button>
      {open
        ? LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={
                isActive(pathname, l.href, l.exact) ? "page" : undefined
              }
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                isActive(pathname, l.href, l.exact)
                  ? "border-primary bg-surface text-foreground border-l-2"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground border-l-2 border-transparent",
              )}
            >
              <l.icon className="size-4" />
              {l.label}
            </Link>
          ))
        : null}
    </div>
  );
}
```

- [ ] **Step 2: Write `PlatformNav.test.tsx`**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlatformNav } from "./PlatformNav";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/users" }));

describe("PlatformNav", () => {
  it("renders nothing for non-platform users", () => {
    const { container } = render(<PlatformNav isPlatformAdmin={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the four section links for platform admins", () => {
    render(<PlatformNav isPlatformAdmin />);
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "href",
      "/admin",
    );
    expect(
      screen.getByRole("link", { name: "Organizations" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Audit log" })).toBeInTheDocument();
  });

  it("marks the active route via aria-current", () => {
    render(<PlatformNav isPlatformAdmin />);
    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("renders icon links with accessible names when collapsed", () => {
    render(<PlatformNav isPlatformAdmin collapsed />);
    // No section header button in collapsed mode; links keep aria-labels.
    expect(
      screen.getByRole("link", { name: "Organizations" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
```

Run: `pnpm test src/components/platform/PlatformNav.test.tsx` → first FAIL (no module), then PASS after Step 1.

- [ ] **Step 3: Render `PlatformNav` in the sidebar**

In `src/components/sidebar.tsx`: add `import { PlatformNav } from "@/components/platform/PlatformNav";`, add `isPlatformAdmin` to the props type, and render it after `DashboardsNav`:

```tsx
        <DashboardsNav
          dashboards={dashboards}
          workspaces={workspaces}
          collapsed={isCollapsed}
        />

        <PlatformNav isPlatformAdmin={isPlatformAdmin} collapsed={isCollapsed} />
```

Props type addition:

```tsx
export function Sidebar({
  boards,
  workspaces,
  dashboards,
  isPlatformAdmin,
}: {
  boards: BoardListEntry[];
  workspaces: { id: string; name: string }[];
  dashboards: { id: string; name: string }[];
  isPlatformAdmin?: boolean;
}) {
```

- [ ] **Step 4: Pass `isPlatformAdmin` from AppShell to Sidebar**

In `src/components/app-shell.tsx`, the `<Sidebar ... />` call:

```tsx
<Sidebar
  boards={boards ?? []}
  workspaces={workspaces ?? []}
  dashboards={dashboards ?? []}
  isPlatformAdmin={isPlatformAdmin}
/>
```

(`isPlatformAdmin` is already an AppShell prop, already computed in every layout — no layout changes needed.)

- [ ] **Step 5: Verify + commit**

Run: `pnpm test src/components/platform/PlatformNav.test.tsx && pnpm typecheck && pnpm lint` → PASS.

```bash
git add src/components/platform/PlatformNav.tsx src/components/platform/PlatformNav.test.tsx src/components/sidebar.tsx src/components/app-shell.tsx
git commit -m "feat(admin): collapsible Platform sidebar section (admin-gated)"
```

---

## Task 3 (U3): Overview page + StatCard

**Files:**

- Create: `src/components/platform/stat-card.tsx`
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: Write `StatCard`**

```tsx
export function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface rounded-xl border p-4">
      <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </div>
      <div className="text-foreground mt-1.5 text-2xl font-semibold">
        {value.toLocaleString()}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite the Overview page**

`src/app/admin/page.tsx`:

```tsx
import Link from "next/link";
import {
  getPlatformStats,
  listAllOrgs,
  platformAuditFeed,
} from "@/lib/platform/queries";
import { StatCard } from "@/components/platform/stat-card";
import { ActivityFeed } from "@/components/settings/activity-feed";

export const metadata = { title: "Platform admin" };

export default async function AdminOverview() {
  const [stats, orgs, audit] = await Promise.all([
    getPlatformStats(),
    listAllOrgs(0, 5),
    platformAuditFeed(8),
  ]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-foreground font-heading text-2xl font-semibold tracking-tight">
          Platform admin
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Cross-organization oversight for the whole application.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Organizations" value={stats.orgs} />
        <StatCard label="Users" value={stats.users} />
        <StatCard label="Platform admins" value={stats.admins} />
        <StatCard label="Events · 24h" value={stats.events24h} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <section className="bg-surface rounded-xl border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-foreground text-sm font-medium">
              Recent organizations
            </h2>
            <Link
              href="/admin/organizations"
              className="text-primary text-xs font-medium"
            >
              View all →
            </Link>
          </div>
          {orgs.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No organizations yet.
            </p>
          ) : (
            <ul className="divide-border divide-y text-sm">
              {orgs.map((o) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <span className="text-foreground min-w-0 truncate">
                    {o.name}
                  </span>
                  <Link
                    href={`/admin/organizations/${o.id}`}
                    className="text-primary shrink-0 text-xs font-medium"
                  >
                    Manage →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-surface rounded-xl border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-foreground text-sm font-medium">
              Recent activity
            </h2>
            <Link
              href="/admin/audit"
              className="text-primary text-xs font-medium"
            >
              View all →
            </Link>
          </div>
          <ActivityFeed rows={audit} />
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm typecheck && pnpm lint` → PASS.

```bash
git add src/components/platform/stat-card.tsx src/app/admin/page.tsx
git commit -m "feat(admin): platform overview page with stat cards"
```

---

## Task 4 (U4): Organizations page + drill-in route move

**Files:**

- Create: `src/components/platform/pager.tsx`, `src/app/admin/organizations/page.tsx`, `src/app/admin/organizations/[id]/page.tsx`
- Modify: `src/lib/platform/actions.ts`
- Remove: `src/app/admin/[orgId]/page.tsx` (and the now-empty `[orgId]` dir)

- [ ] **Step 1: Shared pager**

`src/components/platform/pager.tsx`:

```tsx
import Link from "next/link";

export function Pager({
  basePath,
  page,
  pageSize,
  total,
  query,
}: {
  basePath: string;
  page: number;
  pageSize: number;
  total: number;
  query?: string;
}) {
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const qs = (p: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (p > 0) params.set("page", String(p));
    const s = params.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  if (total <= pageSize) return null;
  return (
    <div className="text-muted-foreground flex items-center justify-end gap-2 text-sm">
      <span className="mr-2 text-xs">
        Page {page + 1} of {lastPage + 1}
      </span>
      {page > 0 ? (
        <Link href={qs(page - 1)} className="rounded-md border px-3 py-1.5">
          ‹ Prev
        </Link>
      ) : (
        <span className="cursor-not-allowed rounded-md border px-3 py-1.5 opacity-40">
          ‹ Prev
        </span>
      )}
      {page < lastPage ? (
        <Link href={qs(page + 1)} className="rounded-md border px-3 py-1.5">
          Next ›
        </Link>
      ) : (
        <span className="cursor-not-allowed rounded-md border px-3 py-1.5 opacity-40">
          Next ›
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Organizations list page**

`src/app/admin/organizations/page.tsx` (server; search via `next/form` GET, pagination via query param):

```tsx
import Link from "next/link";
import Form from "next/form";
import { listOrgsPage } from "@/lib/platform/queries";
import { Pager } from "@/components/platform/pager";

export const metadata = { title: "Platform admin · organizations" };
const PAGE_SIZE = 25;

export default async function AdminOrganizations({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q = "", page: pageStr } = await searchParams;
  const page = Math.max(0, Number(pageStr ?? "0") || 0);
  const { rows, total } = await listOrgsPage(page, PAGE_SIZE, q);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-foreground font-heading text-xl font-semibold tracking-tight">
          Organizations
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Every organization on the platform.
        </p>
      </header>

      <Form action="/admin/organizations" className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search organizations…"
          aria-label="Search organizations"
          className="bg-surface focus-visible:ring-ring flex-1 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        />
        <button
          type="submit"
          className="bg-primary/15 text-primary rounded-md border px-4 py-2 text-sm font-medium"
        >
          Search
        </button>
      </Form>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No organizations found.</p>
      ) : (
        <div className="bg-surface overflow-hidden rounded-xl border">
          <div className="text-muted-foreground grid grid-cols-[2fr_1.4fr_1fr_0.8fr_90px] gap-3 border-b px-4 py-2.5 text-xs font-medium tracking-wide uppercase">
            <span>Name</span>
            <span>Slug</span>
            <span>Created</span>
            <span>Members</span>
            <span />
          </div>
          {rows.map((o) => (
            <div
              key={o.id}
              className="grid grid-cols-[2fr_1.4fr_1fr_0.8fr_90px] items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0"
            >
              <span className="text-foreground truncate">{o.name}</span>
              <span className="text-muted-foreground truncate">{o.slug}</span>
              <span className="text-muted-foreground">
                {new Date(o.created_at).toLocaleDateString()}
              </span>
              <span>{o.member_count}</span>
              <Link
                href={`/admin/organizations/${o.id}`}
                className="text-primary text-right text-xs font-medium"
              >
                Manage →
              </Link>
            </div>
          ))}
        </div>
      )}

      <Pager
        basePath="/admin/organizations"
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        query={q}
      />
    </div>
  );
}
```

- [ ] **Step 3: Move the drill-in to `organizations/[id]`**

Create `src/app/admin/organizations/[id]/page.tsx` with the exact body of the current `src/app/admin/[orgId]/page.tsx`, EXCEPT the param key changes from `orgId` to `id`:

```tsx
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import { MembersTable } from "@/components/settings/members-table";
import { ActivityFeed } from "@/components/settings/activity-feed";

export const metadata = { title: "Platform admin · organization" };

export default async function AdminOrgPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requirePlatformAdmin();
  const { id: orgId } = await params;
  const supabase = await createClient();

  const { data: members } = await supabase.rpc("get_org_members", {
    p_org_id: orgId,
  });
  if (!members) notFound();

  const { data: audit } = await supabase
    .from("admin_audit_log")
    .select("id, action, target_email, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-8">
      <header>
        <a
          href="/admin/organizations"
          className="text-primary text-xs font-medium"
        >
          ← Organizations
        </a>
        <h1 className="text-foreground font-heading mt-2 text-xl font-semibold tracking-tight">
          Organization members
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage roles and access for this organization.
        </p>
      </header>

      <MembersTable
        orgId={orgId}
        members={members}
        currentUserId={me.id}
        currentUserRole="owner"
        mode="platform"
      />

      <section className="space-y-3">
        <h2 className="text-foreground text-sm font-medium">Activity</h2>
        <ActivityFeed rows={audit ?? []} />
      </section>
    </div>
  );
}
```

Then delete the old route: `git rm src/app/admin/[orgId]/page.tsx` (remove the empty `[orgId]` directory too).

- [ ] **Step 4: Update the revalidate path in `actions.ts`**

In `src/lib/platform/actions.ts`, `platformSetOrgRole`:

```ts
revalidatePath(`/admin/organizations/${parsed.data.orgId}`);
```

- [ ] **Step 5: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm build` → PASS; confirm `/admin/organizations` and `/admin/organizations/[id]` compile and `/admin/[orgId]` is gone.

```bash
git add src/components/platform/pager.tsx src/app/admin/organizations/ src/lib/platform/actions.ts
git rm src/app/admin/[orgId]/page.tsx
git commit -m "feat(admin): organizations list page + move drill-in to /organizations/[id]"
```

---

## Task 5 (U5): Users page (enhanced search)

**Files:**

- Create: `src/app/admin/users/page.tsx`
- Modify: `src/components/admin/user-search.tsx`

- [ ] **Step 1: Update `UserSearch` to the new shape**

`src/components/admin/user-search.tsx` — the result type now carries `bannedUntil` + `orgNames`; render org memberships and a banned hint. Keep the existing ban/unban transitions. The component calls `searchUsersAction(q)` (already a `"use server"` wrapper); update the row type:

```tsx
"use client";
import { useState, useTransition } from "react";
import { searchUsersAction } from "@/lib/platform/search-action";
import {
  platformDeactivateUser,
  platformReactivateUser,
} from "@/lib/platform/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PlatformUser } from "@/lib/platform/queries";

export function UserSearch() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<PlatformUser[]>([]);
  const [searched, setSearched] = useState(false);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setRows(await searchUsersAction(q));
            setSearched(true);
          });
        }}
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by email…"
          aria-label="Search users"
        />
        <Button type="submit" disabled={pending}>
          Search
        </Button>
      </form>

      {searched && rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No matching users.</p>
      ) : (
        <ul className="bg-surface divide-border divide-y rounded-xl border text-sm">
          {rows.map((u) => (
            <li
              key={u.id}
              className="flex items-center justify-between gap-3 px-4 py-2.5"
            >
              <div className="min-w-0">
                <div className="text-foreground truncate">
                  {u.email}
                  {u.bannedUntil ? (
                    <span className="text-destructive ml-2 text-xs">
                      banned
                    </span>
                  ) : null}
                </div>
                <div className="text-muted-foreground truncate text-xs">
                  {u.orgNames.length
                    ? u.orgNames.join(" · ")
                    : "No organizations"}
                </div>
              </div>
              <span className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await platformDeactivateUser({ userId: u.id });
                      if (!r.ok) alert(r.error);
                    })
                  }
                >
                  Ban
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await platformReactivateUser({ userId: u.id });
                      if (!r.ok) alert(r.error);
                    })
                  }
                >
                  Unban
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

> If a `user-search.test.tsx` exists, update its mock rows to the new `PlatformUser` shape (`{ id, email, bannedUntil, orgNames }`) and keep the existing assertions (search renders results, ban/unban dispatch). Run it and confirm green.

- [ ] **Step 2: Users page**

`src/app/admin/users/page.tsx`:

```tsx
import { UserSearch } from "@/components/admin/user-search";

export const metadata = { title: "Platform admin · users" };

export default function AdminUsers() {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-foreground font-heading text-xl font-semibold tracking-tight">
          Users
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Find any user across all organizations.
        </p>
      </header>
      <UserSearch />
    </div>
  );
}
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm test src/components/admin/ && pnpm typecheck && pnpm lint` → PASS.

```bash
git add src/app/admin/users/ src/components/admin/user-search.tsx
git commit -m "feat(admin): users page with filtered search + org memberships"
```

---

## Task 6 (U6): Audit log page

**Files:**

- Create: `src/app/admin/audit/page.tsx`

- [ ] **Step 1: Audit page (paginated feed)**

`src/app/admin/audit/page.tsx`:

```tsx
import { platformAuditFeed } from "@/lib/platform/queries";
import { ActivityFeed } from "@/components/settings/activity-feed";
import { Pager } from "@/components/platform/pager";

export const metadata = { title: "Platform admin · audit log" };
const PAGE_SIZE = 50;

export default async function AdminAudit({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageStr } = await searchParams;
  const page = Math.max(0, Number(pageStr ?? "0") || 0);
  // Fetch one extra row to know whether a next page exists (audit feed has no count).
  const rows = await platformAuditFeed(PAGE_SIZE + 1, page * PAGE_SIZE);
  const hasNext = rows.length > PAGE_SIZE;
  const pageRows = rows.slice(0, PAGE_SIZE);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-foreground font-heading text-xl font-semibold tracking-tight">
          Audit log
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Every privileged action across the platform.
        </p>
      </header>

      <div className="bg-surface rounded-xl border p-4">
        <ActivityFeed rows={pageRows} />
      </div>

      <Pager
        basePath="/admin/audit"
        page={page}
        pageSize={PAGE_SIZE}
        total={
          page * PAGE_SIZE +
          (hasNext ? PAGE_SIZE * (page + 2) : pageRows.length)
        }
      />
    </div>
  );
}
```

> The audit feed has no exact count; the `total` passed to `Pager` is a synthetic value that keeps "Next" enabled while `hasNext` is true and disables it on the last page. (Pager only needs relative position; this avoids a second count query.)

- [ ] **Step 2: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm build` → PASS; `/admin/audit` compiles.

```bash
git add src/app/admin/audit/
git commit -m "feat(admin): platform audit log page (paginated)"
```

---

## Final verification (four gates — AGENTS.md #4)

- [ ] `pnpm typecheck` → PASS
- [ ] `pnpm lint` → PASS
- [ ] `pnpm test` → PASS (PlatformNav + user-search component tests; the new `platform_search_users`/`platform_stats` RPC integration cases — add to `src/lib/platform/platform.integration.test.ts`: non-admin gets 0 rows / empty stats; admin gets ilike matches honoring limit/offset and non-zero stats)
- [ ] `pnpm build` → PASS (`/admin`, `/admin/organizations`, `/admin/organizations/[id]`, `/admin/users`, `/admin/audit` all compile; `/admin/[orgId]` gone)
- [ ] Advisors clean (both new functions pin `search_path`)
- [ ] Manual live check: sign in as `info@synapse-solutions.ai` → the Platform section appears in the sidebar (and not for a normal user) → each page loads and is styled correctly.
- [ ] `superpowers:requesting-code-review` whole-branch review → no Critical/Important.
- [ ] `/wrapup` — session note + north-star bump.

---

## Self-Review (against the spec)

**Spec coverage:**

- §3 routes (overview/orgs/orgs[id]/users/audit + drill-in move) → T3/T4/T5/T6 ✓
- §4 collapsible admin-only sidebar section + collapsed rail + active route → T2 ✓
- §5 queries (`getPlatformStats`, paginated/filtered orgs, audit offset, `searchUsers` RPC) → T1 ✓
- §6 components (StatCard, OrgTable→table markup, Pager, drill-in reuse, users wrapper) → T3/T4/T5/T6 ✓
- §7 perf budget (distinct server pages, bounded/paginated, `next/form` query-param search, no realtime) → T4/T6 ✓
- §8 security (layout guard kept, queries fail closed, RPCs gated + `search_path`) → T1/T4 ✓
- §9 testing (PlatformNav, user-search, RPC integration, regression, gates) → T2/T5 + final ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `PlatformUser` redefined with `{ id, email, bannedUntil, orgNames }` in T1 and consumed in T5; `PlatformOrg` gains `member_count` in T1, used in T3/T4; `getPlatformStats`/`listOrgsPage`/`platformAuditFeed(offset)` signatures match call sites; `searchUsersAction` wrapper unchanged (still `(query) => searchUsers(query)` — note it now passes through to the RPC-backed `searchUsers`).

**One consistency fix to apply during T5:** `searchUsersAction` in `src/lib/platform/search-action.ts` currently calls `searchUsers(query)`; the new `searchUsers(query, limit, offset)` keeps `query` first with defaulted limit/offset, so the wrapper still compiles unchanged. Confirm during T5.
