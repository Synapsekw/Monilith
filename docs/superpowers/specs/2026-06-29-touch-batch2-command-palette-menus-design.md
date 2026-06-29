# TOUCH Batch 2 — Command Palette (⌘K) + Dropdown/Context Menus iPad Touch Pass — Design Spec

**Date:** 2026-06-29
**Status:** Spec written — awaiting review (not yet implemented)
**Scope owner:** Danijel Jovanovic
**Worktree / branch:** `.claude/worktrees/touch-command-palette` / `task/touch-command-palette`
**Parent spec:** `docs/superpowers/specs/2026-06-26-ipad-touch-optimization-design.md` (Batch 2, surface ⑧: Command palette + menus)
**Relates to ADR:** `vault/decisions/2026-06-28-gotcha-47-coarse-tooltip-suppresses-focus-label.md`

## Goal

Make the rows inside the **command palette (⌘K)** and the shared **dropdown-menu** primitive reach a
**≥44px hit area on a coarse pointer** (Apple HIG minimum), so an iPad user's finger lands reliably
on a single menu/command row. This is the last of the 8 TOUCH Batch-2 surfaces.

The change is **CSS-only, gated entirely behind `pointer-coarse:`** — desktop (fine-pointer) rendering
is byte-for-byte unchanged. It reuses the **exact** established pattern from Batch 1
(`Button`'s `h-8 pointer-coarse:h-11`, `DragHandle`'s `size-5 pointer-coarse:size-11`) — **no new
primitive, hook, or mechanism is invented.**

## Non-goals (out of scope)

- **Touch-sizing the menu/palette _triggers_.** The ⌘K entry point, the user-menu button, the
  theme-toggle button, and every `DropdownMenuTrigger` (BoardItemMenu, DashboardItemMenu,
  ViewSwitcher, ColumnHeader, user-row-actions, …) are **already** `ui/Button size="icon"` (or
  `size="icon-sm"`), which inherited `pointer-coarse:size-11` from the Batch-1 foundation. Trigger
  sizing is **done** and is owned by surface ① (Nav). This surface touches only the rows _inside_ an
  open menu/palette.
- **`context-menu.tsx`, `menubar.tsx`, `select.tsx`.** The footprint note flagged these "to check" —
  **they do not exist in the repo** (verified: `src/components/ui/` contains `command.tsx` and
  `dropdown-menu.tsx` only; no context-menu / menubar / select primitive). There is no native-`<select>`
  custom primitive to touch either. So the menu-primitive footprint is exactly two files.
- **The gotcha-47 visible-label / long-press fallback for THIS surface.** See "gotcha-47 decision"
  below — after reading the actual trigger code, the conclusion is that **no menu or command trigger
  in this surface relies on a tooltip AS its label**, so there is **no gotcha-47 fix owed here**. That
  regression was real but is fully owned and resolved by surface ① (Nav: `sidebar-nav.tsx`,
  `PlatformNav.tsx`, `BoardsNav.tsx`, `DashboardsNav.tsx`, `sidebar.tsx`).
- **Layout reflow / redesign.** No menu widths change, no new breakpoints, no restructure of menu
  composition. Touch sizing is added vertical padding/min-height on rows only.
- **`CommandInput` height, group headings, separators, shortcuts.** These are not tap targets (input
  is sized by `InputGroup h-8`; headings/separators/shortcuts are non-interactive). Untouched.
- **Playwright iPad E2E.** Deferred with the phone follow-up per the parent spec. Vitest component
  tests are mandatory here.
- **The other Batch-2 surfaces** (Nav, Table, Kanban, Gantt, Calendar, Dashboard, Item Panel) — but
  note the **shared-file caveat** below: `dropdown-menu.tsx` is consumed by ~14 files, so this
  primitive edit has a wide regression surface even though no other in-flight worktree edits the
  primitive itself.

## gotcha-47 decision (the required call)

**Decision: gotcha-47 does NOT apply to this surface. No visible-label / long-press fallback is
owed here.** Rationale, code-verified:

- gotcha-47 is specifically about icon-only controls **whose only visible label is a `<Tooltip>`** —
  on a coarse pointer `resolveTooltipOpen()` forces the tooltip `open=false`, which (because Radix
  can't tell hover from focus) also kills the keyboard-focus label, leaving the control unlabeled.
- The **command palette** is invoked purely by the global ⌘K key handler toggling a Zustand flag
  (`useUIStore.toggleCommand`); there is **no `setCommandOpen(true)` call anywhere outside the palette
  itself** (verified by grep). Its in-shell entry point is owned by surface ① and is already a
  labeled, touch-sized control. The palette has **no icon-only tooltip-labeled trigger** of its own.
  Inside the open palette, every `CommandItem` already renders **visible text** ("Dashboards", board
  name, "New board", "Light"…) next to its icon — it is never icon-only, so there is nothing for a
  tooltip to substitute for.
- Every **`DropdownMenuTrigger`** in the codebase carries a real **`aria-label` directly on the
  trigger `Button`** and is **never wrapped in a `<Tooltip>`** (verified across BoardItemMenu,
  user-menu, ColumnHeader, ViewSwitcher, DashboardItemMenu, user-row-actions). They do not rely on
  tooltip-as-label. (Some triggers also show a visible chevron/icon; their accessible name is the
  `aria-label`, which AT reads on any pointer.) Inside an open dropdown, every `DropdownMenuItem`
  renders visible text.
- The only files that use a tooltip AS an icon-only label (`sidebar.tsx`, `sidebar-nav.tsx`,
  `PlatformNav.tsx`, `BoardsNav.tsx`, `DashboardsNav.tsx`, `presence/PresenceAvatarStack.tsx`) are
  **not in this surface** — they are nav / board-canvas, owned by surfaces ① and the board passes.

So this surface's only job is **row height**. The gotcha-47 paragraph in `tooltip-open.ts`'s JSDoc
("essential info should live in an always-visible label on touch … to be addressed in the Batch-2
surface work") is satisfied for menus/palette by the fact that their rows are **already text-labeled**;
the owed fix lands in the Nav surface, not here. We make this reasoning explicit so a reviewer doesn't
expect a label change in this PR.

## Current state (code-verified in the `touch-command-palette` worktree)

Two in-scope primitive files; one consumer needs no change (inherits the primitive). Size: **S**.

| File                                  | Interactive row(s) & current height                                                                                                                                               | Change                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/components/ui/command.tsx`       | `CommandItem` — `px-2 py-1.5` (~28–30px row); the one tap target inside the palette                                                                                               | add `pointer-coarse:py-2.5 pointer-coarse:min-h-11`                                            |
| `src/components/ui/dropdown-menu.tsx` | `DropdownMenuItem` (`px-1.5 py-1`), `DropdownMenuCheckboxItem` (`py-1 pr-8 pl-1.5`), `DropdownMenuRadioItem` (same), `DropdownMenuSubTrigger` (`px-1.5 py-1`) — all ~20–24px rows | add `pointer-coarse:py-2.5 pointer-coarse:min-h-11` to each of the four interactive item types |
| `src/components/command-palette.tsx`  | Consumer — uses `CommandItem`; rows inherit the primitive change                                                                                                                  | **no change** (inherits)                                                                       |

Non-interactive parts confirmed left alone: `CommandInput` (sized by `InputGroup h-8!`),
`CommandGroup`/group-heading, `CommandSeparator`, `CommandShortcut`, `DropdownMenuLabel`,
`DropdownMenuSeparator`, `DropdownMenuShortcut`, `DropdownMenuContent`/`SubContent` (containers).

**Shared primitives ADOPTED read-only (not modified):**

- `src/lib/hooks/use-coarse-pointer.ts` — `useCoarsePointer()`. **Not even imported here**: the row
  sizing is a pure Tailwind `pointer-coarse:` utility (the CSS media variant), not a JS branch. This
  matches Button/DragHandle, which also size via the class variant, not the hook.
- `src/components/ui/tooltip.tsx` / `tooltip-open.ts` — relevant only to the gotcha-47 reasoning
  above; **no edit**.

**Existing tests:** `command.tsx` and `dropdown-menu.tsx` have **no** co-located unit test today
(`command.test.*` / `dropdown-menu.test.*` absent). The consumer `command-palette.test.tsx` exists and
must stay green. The established coarse-pointer **class-assertion** test pattern to mirror is
`src/components/ui/button.touch.test.tsx` (assert the `pointer-coarse:*` token is present in the
rendered `className`; the media query itself only resolves in a real browser, so we assert the class,
not computed pixels).

## Design direction (pulse-ui + a11y)

- **Chrome stays monochrome; no color earned.** Menus and the palette are pure chrome — this is a
  density/ergonomics pass, nothing visual changes on desktop and no status/brand color is introduced.
- **The exact Batch-1 pattern, reused verbatim.** Each interactive row gains
  `pointer-coarse:min-h-11` (44px floor) plus a coarse-pointer vertical-padding bump
  (`pointer-coarse:py-2.5`) so the text/icon sits comfortably centered in the taller row rather than
  hugging the top. `min-h-11` is the load-bearing token (guarantees ≥44px even for a single short
  label); the `py` bump is for visual balance. Horizontal padding, gap, icon size, radius, and the
  selected/focus background are **unchanged** — no reflow.
- **Why `min-h` not `h`:** menu rows can wrap (long board names, a 2-line item) — a fixed `h-11`
  would clip; `min-h-11` floors the target while letting genuinely tall rows grow. (Button uses fixed
  `h-11` because its content is single-line; rows differ, so `min-h` is the correct analogue.)
- **`items-center` is already present** on all four row types and on `CommandItem`, so the taller box
  keeps icon + label vertically centered with no extra rule.
- **AA / a11y:** unchanged. Rows already carry visible text + `data-selected`/`focus` styling and
  (for the triggers) `aria-label`. No label is removed; keyboard focus ring and `data-disabled`
  handling are untouched. Larger targets strictly improve touch a11y.
- **Generous spacing (parent-spec ⑧ wording):** the `min-h-11` + `py-2.5` gives the "generous
  spacing" the parent spec asks for between adjacent rows on touch, without changing the menu's
  `p-1` container padding.

## Data-fetching & performance budget (working-agreement #5)

This surface has **no data-fetching dimension** — it is a static CSS class addition to two presentational
primitives. Stated explicitly per the rule:

- **(a) First paint vs. interaction:** No views/tabs/filters/sorts are added or changed. The palette is
  already lazy (rendered behind `<Suspense fallback={null}>`, hidden until ⌘K) and its data
  (`listMyBoardsCached` / `listDashboardsCached` / `listWorkspacesCached`) is **unchanged**. Opening a
  menu/palette and tapping a row triggers **zero new server round-trips** beyond what happens today.
- **(b) Does any interaction change server data?** No. Row sizing is presentation only. The existing
  `onSelect` handlers (router.push / Zustand flag toggles / `setTheme`) are untouched; we add no
  mutation and no revalidation.
- **(c) Bounded/indexed reads:** No reads added or changed. (The palette's board/dashboard lists are
  the same bounded cached reads as today; not in scope.)

Net: first-paint and per-interaction server cost is **identical to today**. The only delta is a few
extra characters in two `className` strings → negligible CSS.

## Testing (working-agreement #4 — mandatory, written & executed)

TDD, mirroring `button.touch.test.tsx` (assert the `pointer-coarse:*` class token on the rendered
element; the media query resolves only in a real browser). Two **new** co-located test files; the
existing consumer test stays green.

**New: `src/components/ui/command.touch.test.tsx`**

- Render a `Command` → `CommandList` → `CommandItem` and assert the item's `className` **contains
  `pointer-coarse:min-h-11`** (the 44px floor) and `pointer-coarse:py-2.5`.
- Assert desktop sizing is **unchanged**: the item still contains `py-1.5` (the fine-pointer padding
  is retained, not replaced).

**New: `src/components/ui/dropdown-menu.touch.test.tsx`**

- For each of `DropdownMenuItem`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioItem`,
  `DropdownMenuSubTrigger`: render it (inside the minimal Radix wrappers it requires — Root/Portal or
  open `DropdownMenu`/`DropdownMenuContent`, RadioGroup for the radio item, Sub for the sub-trigger)
  and assert the rendered row's `className` **contains `pointer-coarse:min-h-11`** and
  `pointer-coarse:py-2.5`.
- Assert desktop sizing is **unchanged**: each still contains its original `py-1`.
- For the checkbox/radio items, assert the indicator markup (`data-slot=…-indicator`) still renders
  (no regression to the absolutely-positioned check).

**Regression gate (existing):** `src/components/command-palette.test.tsx` (renders one item per
board/dashboard, navigates on select, sets create flags) must stay green — proves the consumer still
works through the resized primitive.

**Gates per task & at finish:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass.

**Deferred:** Playwright iPad `device`-profile real-touch E2E (with the phone follow-up).

## Cross-cutting risk: `dropdown-menu.tsx` is a widely-shared primitive (call-out)

`dropdown-menu.tsx` is consumed by **~14 files** (verified): `theme-toggle.tsx`, `shell/user-menu.tsx`,
`workspaces/WorkspaceNavItem.tsx`, `feedback/AdminFeedbackDetail.tsx`, `admin/user-row-actions.tsx`,
`dashboards/DashboardsNav.tsx`, `dashboards/DashboardWidget.tsx`, `dashboards/DashboardItemMenu.tsx`,
`boards/BoardItemMenu.tsx`, `boards/ColumnHeader.tsx`, `boards/ViewSwitcher.tsx`, `boards/GanttBoard.tsx`,
`boards/FooterCell.tsx`, `boards/ExportMenu.tsx`, `boards/AddColumnMenu.tsx`, `boards/BoardTable.tsx`.
**Every dropdown menu in the app changes its coarse-pointer row height at once.**

Regression-surface implications, and why the risk is contained:

- **Fine-pointer (desktop) is provably unaffected.** The change is _additive_ and _gated_: existing
  classes stay, we only append `pointer-coarse:*` utilities. The desktop-unchanged assertions in the
  new tests are the guard. So none of the 14 consumers' desktop appearance can move.
- **Coarse-pointer effect is uniform and intended:** every menu's rows get taller on touch — that's
  the goal, applied consistently, not a per-consumer tweak. No consumer overrides `py`/`min-h` on its
  items today (they pass content, not row-height classes), so there's no class-collision/override to
  reconcile.
- **No structural/API change** to the primitive — same exports, same props, same DOM. So no consumer
  needs editing and the blast radius is style-only.
- **Parallel-worktree note (working-agreement #1):** a sibling worktree `task/touch-dashboard-canvas`
  edits the dashboard's _use_ of menus but, per its scope, **not this primitive file** — so there is
  **no shared mutable file** between the two worktrees and no merge contention on `dropdown-menu.tsx`.
  The risk is purely "one shared file's coarse behavior changes for everyone," handled by the uniform
  gated change + the desktop-unchanged tests above. Should that worktree land first, a `finish-task.sh`
  auto-rebase will integrate cleanly (different files).
- **Manual smoke after merge** (below) spot-checks 2–3 representative consumers on touch to confirm the
  uniform change looks right in real menus (a long menu, a checkbox menu, a sub-menu).

## Execution DAG (working-agreement #6)

Per-task `Interfaces` (Consumes / Produces):

- **T1 — Touch-size the command palette row: `command.tsx`.**
  Consumes: nothing (pure Tailwind variant; no hook import). Produces: `CommandItem` with
  `pointer-coarse:min-h-11 pointer-coarse:py-2.5`; new `command.touch.test.tsx`.
  Files: `src/components/ui/command.tsx`, `src/components/ui/command.touch.test.tsx`.

- **T2 — Touch-size the dropdown-menu rows: `dropdown-menu.tsx`.**
  Consumes: nothing (pure Tailwind variant). Produces: `DropdownMenuItem` / `CheckboxItem` /
  `RadioItem` / `SubTrigger` each with `pointer-coarse:min-h-11 pointer-coarse:py-2.5`; new
  `dropdown-menu.touch.test.tsx`.
  Files: `src/components/ui/dropdown-menu.tsx`, `src/components/ui/dropdown-menu.touch.test.tsx`.

Dependency graph: **T1 and T2 are mutually independent** — disjoint files, no shared mutable state,
both are pure CSS-class additions consuming nothing.

```
Batch (single parallel wave, no unmet dependencies):
  ┌── T1  command.tsx        (+ command.touch.test.tsx)
  └── T2  dropdown-menu.tsx  (+ dropdown-menu.touch.test.tsx)
            │
            └─> integrate on task/touch-command-palette → gates → finish-task → develop
```

- **Parallel batch:** T1 + T2 in one wave. Given the change is two ~1-line class edits + two small
  test files, this is small enough that a single agent doing both sequentially in this one worktree is
  equally fine — there is no clobber risk (disjoint files) and no wall-clock pressure. If dispatched as
  subagents, use `superpowers:subagent-driven-development` within this worktree (disjoint files, shared
  branch, no nested worktrees needed).
- **Critical path / wall-clock floor:** **T2** (four row types vs. T1's one) — marginally larger; T1
  is a strict subset of T2's effort.
- **Size:** S (~2 edited primitive lines + 2 new small test files; no new files in `src` beyond tests,
  no migrations, no new dependencies, no consumer edits).

## Risks & open questions

- **`py-2.5` vs `py-3` for the coarse padding.** `min-h-11` (44px) is the hard guarantee; the `py`
  value only tunes vertical balance within that box. The footprint note suggested `py-3`; on a `text-sm`
  row inside `min-h-11`, `py-2.5` keeps single-line text centered without forcing rows much past 44px
  (avoiding an over-tall feel on a dense list like the palette's board list). **Open question for the
  reviewer:** confirm `py-2.5` (recommended) vs `py-3`. Either satisfies ≥44px; this is purely
  aesthetic density. (Whichever is chosen, the test asserts that token.)
- **`min-h-11` interaction with the palette's `max-h-72` scroll list.** Taller rows mean fewer rows
  visible before scroll on touch — acceptable and expected (the list is already `overflow-y-auto`).
  No clipping; verify the scroll feels right on device.
- **iPad-with-trackpad must read as a _fine_ pointer** (stays 28/20px rows, desktop affordance).
  `pointer: coarse` media correctly excludes a trackpad, so the gating handles this for free — same as
  every other Batch-1/2 surface. Verify on a Magic-Keyboard iPad.
- **Confirm no consumer passes a conflicting `py`/`min-h` to a menu item** that Tailwind's source order
  would let win over `pointer-coarse:*`. Grep at build time found none (consumers pass content/`variant`,
  not row-height classes); re-confirm during implementation as a cheap guard.

## How to test (manual acceptance, after merge)

Not user-observable on desktop (intentionally); provide a desktop-regression check plus a touch check.

1. Pull `develop`. On **desktop** (fine pointer): press **⌘K** → the command palette opens; rows are
   the same compact height as before (no change). Open any board's **⋯ menu** (BoardItemMenu) and the
   **user menu** (top-right avatar) → menu rows are the same height as before. (Desktop unchanged.)
2. On an **iPad** (touch, no trackpad) — or emulate a coarse pointer in dev tools (`pointer: coarse`):
   press ⌘K (or the header search entry point) → each palette row (Dashboards, each board, New board,
   Light/Dark/System) is now **comfortably tappable (≥44px tall)** with generous spacing; a finger
   lands on exactly one row.
3. On the same touch device, open a few **dropdown menus** — a board's ⋯ menu, the user menu, the
   theme toggle, a board **view switcher**, and a menu with a **checkbox/radio** item and a **sub-menu**
   (e.g. export/column menus) → every row, including checkbox/radio rows and the "more" sub-trigger,
   is ≥44px and easy to tap; checkmarks/indicators still render correctly.
4. With an iPad **hardware keyboard**, open a menu and arrow through it → focus highlight and selection
   behave exactly as before (only the row is taller). No label or focus regression.

```

```
