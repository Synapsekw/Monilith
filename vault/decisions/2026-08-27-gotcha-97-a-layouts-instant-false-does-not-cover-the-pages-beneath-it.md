---
type: adr
date: 2026-08-27
status: accepted
tags: [decision, gotcha, nextjs, performance, cache-components]
related:
  - "[[2026-08-27-gotcha-96-a-stabilised-route-segment-config-is-ignored-under-its-old-name]]"
  - "[[2026-07-04-gotcha-48-unstable-instant-blocked-by-shell-searchparams]]"
  - "[[2026-08-27-1327-admin-route-skeletons]]"
---

# Gotcha 97 — a layout's `instant = false` does not cover the pages beneath it

## What happened

`/admin/feedback` logged `blocking-prerender-dynamic` on every load, pointing at the Supabase read
in the page body. `src/app/admin/layout.tsx` had carried `export const instant = false` since Cache
Components was enabled — the opt-out looked present and correct, and gotcha-96 had just repaired
its name that same morning. It was still not covering the pages.

The whole `/admin` section was affected. It only looked like a feedback bug because feedback is
where the owner happened to be.

## The trap

With `cacheComponents: true`, the framework default `experimental.instantInsights.validationLevel:
'warning'` **implicitly validates every Page and Default segment** in development. `instant = false`
opts out *the segment that declares it*. On a layout, that is the layout segment — the page
segments beneath it are still implicitly validated, and still error.

What actually suppresses this everywhere else in Pulse is **`loading.tsx`**, which wraps the page
segment in a Suspense boundary so the page-body `await` lands inside one. All 13 `(app)` routes
have one (gotcha-48's outcome: route skeletons are the instant-nav mechanism, because `instant`
itself is unusable while the shell reads `useSearchParams()` pervasively for gotcha-09). `/admin`
had none — it is the one authenticated section outside the `(app)` group, so it inherited neither
the group's layout nor its skeleton discipline.

Two things make this expensive to notice:

- **The build is silent.** Verified by building with and without the skeletons: the `/admin/*` route
  markers are byte-identical. This validation is dev-only, so `pnpm build` will never tell you.
- **`instant = false` reads as broader than it is.** The docs' one line — "setting `instant = false`
  on a segment opts it out of validation entirely" — is about *that* segment. The separate rule
  where a `false` higher in the tree wins is scoped to **static-shell** validation, not to the
  per-page navigation check.

## What we do about it

- Every `/admin` route now has its own `loading.tsx` (7 of them). The three list pages share
  `AdminListSkeleton`; the overview and the two detail pages are bespoke.
- `src/app/app-shell-structure.test.ts` asserts every `(app)` and `admin` page has a `loading.tsx`
  **at or above it** (a parent's covers its subtree — that is why the settings subsections pass),
  and that each admin segment owns its own rather than inheriting the overview's.
- `src/app/admin/loading-columns.test.ts` pins each list fallback's grid template to the page it
  stands in for. Nothing else type-checks that literal, and a drifted template makes the real table
  snap sideways on commit.

## The general shape

A route-segment config is scoped to its segment unless the docs say otherwise, and "unless the docs
say otherwise" is per-validation, not per-config. When an opt-out appears to be in place and the
thing it opts out of still fires, check what the opt-out is attached to before concluding the flag
is broken — that is the difference between this and gotcha-96, where the flag genuinely was not
being read.

Corollary worth keeping: **a section outside the `(app)` group inherits none of its conventions.**
`/admin` has now been caught twice this way — once for the missing `<Toaster />` (already pinned by
a test in the same file), once for the missing skeletons. Next time something is added to the
`(app)` layout, ask what `/admin` and `/home` do instead.
