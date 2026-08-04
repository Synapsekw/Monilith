import "server-only";
import type { ProposedAction, ProposedFields, ValidatedAction } from "./schema";
import type { BoardPayload } from "@/lib/boards/queries";

export type { BoardPayload };
export type Member = { userId: string; name: string };
export type Resolved =
  | { kind: "ok"; action: ValidatedAction }
  | { kind: "error"; error: string };

type OptionSettings = { options?: { id: string; label: string }[] } | null;

/** Pick the board's date/status/people columns by kind. >1 candidate → warn + prefer a name hint. */
export function pickFieldColumns(payload: BoardPayload): {
  dateColumnId: string | null;
  statusColumnId: string | null;
  peopleColumnId: string | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  const byKind = (kind: string, hints: string[]): string | null => {
    const cols = payload.columns.filter((c) => c.kind === kind);
    if (cols.length <= 1) return cols[0]?.id ?? null;
    const hinted =
      cols.find((c) => hints.some((h) => c.name.toLowerCase().includes(h))) ??
      cols[0];
    warnings.push(
      `Board has ${cols.length} ${kind} columns — used "${hinted.name}".`,
    );
    return hinted.id;
  };
  return {
    dateColumnId: byKind("date", ["due", "deadline", "date"]),
    statusColumnId: byKind("status", ["status", "state"]),
    peopleColumnId: byKind("people", ["owner", "assignee", "people"]),
    warnings,
  };
}

function fieldSummary(
  payload: BoardPayload,
  members: Member[],
  fields: ProposedFields | undefined,
): { parts: string[]; warnings: string[] } {
  const parts: string[] = [];
  const warnings: string[] = [];
  if (!fields) return { parts, warnings };
  if (fields.dueDate) parts.push(`due ${fields.dueDate}`);
  if (fields.ownerUserIds?.length) {
    const names = fields.ownerUserIds.map((id) => {
      const match = members.find((m) => m.userId === id);
      if (!match) warnings.push(`Couldn't find a member for one owner id.`);
      return match?.name ?? "someone";
    });
    parts.push(`owner ${names.join(", ")}`);
  }
  if (fields.statusOptionId) {
    const opt = payload.columns
      .flatMap((c) => (c.settings as OptionSettings)?.options ?? [])
      .find((o) => o.id === fields.statusOptionId);
    parts.push(`status ${opt?.label ?? fields.statusOptionId}`);
  }
  return { parts, warnings };
}

export function resolveCreateItem(
  payload: BoardPayload,
  members: Member[],
  action: Extract<ProposedAction, { kind: "create_item" }>,
): Resolved {
  const group = payload.groups.find((g) => g.id === action.groupId);
  if (!group)
    return {
      kind: "error",
      // getBoardPayload excludes archived groups, so a target missing here may
      // be archived rather than absent — don't assert a cause the resolver
      // can't tell apart. Same fix as resolveMoveItem below, which said this
      // first; create was left behind.
      error:
        "I couldn't find that group on this board — it may have been archived.",
    };
  const { parts, warnings } = fieldSummary(payload, members, action.fields);
  const suffix = parts.length ? ` · ${parts.join(" · ")}` : "";
  return {
    kind: "ok",
    action: {
      ...action,
      summary: `Create task "${action.name}" in ${group.name}${suffix}`,
      warnings,
    },
  };
}

export function resolveSetItemFields(
  payload: BoardPayload,
  members: Member[],
  action: Extract<ProposedAction, { kind: "set_item_fields" }>,
): Resolved {
  const item = payload.items.find((i) => i.id === action.itemId);
  if (!item) return { kind: "error", error: "That item isn't on this board." };
  const { parts, warnings } = fieldSummary(payload, members, action.fields);
  return {
    kind: "ok",
    action: {
      ...action,
      summary: `Update "${item.name}"${parts.length ? ` · ${parts.join(" · ")}` : ""}`,
      warnings,
    },
  };
}

/**
 * Validate a proposed move and describe it for the confirm card.
 *
 * Every refusal here is a message the model relays to the user, so each says
 * what is wrong rather than just that something is. The cross-board case is
 * called out by name: it is the one a user is most likely to attempt, and
 * "isn't on this board" alone reads like a bug rather than a boundary.
 *
 * These checks duplicate `moveItem`'s own guards deliberately. moveItem is the
 * enforcement (it runs after the user confirms, under RLS); this is the
 * PREVIEW — catching it here means the user never sees a confirm card for a
 * move that cannot happen.
 */
export function resolveMoveItem(
  payload: BoardPayload,
  action: Extract<ProposedAction, { kind: "move_item" }>,
): Resolved {
  const item = payload.items.find((i) => i.id === action.itemId);
  if (!item) return { kind: "error", error: "That item isn't on this board." };
  if (item.parent_id !== null)
    return { kind: "error", error: "Subitems can't be moved between groups." };

  const target = payload.groups.find((g) => g.id === action.groupId);
  if (!target)
    return {
      kind: "error",
      // The payload excludes archived groups, so a target that is missing here
      // may be archived rather than on another board — don't assert either as
      // the cause, while still stating the cross-board boundary.
      error:
        "I couldn't find that group on this board — it may have been archived. Moving an item to a different board isn't supported.",
    };

  const from = payload.groups.find((g) => g.id === item.group_id);
  if (target.id === item.group_id)
    return {
      kind: "error",
      // Quoted like every neighbouring message: an item named e.g.
      // "is already in Backlog" would otherwise read as an ambiguous sentence.
      error: `"${item.name}" is already in ${from?.name ?? "that group"}.`,
    };

  return {
    kind: "ok",
    action: {
      ...action,
      summary: `Move "${item.name}" from ${from?.name ?? "its group"} to ${target.name}`,
      warnings: [],
    },
  };
}

export function resolveCreateGroup(
  payload: BoardPayload,
  action: Extract<ProposedAction, { kind: "create_group" }>,
): Resolved {
  return {
    kind: "ok",
    action: {
      ...action,
      summary: `Create group "${action.name}" on ${payload.board.name}`,
      warnings: [],
    },
  };
}
