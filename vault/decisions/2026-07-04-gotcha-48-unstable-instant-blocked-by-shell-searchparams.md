---
type: adr
date: 2026-07-04
status: accepted
tags: [decision, gotcha, performance, nextjs, unstable-instant, rsc]
related:
  - "[[2026-07-04-1107-parallel-build-four-scoped-plans]]"
  - "[[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]"
---

# Gotcha 48: `unstable_instant` can't validate `(app)` routes while the shell reads `useSearchParams()`

## Context

Perf tier-3 Task A planned to add `unstable_instant` / `{ prefetch: "static" }` on `(app)` page
segments, on the premise that adding a route-level `loading.tsx` makes an otherwise-dynamic route
validate as instant. In **Next.js 16.2.9** that premise is false.

## The trap

Build-time instant validation flags **every dynamic read anywhere in the rendered tree**, not just
the page body. Pulse's core "0-refetch on view switch" pattern (gotcha 09) means the persistent
static shell reads `useSearchParams()` pervasively — the sidebar (`DashboardsNav` reads
`searchParams.get("ai")`) plus page-level view-state components (`GoalTree`, `PortfolioGrid`,
`WorkloadGrid`, `org-admin-console`, …). So:

- Every `(app)` route fails instant validation because the shared shell is dynamic.
- Dynamic `[id]` param routes can't validate at all without runtime samples.
- The spec's prescribed inner-`<Suspense>` fix does **not** clear param-route validation (proven
  empirically via single-route builds).

The two design goals are in direct tension: **client-state + History API view switching** (which
requires `useSearchParams()` in the shell) is mutually exclusive with **`unstable_instant`** on the
same routes.

## Decision

Do **not** pursue `unstable_instant` on `(app)` routes as a quick perf win. It requires refactoring
the shell/view-state components off `useSearchParams()` (or a different instant mechanism) — a real
architecture change that deserves its own spec, and must not regress the gotcha-09 0-refetch pattern.
Task A was reverted; the genuinely useful part (missing `dashboards`/`portfolios` `loading.tsx`
skeletons) shipped separately.

## Consequences

- Route skeletons (`loading.tsx`) remain the pragmatic instant-nav mechanism; every `(app)` route now
  has one.
- If instant nav is revisited, spec the `useSearchParams`-decoupling first and measure against
  gotcha-09 before touching page segments.
