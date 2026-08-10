import type { ModelChoice } from "@/lib/ai/model-map";
import type { ProviderAdapter } from "@/lib/ai/providers/types";
import { toRequestArgs } from "@/lib/ai/providers/request";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import type {
  BoardSnapshot,
  ColumnStats,
  SnapshotColumn,
} from "@/lib/ai/board-snapshot";
import {
  REPORT_NARRATIVE_JSON_SCHEMA,
  validateNarrative,
  type ReportNarrative,
} from "@/lib/reports/ai-draft-schema";

/** Structurally the same union as `ReportScope` in `@/lib/reports/queries`,
 *  restated here so this module stays free of the server-only query layer
 *  (it is pure and unit-testable without a Supabase client). */
export type ReportScopeLabel = "board" | "boards" | "portfolio" | "template";

/**
 * Prompt-size guards. A report can span many boards, so the prompt grows with
 * `boards × columns`. Both caps are deliberate (AGENTS.md working agreement #5
 * — bounded hot-path reads / bounded payloads):
 *
 * - MAX_BOARDS_PER_DRAFT bounds how many board payloads the ACTION fetches and
 *   how many sections land in the prompt. 8 boards × ~24 columns is a few KB of
 *   stats — comfortably inside a single request, and past ~8 boards a narrative
 *   is a roll-up nobody reads line by line anyway.
 * - MAX_COLUMNS_PER_BOARD bounds the per-board section. Columns are emitted in
 *   board order (the order the user arranged them), so the leftmost — and in
 *   practice the load-bearing — columns survive the trim.
 *
 * Per-column payload is already bounded upstream: `buildBoardSnapshot` caps
 * `distribution` at the top 12 labels and every other stat is a scalar.
 */
export const MAX_BOARDS_PER_DRAFT = 8;
export const MAX_COLUMNS_PER_BOARD = 24;
/** Groups are id+name only, but a pathological board can have many. */
const MAX_GROUPS_PER_BOARD = 12;

export type DraftNarrativeInput = {
  /** One snapshot per board in the report scope, in bound order. */
  snapshots: BoardSnapshot[];
  scope: ReportScopeLabel;
  /** Report name, when the caller has one — helps the model set the framing. */
  reportName?: string;
  /** How many boards the report is bound to, if MORE than `snapshots.length`
   *  (i.e. the set was truncated to the cap). Drives the "N of M" disclosure. */
  totalBoardCount?: number;
  /** Boards excluded because the caller cannot read them. Disclosed so the
   *  model never presents a partial roll-up as complete. */
  omittedForAccessCount?: number;
};

function scopeSentence(scope: ReportScopeLabel, boardCount: number): string {
  switch (scope) {
    case "board":
      return "This report covers a single board.";
    case "boards":
      return `This report covers an explicit set of ${boardCount} boards.`;
    case "portfolio":
      return `This report is a portfolio roll-up across ${boardCount} boards.`;
    case "template":
      return "This report is an organization template.";
  }
}

function systemPrompt(): string {
  return [
    "You write concise status-report narratives from board data.",
    "A report may cover one board, an explicit set of boards, or a whole portfolio roll-up.",
    "The input states the scope and contains one clearly delimited section per board.",
    "Attribute every fact to the board it came from; with several boards, roll up and compare rather than narrating each board in isolation.",
    "You are given schema and aggregate statistics ONLY — never invent item names, owners, dates or values you were not given, and never imply you saw individual rows.",
    "If the input says it covers only some of the report's boards, do not present the result as complete.",
    "Return a JSON object: `summary` (2-4 sentence executive summary of the whole scope),",
    "`highlights` (notable done/on-track signals), `risks` (blocked/overdue/stalled signals).",
    "Be factual and specific to the data. No preamble.",
  ].join("\n");
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * One line per column. The column NAME travels with its stats — `columnStats`
 * is keyed by opaque column UUIDs, so sending the map alone (as this prompt
 * used to) made the model reason about anonymous columns.
 */
function formatColumn(col: SnapshotColumn, stats: ColumnStats | undefined) {
  const bits = [`- "${col.name}" (${col.kind})`];
  if (stats) {
    bits.push(
      `filled ${pct(stats.fillRate)}`,
      `distinct ${stats.distinctCount}`,
    );
    if (stats.distribution?.length)
      bits.push(
        `distribution: ${stats.distribution.map((d) => `${d.label}=${d.count}`).join(", ")}`,
      );
    if (stats.numeric)
      bits.push(
        `min=${round2(stats.numeric.min)}, max=${round2(stats.numeric.max)}, avg=${round2(stats.numeric.avg)}, sum=${round2(stats.numeric.sum)}`,
      );
    if (stats.dateRange)
      bits.push(
        `dates ${stats.dateRange.earliest} to ${stats.dateRange.latest}`,
      );
  }
  return bits.join("; ");
}

function formatBoard(
  snapshot: BoardSnapshot,
  index: number,
  total: number,
): string {
  const header = `=== BOARD ${index + 1}/${total}: ${snapshot.board.name} ===`;
  const lines = [header, `Rows: ${snapshot.rowCount}`];

  const groups = snapshot.groups.slice(0, MAX_GROUPS_PER_BOARD);
  if (groups.length)
    lines.push(
      `Groups (${groups.length} of ${snapshot.groups.length}): ${groups.map((g) => g.name).join(", ")}`,
    );

  const columns = snapshot.columns.slice(0, MAX_COLUMNS_PER_BOARD);
  lines.push(`Columns (${columns.length} of ${snapshot.columns.length}):`);
  for (const col of columns)
    lines.push(formatColumn(col, snapshot.columnStats[col.id]));

  lines.push(`=== END BOARD ${index + 1}/${total} ===`);
  return lines.join("\n");
}

export function buildNarrativeUserPrompt(input: DraftNarrativeInput): string {
  const { snapshots, scope, reportName, totalBoardCount } = input;
  const shown = snapshots.length;
  const bound = Math.max(totalBoardCount ?? shown, shown);
  const totalRows = snapshots.reduce((sum, s) => sum + s.rowCount, 0);

  const head = [
    reportName ? `Report: ${reportName}` : null,
    // The scope sentence describes the REPORT (all bound boards); the next line
    // says how many of them are actually below.
    `Scope: ${scope}. ${scopeSentence(scope, bound)}`,
    bound > shown
      ? `Summarising ${shown} of ${bound} boards bound to this report (the first ${shown} in report order) — say so; the roll-up is partial.`
      : `Summarising all ${shown} board${shown === 1 ? "" : "s"} in this report.`,
    input.omittedForAccessCount
      ? `${input.omittedForAccessCount} further board(s) were excluded because the reader lacks access to them.`
      : null,
    `Total rows across the boards below: ${totalRows}`,
  ].filter((l): l is string => l !== null);

  return [
    ...head,
    "",
    ...snapshots.map((s, i) => formatBoard(s, i, shown)),
  ].join("\n");
}

export async function draftReportNarrative(
  input: DraftNarrativeInput,
  opts: {
    adapter: ProviderAdapter;
    apiKey: string;
    baseUrl?: string | null;
    choice?: ModelChoice;
  },
): Promise<{
  narrative: ReportNarrative;
  usage: AiUsageTokens;
  model: string;
}> {
  if (input.snapshots.length === 0)
    throw new Error("Nothing to summarise: this report has no readable board.");

  const { data, usage, model } = await opts.adapter.generateStructured<unknown>(
    {
      ...toRequestArgs(opts),
      system: systemPrompt(),
      user: buildNarrativeUserPrompt(input),
      schema: REPORT_NARRATIVE_JSON_SCHEMA,
    },
  );
  return { narrative: validateNarrative(data), usage, model };
}
