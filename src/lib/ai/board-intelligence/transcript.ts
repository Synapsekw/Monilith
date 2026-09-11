import { estimateTokens } from "@/lib/agents/document-budget";
import { sanitizeInline } from "@/lib/ai/prompt-sanitize";
import { describeActivityLine } from "@/lib/ai/summarize/summarize";
import {
  resolveActivity,
  type Column,
  type Member,
} from "@/lib/collaboration/activity";
import type { Tables } from "@/types/database.types";

type Entry = { at: string; line: string };

function nameOf(userId: string | null, members: readonly Member[]): string {
  if (!userId) return "Someone";
  return sanitizeInline(
    members.find((m) => m.userId === userId)?.fullName ?? "Someone",
  );
}

/**
 * Board-level sibling of summarize.ts's buildTranscript: the same line
 * grammar, prefixed with the item name so the model can tell rows apart, and
 * trimmed OLDEST-FIRST to `tokenBudget` (the newest activity is what a brief
 * is about). Both reads arrive newest-first; output is oldest→newest.
 */
export function buildBoardTranscript(args: {
  updates: readonly Tables<"item_updates">[];
  activities: readonly Tables<"item_activities">[];
  columns: readonly Column[];
  members: readonly Member[];
  itemNames: ReadonlyMap<string, string>;
  tokenBudget: number;
}): string {
  const { updates, activities, columns, members, itemNames, tokenBudget } =
    args;
  if (updates.length === 0 && activities.length === 0) return "";
  const item = (id: string) =>
    `(${sanitizeInline(itemNames.get(id) ?? "an item")})`;
  const entries: Entry[] = [
    ...updates.map((u): Entry => ({
      at: u.created_at,
      line: `${item(u.item_id)} ${nameOf(u.author_id, members)}: ${sanitizeInline(u.body_text)}`,
    })),
    ...activities.map((a): Entry => ({
      at: a.created_at,
      line: `${item(a.item_id)} ${nameOf(a.actor_id, members)} ${sanitizeInline(describeActivityLine(resolveActivity(a, columns, members)))}`,
    })),
  ];
  entries.sort((a, b) => a.at.localeCompare(b.at));
  let lines = entries.map((e) => `[${e.at}] ${e.line}`);
  while (lines.length > 1 && estimateTokens(lines.join("\n")) > tokenBudget)
    lines = lines.slice(1);
  return lines.join("\n");
}
