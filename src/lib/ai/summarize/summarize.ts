import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "@/lib/ai/providers/anthropic";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import {
  resolveActivity,
  type ActivityDescriptor,
  type Column,
  type Member,
} from "@/lib/collaboration/activity";
import type { Tables } from "@/types/database.types";

export type ItemUpdateRow = Tables<"item_updates">;
export type ItemActivityRow = Tables<"item_activities">;

const SYSTEM = [
  "You summarize the discussion thread on a single work-board item for someone catching up.",
  "Base the summary ONLY on the transcript given below — never invent updates, decisions, or people not present there.",
  "Write a short, plain-text summary (a few sentences, or a short list) covering: what happened, the current state, and any open questions or blockers.",
  "Do not use markdown headings; plain prose or a simple dash list is fine.",
].join("\n");

function nameOf(userId: string | null, members: readonly Member[]): string {
  if (!userId) return "Someone";
  return members.find((m) => m.userId === userId)?.fullName ?? "Someone";
}

/** Mirrors ActivityRow.tsx's <Chip> rendering, but as plain text for the
 *  transcript fed to the model (no JSX / color styling relevant there). */
function chipText(
  value: { label: string; color: string } | string | null,
): string {
  if (value === null) return "—";
  if (typeof value === "string") return value;
  return value.label;
}

/** Plain-text line for one resolved activity descriptor. Mirrors the
 *  human-readable phrasing in ActivityRow.tsx (kept in sync deliberately —
 *  same descriptor kinds, same copy). */
function describeActivityLine(descriptor: ActivityDescriptor): string {
  switch (descriptor.kind) {
    case "item_created":
      return "created this item";
    case "item_deleted":
      return "deleted this item";
    case "item_moved":
      return "moved this item to another group";
    case "update_added":
      return "posted an update";
    case "item_renamed":
      return `renamed ${chipText(descriptor.from)} → ${chipText(descriptor.to)}`;
    case "cell_changed":
      return `${descriptor.columnName}: ${chipText(descriptor.from)} → ${chipText(descriptor.to)}`;
  }
}

type TranscriptEntry = { at: string; line: string };

/**
 * Build a bounded, chronological (oldest → newest) plain-text transcript
 * from an item's updates + activities. Both source reads arrive newest-first
 * (matches useItemCollab's `.order("created_at", { ascending: false })`), so
 * they're merged and re-sorted ascending here for a readable narrative.
 *
 * Returns "" (the empty sentinel) when there is nothing to summarize, so
 * callers can gate on it before spending any AI tokens.
 */
export function buildTranscript(args: {
  updates: readonly ItemUpdateRow[];
  activities: readonly ItemActivityRow[];
  columns: readonly Column[];
  members: readonly Member[];
}): string {
  const { updates, activities, columns, members } = args;
  if (updates.length === 0 && activities.length === 0) return "";

  const entries: TranscriptEntry[] = [
    ...updates.map(
      (u): TranscriptEntry => ({
        at: u.created_at,
        line: `${nameOf(u.author_id, members)}: ${u.body_text}`,
      }),
    ),
    ...activities.map((a): TranscriptEntry => {
      const descriptor = resolveActivity(a, columns, members);
      return {
        at: a.created_at,
        line: `${nameOf(a.actor_id, members)} ${describeActivityLine(descriptor)}`,
      };
    }),
  ];

  // ISO 8601 timestamps sort lexicographically = chronologically.
  entries.sort((a, b) => a.at.localeCompare(b.at));

  return entries.map((e) => `[${e.at}] ${e.line}`).join("\n");
}

/** Concatenate the text blocks of a model response, dropping other block
 *  kinds (mirrors ask.ts's textOf). */
function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/**
 * Build the transcript and ask Anthropic for a plain-text "catch me up"
 * summary. `client` is injectable for tests (mirrors askPulseStream /
 * generateItemAssist) so unit tests never make a network call.
 */
export async function summarizeThread(args: {
  apiKey: string;
  updates: readonly ItemUpdateRow[];
  activities: readonly ItemActivityRow[];
  columns: readonly Column[];
  members: readonly Member[];
  client?: Anthropic;
}): Promise<{ summary: string; usage: AiUsageTokens }> {
  const transcript = buildTranscript(args);
  const client = args.client ?? new Anthropic({ apiKey: args.apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: "user", content: transcript }],
  });

  return {
    summary: textOf(response.content),
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
