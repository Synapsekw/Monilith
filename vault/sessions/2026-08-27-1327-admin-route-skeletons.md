---
type: session
date: 2026-08-27-1327
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-08-27-gotcha-97-a-layouts-instant-false-does-not-cover-the-pages-beneath-it]]"
  - "[[2026-08-27-gotcha-96-a-stabilised-route-segment-config-is-ignored-under-its-old-name]]"
  - "[[2026-07-04-gotcha-48-unstable-instant-blocked-by-shell-searchparams]]"
---

# Admin route skeletons

## What changed

- **7 `loading.tsx` files, one per `/admin` route** — overview, users, organizations,
  organizations/[id], audit, feedback, feedback/[id]. Merged to `develop` as `52436165`
  (`1093efd0`, 15 files, +738/−1).
- **`src/components/admin/AdminListSkeleton.tsx`** — the three list pages are the same shape
  (header, control strip, one bordered grid table, pager) and differ only in column template and
  toolbar, so the fallback is parameterized instead of copied three times. The grid template is
  passed as a **literal** at each call site because Tailwind's scanner needs it verbatim.
- **Two guards.** `app-shell-structure.test.ts` asserts every `(app)` and `admin` page has a
  `loading.tsx` at or above it, and that each admin segment owns its own;
  `admin/loading-columns.test.ts` pins each list fallback's grid template to the page it mirrors.
  Both mutation-checked red before landing.
- **ADR:** [[2026-08-27-gotcha-97-a-layouts-instant-false-does-not-cover-the-pages-beneath-it]].
- **`/updates`: deliberately nothing.** `/admin` is platform-admin-only chrome — not a user-visible
  surface. The two flagged ship dates are the known noise pattern, not debt: 2026-08-14 is
  deliberately unannounced (owner ruling), and 2026-08-24's document work is announced by Spec 2b's
  2026-08-25 commit.

## Why

The owner pasted a dev log showing `blocking-prerender-dynamic` on `/admin/feedback`. It was not a
feedback bug: **the whole admin section had never had a single `loading.tsx`**, so every admin route
blocked navigation with no skeleton — the observed loads were 1.7s and 1.6s of blank page. The
`instant = false` on `admin/layout.tsx` looked like the opt-out and is not: it covers the layout
segment, not the pages beneath it. `/admin` is the one authenticated section outside the `(app)`
group, so it inherited neither that group's layout nor its skeleton discipline — the same way it
previously missed the app-wide `<Toaster />`.

## How to test (for the user)

1. Your dev server on `localhost:3000` is on the merged code — no pull needed. Touch a file if it
   has been idle.
2. Sign in as a platform admin and open **`/admin`**. Four stat-card placeholders and two panel
   outlines should flash before the real numbers land.
3. Click through **Users**, **Organizations**, **Audit log**, **Feedback**. Each paints a skeleton
   table immediately. Watch the column edges as real data commits — no sideways snap.
4. On **Feedback**, click **Review →**. The fallback is a narrow centered column (`max-w-2xl`) with
   two card outlines; confirm it does not start full-width and snap inward.
5. On **Organizations**, click **Manage →**. Three regions skeleton at once (members, AI plan,
   activity), because the page awaits all three together.
6. Watch the terminal throughout: **no `blocking-prerender-dynamic` errors.** That is the fix.

Verified authenticated against a worktree dev server before merging — `/admin/audit` and
`/admin/feedback` both 200, zero errors.

## Open threads

- **`next dev` rewrites a block in `AGENTS.md`** (its generated `<!-- END:nextjs-agent-rules -->`
  section, from `next/dist/server/lib/generate-agent-files.js`). Reverted rather than swept into
  this commit, but it reappears on every dev run. Worth deciding once: commit it or ignore it.
- The build cannot see this class of defect at all — markers are identical with and without the
  skeletons. Only a dev run against an authenticated session proves it.

## Next session entry point

Unchanged from the last bump: **brainstorm Spec 2c (agent memory)**, which must consume
`document-budget.ts` and must not run in parallel with any other agent-surface slice. E6 Stripe
remains the other open epic.
