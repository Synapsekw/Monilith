import type { Tables } from "@/types/database.types";

/**
 * What an approved AI write DID, as authoritative rows the server just produced.
 *
 * Deliberately NOT part of `ExecutionResult`: that shape is persisted into
 * `ai_messages.tool_trace` jsonb and read back forever, so rows inside it would
 * bloat every thread and replay STALE data into the board cache whenever an old
 * thread is reopened. An effect is transient — it lives only for the duration of
 * the approve response, so the acting client can render its own change without a
 * refetch (gotcha-13: the echo reconciles PEERS, it is never the actor's source
 * of truth).
 *
 * A plain module on purpose: `execute.ts` is `server-only` and both approve
 * actions are `"use server"`, where a non-async export fails only `pnpm build`.
 * Both sides import from here.
 */
export type BoardEffect =
  | {
      kind: "item_created";
      boardId: string;
      item: Tables<"items">;
      /** Cells written by the action's `fields`, if any. */
      cells: Tables<"cell_values">[];
    }
  | {
      kind: "item_moved";
      boardId: string;
      item: Tables<"items">;
      /** Subitems whose denormalized group_id moved with the parent. */
      subitemIds: string[];
    }
  | {
      kind: "item_fields_set";
      boardId: string;
      cells: Tables<"cell_values">[];
    }
  | {
      kind: "group_created";
      boardId: string;
      group: Tables<"groups">;
    };
