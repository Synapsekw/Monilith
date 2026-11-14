---
type: session
date: 2026-11-14-0715
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[00-north-star]]"
  - "[[2026-11-13-2120-edge-nubs-and-leave-board]]"
  - "[[2026-11-12-2224-visual-refresh-theme-reach]]"
---

# Board Total tinted with the theme colour

## What changed

- **Board Total redesign** (`98b6fbe8`, merge `7fdba62a`, pushed by `finish-task.sh`): the board-level total row is now sticky at the bottom, filled with a 14% brand mix over `bg-surface`, topped by a full-width solid brand rule, and its label and values are stronger. Per-group summary rows got quieter: plain `bg-surface`, muted values.
- `FooterCell.tsx` gained `FooterTone = "default" | "quiet" | "strong"` and a `tone` prop. `SummaryRow.tsx` owns `BOARD_TOTAL_SURFACE` / `BOARD_TOTAL_LABEL` and passes `tone` per variant. Tests added to `FooterCell.test` and `SummaryRow.test`.
- Value classes are joined with a template string, not `cn()`: tailwind-merge does not know the custom `text-cell` size and drops `text-foreground` beside it (same trap already handled in `TimeTrackingCell` and `GroupHeaderRow`).
- Chosen by the owner from a live prototype artifact (option 04 "Quiet groups, tinted total", all nine presets switchable). Browser-checked in Nebula dark, Ocean dark and Ocean light; owner tested it after merge.
- Announced via the feature commit's own trailer (`Changelog: improved | Board totals stand out`); coverage check reports every ship date covered, so no extra announcement.
- Earlier in the same session (already logged in [[2026-11-13-2120-edge-nubs-and-leave-board]]): plan board relocated to the surviving Mission Control artifact after the old permanent URL was deleted.

## Why

The Board Total read like just another group summary and disappeared at the end of long boards. Making it follow the theme colour ties it to the visual refresh's theme reach instead of a hard-coded accent.

## How to test (for the user)

1. Pull `develop`, run `pnpm dev`, open any board with a Numbers column and a summary configured.
2. Scroll a long board: the Board Total row stays pinned at the bottom, tinted with the theme colour, with a solid theme-coloured line across its top.
3. Group summary rows above it look quieter: no grey fill, muted values.
4. Switch Settings → Preferences → Theme between presets and light/dark: the total's tint and label colour follow each preset.

## Open threads

- Ships with the next `develop → main` promotion, bundled with the edge nubs, Leave board and the Mono work.
- Two Stop-hook drafts (`_draft-2026-11-13-2124`, `_draft-2026-11-14-0314`) belong to the settings-loading and Mono chat sessions; left in place for their own wrapups. Folded and deleted `_draft-2026-11-13-1854`.

## Next session entry point

Run `/promote` when the parallel sessions are ready to bundle.
