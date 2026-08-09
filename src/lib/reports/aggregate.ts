/**
 * Multi-board aggregation for Report Builder v2.
 *
 * A report used to be exactly one board; it can now span several. The per-board
 * pure functions in `shape.ts` / `chart-data.ts` stay per-board and unchanged —
 * this module is the layer ON TOP of them: it runs them once per board
 * (`buildReportBoardData`) and then pools the per-board results into the
 * report-wide KPI strip (`poolKpis`) and chart (`mergeChartSeries`).
 */
import type { BoardPayload } from "@/lib/boards/queries";
import type { ChartBlockOptions } from "@/lib/reports/config";
import type { GroupSummary, Kpis, ReportModel } from "@/lib/reports/shape";
import {
  computeGroupSummaries,
  computeKpis,
  shapeReport,
} from "@/lib/reports/shape";
import type { ChartCategory, ChartSeries } from "@/lib/reports/chart-data";
import { computeChartSeries } from "@/lib/reports/chart-data";
import { PRINT_NEUTRAL, rampSlot } from "@/lib/reports/chart-palette";

/** Everything one board contributes to a multi-board report. */
export type ReportBoardData = {
  boardId: string;
  boardName: string;
  model: ReportModel;
  kpis: Kpis;
  groupSummaries: GroupSummary[];
  /** null when the report has no chart block configured. */
  chartSeries: ChartSeries | null;
};

/**
 * Run the existing per-board shapers over one board's payload. Pure
 * composition — no new logic lives here, so per-board output is byte-identical
 * to the single-board report path.
 */
export function buildReportBoardData(
  payload: BoardPayload,
  peopleNames: Map<string, string>,
  chartOptions: ChartBlockOptions | null,
): ReportBoardData {
  return {
    boardId: payload.board.id,
    boardName: payload.board.name,
    model: shapeReport(payload, peopleNames),
    kpis: computeKpis(payload, peopleNames),
    groupSummaries: computeGroupSummaries(payload),
    chartSeries: chartOptions
      ? computeChartSeries(payload, peopleNames, chartOptions)
      : null,
  };
}

/**
 * Pool per-board KPIs into the report-wide strip.
 *
 * `percentComplete` is the ITEM-WEIGHTED mean of the per-board percentages, so
 * a 3-item board cannot outvote a 300-item one. It is a deliberate
 * APPROXIMATION: `Kpis` carries no raw done-count, only an already-rounded
 * percentage, so `sum(itemCount * percentComplete) / sum(itemCount)` can differ
 * from a true `sum(done) / sum(items)` by up to half a percentage point per
 * board (each input was already rounded to a whole percent). Widening `Kpis`
 * with a done-count purely to make the aggregate exact is not worth the churn
 * to every existing consumer; the drift is well inside the precision a printed
 * KPI tile claims.
 */
export function poolKpis(list: Kpis[]): Kpis {
  const itemCount = list.reduce((n, k) => n + k.itemCount, 0);
  const overdueCount = list.reduce((n, k) => n + k.overdueCount, 0);
  const weighted = list.reduce(
    (n, k) => n + k.itemCount * k.percentComplete,
    0,
  );

  // Merge by label, case-sensitively: board option labels are user-authored, so
  // "Done" and "done" are two different statuses to whoever typed them.
  const tally = new Map<string, number>();
  for (const k of list) {
    for (const t of k.statusTally) {
      tally.set(t.label, (tally.get(t.label) ?? 0) + t.count);
    }
  }

  return {
    itemCount,
    // Guard the divide: a report over empty boards pools to 0, never NaN.
    percentComplete: itemCount ? Math.round(weighted / itemCount) : 0,
    overdueCount,
    statusTally: [...tally.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}

/** Keys that carry a reserved meaning rather than a board entity's identity. */
const RESERVED_KEYS = new Set(["__none", "__other"]);

type MergedCategory = { key: string; label: string; value: number };

/**
 * Merge per-board chart series into one report-wide series.
 *
 * MERGE BY LABEL, NOT BY KEY. A `ChartCategory.key` is board-local — the option
 * id / group id that identifies the bucket *within its own board*. Two boards
 * with a "Done" status have two different option ids for it, so keying the
 * merge would emit "Done" twice. Labels are the only cross-board identity the
 * series carries.
 *
 * COLOR IS RE-DERIVED FROM THE FINAL ORDER, not carried over. The per-board
 * rule is "color follows the entity, never its rank" — a bucket takes its
 * board's own option color, else the ramp slot at its settings index. Across
 * boards that rule has no meaning: the merged bucket has N source entities with
 * N different settings indices and possibly N conflicting board colors, and
 * nothing designates a winner. So the aggregate falls back to the only stable
 * ordering it does own — the final sorted position — and repaints from there.
 * `__none` / `__other` stay neutral because they must never read as an
 * identity.
 */
export function mergeChartSeries(
  list: ChartSeries[],
  maxCategories: number,
): ChartSeries {
  const usable = list.filter((s) => !s.empty);
  // First non-empty input wins. Boards can legitimately group by differently
  // named columns ("Status" vs "Stage"); there is no meaningful way to name the
  // merged axis, and inventing a joined label would read as a data error, so
  // the report just adopts the first board's name.
  const categoryName = usable[0]?.categoryName ?? "";
  const total = usable.reduce((n, s) => n + s.total, 0);

  const byLabel = new Map<string, MergedCategory>();
  for (const s of usable) {
    for (const c of s.categories) {
      const found = byLabel.get(c.label);
      if (!found) {
        byLabel.set(c.label, { key: c.key, label: c.label, value: c.value });
        continue;
      }
      found.value += c.value;
      // A reserved key anywhere in the merge wins over a board-local id: the
      // bucket stays the "no value" / "Other" bucket for the whole report.
      if (RESERVED_KEYS.has(c.key)) found.key = c.key;
    }
  }

  if (byLabel.size === 0) {
    return { categories: [], total: 0, categoryName, empty: true };
  }

  const sorted = [...byLabel.values()].sort(
    (a, b) => b.value - a.value || a.label.localeCompare(b.label),
  );

  const cap = Math.max(1, Math.floor(maxCategories));
  let final = sorted;
  if (sorted.length > cap) {
    const kept = sorted.slice(0, cap);
    let folded = sorted.slice(cap).reduce((n, c) => n + c.value, 0);
    // A board that already folded its own tail contributes an "__other" that
    // must join this one rather than sit alongside it.
    const existing = kept.findIndex((c) => c.key === "__other");
    if (existing >= 0) {
      folded += kept[existing].value;
      kept.splice(existing, 1);
    }
    kept.push({ key: "__other", label: "Other", value: folded });
    final = kept;
  }

  const categories: ChartCategory[] = final.map((c, i) => ({
    key: c.key,
    label: c.label,
    value: c.value,
    color: RESERVED_KEYS.has(c.key) ? PRINT_NEUTRAL : rampSlot(i),
  }));

  return { categories, total, categoryName, empty: categories.length === 0 };
}
