import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database.types";
import { INTELLIGENCE_STALE_MS } from "@/lib/boards/intelligence/constants";
import { payloadSchema, type BoardIntelligencePayload } from "./schema";
export type {
  Action,
  BoardIntelligencePayload,
  Suggestion,
  SuggestionKind,
} from "./schema";

export type BoardIntelligenceRun = {
  id: string;
  boardId: string;
  generatedAt: string;
  inputHash: string;
  payload: BoardIntelligencePayload;
  dismissed: string[];
  applied: string[];
  model: string | null;
  tokensIn: number;
  tokensOut: number;
};

/** DB row → app shape, re-validating the stored jsonb against `payloadSchema`
 *  on every read (fails closed on a malformed/older-shape payload). */
export function rowToRun(
  row: Tables<"board_intelligence_runs">,
): BoardIntelligenceRun | null {
  const payload = payloadSchema.safeParse(row.payload);
  if (!payload.success) return null;
  return {
    id: row.id,
    boardId: row.board_id,
    generatedAt: row.generated_at,
    inputHash: row.input_hash,
    payload: payload.data,
    dismissed: row.dismissed,
    applied: row.applied,
    model: row.model,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
  };
}

/** Spec §8: ONE indexed LIMIT 1 read on (board_id, user_id, generated_at desc).
 *  Never throws — a missing row, an RLS denial or a transport error is "no run". */
export async function getLatestBoardIntelligenceRun(
  supabase: SupabaseClient<Database>,
  boardId: string,
  userId: string,
): Promise<BoardIntelligenceRun | null> {
  const { data, error } = await supabase
    .from("board_intelligence_runs")
    .select("*")
    .eq("board_id", boardId)
    .eq("user_id", userId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return rowToRun(data);
}

export function isRunStale(
  run: BoardIntelligenceRun,
  opts: { nowMs: number; inputHash: string },
): boolean {
  const at = Date.parse(run.generatedAt);
  if (Number.isNaN(at)) return true;
  return (
    opts.nowMs - at >= INTELLIGENCE_STALE_MS || run.inputHash !== opts.inputHash
  );
}
