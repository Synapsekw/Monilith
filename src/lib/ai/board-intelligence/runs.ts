import type { BoardIntelligencePayload } from "./schema";
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
