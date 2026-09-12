"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { allowedAggregations } from "@/lib/boards/aggregation";
import { FooterCell } from "@/components/boards/FooterCell";
import { Kicker } from "@/components/ui/kicker";
import { mirrorTargetColumnFor, mirrorFooterValues } from "@/lib/boards/mirror";
import { cellKey, timeEntriesForCell } from "@/lib/boards/cache";
import { trackedSeconds } from "@/lib/boards/time-format";
import { ROW_HAIRLINE } from "@/components/boards/table/shared";
import type { Column } from "@/lib/boards/queries";
import type { BoardCache, CacheCellValue } from "@/lib/boards/cache";
import type {
  AggregationId,
  ColumnKind,
  ColumnOption,
} from "@/lib/validations/boards";

// NAME_FREEZE_EDGE and NAME_FREEZE_SHADOW below are DELIBERATELY DUPLICATED
// LITERALS, not one derived from the other at runtime. Tailwind v4 emits a
// utility only when its exact class name appears literally in a file its
// scanner reads — it does not execute this module, so a class built by string
// concatenation/interpolation (e.g. `` `after:${cls}` ``) is invisible to it
// and silently drops out of the compiled CSS. (Provenance: a production build
// was checked and both constants' classes ARE currently emitted, but only
// because the old, pre-refactor literal happens to still exist verbatim in
// `docs/superpowers/plans/2026-06-21-frozen-name-column.md` — Tailwind scans
// docs too. That is an accident, not a guarantee; these two constants must
// each spell out their own classes so the app's OWN source is what keeps them
// alive.) `shared.test.ts`-style drift is instead caught by a test that
// derives one from the other and asserts equivalence — see SummaryRow.test.tsx.

// Right-edge shadow for the frozen Name column, as a REAL element's classes
// (no `after:` prefixes, no `content-['']`). The `group/scroll` ancestor (the
// scroll container) toggles `data-scrolledx`; the shadow only shows once
// scrolled, so it reads as a floating frozen pane over the data columns.
// Table's NameCell spends this directly on a sibling `<span>` — its own
// `::after` is already claimed by the Quiet Grid hover seam.
export const NAME_FREEZE_SHADOW =
  "pointer-events-none absolute inset-y-0 right-0 w-4 translate-x-full bg-gradient-to-r from-black/15 to-transparent opacity-0 transition-opacity group-data-[scrolledx=true]/scroll:opacity-100";

// Right-edge shadow for the frozen Name column, as `::after` pseudo-element
// utilities for hosts that don't need a dedicated node (SummaryRow's own
// header cell, GroupHeaderRow, GroupRollupRow). The `group/scroll` ancestor
// (the scroll container) toggles `data-scrolledx`; the ::after only shows once
// scrolled, so it reads as a floating frozen pane over the data columns.
export const NAME_FREEZE_EDGE =
  "name-freeze-edge after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-4 after:translate-x-full after:bg-gradient-to-r after:from-black/15 after:to-transparent after:opacity-0 after:transition-opacity after:content-[''] group-data-[scrolledx=true]/scroll:after:opacity-100";

// The one vertical rule Quiet Grid keeps: a permanent 1px hairline at the
// Name column's right edge, on every surface whose element spans exactly
// that column (this cell, GroupHeaderRow, GroupRollupRow, NameCell — both
// branches — and AddItemRow's inner sticky element). A REAL `border-r`, not
// another `::after` — NAME_FREEZE_EDGE above already owns `::after` on the
// group header, rollup and summary cells, and NameCell's `::after` is the
// hover seam, so a second `after:` set on any of them would collide.
// `border-border` names the semantic token explicitly (the global `*` rule
// in globals.css already applies it to every element, but spelling it out
// here means this rule can't silently drift if that reset ever changes) —
// never a raw color. If a hover state ever needs to touch this rule, swap to
// a brighter border token (e.g. `border-border-bright`); do not thicken it.
// These elements are `border-box` (Tailwind's preflight sets `box-sizing:
// border-box` on `*`), so the 1px comes out of the Name column's own fixed
// width rather than shifting the grid.
export const NAME_FREEZE_RULE = "border-r border-border";

/** True when at least one column has a user-assigned footer aggregation. */
export function hasAssignedSummary(columns: readonly Column[]): boolean {
  return columns.some(
    (c) =>
      (c.settings as { summary_aggregation?: AggregationId } | null)
        ?.summary_aggregation != null,
  );
}

/** The kind to aggregate a column AS (a mirror delegates to its target column's
 *  kind) plus the options used for distribution rendering and the ISO 4217
 *  code used for currency formatting — options and currency always read from
 *  the SAME settings source (a mirrored currency column formats correctly). */
function footerColumnMeta(
  col: Column,
  cache: BoardCache,
): {
  aggregateKind: ColumnKind;
  options?: ColumnOption[];
  currency?: string;
  dirhamSign?: boolean;
} {
  const settingsSource =
    col.kind === "mirror"
      ? (mirrorTargetColumnFor(cache, col)?.settings ?? null)
      : col.settings;
  const aggregateKind =
    col.kind === "mirror"
      ? (mirrorTargetColumnFor(cache, col)?.kind ?? "mirror")
      : col.kind;
  return {
    aggregateKind,
    options: (settingsSource as { options?: ColumnOption[] } | null)?.options,
    currency: (settingsSource as { currency?: string } | null)?.currency,
    dirhamSign: (settingsSource as { dirham_sign?: boolean } | null)
      ?.dirham_sign,
  };
}

/** The per-item values for a column's summary cell, shaped for `aggregate`. */
function footerColumnValues(
  col: Column,
  itemIds: readonly string[],
  cellMap: Map<string, CacheCellValue["value"]>,
  cache: BoardCache,
  nowMs: number,
): unknown[] {
  if (col.kind === "mirror") return mirrorFooterValues(cache, col, itemIds);
  if (col.kind === "time_tracking") {
    return itemIds.map((id) => ({
      trackedSecs: trackedSeconds(timeEntriesForCell(cache, id, col.id), nowMs),
      estimateSecs: (
        cellMap.get(cellKey(id, col.id)) as
          { estimateSeconds?: number } | undefined
      )?.estimateSeconds,
    }));
  }
  return itemIds.map((id) => cellMap.get(cellKey(id, col.id)) ?? null);
}

export type SummaryRowProps = {
  /** Sticky board footer vs. in-flow per-group row. */
  variant: "board" | "group";
  /** Frozen Name-track label. Default "Summary". */
  label?: string;
  /** Group color for the group-identity dot (group variant only). */
  groupColor?: string;
  /** data-testid for the row root. */
  testId: string;
  columns: Column[];
  itemIds: string[];
  cellMap: Map<string, CacheCellValue["value"]>;
  cache: BoardCache;
  template: string;
  nameWidth: number;
  canEdit: boolean;
  nowMs: number;
  onChange: (col: Column, agg: AggregationId | null) => void;
};

/**
 * A column-summary row aligned to the board grid (6d-3, generalized): every
 * column shows one aggregate over the given `itemIds` — the whole board's
 * top-level rows for the sticky footer (`variant="board"`) or one group's
 * top-level rows for the per-group row (`variant="group"`). Aggregation math
 * is pure + client-side (0 round-trips); only the per-column choice persists
 * (`columns.settings.summary_aggregation`, board-global). Reuses the same
 * `template` + Name-freeze tokens as the header/data rows so it stays aligned
 * under horizontal scroll + resize.
 */
export function SummaryRow({
  variant,
  label = "Summary",
  groupColor,
  testId,
  columns,
  itemIds,
  cellMap,
  cache,
  template,
  nameWidth,
  canEdit,
  nowMs,
  onChange,
}: SummaryRowProps) {
  // One memo for all per-column inputs so cell edits recompute cheaply.
  const perColumn = useMemo(
    () =>
      columns.map((col) => ({
        col,
        meta: footerColumnMeta(col, cache),
        values: footerColumnValues(col, itemIds, cellMap, cache, nowMs),
        current: (
          col.settings as { summary_aggregation?: AggregationId } | null
        )?.summary_aggregation,
      })),
    [columns, itemIds, cellMap, cache, nowMs],
  );

  return (
    <div
      data-testid={testId}
      // ROW_HAIRLINE FIRST: it opens with `relative`, in the same
      // tailwind-merge conflict group as the board variant's `sticky` below —
      // listing it first lets `sticky` win the position instead of silently
      // losing to `relative` (same trap as AddItemRow/AddSubitemRow; `sticky`
      // still gives the group-variant's `after:` bottom hairline a valid
      // positioning context on its own via `relative`).
      //
      // Both this top hairline and the group variant's bottom one are inset
      // to `left-4`, matching every other separator in the table (row,
      // subitem, add-item/add-subitem rows) — a full-bleed `border-t`/
      // `border-b` here used to redraw the cage the rest of Quiet Grid
      // removed, and read as a heavier, differently-colored line than the
      // dim inset hairlines around it (confirmed in Chromium screenshots).
      // The bottom rule is a hand-written `after:` literal, not derived from
      // ROW_HAIRLINE, for the same reason NAME_FREEZE_SHADOW/NAME_FREEZE_EDGE
      // above are duplicated rather than composed: Tailwind only emits a
      // class whose exact text appears literally in scanned source.
      className={cn(
        ROW_HAIRLINE,
        "bg-surface-muted grid",
        variant === "board" && "sticky bottom-0 z-[15]",
        variant === "group" &&
          "after:bg-border after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-4 after:h-px after:opacity-70 after:content-['']",
      )}
      style={{ gridTemplateColumns: template }}
    >
      <div
        className={cn(
          "bg-surface-muted sticky left-0 z-10 flex items-center gap-2 px-4 py-1.5",
          NAME_FREEZE_EDGE,
          NAME_FREEZE_RULE,
        )}
        style={{ width: nameWidth }}
      >
        {groupColor && (
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: groupColor }}
          />
        )}
        <Kicker size="xs">{label}</Kicker>
      </div>
      {perColumn.map(({ col, meta, values, current }) => (
        <div key={col.id} className="flex min-w-0 items-center py-1.5">
          <FooterCell
            aggregateKind={meta.aggregateKind}
            values={values}
            options={meta.options}
            currency={meta.currency}
            dirhamSign={meta.dirhamSign}
            current={current}
            allowed={allowedAggregations(meta.aggregateKind)}
            canEdit={canEdit}
            onChange={(agg) => onChange(col, agg)}
          />
        </div>
      ))}
      {/* Two filler cells to keep the grid aligned with the created-by/created-at tracks */}
      <div aria-hidden />
      <div aria-hidden />
      <div />
    </div>
  );
}
