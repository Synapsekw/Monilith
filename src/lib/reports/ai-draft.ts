import type { ProviderAdapter } from "@/lib/ai/providers/types";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import type { BoardSnapshot } from "@/lib/ai/board-snapshot";
import {
  REPORT_NARRATIVE_JSON_SCHEMA,
  validateNarrative,
  type ReportNarrative,
} from "@/lib/reports/ai-draft-schema";

function systemPrompt(): string {
  return [
    "You write concise status-report narratives for a project board.",
    "Return a JSON object: `summary` (2-4 sentence executive summary),",
    "`highlights` (notable done/on-track items), `risks` (blocked/overdue items).",
    "Be factual and specific to the data. No preamble.",
  ].join("\n");
}

function userPrompt(snapshot: BoardSnapshot): string {
  return `Board: ${snapshot.board.name}\nRows: ${snapshot.rowCount}\nColumns+stats:\n${JSON.stringify(snapshot.columnStats)}`;
}

export async function draftReportNarrative(
  snapshot: BoardSnapshot,
  opts: { adapter: ProviderAdapter; apiKey: string },
): Promise<{ narrative: ReportNarrative; usage: AiUsageTokens }> {
  const { data, usage } = await opts.adapter.generateStructured<unknown>({
    apiKey: opts.apiKey,
    system: systemPrompt(),
    user: userPrompt(snapshot),
    schema: REPORT_NARRATIVE_JSON_SCHEMA,
  });
  return { narrative: validateNarrative(data), usage };
}
