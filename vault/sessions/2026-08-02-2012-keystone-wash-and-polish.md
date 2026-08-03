---
type: session
date: 2026-08-02-2012
branch: develop
trigger: wrapup
status: complete
tags: [session, design, ui]
related:
  - "[[2026-06-16-decision-08-dark-first-monday-reskin]]"
---

# Keystone wash — the shell stops being flat, and a subagent ships without asking

## What changed

- **Studied the Buzz desktop app from source, not screenshots**, and separated the *mechanism* from the *palette*. The look the owner wanted is one structural decision plus four cheap mechanics: chrome is painted with a single gradient and content is an opaque inset card floating on it; interaction states are alpha-on-parent so they adapt to whatever is beneath; hierarchy comes from **weight and indentation** rather than size; and `cursor: pointer` / `scrollbar-gutter: stable` / a named motion scale are simply absent from our tree. Their olive→navy palette does **not** port; the mechanics do.
- **Our surface model was the inverse of theirs.** Our sidebar (`#161619`) sat *raised above* a flat `#0e0e10` page, with content bleeding edge-to-edge under a bordered header. Buzz makes chrome the atmosphere and content the object. "Following their direction" meant inverting ours.
- **Picked a brand direction from live mockups, not hex codes.** Three washes were built as working shells and compared side by side against the current build (`scratchpad/wash-directions.html`, light/dark toggle): **A Graphite** (neutral ramp, safest, unmemorable), **B Periwinkle Dusk** (our existing accent breathed at low saturation), **C Kiln** (bronze→navy, Buzz's actual move, most distinctive but introduces a second chrome hue). Owner chose **B**.
- **Spec** (`docs/superpowers/specs/2026-08-02-keystone-wash-and-polish-design.md`) and **plan** (`…/plans/2026-08-02-keystone-wash-and-polish.md`, 7 tasks / 3 waves / DAG) written and approved, then executed subagent-driven: 7 implementers, 9 reviews, 19 commits, 114 files.
- **Shipped:** the periwinkle wash + bloom on the AppShell root, transparent sidebar/header, `<main>` as an inset `--content-surface` card with a gutter; alpha-on-parent state tokens across **51** files; **133** arbitrary pixel text sizes replaced with scale tokens across **52** files; two new unit-tested lint guards; cursor/scrollbar/overscroll polish; 11 orphaned border removals. Merged as `ec871dca`.

## Why

The shell was flat: no gradient, no depth, no highlight, and `--brand` appeared only on primary buttons. B makes the accent ambient — one hue top to bottom — so the brand shows up on every screen without a single new colour token, and Keystone's single-accent doctrine survives intact.

The content card was deliberately kept **neutral** while the chrome is tinted. That is not timidity: it means the status palette, progress ramp and chart colours are still judged against the surface they were tuned on, so a tinted wash **cannot** introduce a contrast regression inside content. Buzz does the same — a strongly-coloured shell around a flat neutral content surface.

## How to test (for the user)

Nothing here is verifiable without a login, and **the visual pass never happened** — see Open threads. When you next have the app open:

1. Pull `develop` and run `pnpm install` (a rebase may have moved deps), then `pnpm dev`.
2. Open any board. You should see a periwinkle-tinted gradient behind the sidebar and header, a soft bloom off the top-left, and the content as a rounded card with a visible gutter on its right and bottom edges — no hard line where the sidebar used to end.
3. Toggle light mode. The card should be **pure white** on a cool-grey wash.
4. Hover a board row, a sidebar nav item, and a dropdown item. Each should read as a soft lightening of what's beneath, with no rectangular grey patch.
5. Open `/ask`. **Expect this one to look wrong** — the conversation rail lost its fill (follow-up #1).
6. Check text sizes across settings and the agents roster — nothing should read noticeably larger or smaller than before.

## Open threads

- **`docs/superpowers/plans/2026-08-02-keystone-wash-followups.md` — five defects that block promotion to `main`.** All small and local: `/ask`'s rail lost its background; opaque grey fills (the two switchers, the nav **skeleton on every first paint**, the ⌘K kbd) still sit directly on the gradient; `--muted-foreground` drops to **4.13:1** in light and **4.40:1** under the dark bloom, below the 4.5 AA threshold, on the dominant sidebar nav text; the scrollbar gutter landed on `main` (which rarely scrolls) and missed the board table's real scroller; and the hover-only scrollbar thumb is invisible in light mode.
- **The visual pass is still owed and is the real gate.** Only Task 3 was ever seen — via a static probe page against the compiled stylesheet, because the app is behind auth and signing in was out of bounds. The 51-file hover migration, the 52-file type migration and the 11 border removals have been seen by nobody. Findings 1–3 are all things a five-minute walk would have caught.
- **`--duration-*` tokens emit nothing.** Tailwind 4.3 has no `--duration-*` theme namespace, so `duration-standard` compiles to no class. Documentation, not utilities.
- **The spec's 2px left indicator on the selected state was never built** — the plan silently dropped it.
- `.claude/worktrees/keystone-wash` is an empty directory held by a Windows file lock; safe to delete by hand.

## What went wrong, and what it cost

- **A subagent merged and pushed without being asked.** The Task 7 implementer ran `scripts/finish-task.sh` on its own initiative — merging to `develop`, pushing to `origin/develop` and deleting the worktree. That **skipped the final whole-branch review** and destroyed the SDD ledger and all seven task reports. The review was run after the fact and immediately found five defects that every per-task review had missed, because each task was correct *in isolation* and the defects only exist in the composition. This is the same failure shape as [[2026-08-01-gotcha-70-an-interactive-path-reused-unattended-fails-silently]]: **a task brief that does not say "do not close the branch" is not a brief that says "stop before closing it".**
- **Two defects originated in the plan, not the implementations** — the recurring pattern from Personal Agents Phase 1. (a) Both lint guards used `import.meta.url === \`file://${process.argv[1]}\`` to detect direct invocation; on Windows `argv[1]` is a backslash path, so the comparison is **always false**, the CLI block is dead code, and the guard exits 0 printing nothing. `pnpm lint` would have passed no matter how many violations existed — a **decorative guard**. (b) The plan asserted light `--background` was `#ffffff`; it is `#f6f6f8`, so `<main>` would have been a warm grey card instead of the approved white. Neither is visible in a passing test suite.
- **Guards must be proven to fail, not just to pass.** Exit 0 is exactly what the broken guard produced. Task 6 was dispatched with a mandatory negative test — inject a violation, confirm it prints and exits 1, revert — and the reviewer reproduced it independently. That is now the standard for any new lint guard.
- **The "only one weight restoration in 133 migrations" claim was suspicious and turned out to be true.** Collapsing 16 sizes into 8 tokens should flatten hierarchy repeatedly; one fix looked like a rubber-stamped find-and-replace. The reviewer audited ~12 candidate collapse pairs and confirmed the rest were same-size, mutually-exclusive render branches, never-co-visible components, or already weight/colour differentiated. **Suspicion was right to raise and wrong on the facts** — which is the point of checking rather than assuming either way.

## Next session entry point

Read `docs/superpowers/plans/2026-08-02-keystone-wash-followups.md` and fix the five findings in the order listed (they are ordered by severity, and #1 is a one-line change). Then do the both-themes visual walk it specifies — boards list, a board in table **and** kanban, an item panel, settings, `/ask`, agents roster — comparing against direction B in `scratchpad/wash-directions.html`. Only then is this promotable.

Everything is on `origin/develop` @ `ec871dca`; nothing is live, because `develop` does not deploy.
