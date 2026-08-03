---
type: session
date: 2026-08-03-1049
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-08-02-2012-keystone-wash-and-polish]]"
  - "[[2026-08-03-gotcha-72-a-global-regex-with-test-makes-a-guard-silently-blind]]"
---

# Keystone wash follow-ups closed — the promotion blocker is gone

## What changed

- **Merged `c8f730d`** — 11 commits, 43 files, +2386/−48. All five wash defects closed:
  `/ask` on the shell surface model, `--chrome-fill` for resting fills (Skeleton gains a `chrome`
  variant, default untouched across ~67 call sites), `--muted-foreground` to AA, 23 real scrollers
  opted into the gutter, `--scrollbar-thumb` in both the webkit block and the Firefox fallback.
- **The findings doc's own AA fix did not reach AA.** Its `#a8a8b0` computes to **4.19:1** at the
  declared 22% bloom peak — the doc's 4.13/4.40 figures were taken mid-ramp, not worst-case. Shipped
  `#5c5c63` / `#b2b2ba` (4.85 / 4.70). `globals.contrast.test.ts` now parses the gradient stops and
  bloom percentage out of the stylesheet and **computes** the ratio rather than asserting a number.
- **Four more defects found beyond the five.** The whole-branch review caught two composition
  failures (a `variant="outline"` button painting an opaque slab on the new gradient in the `/ask`
  rail; `<main>` reserving a dead 10px gutter it can never use). The owner's visual walk caught two
  more: `/ask` had **no header band**, so no wash across the top, and its rail was `w-64 px-4`
  against the shell's `w-60 px-3`. `/ask` also had **no theme control at all**.
- **The new guard was born blind** — a `/g` regex reused with `.test()` drops matches via
  `lastIndex`. Fixed before shipping and written up as
  [[2026-08-03-gotcha-72-a-global-regex-with-test-makes-a-guard-silently-blind]]. The prove-it-fails
  drill was run with real output, not claimed.
- Gates at merge: typecheck clean, lint 0 errors, **4119 tests**, build compiled.

## Why

`develop` had carried the Keystone wash since 2026-08-02 with five known defects and an explicit
"do not promote" gate. Nothing about the wash had been seen by a human — 51 hover-migration files,
52 type-migration files and 11 border removals reviewed by diff only. Closing the five was the
cheap half; **the walk was the point**, and it found two defects no test on the branch could have.

## How to test (for the user)

Already walked and accepted by the owner on a worktree dev server. To re-verify on `develop`:

1. `git pull`, `pnpm install`, `pnpm dev`. Sign in.
2. **`/ask`** — a 56px gradient band across the top above the chat card; wordmark and rail edge sit
   exactly where they do on `/my-work` (flip between the two tabs); theme toggle in that band.
3. **Hard-reload any page**, watch the sidebar for half a second — nav placeholders pulse
   translucent, not as grey rectangles. Same for the org/workspace chips.
4. **Sidebar nav labels, top and bottom** — legible in both themes (were 3.87:1 light / 3.54:1 dark
   against a 4.5:1 floor).
5. **Board table: filter until the scrollbar disappears, then clear it** — columns must not jump
   sideways. Repeat in the item panel and `/my-work`.
6. **Scroll a long table, hover near the right edge** — thumb fades in, is aimable, darkens on
   direct hover. **Chrome, not Firefox** (`scrollbar-gutter` is a no-op with overlay scrollbars).
7. Toggle theme and repeat. Light changed more than dark.

## Open threads

- **Deliberately not fixed, no home yet:** `--kicker` at ≈2.8:1 in light (pre-existing, below AA,
  unrelated to the wash); the `outline` button variant's opaque `bg-background`, which was the root
  cause behind two defects but is an app-wide change; `ReportBuilder.tsx:141` carries the scroll
  attribute but its className lacks `flex-1`, so the guard will not catch its deletion; a 2px
  eyebrow misalignment inside `ConversationRail`.
- `scroll-containers.test.ts:17`'s comment claims the idiom excludes Sheet drawers; three of them
  opted in. Behaviour is right, comment is wrong.
- **A class list is not a layout.** `/ask` copied `AppShell`'s exact `<main>` classes
  (`mr-2 mb-2 ml-1`, no `mt-*`) without the transparent `h-14` header that supplies the top space.
  Worth remembering the next time a surface "mirrors the shell".
- Stale `_draft-2026-07-27-1525.md` deleted along with three contentless stubs from this work.

## Next session entry point

**Promote.** `develop → main` is unblocked for the first time since the wash landed and carries E6
billing batch 1 + the wash + these fixes — run `/promote`. After that the queue is unchanged:
**Report Builder v2 roll-ups + org templates** (critical path; note RLS on `reports` is org-only, so
the action-layer `boardId` guards go vacuous the moment `board_id` goes nullable), the **E6 Stripe
track** (units B, C, E–H — builds and unit-tests offline; only end-to-end verification needs the
Stripe account), and **F17**, which still has no successor spec.
