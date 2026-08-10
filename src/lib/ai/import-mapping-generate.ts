import "server-only";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import type { ProviderAdapter } from "@/lib/ai/providers/types";
import { toRequestArgs } from "@/lib/ai/providers/request";
import type { ModelChoice } from "@/lib/ai/model-map";
import {
  IMPORT_MAPPING_JSON_SCHEMA,
  type MappingSuggestion,
} from "@/lib/ai/import-mapping-schema";
import { IMPORTABLE_KINDS } from "@/lib/boards/spreadsheet/types";

/**
 * The bounded, capped egress payload sent to the model to infer a mapping.
 * `columns` carries the header and a SMALL sample of verbatim cell values per
 * column (the caps are enforced server-side in the action). `boardColumns` is
 * only present in existing-board mode, so the model can propose merge targets.
 */
export type ImportMappingPayload = {
  columns: { sourceIndex: number; header: string; sampleValues: string[] }[];
  boardColumns?: { id: string; name: string; kind: string }[];
};

/**
 * System prompt teaching the model the importable column kinds, the name/data
 * role semantics, and the "only target an existing column when confident" rule.
 * Frozen and prompt-cached (see generateImportMapping) so the cache prefix stays
 * stable across requests.
 */
export function buildImportMappingSystemPrompt(): string {
  return [
    "You map spreadsheet columns onto a Monday-style work board so they can be imported.",
    "For each source column you are given, output ONE suggestion: { sourceIndex, kind, role, targetColumnId? }.",
    "Copy `sourceIndex` verbatim from the column you are describing — never invent one.",
    `Pick a kind from this set (choose the most specific that fits the sample values): ${IMPORTABLE_KINDS.join(", ")}.`,
    "Kind hints: status/dropdown for a small set of repeated labels (dropdown allows multiple per cell); numbers/currency/percent/rating for numeric data; date for dates; checkbox for true/false; email/link/phone for those formats; priority for Low/Medium/High-style labels; text otherwise.",
    "`role`: set exactly ONE column to 'name' — the column that best names each row (a title/task/summary). Every other column is 'data'.",
    "Existing-column targeting: when board columns are provided, set `targetColumnId` to an existing board column's id ONLY when you are confident the source column is the same field (matching meaning AND compatible kind). Otherwise omit `targetColumnId` to create a new column.",
    "Return one suggestion per source column you can classify; omit a column entirely if you truly can't.",
  ].join("\n");
}

function buildUserPrompt(payload: ImportMappingPayload): string {
  return [
    "Source columns (header + a few sample cell values):",
    JSON.stringify(payload.columns),
    payload.boardColumns && payload.boardColumns.length > 0
      ? `\nExisting board columns you may target: ${JSON.stringify(payload.boardColumns)}`
      : "\nThis is a brand-new board — there are no existing columns to target; propose new columns.",
  ].join("\n");
}

/**
 * Ask the model for per-column mapping suggestions. The adapter + key are
 * resolved by the metered AI gateway (see runAi) and passed in, so every call
 * is entitlement-gated and metered by the caller. The raw suggestions are
 * clamped/filtered by the action before they reach client state.
 */
export async function generateImportMapping(
  payload: ImportMappingPayload,
  opts: {
    adapter: ProviderAdapter;
    apiKey: string;
    baseUrl?: string | null;
    choice?: ModelChoice;
  },
): Promise<{
  suggestions: MappingSuggestion[];
  usage: AiUsageTokens;
  model: string;
}> {
  const { data, usage, model } = await opts.adapter.generateStructured<{
    suggestions?: MappingSuggestion[];
  }>({
    ...toRequestArgs(opts),
    system: buildImportMappingSystemPrompt(),
    user: buildUserPrompt(payload),
    schema: IMPORT_MAPPING_JSON_SCHEMA,
  });
  return { suggestions: data?.suggestions ?? [], usage, model };
}
