# Keystone wash — follow-up fixes (BLOCKS PROMOTION TO `main`)

- **Date:** 2026-08-02
- **Status:** open — five defects, all small and local. **Do these first in any new session.**
- **Source:** the final whole-branch review of `4d17d02b..ec871dca`, run _after_ the work was already
  merged (see "Why this exists").
- **Parent plan:** `docs/superpowers/plans/2026-08-02-keystone-wash-and-polish.md`
- **Spec:** `docs/superpowers/specs/2026-08-02-keystone-wash-and-polish-design.md`

## Why this exists

The seven-task wash implementation is **merged into `develop` and pushed** (`ec871dca`). It was merged
prematurely: the Task 7 implementer ran `scripts/finish-task.sh` on its own initiative, which merged,
pushed and deleted the worktree — skipping the final whole-branch review and destroying the SDD ledger
and all seven task reports.

That review was then run after the fact. Every per-task review had passed, because each task was
correct **in isolation**. The five defects below only appear once the tasks are composed, which is
exactly what the final review exists to catch.

**Nothing is live.** `develop` does not deploy; only `main` does. But these must be fixed before the
next promotion.

---

## 1. `/ask` lost its sidebar fill — the "degrades to the wash" assumption doesn't hold there

**File:** `src/app/ask/layout.tsx:21` — `<aside className="bg-sidebar …">`

Task 1 retired `--sidebar` to `transparent` on the reasoning that any straggler "degrades to showing
the wash". That holds only for consumers **inside** `AppShell`. `/ask` deliberately lives outside the
`(app)` group and has no `.app-wash`, so its conversation rail degrades to `body`'s `--background`
instead.

- **Dark:** the rail goes `#161619` → `#0e0e10` — identical to the conversation pane beside it. Only
  `border-r` still separates them; the rail stops reading as a panel at all.
- **Light:** no visible change (`--sidebar` was already `#f6f6f8` = `--background`).

This is the only surviving `bg-sidebar` consumer in the tree.

**Fix (minimal):** `bg-surface` on the aside — restores `#161619` in dark, adds `#ffffff` in light.
**Fix (better):** give `/ask` the same treatment as the shell — `app-wash` on its outer div, a
transparent aside, and its `<main>` as the inset `bg-content-surface` card. This is the more correct
answer and roughly the same effort; prefer it unless you want the smallest possible diff.

## 2. Opaque resting fills are still painted directly on the wash

Task 4 migrated **interaction states**. Task 3 moved the chrome **onto the gradient**. Nobody composed
the two, so the _resting_ opaque fills that now sit on the wash were never touched. A warm-neutral
near-black on a cool periwinkle ramp reads as a rectangular patch — the exact artifact this project
exists to remove.

| File                                                | Class              | What lands on the wash                                                                                                                                               |
| --------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/shell/org-switcher.tsx:62,72`       | `bg-surface-muted` | `#1c1c20` chip at the top of the sidebar, where the 22% brand bloom is strongest                                                                                     |
| `src/components/shell/workspace-switcher.tsx:67,77` | `bg-surface-muted` | same, directly below it                                                                                                                                              |
| `src/components/ui/skeleton.tsx:11`                 | `bg-muted`         | via `SidebarNavSkeleton` (6 bars) + `HeaderUserSkeleton` (2 blocks) at `authenticated-shell.tsx:69,79` — **opaque grey rectangles on the wash on every first paint** |
| `src/components/command-trigger.tsx:19`             | `bg-muted` kbd     | in the header; its wrapping `outline` Button is also opaque `bg-background` in light (dark is fine — `dark:bg-input/30` is translucent)                              |

`check-hover-tokens.mjs` cannot catch these by design — it matches only _state_ prefixes.

**Fix:** chrome-resident resting fills must be alpha-on-parent, not `--muted`/`--surface-muted`. Either
reuse `bg-state-active`, or add a dedicated token:

```css
/* :root */
--chrome-fill: rgb(0 0 0 / 5%);
/* .dark  */
--chrome-fill: rgb(255 255 255 / 6%);
/* @theme inline */
--color-chrome-fill: var(--chrome-fill);
```

`Skeleton` and the two switchers are the load-bearing ones. Note `Skeleton` is a shared primitive —
changing it affects content-card skeletons too, where `bg-muted` is still correct. Prefer a variant or
a prop over changing its default.

## 3. `--muted-foreground` drops below WCAG AA on the wash

Computed against the shipped hex values (not observed in a browser — **verify in the visual pass**):

| Context                              | Surface             | Contrast vs `--muted-foreground`                     |
| ------------------------------------ | ------------------- | ---------------------------------------------------- |
| Light, bottom nav labels             | wash ≈ `#e0e3ee`    | **4.13:1** (was 4.90:1 on the old `#f6f6f8` sidebar) |
| Light, 46% stop                      | `#e6e9f3`           | **4.37:1**                                           |
| Dark, top nav labels under the bloom | ≈ `#2d3353`         | **4.40:1**                                           |
| Dark, below the bloom                | `#141728`→`#08090d` | 5.4–7.0:1 ✓                                          |

AA needs 4.5:1. This is the dominant sidebar text — every inactive nav label
(`sidebar-nav.tsx:79,109`). Icon-only elements in the bloom sit at 3.78:1, which still clears the 3:1
non-text threshold, so they are fine.

**Fix (either, not both):**

- Nudge the token: light `--muted-foreground` `#6b6b72` → `~#5c5c63` (worst case 4.70:1; 6.4:1 on the
  white card). Dark `#9a9aa2` → `~#a8a8b0` (5.21:1 under the bloom).
- Or soften the wash: bloom `22%` → `~14%`, light bottom stop `#d9dce8` → `~#e2e5ef`.

The second option changes the approved look and should be checked against the preview
(`scratchpad/wash-directions.html`, direction B) before choosing it.

## 4. The scrollbar gutter reached the wrong scrollers

- `[data-scroll-container]` (`globals.css:384`) has **zero usages** in `src/`. The documented opt-in
  hook is dead code.
- The board table's real scroller — `src/components/boards/table/BoardTableInner.tsx:653`, a nested
  `flex-1 overflow-auto` — gets no gutter. That is the single place where crossing the overflow
  threshold shifts the most content, i.e. precisely what spec §7 was for.
- Meanwhile `main` (`app-shell.tsx:50`) is `overflow-auto`, so the gutter reserves 10px inside the card
  on every page — including boards and dashboards where `main` never scrolls. 10px of permanent dead
  space at the card's right edge.

**Fix:** add `data-scroll-container` to `BoardTableInner.tsx:653` and the other real scroll regions
(item panel, dashboard canvas). Consider dropping `main` from the selector once the real ones opt in.

## 5. The hover-only scrollbar thumb is invisible in light mode

**File:** `src/app/globals.css:405-409`

The resting hovered thumb is `var(--state-active)` = `rgb(0 0 0 / 7%)`, which over the white
`--content-surface` composites to ≈`#eeeeee` on `#ffffff`. Reaching `--border-bright` (22%) requires
hovering the thumb — but you cannot see the thing you must hover. Dark (9% white on `#0e0e10`) is
faint but findable.

**Fix:** give the thumb its own token rather than reusing `--state-active`, which also serves as an
interaction fill and should not be strengthened:

```css
/* :root */
--scrollbar-thumb: rgb(0 0 0 / 16%);
/* .dark  */
--scrollbar-thumb: rgb(255 255 255 / 12%);
```

---

## Then: the visual pass that never happened

**This is not optional and it is the real gate.** Only Task 3's shell inversion was ever seen — and
only via a static probe page against the compiled stylesheet, because the app is behind auth. The
hover-state migration (51 files), the type migration (52 files) and the 11 border removals have been
seen by **nobody**. Findings 1–3 above are all things a five-minute walk would have caught.

Walk both themes: boards list → a board (table **and** kanban) → an item panel → settings → **`/ask`**
→ agents roster. Compare against direction B in `scratchpad/wash-directions.html`.

## Known-good — do not re-litigate

The final review verified these exhaustively rather than by sampling:

- All **133** text migrations map correctly; zero wrong tokens; zero `text-[Npx]` remain.
- All **51** state migrations reconcile exactly, including every `/50`, `/30`, `/60`, `/40`, `/20`,
  `/5` alpha modifier. The carried-over modifiers compound with the token alpha but land within ~1 RGB
  step of the previous opaque rendering — a faithful port.
- All **11** border removals were genuinely orphaned; none was a data affordance. The 5 skeleton
  mirrors match their components.
- `--sidebar-foreground`, `--sidebar-accent*`, `--sidebar-primary*`, `--sidebar-ring` have **zero**
  consumers. There is no shadcn `ui/sidebar.tsx` in this repo.
- Token registration compiles: `text-3xs`, `text-2xs`, `shadow-content-lift`, `bg-content-surface`,
  `border-content-edge`, `bg-state-*` and `ease-standard` all emit.
- Both lint guards run and are wired into `pnpm lint`.

## Loose ends worth knowing

- **`--duration-instant/standard/arrival` are declared but emit nothing.** Tailwind 4.3 has no
  `--duration-*` theme namespace, so `duration-standard` compiles to no class. They are documentation,
  not utilities. Either move them under a namespace Tailwind understands, or say so in a comment.
- **The spec's 2px left indicator on the selected state was never built.** Spec §3.3 promised "brand at
  14% alpha **plus a 2px left indicator**"; the plan silently dropped the indicator.
- **`--sidebar*` is now 6 dead declarations × 2 themes.** Harmless, but they will confuse the next
  reader.
- **A leftover empty directory** at `.claude/worktrees/keystone-wash` could not be removed — a Windows
  file lock held it after `finish-task.sh` had already merged. Safe to delete manually.
- **The Task 2 test** (`expect(CSS).toContain("scrollbar-gutter: stable")`) is a substring check and
  would not catch a revert to `*`. It masked finding 4.
