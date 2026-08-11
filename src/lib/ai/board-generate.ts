import "server-only";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import {
  BOARD_PROPOSAL_JSON_SCHEMA,
  type BoardProposal,
} from "@/lib/ai/board-gen-schema";
import type { ProviderAdapter } from "@/lib/ai/providers/types";
import { toRequestArgs } from "@/lib/ai/providers/request";

/**
 * System prompt teaching the model how to design a starter board: the column
 * kinds and which carry options, the temp-id contract, and layout heuristics.
 * Frozen + prompt-cached (see generateBoardProposal) so the cache prefix stays
 * stable across requests. Mirrors generate.ts (dashboard-gen).
 */
export function buildBoardGenSystemPrompt(): string {
  return [
    "You design starter work boards for a Monday-style Work OS.",
    "Output a board proposal: a name, 2-4 groups, a set of columns, and 5-15 realistic starter items.",
    "",
    'IDS: every group/column uses a temporary string `tempId` (e.g. "g1", "col-1"). NEVER invent UUIDs — the app mints real ids and remaps your tempIds. Items reference a group by `groupTempId` and each cell references a column by `columnTempId`, using the tempIds you assigned.',
    "",
    "COLUMN KINDS: text, status, people, date, numbers, dropdown, checkbox, rating, link, email, phone, files, time_tracking, percent, currency, priority. (Do NOT use relation or mirror — they need another board.)",
    'OPTIONS: only `status` and `dropdown` columns carry options. Supply `options: [{label, color?}]`. For every status/dropdown cell, reference an option BY ITS LABEL: status cell value = { optionId: "<label>" }; dropdown cell value = { optionIds: ["<label>", …] }.',
    "",
    "CELL VALUES (shape per kind): text {text}; numbers {n}; date {date:'YYYY-MM-DD', end?}; checkbox {checked}; percent {percent:0-100}; rating {rating:1-5}; currency {amount}; priority {level:'normal'|'critical'}; email {email}; phone {phone}; link {url:'https://…', text?}; people {userIds:[]} (leave empty — the board has no members yet).",
    "",
    "DESIGN A USABLE STARTER BOARD: lead with a Status column, then an Owner (people) column and a Date column, then 2-6 domain columns that fit the request. Give realistic starter items spread across the groups with kind-correct cells. Keep names short and human. Only emit cells you can fill meaningfully.",
  ].join("\n");
}

function buildUserPrompt(prompt: string, feedback?: string): string {
  return [
    `Design a board for this request:`,
    prompt,
    feedback ? `\nUser feedback for this revision: ${feedback}` : "",
  ].join("\n");
}

/**
 * Propose a board for the given free-text description. The adapter + key are
 * resolved by the metered AI gateway (see runAi) and passed in — this function
 * never resolves credentials itself, so every call is entitlement-gated and
 * metered by the caller. Returns the RAW proposal; the caller re-validates it
 * with validateBoardProposal before anything is persisted.
 */
export async function generateBoardProposal(
  prompt: string,
  opts: {
    adapter: ProviderAdapter;
    apiKey: string;
    baseUrl?: string | null;
    feedback?: string;
    /** The WIRE model id to run (`ResolvedModel.requestModel`). */
    model: string;
  },
): Promise<{ proposal: BoardProposal; usage: AiUsageTokens; model: string }> {
  const { data, usage, model } =
    await opts.adapter.generateStructured<BoardProposal>({
      ...toRequestArgs(opts),
      system: buildBoardGenSystemPrompt(),
      user: buildUserPrompt(prompt, opts.feedback),
      schema: BOARD_PROPOSAL_JSON_SCHEMA,
    });
  return { proposal: data, usage, model };
}
