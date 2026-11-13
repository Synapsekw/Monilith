import type { BoardPayload } from "@/lib/boards/queries";
import type { Member } from "@/lib/collaboration/activity";
import {
  buildBoardContext,
  type BoardContext,
} from "@/lib/ai/board-intelligence/board-context";
import { sanitizeInline } from "@/lib/ai/prompt-sanitize";

/**
 * Human-readable labels for staged calls, shown on the confirm card.
 *
 * Every label is derived from REAL board data (the RLS-scoped payload and the
 * org's members the route already loaded for the focus block) applied to the
 * exact, pinned input that is stored and later applied. Nothing here reads the
 * model's prose. When the input names anything the context does not hold, the
 * answer is null and the caller falls back to the generic summary, so a label
 * never guesses.
 */

/** `BoardContext` plus the two names it does not carry: the board's own name
 *  and its groups'. */
export type DescribeContext = BoardContext & {
  boardName: string;
  groups: ReadonlyMap<string, string>;
};

/** `stagedCallSchema.summary`'s limit. */
const MAX_LABEL = 500;
/** A text value longer than this is shortened inside the label. */
const MAX_TEXT_VALUE = 80;

type Column = BoardContext["columns"] extends Map<string, infer C> ? C : never;

export function buildDescribeContext(
  payload: BoardPayload,
  members: readonly Member[],
): DescribeContext {
  return {
    ...buildBoardContext(payload, members),
    boardName: payload.board.name,
    groups: new Map(payload.groups.map((g) => [g.id, g.name])),
  };
}

const clean = (s: string) => sanitizeInline(s).trim();
const quoted = (s: string) => `"${clean(s)}"`;

function shorten(s: string): string {
  const t = clean(s);
  return t.length > MAX_TEXT_VALUE ? `${t.slice(0, MAX_TEXT_VALUE - 1)}…` : t;
}

function clip(label: string): string {
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** What one field does to its cell. */
type Op =
  | { op: "set"; text: string }
  | { op: "clear" }
  | { op: "tick" }
  | { op: "untick" };

const CLEAR: Op = { op: "clear" };
const set = (text: string): Op => ({ op: "set", text });

/** What a field does, in words, or null when it cannot be described from the
 *  context. */
function valueOp(
  col: Column,
  value: Record<string, unknown>,
  ctx: DescribeContext,
): Op | null {
  switch (col.kind) {
    case "status": {
      if (value.optionId === null) return CLEAR;
      if (typeof value.optionId !== "string") return null;
      const label = col.options.get(value.optionId);
      return label === undefined ? null : set(quoted(label));
    }
    case "dropdown": {
      if (!Array.isArray(value.optionIds)) return null;
      if (value.optionIds.length === 0) return CLEAR;
      const labels = value.optionIds.map((id) =>
        typeof id === "string" ? col.options.get(id) : undefined,
      );
      return labels.every((l) => l !== undefined)
        ? set(labels.map((l) => quoted(l!)).join(", "))
        : null;
    }
    case "people": {
      if (!Array.isArray(value.userIds)) return null;
      if (value.userIds.length === 0) return CLEAR;
      const names = value.userIds.map((id) =>
        typeof id === "string" ? ctx.members.get(id) : undefined,
      );
      return names.every((n) => n !== undefined)
        ? set(names.map((n) => clean(n!)).join(", "))
        : null;
    }
    case "date": {
      if (typeof value.date !== "string") return null;
      return set(
        typeof value.end === "string"
          ? `${clean(value.date)} to ${clean(value.end)}`
          : clean(value.date),
      );
    }
    case "numbers":
      return isNum(value.n) ? set(String(value.n)) : null;
    case "currency":
      return isNum(value.amount) ? set(String(value.amount)) : null;
    case "percent":
      return isNum(value.percent) ? set(`${value.percent}%`) : null;
    case "rating":
      return isNum(value.rating) ? set(`${value.rating}/5`) : null;
    case "priority":
      return typeof value.level === "string" ? set(clean(value.level)) : null;
    case "text":
      if (typeof value.text !== "string") return null;
      return value.text.trim() === "" ? CLEAR : set(`"${shorten(value.text)}"`);
    case "email":
      return typeof value.email === "string" ? set(clean(value.email)) : null;
    case "phone":
      return typeof value.phone === "string" ? set(clean(value.phone)) : null;
    case "link":
      return typeof value.url === "string" ? set(clean(value.url)) : null;
    case "checkbox":
      return typeof value.checked === "boolean"
        ? { op: value.checked ? "tick" : "untick" }
        : null;
    default:
      return null;
  }
}

type Field = { column: string } & Op;

/** Every field in words, or null when any one of them cannot be described:
 *  a label that silently left a field out would misstate what Apply does. */
function describeFields(raw: unknown, ctx: DescribeContext): Field[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const out: Field[] = [];
  for (const f of raw) {
    if (!isRecord(f) || typeof f.columnId !== "string" || !isRecord(f.value))
      return null;
    const col = ctx.columns.get(f.columnId);
    if (!col) return null;
    const op = valueOp(col, f.value, ctx);
    if (op === null) return null;
    out.push({ column: clean(col.name), ...op });
  }
  return out;
}

/** `set Status to "Done"` / `clear Owner` / `tick Signed off`. */
function asChange(f: Field): string {
  switch (f.op) {
    case "set":
      return `set ${f.column} to ${f.text}`;
    case "clear":
      return `clear ${f.column}`;
    case "tick":
      return `tick ${f.column}`;
    case "untick":
      return `untick ${f.column}`;
  }
}

/** `Status "Done"` / `Owner empty` — the short form inside a create. */
function asInitial(f: Field): string {
  switch (f.op) {
    case "set":
      return `${f.column} ${f.text}`;
    case "clear":
      return `${f.column} empty`;
    case "tick":
      return `${f.column} ticked`;
    case "untick":
      return `${f.column} unticked`;
  }
}

function itemName(id: unknown, ctx: DescribeContext): string | null {
  if (typeof id !== "string") return null;
  const item = ctx.items.get(id);
  return item ? clean(item.name) : null;
}

function groupName(id: unknown, ctx: DescribeContext): string | null {
  if (typeof id !== "string") return null;
  const name = ctx.groups.get(id);
  return name === undefined ? null : clean(name);
}

function describeUpdateItem(
  input: Record<string, unknown>,
  ctx: DescribeContext,
): string | null {
  const item = itemName(input.itemId, ctx);
  if (!item) return null;
  const fields = describeFields(input.fields, ctx);
  if (!fields) return null;
  const changes: string[] = [];
  if (input.name !== undefined) {
    if (typeof input.name !== "string") return null;
    changes.push(`rename to ${quoted(input.name)}`);
  }
  changes.push(...fields.map(asChange));
  return changes.length ? `${item}: ${changes.join("; ")}` : null;
}

function describeCreateItem(
  input: Record<string, unknown>,
  ctx: DescribeContext,
): string | null {
  const group = groupName(input.groupId, ctx);
  if (!group) return null;
  const entries =
    input.items !== undefined
      ? input.items
      : input.name !== undefined
        ? [{ name: input.name, fields: input.fields }]
        : null;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const parts: string[] = [];
  for (const e of entries) {
    if (!isRecord(e) || typeof e.name !== "string") return null;
    const fields = describeFields(e.fields, ctx);
    if (!fields) return null;
    const name = clean(e.name);
    parts.push(
      fields.length ? `${name} (${fields.map(asInitial).join("; ")})` : name,
    );
  }
  const n = parts.length;
  return `Add ${n} ${n === 1 ? "item" : "items"} to ${group}: ${parts.join(", ")}`;
}

function describeManageItem(
  input: Record<string, unknown>,
  ctx: DescribeContext,
): string | null {
  const item = itemName(input.itemId, ctx);
  if (!item) return null;
  switch (input.action) {
    case "archive":
      return `Archive the item "${item}"`;
    case "restore":
      return `Restore the item "${item}"`;
    case "move": {
      const group = groupName(input.groupId, ctx);
      return group ? `Move "${item}" to ${group}` : null;
    }
    case "add_subitem":
      return typeof input.name === "string"
        ? `Add the subitem ${quoted(input.name)} under "${item}"`
        : null;
    default:
      // reorder: a position number says nothing a person can check.
      return null;
  }
}

function describeManageBoard(
  input: Record<string, unknown>,
  ctx: DescribeContext,
): string | null {
  // Only the board in focus: it is the only one whose name is known here.
  if (input.boardId !== ctx.boardId) return null;
  const board = quoted(ctx.boardName);
  switch (input.action) {
    case "archive":
      return `Archive the board ${board}`;
    case "restore":
      return `Restore the board ${board}`;
    case "duplicate":
      return `Duplicate the board ${board}`;
    case "rename":
      return typeof input.name === "string"
        ? `Rename the board ${board} to ${quoted(input.name)}`
        : null;
    default:
      return null;
  }
}

/**
 * A card label for one staged call, or null to fall back to the generic
 * summary. Pure: no I/O, and only `ctx` is consulted for names.
 */
export function describeCall(
  tool: string,
  input: Record<string, unknown>,
  ctx: DescribeContext | null,
): string | null {
  if (!ctx) return null;
  let label: string | null;
  switch (tool) {
    case "update_item":
      label = describeUpdateItem(input, ctx);
      break;
    case "create_item":
      label = describeCreateItem(input, ctx);
      break;
    case "manage_item":
      label = describeManageItem(input, ctx);
      break;
    case "manage_board":
      label = describeManageBoard(input, ctx);
      break;
    default:
      label = null;
  }
  return label === null ? null : clip(label);
}
