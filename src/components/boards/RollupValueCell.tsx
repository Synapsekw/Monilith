import {
  cellKey,
  relationLinksForCell,
  timeEntriesForCell,
  type BoardCache,
  type CacheCellValue,
} from "@/lib/boards/cache";
import type { Column, Item } from "@/lib/boards/queries";
import {
  isTextualKind,
  rollupCell,
  rollupTimeTracking,
  textualRollup,
} from "@/lib/boards/rollup";
import { relationRollup } from "@/lib/boards/relations";
import { RollupCell } from "@/components/boards/RollupCell";
import { CellRenderer } from "@/components/boards/cells";
import type { ColumnOption } from "@/lib/validations/boards";

const CELL_CLASS = "flex h-full items-center truncate border-l px-3";

/**
 * One column's read-only rollup over a set of items — the cell shown for a
 * collapsed parent's subitems and for a collapsed group's items. Mirrors the
 * per-item-kind logic so a collapsed parent and a collapsed group read
 * identically: numeric/percent/rating/etc. via {@link rollupCell}, time
 * tracking via {@link rollupTimeTracking}, relations via {@link relationRollup},
 * and mirror columns blank.
 *
 * `nowMs` is the snapshot time for any running time-tracking entry (passed in so
 * the caller controls react-hooks purity); unused for other kinds.
 *
 * `ownValue` is the collapsed PARENT's own cell value for this column. It is
 * only supplied when this rollup renders for a parent item (not a whole group),
 * and drives the free-text fallback: text/link/email/phone have no arithmetic
 * aggregate, so instead of a blank cell we show the parent's own value, or a
 * count of subitems that carry one. In a group context it is omitted and those
 * kinds stay blank (as before).
 */
export function RollupValueCell({
  col,
  items,
  cellMap,
  cache,
  nowMs,
  ownValue,
}: {
  col: Column;
  items: Item[];
  cellMap: Map<string, CacheCellValue["value"]>;
  cache: BoardCache;
  nowMs: number;
  ownValue?: CacheCellValue["value"];
}) {
  if (col.kind === "time_tracking") {
    const entries = items.flatMap((c) =>
      timeEntriesForCell(cache, c.id, col.id),
    );
    const estimates = items
      .map(
        (c) =>
          (
            cellMap.get(cellKey(c.id, col.id)) as
              | { estimateSeconds?: number }
              | undefined
          )?.estimateSeconds,
      )
      .filter((n): n is number => typeof n === "number");
    return (
      <div className={CELL_CLASS}>
        <RollupCell result={rollupTimeTracking(entries, estimates, nowMs)} />
      </div>
    );
  }

  if (col.kind === "relation") {
    const links = items.flatMap((c) =>
      relationLinksForCell(cache, c.id, col.id),
    );
    return (
      <div className={CELL_CLASS}>
        <span className="text-muted-foreground text-xs">
          {relationRollup(links)}
        </span>
      </div>
    );
  }

  if (col.kind === "mirror") {
    // Mirror has no rollup aggregate in v1 — blank, matching the cell shape.
    return <div className={CELL_CLASS} />;
  }

  // Free-text kinds (text/link/email/phone) can't be summed or averaged. On a
  // collapsed parent (ownValue provided) show the parent's own value, else a
  // count of subitems that carry one — so collapsing doesn't hide information.
  if (ownValue !== undefined && isTextualKind(col.kind)) {
    const subValues = items.map(
      (c) => cellMap.get(cellKey(c.id, col.id)) ?? null,
    );
    const r = textualRollup(ownValue, subValues);
    return (
      <div className={CELL_CLASS}>
        {r.kind === "own" ? (
          <CellRenderer
            kind={col.kind}
            value={ownValue}
            settings={
              (col.settings ?? {}) as Record<string, unknown> & {
                options?: ColumnOption[];
              }
            }
          />
        ) : r.kind === "count" ? (
          <span className="text-muted-foreground text-sm">
            {r.count} {r.count === 1 ? "item" : "items"}
          </span>
        ) : (
          <span className="text-sm" />
        )}
      </div>
    );
  }

  const values = items.map((c) => cellMap.get(cellKey(c.id, col.id)) ?? null);
  const settings = (col.settings ?? {}) as {
    options?: Parameters<typeof rollupCell>[2];
    currency?: string;
  };
  return (
    <div className={CELL_CLASS}>
      <RollupCell
        result={rollupCell(
          col.kind,
          values,
          settings.options,
          settings.currency,
        )}
        currencySettings={col.settings}
      />
    </div>
  );
}
