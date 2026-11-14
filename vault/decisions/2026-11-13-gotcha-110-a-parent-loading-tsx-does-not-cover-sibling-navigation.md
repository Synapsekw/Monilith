---
type: adr
date: 2026-11-13
status: accepted
tags: [decision, gotcha, nextjs, performance, cache-components]
related:
  - "[[2026-08-27-gotcha-97-a-layouts-instant-false-does-not-cover-the-pages-beneath-it]]"
  - "[[2026-07-04-gotcha-48-unstable-instant-blocked-by-shell-searchparams]]"
---

# Gotcha 110 — a parent `loading.tsx` does not cover navigation between its children

## What happened

Every `/settings/*` page showed an "Instant" insight in the dev overlay: "Next.js encountered
uncached data during a navigation", with a stack running through `getClaims` →
`src/lib/auth/session.ts` → `AppLayout`. `/my-work` and `/ask` were clean.

The stack points at the shell only because `getUser` is wrapped in React `cache()`: the shell
starts the promise first, and the settings page's `await requireUser()` reuses it. The real
blocking `await` is in the page body.

## The trap

`settings/loading.tsx` looked like it covered every settings section, and
`app-shell-structure.test.ts` agreed: it only required a `loading.tsx` *at or above* each page.
That premise was wrong. A `loading.tsx` is the Suspense boundary for **its own segment**, keyed by
that segment. Moving from `/settings/profile` to `/settings/security` keeps the `settings`
segment, so its boundary never re-suspends. The new page has no boundary of its own
(`LoadingBoundary name="security/" loading={null}` in the React tree), so the navigation blocks on
the server until `requireUser()` and the page's reads finish.

It also had a second effect: the settings-level fallback wrapped the settings **layout**, so on the
way into settings the header and nav were hidden behind the skeleton. The docblocks said the
opposite.

Verified with a live A/B on the dev server: adding `profile/loading.tsx` alone cleared the
insight on `/settings/profile` while `/settings/security` kept it.

This is dev-only validation (`validationLevel: 'warning'`), so `pnpm build` passes either way.

## What we do about it

- The skeleton moved to `src/components/settings/settings-section-skeleton.tsx`. Each of the 11
  settings sections has its own `loading.tsx` that renders it. `settings/loading.tsx` is gone, so
  the static settings header and nav paint straight away on the way in.
- `app-shell-structure.test.ts` now requires a **sibling** `loading.tsx` for every `(app)` and
  `admin` page, not just one at or above it.

## The general shape

A section that groups several pages under a shared layout needs the boundary on each page, not
on the section. A parent boundary only helps on the way into the section.
