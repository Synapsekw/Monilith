import type { SignalKind } from "@/lib/boards/intelligence/types";

/**
 * Placeholder shared types for Board Intelligence Phase 2 (spec §4.4). Task 3
 * owns `schema.ts` (the Zod source of truth for these shapes, plus the
 * model-facing JSON schema and validation) and will re-export
 * `BoardIntelligencePayload` / `Suggestion` / `Action` / `SuggestionKind` from
 * there, keeping `BoardIntelligenceRun` here. Declared here, plainly, only so
 * the bridge store (Task 2) typechecks ahead of Task 3 landing — no `server-only`
 * so the client store can import the types.
 */
export type SuggestionKind =
  "overdue" | "blocked" | "overloaded" | "stalled" | "changed" | "other";

export type Action =
  | {
      type: "reassign";
      itemIds: string[];
      columnId: string;
      toUserId: string;
      label: string;
    }
  | {
      type: "set_due";
      itemId: string;
      columnId: string;
      date: string;
      label: string;
    }
  | {
      type: "set_status";
      itemId: string;
      columnId: string;
      optionId: string;
      label: string;
    }
  | {
      type: "nudge";
      itemId: string;
      userId: string;
      message: string;
      label: string;
    }
  | { type: "filter"; signalKind: SignalKind; label: string };

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  title: string;
  evidence: string;
  body: string;
  evidenceRows: { itemId: string; name: string; detail: string }[];
  actions: Action[];
}

export interface BoardIntelligencePayload {
  brief: string;
  suggestions: Suggestion[];
  signals: { kind: SignalKind; count: number; label: string }[];
}

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
