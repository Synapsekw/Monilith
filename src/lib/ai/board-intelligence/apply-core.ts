import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { BoardEffect } from "@/lib/ai/write/effects";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { cellValueSchema, type ColumnKind } from "@/lib/validations/boards";
import type { Database, Json, Tables } from "@/types/database.types";
import type { BoardContext } from "./board-context";
import type { Action } from "./schema";
import { toAction } from "./validate";

export type CellWrite = {
  item_id: string;
  column_id: string;
  value: Json | null;
};
export type BeforeValue = {
  itemId: string;
  columnId: string;
  value: unknown | null;
};
export type ApplyOutcome = {
  before: BeforeValue[];
  updateIds: string[];
  effects: BoardEffect[];
};

type CellAction = Extract<
  Action,
  { type: "reassign" | "set_due" | "set_status" }
>;

/** Turn a cell-writing action into RPC writes, validating every value with
 *  the SAME per-kind schema `upsertCellCore` uses (gotcha-60: one boundary). */
export function planCellWrites(
  action: CellAction,
  ctx: BoardContext,
  cellValues: readonly { item_id: string; column_id: string; value: unknown }[],
): { ok: true; writes: CellWrite[] } | { ok: false; error: string } {
  const col = ctx.columns.get(action.columnId);
  if (!col) return { ok: false, error: "Column not found." };
  const current = (itemId: string) =>
    cellValues.find(
      (c) => c.item_id === itemId && c.column_id === action.columnId,
    )?.value as Record<string, unknown> | undefined;
  const pairs: { itemId: string; value: unknown }[] =
    action.type === "reassign"
      ? action.itemIds.map((itemId) => ({
          itemId,
          value: { userIds: [action.toUserId] },
        }))
      : action.type === "set_due"
        ? [
            {
              itemId: action.itemId,
              value: {
                date: action.date,
                ...(typeof current(action.itemId)?.end === "string"
                  ? { end: current(action.itemId)!.end }
                  : {}),
              },
            },
          ]
        : [{ itemId: action.itemId, value: { optionId: action.optionId } }];
  const writes: CellWrite[] = [];
  for (const p of pairs) {
    const parsed = cellValueSchema(col.kind as ColumnKind).safeParse(p.value);
    if (!parsed.success)
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid value",
      };
    writes.push({
      item_id: p.itemId,
      column_id: action.columnId,
      value: parsed.data as Json,
    });
  }
  return { ok: true, writes };
}

const rpcResultSchema = z.object({
  before: z.array(
    z.object({
      item_id: z.string(),
      column_id: z.string(),
      value: z.unknown(),
    }),
  ),
  cells: z.array(
    z.union([
      z.object({
        item_id: z.string(),
        column_id: z.string(),
        cleared: z.literal(true),
      }),
      // The non-cleared arm is the authoritative `cell_values` row the RPC
      // returns via `to_jsonb(v_row)` — no synthetic id (item_id/column_id
      // is the primary key) — so shape-gate loosely and cast to the
      // generated row type below rather than re-declaring every column here.
      z.record(z.string(), z.unknown()),
    ]),
  ),
});

/** ONE transaction: before-values out, authoritative rows out, activity rows
 *  stamped source = 'intelligence'. Throws on an RPC error (the caller maps it). */
export async function applyCellWrites(
  supabase: SupabaseClient<Database>,
  boardId: string,
  writes: CellWrite[],
): Promise<{ before: BeforeValue[]; effects: BoardEffect[] }> {
  const { data, error } = await typedRpc(supabase, "apply_intelligence_cells", {
    p_board_id: boardId,
    p_writes: writes as unknown as Json,
  });
  if (error) throw new Error(error.message);
  const out = rpcResultSchema.parse(data);
  const before = out.before.map((b) => ({
    itemId: b.item_id,
    columnId: b.column_id,
    value: b.value ?? null,
  }));
  const rows = out.cells.filter(
    (c) => !("cleared" in c),
  ) as unknown as Tables<"cell_values">[];
  const cleared = out.cells.filter(
    (c): c is { item_id: string; column_id: string; cleared: true } =>
      "cleared" in c,
  );
  const effects: BoardEffect[] = [];
  if (rows.length)
    effects.push({ kind: "item_fields_set", boardId, cells: rows });
  if (cleared.length)
    effects.push({
      kind: "cells_cleared",
      boardId,
      cells: cleared.map((c) => ({ itemId: c.item_id, columnId: c.column_id })),
    });
  return { before, effects };
}

/** Nudge = an update on the item, as the current user, plus a mention
 *  notification for the target (the automations `notify` shape). */
export async function applyNudge(
  supabase: SupabaseClient<Database>,
  args: {
    orgId: string;
    boardId: string;
    itemId: string;
    actorId: string;
    userId: string;
    message: string;
  },
): Promise<{ updateId: string }> {
  const { data, error } = await supabase
    .from("item_updates")
    .insert({
      org_id: args.orgId,
      board_id: args.boardId,
      item_id: args.itemId,
      author_id: args.actorId,
      body: { text: args.message },
      body_text: args.message,
    })
    .select("id")
    .single();
  if (error || !data)
    throw new Error(error?.message ?? "Couldn't post the nudge.");
  if (args.userId !== args.actorId) {
    const { error: nErr } = await supabase.from("notifications").insert({
      org_id: args.orgId,
      recipient_id: args.userId,
      actor_id: args.actorId,
      kind: "mention",
      board_id: args.boardId,
      item_id: args.itemId,
      update_id: data.id,
    });
    if (nErr)
      console.error("[intelligence] nudge notification failed", {
        itemId: args.itemId,
        error: nErr.message,
      });
  }
  return { updateId: data.id };
}

/** Spec §7: validate against the board's CURRENT items and members at apply time. */
export function isActionApplicable(action: Action, ctx: BoardContext): boolean {
  const base = {
    itemIds: null,
    itemId: null,
    columnId: null,
    toUserId: null,
    date: null,
    optionId: null,
    userId: null,
    message: null,
    signalKind: null,
  };
  const raw =
    action.type === "reassign"
      ? {
          ...base,
          type: action.type,
          itemIds: action.itemIds,
          columnId: action.columnId,
          toUserId: action.toUserId,
        }
      : action.type === "set_due"
        ? {
            ...base,
            type: action.type,
            itemId: action.itemId,
            columnId: action.columnId,
            date: action.date,
          }
        : action.type === "set_status"
          ? {
              ...base,
              type: action.type,
              itemId: action.itemId,
              columnId: action.columnId,
              optionId: action.optionId,
            }
          : action.type === "nudge"
            ? {
                ...base,
                type: action.type,
                itemId: action.itemId,
                userId: action.userId,
                message: action.message,
              }
            : { ...base, type: action.type, signalKind: action.signalKind };
  const re = toAction(raw, ctx);
  if (!re) return false;
  // Every id the stored action names must still resolve (reassign: ALL items).
  return (
    action.type !== "reassign" ||
    (re.type === "reassign" && re.itemIds.length === action.itemIds.length)
  );
}
