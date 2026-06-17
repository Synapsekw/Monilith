---
type: adr
status: active
date: 2026-06-17
tags: [decision, gotcha]
related:
  [
    "[[2026-06-14-gotcha-02-proxy-must-live-in-src]]",
    "[[2026-06-14-gotcha-01-next16-not-next15]]",
  ]
---

# Gotcha 12 — a new public route needs the proxy whitelist + e2e update, not just `page.tsx`

## Symptom

The new MONOLITH landing page at `/` was fully built (component + root `page.tsx` switched from
`requireUser()` to `getUser()` with a logged-out branch) and all unit tests, typecheck, lint, and
build were green — yet visiting `/` while logged out still redirected to `/login`. The landing was
never reachable.

## Context

`src/proxy.ts` (Next 16's renamed middleware — see
[[2026-06-14-gotcha-02-proxy-must-live-in-src]]) is the auth gate: it redirects **every**
unauthenticated request to `/login` unless the path matches `AUTH_ROUTES` (`/login`, `/signup`,
`/auth`). `/` was not whitelisted, so the proxy short-circuited the request before `page.tsx` ever
ran. Two things the spec/plan missed entirely:

1. **The proxy.** Making a route public is a proxy-level concern, not just a page-level one. The
   page's `getUser()`-null branch is dead code until the proxy lets the request through.
2. **The existing e2e test.** `e2e/home.spec.ts` asserted "unauthenticated `/` redirects to
   `/login`" — the exact behavior we were inverting. `pnpm test` (Vitest unit) is green and does
   **not** run Playwright, so the contradiction only surfaced when the e2e was run manually during
   verification.

## Decision

- Add an exact-match `PUBLIC_ROUTES = ["/"]` list to `src/proxy.ts` and skip the redirect when
  `PUBLIC_ROUTES.includes(pathname)` (commit `6a514a0`). Exact match (`Array.includes`, strict
  equality) — `/boards`, `//`, `/login` do not match; only the bare `/` does. No sub-path bleed.
- Update `e2e/home.spec.ts` to assert the landing renders at `/` and its link navigates to
  `/login`.
- Auth layering is preserved: the proxy gates unauthenticated access; `page.tsx` still redirects
  **authenticated** users onward. RLS remains the real data boundary.

## Rationale

Routing/auth behavior in this app lives in two layers (proxy + page). A spec that only reasons
about the page will silently fail at the proxy. e2e is the only layer that exercises the real Next
runtime + cookies, so route-visibility changes must be verified there, not just in unit tests.

## Consequences

- Positive: landing reachable; auth boundary unchanged for protected routes.
- Process: **specs/plans that add or change a public route MUST include (a) a `src/proxy.ts`
  whitelist task and (b) an e2e (`pnpm e2e`) update/verification step.** Treat `pnpm e2e` as part
  of the verification gate when routing/visibility changes — `typecheck/lint/test/build` alone will
  pass on a route that's actually unreachable.
- Open follow-up: consider a unit test for the proxy's public/auth/protected branching so the gate
  catches this without a full browser run.

## Related

- [[2026-06-14-gotcha-02-proxy-must-live-in-src]]
- [[2026-06-14-gotcha-01-next16-not-next15]]
