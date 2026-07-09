"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { allowedAggregations } from "@/lib/boards/aggregation";
import { FooterCell } from "@/components/boards/FooterCell";
import { mirrorTargetColumnFor, mirrorFooterValues } from "@/lib/boards/mirror";
import { cellKey, timeEntriesForCell } from "@/lib/boards/cache";
import { trackedSeconds } from "@/lib/boards/time-format";
import type { Column } from "@/lib/boards/queries";
import type { BoardCache, CacheCellValue } from "@/lib/boards/cache";
import type {
  AggregationId,
  ColumnKind,
  ColumnOption,
} from "@/lib/validations/boards";

// Right-edge shadow for the frozen Name column. The `group/scroll` ancestor
// (the scroll container) toggles `data-scrolledx`; the ::after only shows once
// scrolled, so it reads as a floating frozen pane over the data columns.
export const NAME_FREEZE_EDGE =
  "name-freeze-edge after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-4 after:translate-x-full after:bg-gradient-to-r after:from-black/15 after:to-transparent after:opacity-0 after:transition-opacity after:content-[''] group-data-[scrolledx=true]/scroll:after:opacity-100";

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
          | { estimateSeconds?: number }
          | undefined
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
  /** Group color for the 3px inset bar (group variant only). */
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
      className={cn(
        "bg-surface-muted grid border-t",
        variant === "board" && "sticky bottom-0 z-[15]",
        variant === "group" && "border-b",
      )}
      style={{ gridTemplateColumns: template }}
    >
      <div
        className={cn(
          "bg-surface-muted text-kicker sticky left-0 z-10 flex items-center px-4 py-1.5 font-mono text-[10px] tracking-wide uppercase",
          NAME_FREEZE_EDGE,
        )}
        style={{
          width: nameWidth,
          ...(groupColor ? { boxShadow: `inset 3px 0 0 0 ${groupColor}` } : {}),
        }}
      >
        {label}
      </div>
      {perColumn.map(({ col, meta, values, current }) => (
        <div key={col.id} className="flex min-w-0 items-center border-l py-1.5">
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
