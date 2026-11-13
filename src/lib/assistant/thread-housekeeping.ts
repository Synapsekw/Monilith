import "server-only";
import { generateText, type LanguageModel } from "ai";
import { toAiUsage } from "@/lib/ai/providers/usage";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import type { MessageRow } from "@/lib/ai/ask/conversations";

/** Fold older turns into the rolling summary. Same prompt as Ask's original. */
export async function summarizeThread(
  model: LanguageModel,
  priorSummary: string | null,
  toFold: MessageRow[],
): Promise<{ summary: string; usage: AiUsageTokens }> {
  const transcript = toFold.map((m) => `${m.role}: ${m.content}`).join("\n");
  const r = await generateText({
    model,
    maxOutputTokens: 512,
    system:
      "You compress a chat transcript into a compact factual summary. Keep names, ids, decisions. No preamble.",
    prompt: `Prior summary:\n${priorSummary ?? "(none)"}\n\nNew turns to fold in:\n${transcript}`,
  });
  const summary = r.text.trim();
  return {
    summary: summary.length > 0 ? summary : (priorSummary ?? ""),
    usage: toAiUsage(r.totalUsage),
  };
}

/** A 3 to 6 word title for a fresh thread. */
export async function titleThread(
  model: LanguageModel,
  firstQuestion: string,
): Promise<{ title: string; usage: AiUsageTokens }> {
  const r = await generateText({
    model,
    maxOutputTokens: 24,
    system:
      "Reply with a 3–6 word title for this chat. No quotes, no punctuation at the end.",
    prompt: firstQuestion,
  });
  const text = r.text.trim();
  return {
    title: text.slice(0, 120) || firstQuestion.slice(0, 60),
    usage: toAiUsage(r.totalUsage),
  };
}
