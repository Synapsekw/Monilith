---
type: adr
date: 2026-09-04
status: accepted
tags: [decision, gotcha, nextjs, cache-components, routing, settings]
related:
  - "[[2026-08-27-gotcha-97-a-layouts-instant-false-does-not-cover-the-pages-beneath-it]]"
  - "[[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]"
---

# Gotcha 99 — a `redirect()` thrown inside the streaming shell never navigates

## What happened

In production, clicking the profile icon → **Settings** did nothing. The menu closed and the page
stayed where it was. No error, no 500, nothing in the Vercel runtime error table.

The runtime logs told the story: after sign-in there were three `GET /settings 200` hits and then
**no `GET /settings/profile` at all**. The navigation reached the server; the redirect that was
supposed to follow it never happened.

`src/app/(app)/settings/page.tsx` was a redirect dispatcher — no content of its own, just
`redirect("/settings/profile")` so that existing links to `/settings` kept working.

## The trap

`/settings` renders inside the `(app)` group, whose layout is the Cache Components streaming shell
(`cacheComponents: true`, per-user data streaming behind Suspense). So by the time the page segment
runs, the response has already begun streaming. From the Next.js `redirect` docs:

> When used in a streaming context, this will insert a meta tag to emit the redirect on the client
> side.

That degradation is invisible until you look at the bytes. Probed against a local production build
with a real session cookie:

- **Hard load** — `200 OK`, `x-nextjs-postponed: 1`, and in the flushed HTML:
  `<meta http-equiv="refresh" content="1;url=/settings/profile"/>`. It recovers, one second later.
- **Client-side navigation** (`RSC: 1`) — a payload containing the settings layout, an empty content
  column, and the redirect only as a serialized digest,
  `NEXT_REDIRECT;replace;/settings/profile;307;`. The router did not act on it.

Clicking a `<Link>` is the second case. That is the whole bug: the one entry point every user
actually takes was the one that silently did nothing, while typing the URL by hand — the way anyone
would "verify the fix" — worked fine after a barely-perceptible delay.

Nothing about this is specific to Settings. **Any** redirect-only index page placed under a
streaming layout behaves this way. `/home` escaped it by accident: it is deliberately kept *outside*
the `(app)` group because it is "a one-shot redirect dispatcher", so its redirect is not thrown from
a streaming context.

## The rule

**A route whose only job is to redirect does not belong inside the streaming shell.** Put the
redirect at the routing layer instead — `redirects()` in `next.config.ts` — where it runs before
rendering and produces a real 307 for every entry path. The same docs page says as much: "If you'd
like to redirect before the render process, use `next.config.js`."

`redirects()` runs *before* the proxy, so an unauthenticated hit chains
`/settings` → `/settings/profile` → `/login?next=/settings/profile`, which lands the visitor on the
real page after sign-in rather than back at the empty index. That is an improvement, not a
regression.

## Verifying a redirect, honestly

A redirect is only verified when you have checked **both** transports. `curl` alone tests the hard
load and would have passed this bug through; the browser click is a different code path. The probe
that settled it: mint a session cookie for a Tier-2 fixture user, run `pnpm build && pnpm start`,
then request the route twice — once plain, once with `RSC: 1` — and assert `307` both times.

```
HARD NAV /settings   → 307  location: /settings/profile
SOFT NAV /settings   → 307  location: /settings/profile
```

## Fallout

The fix is `src/app/(app)/settings/page.tsx` deleted and a `redirects()` entry in `next.config.ts`,
guarded by `src/app/(app)/settings/settings-index-redirect.test.ts` so the page-level form cannot
come back.

Separately, and still open: the dev overlay reports `blocking-prerender-dynamic` on
`/settings/profile`. That one is gotcha-97's shape — `settings/layout.tsx` awaits `requireUser()`,
`resolveActiveOrg()` and `isOrgAdminCached()` above the `loading.tsx` boundary, which wraps the
layout's *children*, not the layout itself. It is a dev-only warning and did **not** cause the blank
page, but it does mean the settings shell blocks on three sequential reads.
