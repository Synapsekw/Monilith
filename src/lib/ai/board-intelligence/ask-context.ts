import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { BoardIntelligenceRun } from "./runs";
import type { IntelAskRequest } from "./ask-input";

/**
 * The system prompt for one Q&A turn: this board, and the brief the reader is
 * looking at. The run payload is the grounding — the reader's question is
 * nearly always about something the brief just told them (spec §3.1).
 */
export function buildIntelAskSystem(
  run: BoardIntelligenceRun,
  board: { id: string; name: string },
): string {
  // The SAME filter the tab renders through (`use-intelligence-run.ts`'s
  // `visible`): a dismissed or applied card is gone from the screen, so listing
  // it as "ON SCREEN" invites the model to answer "as the overdue card above
  // suggests… you can apply it from a suggestion card" about a card the user
  // just made disappear. The prompt must describe what the reader is looking
  // at, not what the run once held.
  const gone = new Set([...run.dismissed, ...run.applied]);
  const suggestions = run.payload.suggestions
    .filter((s) => !gone.has(s.id))
    .map((s) => `- ${s.title}: ${s.body}`)
    .join("\n");
  return [
    `You are the Intelligence assistant for the Monolith board "${board.name}" (id ${board.id}).`,
    "Answer questions about THIS board only, grounded in the brief below and in the read tools.",
    "Use query_items and semantic_search_items for anything the brief does not already say. Never fabricate an item, a person or a date.",
    "You cannot change the board. If asked to, say what you would change and that the user can apply it from a suggestion card.",
    "Answer in at most four sentences unless asked for more.",
    "",
    `BRIEF (generated ${run.generatedAt}):`,
    run.payload.brief,
    suggestions ? `\nSUGGESTIONS ON SCREEN:\n${suggestions}` : "",
  ].join("\n");
}

/**
 * The turn's messages: the replayed Q&A pairs, then the new question. Same
 * `MessageParam[]` shape `buildAskMessages` produces — but built from the
 * REQUEST, because nothing in this turn is persisted, so there are no
 * `ai_messages` rows to read back (spec §3.2). The history is already capped
 * by `intelAskRequestSchema`, which truncates rather than rejecting.
 */
export function buildIntelAskMessages(
  history: IntelAskRequest["history"],
  question: string,
): Anthropic.MessageParam[] {
  return [
    ...history.flatMap((pair): Anthropic.MessageParam[] => [
      { role: "user", content: pair.question },
      { role: "assistant", content: pair.answer },
    ]),
    { role: "user", content: question },
  ];
}
