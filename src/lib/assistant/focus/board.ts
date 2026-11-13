import type { BoardPayload } from "@/lib/boards/queries";
import type { Member } from "@/lib/collaboration/activity";
import { buildBoardContext } from "@/lib/ai/board-intelligence/board-context";
import { buildItemRoster } from "@/lib/ai/board-intelligence/prompt";
import { sanitizeInline } from "@/lib/ai/prompt-sanitize";
import { FOCUS_MAX_CHARS, FOCUS_MAX_ITEMS } from "./types";

const MAX_OPTIONS = 12;

/**
 * A bounded text picture of one board, built from the RLS-scoped payload the
 * board page already loads. Ids are included so the model can act without a
 * discovery round-trip.
 */
export function buildBoardFocus(args: {
  payload: BoardPayload;
  members: readonly Member[];
}): string {
  const { payload } = args;
  const ctx = buildBoardContext(payload, args.members);

  const groups = payload.groups.map(
    (g) => `${g.id} | ${sanitizeInline(g.name)}`,
  );
  const columns = [...ctx.columns.values()].map((c) => {
    const listed = [...c.options].slice(0, MAX_OPTIONS);
    const options = listed.length
      ? ` | options: ${listed.map(([id, label]) => `${id}=${sanitizeInline(label)}`).join(", ")}${
          c.options.size > listed.length ? ", …" : ""
        }`
      : "";
    return `${c.id} | ${sanitizeInline(c.name)} | ${c.kind}${options}`;
  });
  const members = [...ctx.members].map(
    ([id, name]) => `${id} | ${sanitizeInline(name)}`,
  );

  const head = [
    `Board "${sanitizeInline(payload.board.name)}" (id ${payload.board.id}), ${payload.items.length} items.`,
    "",
    "GROUPS (id | name)",
    ...groups,
    "",
    "COLUMNS (id | name | kind | options)",
    ...columns,
    "",
    "MEMBERS (userId | name)",
    ...members,
    "",
    `ITEMS (most recently updated first, up to ${FOCUS_MAX_ITEMS}; call list_items for the rest)`,
  ].join("\n");

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
  const lines: string[] = [];
  let length = head.length;
  for (const line of roster) {
    const clipped = line.slice(0, 300);
    if (length + clipped.length + 1 > FOCUS_MAX_CHARS) break;
    lines.push(clipped);
    length += clipped.length + 1;
  }
  return [head, ...lines].join("\n").slice(0, FOCUS_MAX_CHARS);
}
