import type { Tables } from "@/types/database.types";
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

// NOTE (Task 6): Task 5 owns the full build-out of this module
// (`getLatestBoardIntelligenceRun`, `isRunStale`) — this task only needed
// `rowToRun` (apply.ts loads a run by id), implemented exactly as the Task 5
// brief specifies it so the two land without conflict.
/** Map a DB row to the app shape, failing CLOSED on a payload an older
 *  client wrote in another shape (`payloadSchema.safeParse` → null). */
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
