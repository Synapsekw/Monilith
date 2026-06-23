# Shared `(app)` shell layout — design

**Date:** 2026-06-23
**Status:** Approved, ready for implementation plan
**Branch:** `task/shared-app-shell`

## Problem

Clicking between authenticated sections in the sidebar (Boards → Portfolios →
Dashboard → …) visibly **reloads the entire sidebar** — the `SidebarNavSkeleton`
flashes and the per-user nav data re-fetches on every click.

### Root cause

Every authenticated section mounts its **own** copy of the shell:

```
src/app/boards/layout.tsx      → <AuthenticatedShell>
src/app/dashboards/layout.tsx  → <AuthenticatedShell>
src/app/portfolios/layout.tsx  → <AuthenticatedShell>
src/app/goals/layout.tsx       → <AuthenticatedShell>
src/app/time/layout.tsx        → <AuthenticatedShell>
src/app/workload/layout.tsx    → <AuthenticatedShell>
src/app/settings/layout.tsx    → <AuthenticatedShell>
src/app/admin/layout.tsx       → <AuthenticatedShell>  (+ requirePlatformAdmin guard)
src/app/home/page.tsx          → <AuthenticatedShell>  (page-level, dispatcher)
```

These are **sibling** layouts whose only common ancestor is the root
`src/app/layout.tsx`. The Next.js App Router only preserves a layout when you
navigate _within its own subtree_. Crossing from `/boards/*` to `/portfolios`
unmounts the boards shell and mounts a brand-new portfolios shell — re-running
`SidebarNavData`'s six uncached queries (`listMyBoards`, `listSharedBoards`,
`listDashboards`, workspaces, two admin checks, +feedback count) and re-flashing
the Suspense skeleton on every cross-section click.

Board-to-board navigation (`/boards/A → /boards/B`) is _already_ preserved
because it stays inside `boards/layout.tsx`; the section-crossing case is the
dominant offender.

`SidebarNavData` is also explicitly uncached (its own comment defers caching to
"Phase 9.3"), so each re-mount pays the full query cost.

## Goal

The authenticated shell (sidebar nav, header user region, command palette)
mounts **once** and persists across section navigation, so `SidebarNavData` runs
once per page load rather than once per click.

## Design

### New shared route-group layout

Create `src/app/(app)/layout.tsx`. The parentheses make it a **route group** —
it does **not** affect the URL (`/boards` stays `/boards`):

```tsx
import type { ReactNode } from "react";
import { AuthenticatedShell } from "@/components/shell/authenticated-shell";

// Hoisted from the former per-section layouts: cookie-bound page-load entry is
// dynamic; sibling client-nav is validated via `{ prefetch: 'static' }` on the
// page segments. The static AppShell frame still prerenders; per-user data
// streams behind Suspense.
export const unstable_instant = false;

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}
```

### Directory moves (`git mv`, special files travel with the dir)

```
src/app/boards/      → src/app/(app)/boards/
src/app/dashboards/  → src/app/(app)/dashboards/
src/app/portfolios/  → src/app/(app)/portfolios/
src/app/goals/       → src/app/(app)/goals/
src/app/time/        → src/app/(app)/time/
src/app/workload/    → src/app/(app)/workload/
src/app/settings/    → src/app/(app)/settings/
```

### Per-section layouts after the move

- **boards, portfolios, goals, time, workload, settings** — `layout.tsx`
  **deleted**. They only mounted the shell and set `unstable_instant = false`;
  both responsibilities now live on the group layout, making them redundant.
- **dashboards** — keep a _thin_ nested `layout.tsx` that contains **only** the
  `react-grid-layout/css/styles.css` import and returns `{children}` (no shell,
  no `unstable_instant`). Keeps that stylesheet scoped to dashboard routes rather
  than loading it shell-wide.
- **admin** — **untouched, stays outside the group.** Its layout runs
  `requirePlatformAdmin()` _before_ any Suspense boundary so a non-admin gets a
  clean server redirect, never a mid-stream client redirect. Folding it under the
  shared shell would run that guard _inside_ the shell's Suspense, defeating its
  purpose. Cost: shell-persistence is lost only when crossing into/out of admin,
  which is rare.
- **home** — **untouched.** It is a one-shot cookie-reading redirect dispatcher,
  not a surface you sit on and navigate from, so shell persistence there is
  irrelevant.

### Out of scope (unchanged)

`updates/`, `onboarding/`, `(auth)/`, `landing/`, `auth/callback` are
public/unauthenticated or shell-less and are not touched.

## Why this fixes it

`(app)/layout.tsx` becomes the common ancestor of all the moved sections, so the
App Router preserves it across `boards → portfolios → dashboard` navigation. The
shell — and `SidebarNavData` — render once per page load instead of once per
click. The Suspense skeleton stops flashing on section changes.

## Risks / verification

1. **Import paths.** Moved files use the `@/` path alias (absolute), so deepening
   the directory should not break imports. Verify by grepping the moved trees for
   relative `../` imports that would shift; convert any to `@/` if found.
2. **`revalidatePath("/", "layout")`** in `src/lib/boards/actions.ts` (5 sites:
   delete/rename/reorder/duplicate/move) still over-invalidates the whole shell
   after a board mutation. **Out of scope** for this fix — noted as a follow-up.
   It is the secondary trigger (after-edit refetch), not the every-click cause.
3. **No URL changes.** Route groups are URL-transparent; all existing links,
   redirects, and `proxy.ts` rules remain valid. Confirm via the build (route
   manifest) and a smoke nav.

## Testing

- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — the build
  catches structural/route breakage; typecheck catches import breakage.
- **Regression guard (Vitest):** assert that no route layout under `src/app/(app)/`
  imports `AuthenticatedShell` — prevents re-introducing a per-section shell that
  would silently restore the bug. (Allow-list admin/home, which intentionally
  mount it outside the group.)
- **Manual acceptance:** open DevTools → Network, navigate Boards → Portfolios →
  Dashboard → Time; the sidebar nav queries fire **once** (initial load), not on
  each section click, and the sidebar skeleton does not re-flash.
