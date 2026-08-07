import type { BoardPayload, Column, Group, Item } from "@/lib/boards/queries";
import type { ColumnKind } from "@/lib/validations/boards";
import { cellToText } from "@/lib/boards/spreadsheet/cell-codec";
import { previewMarkdown } from "@/lib/boards/markdown";

/** A shaped cell: `text` is the (possibly bounded) display value used by the
 *  table/spotlight blocks, `fullText` is always the complete, untruncated
 *  value — the same string `cellToText` produced, before any preview
 *  bounding — for consumers like the Appendix block that are a genuine
 *  full-data dump and must never truncate. For non-"text" kinds the two are
 *  identical (only "text"-kind cells are ever bounded, see `reportTextPreview`
 *  below). `color` carries the selected option's raw hex for option-bearing
 *  kinds (status/dropdown/priority) so blocks can render a colored pill;
 *  undefined for plain cells. */
export type ReportCell = { text: string; fullText: string; color?: string };
export type ReportRow = {
  item: Item;
  cells: Map<string, ReportCell>;
  subitems: ReportRow[];
};
export type ReportGroup = { group: Group; rows: ReportRow[] };
export type ReportModel = { columns: Column[]; groups: ReportGroup[] };

export type Kpis = {
  itemCount: number;
  percentComplete: number; // 0..100, rounded
  overdueCount: number;
  statusTally: { label: string; count: number }[];
};

const DONE_LABELS = new Set(["done", "complete", "completed", "closed"]);

// Text columns hold Markdown up to 20,000 characters (see
// src/lib/boards/markdown.ts). `cellToText`'s own "text" case intentionally
// returns the RAW value — that's load-bearing for CSV export/import
// round-tripping (see cell-codec.ts), so it must not change. The PDF/print
// TABLE and SPOTLIGHT blocks are a different consumer with a different
// requirement: a value this long, rendered unbounded in an auto-layout
// `<td>`, makes that one row wrap into hundreds of lines and breaks
// pagination. Bounding the actual character count here — not just visually
// clipping it in CSS — is what makes the fix reliable in a paginated PDF:
// `text-overflow: ellipsis` needs a definite cell width and a single
// un-wrapped line to trigger, which auto table layout doesn't reliably give
// a variable, caller-chosen set of report columns, and it produces no
// visible "there's more" affordance on a printed page (no hover title).
// Truncating the source text, paired with the `max-width` this file's own
// `.r-narrative`/`.r-cover-lede` rules already use for long-form content, is
// the deterministic version of the same idea.
//
// The APPENDIX block is explicitly exempt from this bound — it's opt-in
// (`config.ts`'s `appendix` block defaults to disabled) and its own doc
// comment calls it "a true full-data dump". That's why `ReportCell` carries
// BOTH `text` (this preview, used by table/spotlight) and `fullText` (always
// complete) — see the type's doc comment above.
const REPORT_TEXT_PREVIEW_MAX = 200;

function reportTextPreview(text: string): string {
  return previewMarkdown(text, REPORT_TEXT_PREVIEW_MAX);
}

function cellLookup(payload: BoardPayload): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const cv of payload.cellValues)
    map.set(`${cv.item_id}:${cv.column_id}`, cv.value);
  return map;
}

function firstStatusColumn(columns: Column[]): Column | undefined {
  return columns.find((c) => c.kind === "status");
}

/** The selected option's hex for a colored-option cell (status/dropdown/
 *  priority), or undefined. Tolerates the `{optionId}` / `{optionIds:[]}` /
 *  bare-string value shapes the board stores. */
function optionColor(
  kind: ColumnKind,
  raw: unknown,
  settings: unknown,
): string | undefined {
  if (kind !== "status" && kind !== "dropdown" && kind !== "priority") return;
  const options = (settings as { options?: { id: string; color?: string }[] })
    ?.options;
  if (!options?.length) return;
  let id: string | undefined;
  if (typeof raw === "string") id = raw;
  else if (raw && typeof raw === "object") {
    const o = raw as { optionId?: string; optionIds?: string[] };
    id = o.optionId ?? o.optionIds?.[0];
  }
  if (!id) return;
  return options.find((op) => op.id === id)?.color ?? undefined;
}

function isDone(
  payload: BoardPayload,
  itemId: string,
  statusCol: Column | undefined,
): boolean {
  if (!statusCol) return false;
  const lookup = cellLookup(payload);
  const raw = lookup.get(`${itemId}:${statusCol.id}`);
  const label = cellToText(
    statusCol.kind as ColumnKind,
    raw,
    statusCol.settings,
  )
    .trim()
    .toLowerCase();
  return DONE_LABELS.has(label);
}

export function shapeReport(
  payload: BoardPayload,
  peopleNames: Map<string, string>,
): ReportModel {
  const lookup = cellLookup(payload);
  const columns = [...payload.columns].sort((a, b) => a.position - b.position);
  const resolvePerson = (id: string) => peopleNames.get(id) ?? null;

  const buildRow = (item: Item): ReportRow => {
    const cells = new Map<string, ReportCell>();
    for (const col of columns) {
      const raw = lookup.get(`${item.id}:${col.id}`);
      const kind = col.kind as ColumnKind;
      const text = cellToText(kind, raw, col.settings, resolvePerson);
      cells.set(col.id, {
        text: kind === "text" ? reportTextPreview(text) : text,
        fullText: text,
        color: optionColor(kind, raw, col.settings),
      });
    }
    const subitems = payload.items
      .filter((c) => c.parent_id === item.id)
      .sort((a, b) => a.position - b.position)
      .map(buildRow);
    return { item, cells, subitems };
  };

  const groups = [...payload.groups]
    .sort((a, b) => a.position - b.position)
    .map((group) => ({
      group,
      rows: payload.items
        .filter((i) => i.group_id === group.id && i.parent_id === null)
        .sort((a, b) => a.position - b.position)
        .map(buildRow),
    }));

  return { columns, groups };
}

/** Ids of items that have at least one child (header/parent rows). */
function parentIdSet(payload: BoardPayload): Set<string> {
  const s = new Set<string>();
  for (const i of payload.items) if (i.parent_id) s.add(i.parent_id);
  return s;
}

/** Leaf items — those with no subitems. KPIs and progress count leaves (the
 *  trackable work units) so header/parent rows, which often carry no status,
 *  don't dilute completion. On a flat board every item is a leaf, so behavior
 *  is unchanged; on a board where work lives in subitems, the subitems drive
 *  the numbers. */
export function leafItems(payload: BoardPayload): Item[] {
  const parents = parentIdSet(payload);
  return payload.items.filter((i) => !parents.has(i.id));
}

export function computeKpis(
  payload: BoardPayload,
  peopleNames: Map<string, string>,
): Kpis {
  const leaves = leafItems(payload);
  const statusCol = firstStatusColumn(payload.columns);
  const doneCount = leaves.filter((i) =>
    isDone(payload, i.id, statusCol),
  ).length;

  const tally = new Map<string, number>();
  if (statusCol) {
    const lookup = cellLookup(payload);
    for (const i of leaves) {
      const label =
        cellToText(
          statusCol.kind as ColumnKind,
          lookup.get(`${i.id}:${statusCol.id}`),
          statusCol.settings,
          (id) => peopleNames.get(id) ?? null,
        ).trim() || "—";
      tally.set(label, (tally.get(label) ?? 0) + 1);
    }
  }

  const dateCol = payload.columns.find((c) => c.kind === "date");
  let overdue = 0;
  if (dateCol) {
    const lookup = cellLookup(payload);
    const today = new Date().toISOString().slice(0, 10);
    for (const i of leaves) {
      const v = lookup.get(`${i.id}:${dateCol.id}`);
      const iso = typeof v === "string" ? v.slice(0, 10) : "";
      if (iso && iso < today && !isDone(payload, i.id, statusCol)) overdue += 1;
    }
  }

  return {
    itemCount: leaves.length,
    percentComplete: leaves.length
      ? Math.round((doneCount / leaves.length) * 100)
      : 0,
    overdueCount: overdue,
    statusTally: [...tally.entries()].map(([label, count]) => ({
      label,
      count,
    })),
  };
}

export type GroupSummary = {
  group: Group;
  count: number;
  percentComplete: number;
};

export function computeGroupSummaries(payload: BoardPayload): GroupSummary[] {
  const statusCol = firstStatusColumn(payload.columns);
  const parents = parentIdSet(payload);
  return [...payload.groups]
    .sort((a, b) => a.position - b.position)
    .map((group) => {
      // Leaf items in this group (subitems carry a group_id too), so progress
      // reflects the actual work, not just the header rows.
      const leaves = payload.items.filter(
        (i) => i.group_id === group.id && !parents.has(i.id),
      );
      const done = leaves.filter((i) =>
        isDone(payload, i.id, statusCol),
      ).length;
      return {
        group,
        count: leaves.length,
        percentComplete: leaves.length
          ? Math.round((done / leaves.length) * 100)
          : 0,
      };
    });
}
