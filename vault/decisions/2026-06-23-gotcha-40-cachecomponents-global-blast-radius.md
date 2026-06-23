---
type: adr
date: 2026-06-23
status: accepted
tags: [decision, gotcha, nextjs, ppr, cache-components, streaming]
related:
  - "[[2026-06-23-1016-phase-9-2-streaming-shell-build]]"
---

# Gotcha 40: `cacheComponents: true` is a global flag — it breaks every cookie-reading route, not just the ones you convert

## Context

Phase 9.2 set out to stream the **authenticated section shells** (the 8 `src/app/<section>/layout.tsx`).
The plan framed the work as "convert the 8 layouts + flip the flag." But `cacheComponents: true` in
`next.config.ts` is **build-wide**: once on, _every_ route is prerendered by default, and any
uncached dynamic access (`cookies()`, and anything that reads it — `getUser()`/`requireUser()`/
`createClient()`) **outside a `<Suspense>`** is a hard build error:

```
Error: Route "/change-password": Uncached data was accessed outside of <Suspense>.
```

The build died on `(auth)/change-password` — a route with no converted layout and nothing to do with
the shell. The section **pages** were fine (they render inside `AuthenticatedShell`'s children
`<Suspense>`), but four **standalone** cookie-reading routes outside any converted layout were not:
`home`, `landing`, `onboarding`, `(auth)/change-password`.

## Decision

Wrap each standalone route's cookie-bound work in its own `<Suspense>` gate: extract the async body
into an inner server component (`HomeDispatch`/`LandingInner`/`OnboardingGate`/`ChangePasswordGate`)
and render `<Suspense><Inner/></Suspense>` from the page. The static chrome (brand, hero fallback)
prerenders; the dynamic part streams. `redirect()` inside the gate still works.

Admin layouts that must gate before any boundary (`requirePlatformAdmin()` for a real redirect) stay
fully `ƒ Dynamic` — accepted, not an error.

## Consequences

- Enabling Cache Components is **not** a per-section change you can stage — the flag flip touches the
  whole app at once. Budget for sweeping _every_ route that reads request data, including auth /
  onboarding / marketing pages, not only the feature you're building.
- The build is the authoritative gate and names the offending route one at a time; iterate
  build → wrap → build. Do **not** silence by caching cookie-bound reads (`use cache` forbids
  `cookies()`) — that's a different lever (9.3).
- Net result is good: 10 routes became `◐ Partial Prerender`, `/` stayed `○ Static`, only the
  admin gate + a few framework routes stayed `ƒ Dynamic`.
