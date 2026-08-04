import "server-only";
import { getBoardPayload } from "@/lib/boards/queries";
import { createItem, moveItem } from "@/lib/boards/actions/item";
import { createGroup } from "@/lib/boards/actions/group";
import { upsertCell } from "@/lib/boards/actions/cell";
import { pickFieldColumns } from "./resolve";
import type { BoardEffect } from "./effects";
import type { Tables } from "@/types/database.types";
import type {
  ProposedFields,
  ValidatedAction,
  ExecutionResult,
} from "./schema";

/**
 * Write the action's fields, collecting BOTH the per-field errors and the rows
 * that landed — a partial failure must still let the board render what did.
 */
async function applyFields(
  boardId: string,
  itemId: string,
  fields: ProposedFields | undefined,
): Promise<{ errors: string[]; cells: Tables<"cell_values">[] }> {
  if (!fields) return { errors: [], cells: [] };
  const payload = await getBoardPayload(boardId);
  if (!payload) return { errors: ["Board not found."], cells: [] };
  const { dateColumnId, statusColumnId, peopleColumnId } =
    pickFieldColumns(payload);
  const errors: string[] = [];
  const cells: Tables<"cell_values">[] = [];
  const write = async (
    columnId: string | null,
    value: unknown,
    label: string,
  ): Promise<void> => {
    if (!columnId) {
      errors.push(`No ${label} column on this board.`);
      return;
    }
    const r = await upsertCell({ itemId, columnId, value });
    if (!r.ok) errors.push(`${label}: ${r.error}`);
    else cells.push(r.data.cell);
  };
  if (fields.dueDate)
    await write(
      dateColumnId,
      {
        date: fields.dueDate,
        ...(fields.endDate ? { end: fields.endDate } : {}),
      },
      "date",
    );
  if (fields.ownerUserIds?.length)
    await write(peopleColumnId, { userIds: fields.ownerUserIds }, "people");
  if (fields.statusOptionId !== undefined)
    await write(statusColumnId, { optionId: fields.statusOptionId }, "status");
  return { errors, cells };
}

/**
 * Map a re-validated action to the canonical typed Server Actions. RLS is the
 * guard at every write. A field write that fails does NOT roll back a created
 * item — per-field errors are surfaced so the UI can show exactly what landed.
 *
 * Returns the persisted `result` AND a transient `effect`: the authoritative
 * rows this write produced, so the acting client can render its own change with
 * no refetch. The effect is deliberately NOT folded into ExecutionResult, which
 * is persisted into ai_messages.tool_trace and read back forever.
 *
 * The `never` check at the bottom is what makes this shared: a fifth verb cannot
 * compile without deciding what the board should show.
 */
export async function executeAction(
  action: ValidatedAction,
): Promise<{ result: ExecutionResult; effect: BoardEffect | null }> {
  if (action.kind === "create_group") {
    const r = await createGroup({ boardId: action.boardId, name: action.name });
    return r.ok
      ? {
          result: { ok: true },
          effect: {
            kind: "group_created",
            boardId: action.boardId,
            group: r.data.group,
          },
        }
      : { result: { ok: false, error: r.error }, effect: null };
  }
  if (action.kind === "create_item") {
    const created = await createItem({
      groupId: action.groupId,
      name: action.name,
    });
    if (!created.ok)
      return { result: { ok: false, error: created.error }, effect: null };
    const itemId = created.data.item.id;
    const { errors, cells } = await applyFields(
      action.boardId,
      itemId,
      action.fields,
    );
    // The item exists either way, so the board must show it even when a field
    // write failed — the effect rides along with the error, not instead of it.
    const effect: BoardEffect = {
      kind: "item_created",
      boardId: action.boardId,
      item: created.data.item,
      cells,
    };
    return errors.length
      ? { result: { ok: false, error: errors.join("; ") }, effect }
      : { result: { ok: true, itemId }, effect };
  }
  if (action.kind === "move_item") {
    // moveItem owns the guards that matter after confirmation: it refuses
    // subitems, refuses a group on another board, and appends to the end of
    // the target group. Omitting `position` is what selects that append —
    // there is no drag-drop cursor here to honour.
    const r = await moveItem({
      itemId: action.itemId,
      groupId: action.groupId,
    });
    // No `itemId` on success: the UI reads that as "a row was CREATED — open it
    // from the board", which is wrong for a move. Nothing consumes a move's id.
    return r.ok
      ? {
          result: { ok: true },
          effect: {
            kind: "item_moved",
            boardId: action.boardId,
            item: r.data.item,
            subitemIds: r.data.subitemIds,
          },
        }
      : { result: { ok: false, error: r.error }, effect: null };
  }
  if (action.kind === "set_item_fields") {
    const { errors, cells } = await applyFields(
      action.boardId,
      action.itemId,
      action.fields,
    );
    const effect: BoardEffect | null = cells.length
      ? { kind: "item_fields_set", boardId: action.boardId, cells }
      : null;
    return errors.length
      ? { result: { ok: false, error: errors.join("; ") }, effect }
      : { result: { ok: true, itemId: action.itemId }, effect };
  }
  // Every verb is handled above. A fifth one fails to COMPILE here rather than
  // silently falling into another verb's branch — which is now also what forces
  // a new verb to decide how the board should render it.
  const _exhaustive: never = action;
  return _exhaustive;
}
