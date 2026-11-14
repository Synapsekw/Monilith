import { currencyOf, formatCurrency } from "@/lib/boards/currency";
import { stripMarkdown } from "@/lib/boards/markdown";

/**
 * Auto-fit for value columns: a column the user has never resized is as wide
 * as its content needs. The Name column has worked this way since
 * `fitNameColumnWidth` (./name-column-width); this is the same idea for every
 * other column.
 *
 * These bounds are for RENDERING an auto-fitted column. They are never
 * persisted: a saved `columns.width` is still 80–1200 (DB check constraint +
 * `resizeColumnSchema`), and null means "auto-fit".
 */
export const COLUMN_FIT_MIN = 72;
export const COLUMN_FIT_MAX = 360;
/** Width of a column whose content is not measured (and the pre-hydration width). */
export const COLUMN_FIT_DEFAULT = 180;

/**
 * Which rendered font a string is measured in. The caller owns the canvas and
 * the real font strings (see table/use-column-auto-fit); this module stays
 * DOM-free so it is unit-testable (jsdom's `measureText` returns 0).
 *  - cell:   value text (`text-cell`, 12.5px Inter 400 in the table)
 *  - chip:   status / dropdown pill label (`text-xs` Inter 500)
 *  - mono:   reserved for mono metadata text
 *  - header: the column label (10px mono kicker, uppercase)
 */
export type FitFont = "cell" | "chip" | "mono" | "header";
export type FitMeasure = (text: string, font: FitFont) => number;

export type FitColumn = {
  id: string;
  kind: string;
  name: string;
  settings: unknown;
  width: number | null;
};

export type FitMember = {
  userId: string;
  fullName: string | null;
  email: string | null;
  /** Set when the member is a Mono: its name is followed by an Agent chip. */
  mono?: unknown;
};

// Geometry, mirrored from the markup. If a class changes there, change the
// matching number here (the plan's browser verification checks the result).
/** A value cell's horizontal padding: `px-2` on both sides. */
const CELL_PAD = 16;
/** ColorChip / StatusPill horizontal padding: `px-2.5` on both sides. */
const CHIP_PAD = 20;
/** DropdownCell `gap-1`. */
const CHIP_GAP = 4;
/** MemberAvatar `size-6`, and the `gap-1.5` before the name. */
const AVATAR = 24;
const AVATAR_GAP = 6;
/** Stacked avatars overlap by `-ml-2`: each extra disc adds 24 − 8. */
const AVATAR_STACK_STEP = 16;
/** PeopleCell shows at most four discs (three avatars + "+N"). */
const MAX_STACKED_AVATARS = 4;
/** The "Agent" chip after a Mono's name, with its gap. */
const AGENT_CHIP = 44;
/**
 * Room around a centered header label: 24px on each side for the pinned
 * reorder grip (left) and menu button (right) — see ColumnHeader.
 */
const HEADER_CHROME = 48;
/** The kicker's `tracking-[0.12em]` at 10px, per character. */
const HEADER_TRACKING = 1.2;
/** Longer than this cannot fit in COLUMN_FIT_MAX at any font here: skip measuring. */
const LONG_TEXT_CHARS = 120;

const FIXED_WIDTH = new Map<string, number>([
  ["date", 116],
  ["checkbox", COLUMN_FIT_MIN],
  ["rating", 96],
  ["percent", 120],
  ["priority", 108],
]);
const TEXTUAL = new Set([
  "text",
  "link",
  "email",
  "phone",
  "numbers",
  "currency",
]);
const UNMEASURED = new Set(["files", "relation", "mirror", "time_tracking"]);

const NO_MEMBERS: readonly FitMember[] = [];
const NO_VALUES: readonly unknown[] = [];

type Obj = Record<string, unknown>;

function asObj(value: unknown): Obj | null {
  return typeof value === "object" && value !== null ? (value as Obj) : null;
}

/** The single line of text a textual cell shows for a value, or null. */
function textOf(kind: string, value: Obj, settings: Obj): string | null {
  switch (kind) {
    case "text":
      if (typeof value.text !== "string") return null;
      // Far past the cap either way: don't pay for the Markdown strip.
      return value.text.length > LONG_TEXT_CHARS * 2
        ? value.text
        : stripMarkdown(value.text);
    case "link": {
      const label =
        typeof value.text === "string" && value.text ? value.text : value.url;
      return typeof label === "string" ? label : null;
    }
    case "email":
      return typeof value.email === "string" ? value.email : null;
    case "phone":
      return typeof value.phone === "string" ? value.phone : null;
    case "numbers": {
      if (typeof value.n !== "number") return null;
      const n =
        typeof settings.precision === "number"
          ? value.n.toFixed(settings.precision)
          : String(value.n);
      return typeof settings.unit === "string" && settings.unit
        ? `${n} ${settings.unit}`
        : n;
    }
    case "currency":
      return typeof value.amount === "number"
        ? formatCurrency(value.amount, currencyOf(settings))
        : null;
    default:
      return null;
  }
}

function fitTextual(
  kind: string,
  values: readonly unknown[],
  settings: Obj,
  measure: FitMeasure,
): number {
  const seen = new Set<string>();
  let widest = 0;
  for (const raw of values) {
    const value = asObj(raw);
    if (!value) continue;
    const text = textOf(kind, value, settings);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    if (text.length > LONG_TEXT_CHARS) return COLUMN_FIT_MAX;
    const w = measure(text, "cell");
    if (w > widest) widest = w;
    if (widest >= COLUMN_FIT_MAX) return COLUMN_FIT_MAX;
  }
  return widest + CELL_PAD;
}

function fitOptions(
  kind: string,
  values: readonly unknown[],
  settings: Obj,
  measure: FitMeasure,
): number {
  const labelById = new Map<string, string>();
  if (Array.isArray(settings.options)) {
    for (const raw of settings.options) {
      const option = asObj(raw);
      if (
        option &&
        typeof option.id === "string" &&
        typeof option.label === "string"
      ) {
        labelById.set(option.id, option.label);
      }
    }
  }
  // Chip widths, measured lazily: only labels that are in use are measured.
  const chipById = new Map<string, number>();
  const chip = (id: string): number => {
    let w = chipById.get(id);
    if (w === undefined) {
      const label = labelById.get(id);
      w = label === undefined ? 0 : measure(label, "chip") + CHIP_PAD;
      chipById.set(id, w);
    }
    return w;
  };

  let widest = 0;
  for (const raw of values) {
    const value = asObj(raw);
    if (!value) continue;
    let row = 0;
    if (kind === "status") {
      if (typeof value.optionId === "string") row = chip(value.optionId);
    } else if (Array.isArray(value.optionIds)) {
      let shown = 0;
      for (const id of value.optionIds) {
        if (typeof id !== "string") continue;
        const w = chip(id);
        if (w === 0) continue;
        row += w;
        shown++;
      }
      if (shown > 1) row += CHIP_GAP * (shown - 1);
    }
    if (row > widest) widest = row;
  }
  return widest + CELL_PAD;
}

function fitPeople(
  values: readonly unknown[],
  measure: FitMeasure,
  members: readonly FitMember[],
): number {
  const byId = new Map(members.map((m) => [m.userId, m]));
  let widest = 0;
  for (const raw of values) {
    const value = asObj(raw);
    const ids =
      value && Array.isArray(value.userIds)
        ? value.userIds.filter((id): id is string => typeof id === "string")
        : [];
    if (ids.length === 0) continue;
    let row: number;
    if (members.length === 0) {
      // PeopleCell's fallback when it cannot resolve ids to names.
      row = measure(
        `${ids.length} ${ids.length === 1 ? "person" : "people"}`,
        "cell",
      );
    } else if (ids.length === 1) {
      const member = byId.get(ids[0]);
      const label = member?.fullName || member?.email || "Unknown";
      row =
        AVATAR +
        AVATAR_GAP +
        measure(label, "cell") +
        (member?.mono ? AGENT_CHIP : 0);
    } else {
      row =
        AVATAR +
        (Math.min(ids.length, MAX_STACKED_AVATARS) - 1) * AVATAR_STACK_STEP;
    }
    if (row > widest) widest = row;
  }
  return widest + CELL_PAD;
}

/**
 * The width one column needs: its content (by kind — see the table in the
 * plan / spec), never narrower than its own header label, clamped to
 * [COLUMN_FIT_MIN, COLUMN_FIT_MAX] and rounded to an integer.
 *
 * `values` are the column's raw cell values (any order; null / malformed
 * entries are skipped). `members` resolves People ids to names.
 */
export function fitColumnWidth(
  column: Pick<FitColumn, "kind" | "name" | "settings">,
  values: readonly unknown[],
  measure: FitMeasure,
  members: readonly FitMember[] = NO_MEMBERS,
): number {
  const header =
    measure(column.name.toUpperCase(), "header") +
    column.name.length * HEADER_TRACKING +
    HEADER_CHROME;
  const settings = asObj(column.settings) ?? {};
  const fixed = FIXED_WIDTH.get(column.kind);

  let content: number;
  if (fixed !== undefined) content = fixed;
  else if (UNMEASURED.has(column.kind)) content = COLUMN_FIT_DEFAULT;
  else if (column.kind === "status" || column.kind === "dropdown")
    content = fitOptions(column.kind, values, settings, measure);
  else if (column.kind === "people")
    content = fitPeople(values, measure, members);
  else if (TEXTUAL.has(column.kind))
    content = fitTextual(column.kind, values, settings, measure);
  else content = COLUMN_FIT_DEFAULT;

  return Math.round(
    Math.min(COLUMN_FIT_MAX, Math.max(COLUMN_FIT_MIN, content, header)),
  );
}

/**
 * Fit every column that has no saved width. Returns `{ [columnId]: width }`
 * with entries ONLY for those columns; a column with a saved width is neither
 * measured nor listed. One pass over `cellValues` to bucket them by column.
 */
export function fitBoardColumns(
  columns: readonly FitColumn[],
  cellValues: readonly { column_id: string; value: unknown }[],
  measure: FitMeasure,
  members: readonly FitMember[] = NO_MEMBERS,
): Record<string, number> {
  const unsaved = columns.filter((c) => c.width == null);
  if (unsaved.length === 0) return {};
  const wanted = new Set(unsaved.map((c) => c.id));
  const byColumn = new Map<string, unknown[]>();
  for (const cell of cellValues) {
    if (!wanted.has(cell.column_id)) continue;
    const list = byColumn.get(cell.column_id);
    if (list) list.push(cell.value);
    else byColumn.set(cell.column_id, [cell.value]);
  }
  const out: Record<string, number> = {};
  for (const column of unsaved) {
    out[column.id] = fitColumnWidth(
      column,
      byColumn.get(column.id) ?? NO_VALUES,
      measure,
      members,
    );
  }
  return out;
}
