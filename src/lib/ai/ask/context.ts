import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { MessageRow } from "./conversations";

export const KEEP_RECENT = 10; // verbatim turns; older fold into the rolling summary

/** Map DB message rows to Anthropic message params in order. */
export function buildAskMessages(rows: MessageRow[]): Anthropic.MessageParam[] {
  return rows.map((r) => ({
    role: r.role as "user" | "assistant",
    content: r.content,
  }));
}

/** Split a thread into the older turns to fold into the rolling summary and the
 *  most-recent `keepRecent` turns kept verbatim. Bounds per-turn token cost as a
 *  thread grows (working agreement #5). */
export function splitForCompaction(
  rows: MessageRow[],
  keepRecent = KEEP_RECENT,
): {
  toFold: MessageRow[];
  recent: MessageRow[];
} {
  if (rows.length <= keepRecent) return { toFold: [], recent: rows };
  const cut = rows.length - keepRecent;
  return { toFold: rows.slice(0, cut), recent: rows.slice(cut) };
}

/** Append the rolling summary block to the base system prompt when present. */
export function composeSystem(
  baseSystem: string,
  summary: string | null,
): string {
  if (!summary) return baseSystem;
  return `${baseSystem}\n\nConversation so far (summary of earlier turns):\n${summary}`;
}

/** Concatenate the text blocks of a model response. */
function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

// Impure — summarize folded turns into an updated rolling summary. Model call injected for tests.
export async function summarize(
  client: Pick<Anthropic["messages"], "create">,
  model: string,
  priorSummary: string | null,
  toFold: MessageRow[],
): Promise<{
  summary: string;
  usage: { inputTokens: number; outputTokens: number };
}> {
  const transcript = toFold.map((m) => `${m.role}: ${m.content}`).join("\n");
  const res = await client.create({
    model,
    max_tokens: 512,
    // MUST be explicit. On Sonnet-tier models, OMITTING `thinking` runs
    // adaptive thinking at effort "high", and max_tokens caps thinking PLUS
    // response text. A thinking block would eat this 512-token budget whole:
    // the response then carries stop_reason "max_tokens" with no text block,
    // textOf() returns "", and /api/ask persists that empty summary while
    // advancing summarized_upto — silently dropping the folded turns forever.
    thinking: { type: "disabled" },
    system:
      "You compress a chat transcript into a compact factual summary. Keep names, ids, decisions. No preamble.",
    messages: [
      {
        role: "user",
        content: `Prior summary:\n${priorSummary ?? "(none)"}\n\nNew turns to fold in:\n${transcript}`,
      },
    ],
  });
  return {
    summary: textOf(res.content),
    usage: {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    },
  };
}

// Impure — a 3–6 word title for a fresh conversation from its first question.
export async function generateTitle(
  client: Pick<Anthropic["messages"], "create">,
  model: string,
  firstQuestion: string,
): Promise<{
  title: string;
  usage: { inputTokens: number; outputTokens: number };
}> {
  const res = await client.create({
    model,
    max_tokens: 24,
    // MUST be explicit — see summarize() above. 24 tokens cannot fit a thinking
    // block at all, so adaptive thinking here would return no text every time.
    thinking: { type: "disabled" },
    system:
      "Reply with a 3–6 word title for this chat. No quotes, no punctuation at the end.",
    messages: [{ role: "user", content: firstQuestion }],
  });
  const text = textOf(res.content).trim();
  return {
    title: text.slice(0, 120) || firstQuestion.slice(0, 60),
    usage: {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    },
  };
}
