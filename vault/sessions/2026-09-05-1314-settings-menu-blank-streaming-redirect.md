---
type: session
date: 2026-09-05-1314
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-09-04-gotcha-99-a-redirect-thrown-inside-the-streaming-shell-never-navigates]]"
  - "[[2026-08-27-gotcha-97-a-layouts-instant-false-does-not-cover-the-pages-beneath-it]]"
---

# Settings opened to nothing — a redirect thrown inside the streaming shell

## What changed

- `next.config.ts` — `/settings` → `/settings/profile` moved into `redirects()`, which runs before
  rendering; `src/app/(app)/settings/page.tsx` (the redirect-only page) deleted.
- `src/app/(app)/settings/settings-index-redirect.test.ts` — guards the routing-layer form so the
  page-level redirect cannot come back.
- ADR [[2026-09-04-gotcha-99-a-redirect-thrown-inside-the-streaming-shell-never-navigates]].
- Promoted as PR #109 (`24ad32b4`), Vercel production deploy confirmed, verified live.
- Announced on `/updates`: "Settings opens from the profile menu again" (`fixed`, 2026-09-05).

## Why

Clicking the profile icon → Settings did nothing in production — the menu closed, the page stayed
put, and no error appeared anywhere. `/settings` was a redirect-only page inside the `(app)` Cache
Components streaming shell, so `redirect()` was thrown from a streaming context. Next.js degrades
that: a `<meta http-equiv="refresh">` in the flushed HTML, and an inert `NEXT_REDIRECT` digest in the
RSC payload. A hard page load recovered after a 1s meta refresh; a client-side navigation — the one
path every user takes — rendered the settings layout with an empty content column. `/home` had
avoided this by accident, being deliberately kept outside the `(app)` group.

## How to test (for the user)

1. Hard-refresh `www.monolith.works` (Cmd+Shift+R) so the old client bundle is discarded.
2. Sign in, click the profile icon (top right), choose **Settings**.
3. Expect: Settings → Profile, URL `/settings/profile`, "How you appear to your teammates" visible.
4. Type `www.monolith.works/settings` in the address bar — same page, no one-second blank.
5. Signed out, open `/settings` — you land on the login page, and after signing in you arrive at
   `/settings/profile` rather than an empty Settings.

## Open threads

- `settings/layout.tsx` awaits `requireUser()`, `resolveActiveOrg()` and `isOrgAdminCached()` above
  the `loading.tsx` boundary — `loading.tsx` wraps a layout's *children*, not the layout itself — so
  the dev overlay reports `blocking-prerender-dynamic` on `/settings/*` and the settings shell blocks
  on three sequential reads. Dev-only warning, gotcha-97's shape, not the cause of the blank page.
- The Vercel CLI in this environment is two majors behind (57.0.0 → 59.11.2).

## Next session entry point

Audit the rest of the app for the same shape: any route whose only job is to redirect and which
renders inside a streaming layout. `redirects()` is the fix, and the two-transport probe (`curl`
plain **and** `RSC: 1`) is how you prove it — a `curl` alone passes the broken version.
