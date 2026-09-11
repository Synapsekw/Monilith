import { sanitizeInline } from "@/lib/ai/prompt-sanitize";
import type { BoardSnapshot } from "@/lib/ai/board-snapshot";
import type { Signal } from "@/lib/boards/intelligence/types";
import { ROSTER_MAX_ITEMS } from "@/lib/boards/intelligence/constants";
import type { BoardContext } from "./board-context";

export type PromptInput = {
  snapshot: BoardSnapshot;
  ctx: BoardContext;
  signals: readonly Signal[];
  transcript: string;
  now: string;
  timezone: string;
  cellValues: readonly { item_id: string; column_id: string; value: unknown }[];
  itemsByRecency: readonly { id: string; updated_at: string }[];
};

export function systemPrompt(): string {
  return [
    "You are the Intelligence layer of a work board. You write a short brief of the last 7 days and propose concrete next actions.",
    "Base everything ONLY on the data between the === markers. Never invent items, people, dates or counts; the SIGNALS section holds the authoritative counts.",
    "Write the brief as 3 to 5 sentences of plain prose — no headings, no lists, no markdown.",
    'Propose at most 5 suggestions, most important first. Each has a short title, a terse evidence kicker (for example "3 overdue" or "140% → 95%"), a one-line body, the ids of the items it rests on, and 1–2 actions.',
    "Actions must use only ids that appear in the ITEMS, COLUMNS, MEMBERS or SIGNALS sections: reassign needs a people column and a member; set_due needs a date column and YYYY-MM-DD; set_status needs a status column and one of its option ids; nudge needs a member and a message under 200 characters; filter needs a signal kind.",
    "Fill every action field; use null for fields that do not apply to the action type.",
    "Prefer nothing over noise: when the board is quiet, say so in the brief and return no suggestions.",
  ].join("\n");
}

type CtxColumn =
  BoardContext["columns"] extends Map<string, infer C> ? C : never;

function valueText(
  kind: string,
  value: unknown,
  col: CtxColumn,
  ctx: BoardContext,
): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  switch (kind) {
    case "status":
      return typeof v.optionId === "string"
        ? (col.options.get(v.optionId) ?? null)
        : null;
    case "date":
      return typeof v.date === "string"
        ? v.date + (typeof v.end === "string" ? `→${v.end}` : "")
        : null;
    case "people":
      return Array.isArray(v.userIds)
        ? v.userIds
            .map((id) => ctx.members.get(String(id)) ?? "someone")
            .join(", ")
        : null;
    case "numbers":
      return typeof v.n === "number" ? String(v.n) : null;
    case "percent":
      return typeof v.percent === "number" ? `${v.percent}%` : null;
    case "priority":
      return typeof v.level === "string" ? v.level : null;
    default:
      return null;
  }
}

/** One line per item: `- <id> | <name> | <group> | Col: value · Col: value`.
 *  Signal items first (they are what suggestions rest on), then by recency. */
export function buildItemRoster(
  input: Pick<PromptInput, "ctx" | "signals" | "cellValues" | "itemsByRecency">,
  max = ROSTER_MAX_ITEMS,
): string[] {
  const { ctx, signals, cellValues, itemsByRecency } = input;
  const order: string[] = [];
  const seen = new Set<string>();
  for (const s of signals)
    for (const id of s.itemIds)
      if (ctx.items.has(id) && !seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
  for (const it of [...itemsByRecency].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at),
  ))
    if (!seen.has(it.id) && ctx.items.has(it.id)) {
      seen.add(it.id);
      order.push(it.id);
    }
  const byItem = new Map<string, { column_id: string; value: unknown }[]>();
  for (const c of cellValues) {
    const arr = byItem.get(c.item_id) ?? [];
    arr.push(c);
    byItem.set(c.item_id, arr);
  }
  return order.slice(0, max).map((id) => {
    const it = ctx.items.get(id)!;
    const cells = (byItem.get(id) ?? []).flatMap((c) => {
      const col = ctx.columns.get(c.column_id);
      if (!col) return [];
      const text = valueText(col.kind, c.value, col, ctx);
      return text
        ? [`${sanitizeInline(col.name)}: ${sanitizeInline(text)}`]
        : [];
    });
    return `- ${id} | ${sanitizeInline(it.name)} | group ${it.groupId} | ${cells.join(" · ") || "no values"}`;
  });
}

export function buildUserPrompt(input: PromptInput): string {
  const { snapshot, ctx, signals, transcript, now, timezone } = input;
  const groups = snapshot.groups.map(
    (g) => `${g.id} | ${sanitizeInline(g.name)}`,
  );
  const columns = [...ctx.columns.values()].map((c) => {
    const opts = c.options.size
      ? ` | options: ${[...c.options].map(([id, label]) => `${id}=${sanitizeInline(label)}`).join(", ")}`
      : "";
    return `${c.id} | ${sanitizeInline(c.name)} | ${c.kind}${opts}`;
  });
  const members = [...ctx.members].map(
    ([id, name]) => `${id} | ${sanitizeInline(name)}`,
  );
  return [
    `Board "${sanitizeInline(snapshot.board.name)}" (id ${snapshot.board.id}), ${snapshot.rowCount} items. Now: ${now} (${timezone}).`,
    "",
    "=== SIGNALS ===",
    ...(signals.length
      ? signals.map(
          (s) =>
            `${s.kind} | count ${s.count} | ${sanitizeInline(s.label)} | items: ${s.itemIds.slice(0, 20).join(", ")}${s.itemIds.length > 20 ? ", …" : ""}`,
        )
      : ["none — all on track"]),
    "",
    "=== GROUPS ===",
    ...groups,
    "",
    "=== COLUMNS ===",
    ...columns,
    "",
    "=== MEMBERS ===",
    ...members,
    "",
    "=== ITEMS ===",
    ...buildItemRoster(input),
    "",
    "=== RECENT ACTIVITY (7 days) ===",
    transcript || "no activity in the last 7 days",
    "",
    "=== END ===",
  ].join("\n");
}
