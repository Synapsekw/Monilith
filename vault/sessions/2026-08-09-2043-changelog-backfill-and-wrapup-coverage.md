---
type: session
date: 2026-08-09-2043
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-07-31-gotcha-64-changelog-drift-check-cannot-see-a-missing-trailer]]"
  - "[[2026-07-31-1559-changelog-backfill-updates-page]]"
---

# /updates backfilled again, and the coverage question moved into /wrapup

## What changed

- **Backfilled 25 `Changelog:` entries covering 2026-08-01 → 08-09** — the whole gap since the
  last trailer (2026-07-27), spanning **10 promotions** (#79 → #91). Seven announcement commits,
  one per ship date, author-date pinned, then `chore(changelog): regenerate generated.ts`
  (`0aff3356`). `/updates` goes 50 → **75** entries.
- Entries by date: personal agents + landing rebuild (08-01); run history, pricing page, open
  signup (08-02); the Keystone wash (08-03); board dock, AI move verb, live-rendering writes
  (08-04); offline boards, long-text editor, macOS app, connector 7→22, My Time save fix (08-06);
  realtime invitations, MCP attachments (08-07); file preview viewer, file icons, desktop update
  path (08-09). **Omitted on purpose:** infra and invisible hardening — the dev service-worker
  fix, `finish-task.sh` repairs, the mission-control redesign, RLS/grant lockdowns.
- **`/wrapup` now asks the coverage question** (`7ecc24e7`). New step 6 in
  `.claude/commands/wrapup.md` (announce/skip criteria, the backdated-empty-commit recipe, two
  guardrails), and a `CHANGELOG COVERAGE` section in `scripts/wrapup-context.sh` so step 1 stays
  one boot call. Both project-local — other repos' `/wrapup` is untouched.
- **The check compares ship dates, not commits.** An announcement legitimately rides a backdated
  empty commit, so a feature commit's own missing trailer proves nothing — a per-commit check
  would flag every backfilled feature forever. It reports dates in the last 14 days carrying
  `feat`/`fix` work but zero `/updates` entries. First `origin/main..HEAD` attempt was useless:
  the squash-plus-heal history makes that range 2508 commits
  ([[2026-08-09-gotcha-82-squash-plus-ours-heal-makes-the-main-develop-range-grow-forever]]).
- Gates: typecheck / lint / build / drift-check green, changelog tests 15/15, `/updates` still
  prerendered static, page render-checked against the production build. Pushed to `develop`.

## Why

`/updates` had gone 13 days and 10 promotions without a trailer — the **second** time this exact
gap opened, four weeks after [[2026-07-31-1559-changelog-backfill-updates-page]] backfilled 19
entries for the same reason. Gotcha-64 named the cause (the drift check proves `generated.ts`
matches history, never that history carries the trailers it should) and put the fix at the
promotion seam. A recurrence that fast says one deferred check isn't enough: the wrapup is the
earlier and cheaper seam, because the session still remembers what it built.

## How to test (for the user)

1. Pull `develop`, `pnpm build && pnpm start`, open `/updates`.
2. Expect seven new date headings, **August 9 down to August 1**, above the existing July 27 group.
3. Spot-check **August 6** — eight entries, the densest day.
4. Run `bash scripts/wrapup-context.sh`; under `CHANGELOG COVERAGE` expect only `2026-07-31`,
   whose two commits are internal.
5. Nothing is public until `develop → main` promotes — `/updates` deploys only from `main`.

## Open threads

- **25 entries are undeployed.** They publish on the next promotion; until then `/updates` in
  production still ends at July 27.
- Gotcha-64's own follow-up is **still open**: `/promote` does not print the trailer-vs-commit
  diff. The wrapup check is an earlier seam, not a replacement for it.
- The coverage window is fixed at 14 days. A gap older than that goes unreported — acceptable
  while wrapups are frequent, wrong if they lapse.
- `2026-07-31` will keep showing as an uncovered ship date until it ages out of the window. Both
  commits there are internal; there is nothing to announce.

## Next session entry point

Promote `develop → main` to publish the 25 entries, or pick up the north-star's Next queue: a git
remote for `monolith-desktop` (16 local-only commits, needs the owner) or the dashboard-widget
`SECURITY DEFINER`/service-client question.
