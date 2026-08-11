---
type: session
date: 2026-08-10-2025
branch: develop
trigger: wrapup
status: complete
tags: [session, vault, board, docs]
related:
  [
    "[[2026-08-09-2323-desktop-remote-and-release-ci]]",
    "[[2026-08-10-1659-test-account-purge-and-e2e-guard]]",
  ]
---

# The board's 87% was right; four other fields were not

A short docs session. The owner asked whether the mission-control board was updated, since it
"still shows 87%" against the 90% quoted for Platform & craft.

## What changed

- **Answered the premise first: 87% is correct and could not have moved.** It is `stand.percent`
  — 13 of 15 roadmap tracks, the two open ones being 6 Depth (88%) and 10 AI (83%). The desktop
  shell is not one of the 15. The 90% it was being compared against is the **Platform & craft
  pillar**, a different denominator on a different row.
- **The staleness was real but elsewhere** (`1cb8dd63`). The board was stamped 22:10 while
  [[2026-08-09-2323-desktop-remote-and-release-ci]] wrapped at 23:23, so four fields contradicted
  reality: Platform & craft's "still open" line still claimed the repo had no remote (90% → 93%);
  `next[]` still listed "Give monolith-desktop a git remote" as a to-do; the amber risk "The
  desktop shell exists on one disk" was resolved; and `ship.develop` was three commits behind.
- **Replaced the retired risk rather than deleting it** — "Nothing in the desktop signing path has
  ever run signed". The release CI is verified only in its unsigned mode, and a pipeline that
  looks finished is exactly what should not imply that gap away.
- **`ship.develop`'s note now reads "no code undeployed"**, not "nothing undeployed": develop was
  ahead of main, and the tree diff proved those commits were vault docs.
- **Bumped the north-star's `last-updated`**, which the previous session edited the body of and
  failed to stamp. `/board` derives its timestamp from that field, so leaving it would have
  re-published the board under the wrong session.
- **Deliberately did not touch §3 "Now"** — it had already been overwritten at 16:59 by the
  concurrent test-account session with a fresher snapshot. Nothing here belongs in it.
- **No `/updates` entry.** Nothing user-visible shipped; the board is an internal artifact.

## Why

The board is a derived view whose only value is being trusted, so a field that contradicts the
repo is worse than a missing one. The 87/90 confusion was not a defect — but chasing it surfaced
four fields that genuinely were.

## How to test (for the user)

No user-facing behavior to test — the board is an internal artifact, not a product surface. To see
the refresh: https://claude.ai/code/artifact/eb984761-bee4-4d1a-b6ba-30c6bc05119c

## Open threads

- **The north-star's `Branch:` bullet has become a changelog.** It leads with `main @ 65f4a5d1` /
  PR #91, states the current truth mid-paragraph, then accumulates five prior PRs, and its
  `develop` pointer and ledger count are both stale. §3 is meant to be a snapshot, not a log.
  Left alone here — rewriting it is its own task and would fight a live session.
- **The board's `session` field now points at 2026-08-10-1659, not this note.** Deliberate: a
  docs-only session is a worse headline than the test-account purge it would displace.

## Next session entry point

Unchanged by this session — the north-star's `Next` bullet stands. The dashboard-widget
`SECURITY DEFINER` question is still the one item that may be affecting users today.
