import "server-only";
import type { DashboardProposal } from "@/lib/ai/proposal-schema";
import type { BoardSnapshot } from "@/lib/ai/board-snapshot";
import { resolveUserAdapter } from "@/lib/ai/credentials";
import type { ProviderAdapter } from "@/lib/ai/providers/types";

/**
 * System prompt teaching the model the widget vocabulary and grid. Frozen and
 * prompt-cached (see generateProposal) so the cache prefix stays stable across
 * requests.
 */
export function buildSystemPrompt(): string {
  return [
    "You design analytics dashboards for a Monday-style work board.",
    "Output a dashboard proposal: a name and 4-6 widgets. Every widget MUST have a fully-populated config (the grid layout is handled by the app, not you).",
    "Widget kinds and their config:",
    "- number: { agg: 'count'|'sum'|'avg', valueColumnId?, display?: 'plain'|'gauge', target? }. sum/avg need a numbers column.",
    "- chart: { chartType: 'bar'|'stackedBar'|'groupedBar'|'line'|'area'|'combo'|'pie'|'donut'|'radial', primary: {kind:'status'|'dropdown'|'people'|'date', columnId?, bucket?}, series?: <same>, measure: {agg, valueColumnId?} }.",
    "- battery: { groupColumnId } — must be a status or dropdown column.",
    "- list: { columnIds: string[] (<=8), limit?: number }.",
    "Rules: only reference columnId values that exist in the snapshot. primary/series.kind MUST equal the referenced column's kind. Only status/dropdown/people/date are chartable dimensions; sum/avg measures need a numbers column.",
    "Design well: lead with 1-2 headline number widgets (e.g. total count), then 2-4 charts over the status/date columns, optionally a battery or list. Prefer pie/donut for low-cardinality status; bar for categories; line/area for date trends. Don't chart near-empty columns. Give each widget a short human title.",
  ].join("\n");
}

function buildUserPrompt(snap: BoardSnapshot, feedback?: string): string {
  return [
    `Board snapshot (schema + aggregate stats, no raw rows):`,
    JSON.stringify(snap),
    feedback ? `\nUser feedback for this revision: ${feedback}` : "",
  ].join("\n");
}

/**
 * Propose a dashboard for the given board snapshot using the current user's
 * configured AI provider. The adapter + key are dependency-injected in tests
 * (opts.adapter/opts.apiKey); production resolves them from the user's stored
 * credential via resolveUserAdapter().
 */
export async function generateProposal(
  snap: BoardSnapshot,
  opts: {
    adapter?: ProviderAdapter;
    apiKey?: string;
    feedback?: string;
  } = {},
): Promise<DashboardProposal> {
  const { adapter, apiKey } =
    opts.adapter && opts.apiKey
      ? { adapter: opts.adapter, apiKey: opts.apiKey }
      : await resolveUserAdapter();

  return adapter.generateProposal({
    apiKey,
    system: buildSystemPrompt(),
    user: buildUserPrompt(snap, opts.feedback),
  });
}
