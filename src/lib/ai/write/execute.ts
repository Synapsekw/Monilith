import "server-only";
import { getBoardPayload } from "@/lib/boards/queries";
import { createItem } from "@/lib/boards/actions/item";
import { createGroup } from "@/lib/boards/actions/group";
import { upsertCell } from "@/lib/boards/actions/cell";
import { pickFieldColumns } from "./resolve";
import type {
  ProposedFields,
  ValidatedAction,
  ExecutionResult,
} from "./schema";

async function applyFields(
  boardId: string,
  itemId: string,
  fields: ProposedFields | undefined,
): Promise<string[]> {
  if (!fields) return [];
  const payload = await getBoardPayload(boardId);
  if (!payload) return ["Board not found."];
  const { dateColumnId, statusColumnId, peopleColumnId } =
    pickFieldColumns(payload);
  const errors: string[] = [];
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
  return errors;
}

/**
 * Map a re-validated action to the canonical typed Server Actions. RLS is the
 * guard at every write. A field write that fails does NOT roll back a created
 * item — per-field errors are surfaced so the UI can show exactly what landed.
 */
export async function executeAction(
  action: ValidatedAction,
): Promise<ExecutionResult> {
  if (action.kind === "create_group") {
    const r = await createGroup({ boardId: action.boardId, name: action.name });
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }
  if (action.kind === "create_item") {
    const created = await createItem({
      groupId: action.groupId,
      name: action.name,
    });
    if (!created.ok) return { ok: false, error: created.error };
    const itemId = created.data.item.id;
    const fieldErrors = await applyFields(
      action.boardId,
      itemId,
      action.fields,
    );
    return fieldErrors.length
      ? { ok: false, error: fieldErrors.join("; ") }
      : { ok: true, itemId };
  }
  // set_item_fields
  const fieldErrors = await applyFields(
    action.boardId,
    action.itemId,
    action.fields,
  );
  return fieldErrors.length
    ? { ok: false, error: fieldErrors.join("; ") }
    : { ok: true, itemId: action.itemId };
}
