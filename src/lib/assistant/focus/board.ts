import type { BoardPayload } from "@/lib/boards/queries";
import type { Member } from "@/lib/collaboration/activity";
import {
  buildBoardContext,
  type BoardContext,
} from "@/lib/ai/board-intelligence/board-context";
import { buildItemRoster } from "@/lib/ai/board-intelligence/prompt";
import { sanitizeInline } from "@/lib/ai/prompt-sanitize";
import { FOCUS_MAX_CHARS, FOCUS_MAX_ITEMS } from "./types";

const MAX_OPTIONS = 12;
const MAX_GROUPS = 30;
const MAX_COLUMNS = 30;
const MAX_MEMBERS = 40;
const MAX_LINE = 300;
/** The head (groups, columns, members) may use at most this much of the budget. */
const HEAD_BUDGET = 3500;

const clip = (line: string) => line.slice(0, MAX_LINE);

/** Whole lines only: at most `limit` of them, then a `… N more` marker. */
function capLines(lines: string[], limit: number): string[] {
  if (lines.length <= limit) return lines.map(clip);
  return [...lines.slice(0, limit).map(clip), `… ${lines.length - limit} more`];
}

/**
 * A bounded text picture of one board, built from the RLS-scoped payload the
 * board page already loads. Ids are included so the model can act without a
 * discovery round-trip. Every line is whole, the ITEMS header is always
 * present, and anything dropped is marked with a `… N more` line.
 */
export function buildBoardFocus(args: {
  payload: BoardPayload;
  members: readonly Member[];
}): string {
  const { payload } = args;
  const ctx = buildBoardContext(payload, args.members);

  const groupLines = payload.groups.map(
    (g) => `${g.id} | ${sanitizeInline(g.name)}`,
  );
  const columnLine = (
    c: BoardContext["columns"] extends Map<string, infer V> ? V : never,
    withOptions: boolean,
  ) => {
    const base = `${c.id} | ${sanitizeInline(c.name)} | ${c.kind}`;
    if (c.options.size === 0) return base;
    if (!withOptions) return `${base} | options: (omitted)`;
    const listed = [...c.options].slice(0, MAX_OPTIONS);
    return `${base} | options: ${listed.map(([id, label]) => `${id}=${sanitizeInline(label)}`).join(", ")}${
      c.options.size > listed.length ? ", …" : ""
    }`;
  };
  const columnList = [...ctx.columns.values()];
  const memberLines = [...ctx.members].map(
    ([id, name]) => `${id} | ${sanitizeInline(name)}`,
  );

  const itemsHeader = `ITEMS (most recently updated first, up to ${FOCUS_MAX_ITEMS}; call list_items for the rest)`;
  const compose = (
    withOptions: boolean,
    limits: { groups: number; columns: number; members: number },
  ) =>
    [
      `Board "${sanitizeInline(payload.board.name)}" (id ${payload.board.id}), ${payload.items.length} items.`,
      "",
      "GROUPS (id | name)",
      ...capLines(groupLines, limits.groups),
      "",
      "COLUMNS (id | name | kind | options)",
      ...capLines(
        columnList.map((c) => columnLine(c, withOptions)),
        limits.columns,
      ),
      "",
      "MEMBERS (userId | name)",
      ...capLines(memberLines, limits.members),
      "",
      itemsHeader,
    ].map(clip);

  const limits = {
    groups: MAX_GROUPS,
    columns: MAX_COLUMNS,
    members: MAX_MEMBERS,
  };
  const size = (lines: string[]) => lines.join("\n").length;
  let head = compose(true, limits);
  if (size(head) > HEAD_BUDGET) head = compose(false, limits);
  // Still too big: shrink members, then columns, then groups, a few at a time.
  for (const key of ["members", "columns", "groups"] as const) {
    while (size(head) > HEAD_BUDGET && limits[key] > 0) {
      limits[key] = Math.max(0, limits[key] - 5);
      head = compose(false, limits);
    }
  }

  const roster = buildItemRoster(
    {
      ctx,
      signals: [],
      cellValues: payload.cellValues,
      itemsByRecency: payload.items,
    },
    FOCUS_MAX_ITEMS,
  );

  // Keep whole item lines while they fit, so the block never ends mid-line.
  // Reserve room for the "more items" marker.
  const markerReserve = 70;
  const lines: string[] = [];
  let length = size(head);
  for (const line of roster) {
    const clipped = clip(line);
    if (length + clipped.length + 1 + markerReserve > FOCUS_MAX_CHARS) break;
    lines.push(clipped);
    length += clipped.length + 1;
  }
  const omitted = payload.items.length - lines.length;
  const tail =
    omitted > 0 ? [`… ${omitted} more items not shown; call list_items`] : [];
  // Last-resort guard only; the caps above mean this should never cut.
  return [...head, ...lines, ...tail].join("\n").slice(0, FOCUS_MAX_CHARS);
}
