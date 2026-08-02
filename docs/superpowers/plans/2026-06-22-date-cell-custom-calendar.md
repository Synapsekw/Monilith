# Date cell — custom calendar (Safari fix) — Implementation Plan

**Date:** 2026-06-22
**Spec:** `docs/superpowers/specs/2026-06-22-date-cell-custom-calendar-design.md`
**Branch:** `task/date-cell-calendar`

TDD throughout: write the failing test first, then the implementation. A task is done only when its
tests pass.

## Execution DAG

```
Task 0 → Task 1 → Task 2 → Task 3
```

Strictly sequential; every batch size 1 (no parallel fan-out — editor depends on the primitive, the
primitive depends on the dependency). Critical path = the full chain.

---

## Task 0 — Add the dependency

**Produces:** `react-day-picker` v9 in `package.json` + lockfile.
**Consumes:** nothing.

- `pnpm add react-day-picker` (v9; brings `date-fns` transitively — no direct app import).
- Verify the install: `pnpm typecheck` still clean.
- Confirm v9 API against current react-day-picker / shadcn docs and the repo's React 19.2 / Tailwind v4
  setup (single-date `mode="single"`, `classNames` theming, custom chevron components).

**Tests:** none (dependency only). Gate: `pnpm typecheck`.

---

## Task 1 — Calendar primitive

**Produces:** `src/components/ui/calendar.tsx` — a shadcn-style Calendar wrapping react-day-picker v9,
themed with Monolith tokens (monochrome + indigo accent, dark-first), lucide chevrons.
**Consumes:** Task 0 dependency; `cn` (`@/lib/utils`); lucide-react.

- **Load the `pulse-ui` and `frontend-design` skills first** and follow them — map rdp `classNames` to
  Monolith tokens so it matches the design system (not the default rdp look). Match the existing Popover
  surface styling.
- Single-date `mode="single"`; expose `selected: Date | undefined`, `onSelect`, and month-nav.
- Accessible keyboard grid (rdp built-in) — arrow keys move days, Enter selects, chevrons change month.

**Tests** (`src/components/ui/calendar.test.tsx`):

- renders a month grid;
- clicking a day fires `onSelect` with the right `Date`;
- the selected day has the selected style;
- keyboard navigation moves focus between days;
- prev/next chevrons change the visible month.

Gate after: `pnpm typecheck && pnpm lint && pnpm test`.

---

## Task 2 — Rewrite DateEditor

**Produces:** updated `DateEditor` in `src/components/boards/cells/editors/index.tsx` — Popover trigger
(visible lucide `Calendar` icon + formatted date) + Calendar content; ISO↔local-`Date` conversion;
commit logic with `end` preservation.
**Consumes:** Task 1 `Calendar`; existing `Popover` (`src/components/ui/popover.tsx`); existing
`useCommitKeys`, `onCommit`/`onCancel`/`onClear`; `addDaysISO`/`diffDaysISO` (`src/lib/boards/*`).

Commit semantics (from spec Q1):

- empty/cleared → `(onClear ?? onCancel)()` (delete the cell), as today;
- if `prev.end && prev.end > prev.date` (a real range) → commit
  `{ date: d, end: addDaysISO(d, diffDaysISO(prev.date, prev.end)) }` (duration-shift; never `end < date`);
- otherwise → commit `{ date: d }` (no synthesized `end`).
- Calendar auto-opens + focuses on edit (replaces native `autoFocus`); Escape cancels.
- ISO↔`Date` via split-integer parsing (`YYYY-MM-DD` → `new Date(y, m-1, d)`) to avoid the UTC
  off-by-one; format back to ISO without timezone drift.

**Tests** (rewrite the two native-input date tests in `editors/cells.test.tsx` +
`editors/editors.test.tsx`, and add to `editors/editors.test.tsx`):

- picking a day commits the correct ISO date;
- **`end`-preserve regression:** start of a multi-day range moves → `end` shifts by the same number of
  days (span length preserved, not collapsed to a milestone);
- single-day value commits with **no** synthesized `end`;
- clearing deletes the cell;
- Escape cancels without committing;
- calendar opens on edit;
- ISO boundary date (e.g. month/year edge) round-trips with no off-by-one.

Gate after: `pnpm typecheck && pnpm lint && pnpm test`.

---

## Task 3 — Full gate sweep + merge

**Consumes:** Tasks 0–2.

- Run the full gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- Manual cross-browser check (Safari + Chrome): icon visible, calendar polished + identical, commit
  works, range span preserved.
- `scripts/finish-task.sh` from inside the worktree (rebase onto latest `develop` → gate → merge →
  push → remove worktree/branch).
- Hand the user the numbered "How to test this" walkthrough (from the spec) in the closing message and
  the `/wrapup` note.

**Follow-up (out of scope, noted):** convert the two native `<input type="date">` in
`TimeTrackingCell.tsx` (~lines 310, 406) to the same Calendar primitive for consistency.
