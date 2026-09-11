"use server";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { getBoardAccess, getBoardPayload } from "@/lib/boards/queries";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import { notifyNewAssignees } from "@/lib/boards/actions/assign-notify";
import { cellValueSchema, type ColumnKind } from "@/lib/validations/boards";
import { fail, type ActionResult } from "@/lib/actions/result";
import {
  applySuggestionSchema,
  revertSuggestionSchema,
} from "@/lib/validations/board-intelligence";
import type { BoardEffect } from "@/lib/ai/write/effects";
import type { Json } from "@/types/database.types";
import {
  applyCellWrites,
  applyNudge,
  isActionApplicable,
  planCellWrites,
  type BeforeValue,
} from "./apply-core";
import { buildBoardContext } from "./board-context";
import { rowToRun, type BoardIntelligenceRun } from "./runs";

const EDITOR_ONLY = "Only editors can apply suggestions.";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

async function loadRun(supabase: ServerClient, runId: string) {
  const { data } = await supabase
    .from("board_intelligence_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  return data ? rowToRun(data) : null;
}

async function setApplied(
  supabase: ServerClient,
  run: BoardIntelligenceRun,
  applied: string[],
) {
  const { data, error } = await supabase
    .from("board_intelligence_runs")
    .update({ applied })
    .eq("id", run.id)
    .select("*")
    .single();
  const next = data ? rowToRun(data) : null;
  if (error || !next)
    throw new Error(error?.message ?? "Couldn't update the brief.");
  return next;
}

export async function applySuggestion(input: {
  runId: string;
  suggestionId: string;
  actionIndex: number;
}): Promise<
  ActionResult<{
    before: BeforeValue[];
    updateIds: string[];
    effects: BoardEffect[];
    run: BoardIntelligenceRun;
  }>
> {
  const parsed = applySuggestionSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid suggestion.");
  const user = await requireUser();
  const supabase = await createClient();
  const run = await loadRun(supabase, parsed.data.runId);
  if (!run) return fail("Brief not found.");
  const access = await getBoardAccess(run.boardId);
  if (access !== "owner" && access !== "editor") return fail(EDITOR_ONLY);
  const suggestion = run.payload.suggestions.find(
    (s) => s.id === parsed.data.suggestionId,
  );
  const action = suggestion?.actions[parsed.data.actionIndex];
  if (!suggestion || !action) return fail("Suggestion not found.");
  if (action.type === "filter") return fail("This action runs in the browser.");
  const payload = await getBoardPayload(run.boardId);
  if (!payload) return fail("Board not found.");
  const members = (await listOrgMembersCached(payload.board.org_id)).map(
    (m) => ({ userId: m.userId, fullName: m.fullName }),
  );
  const ctx = buildBoardContext(payload, members);
  if (!isActionApplicable(action, ctx))
    return fail("This suggestion no longer matches the board.");
  try {
    let before: BeforeValue[] = [];
    let updateIds: string[] = [];
    let effects: BoardEffect[] = [];
    if (action.type === "nudge") {
      const { updateId } = await applyNudge(supabase, {
        orgId: ctx.orgId,
        boardId: run.boardId,
        itemId: action.itemId,
        actorId: user.id,
        userId: action.userId,
        message: action.message,
      });
      updateIds = [updateId];
    } else {
      const plan = planCellWrites(action, ctx, payload.cellValues);
      if (!plan.ok) return fail(plan.error);
      ({ before, effects } = await applyCellWrites(
        supabase,
        run.boardId,
        plan.writes,
      ));
      if (action.type === "reassign") {
        for (const b of before) {
          const prior =
            (b.value as { userIds?: string[] } | null)?.userIds ?? [];
          await notifyNewAssignees(supabase, {
            orgId: ctx.orgId,
            boardId: run.boardId,
            itemId: b.itemId,
            actorId: user.id,
            prior,
            next: [action.toUserId],
          });
        }
      }
    }
    const next = await setApplied(
      supabase,
      run,
      Array.from(new Set([...run.applied, suggestion.id])),
    );
    return { ok: true, data: { before, updateIds, effects, run: next } };
  } catch (e) {
    return fail(
      e instanceof Error ? e.message : "Couldn't apply the suggestion.",
    );
  }
}

export async function revertSuggestion(input: {
  runId: string;
  suggestionId: string;
  before: BeforeValue[];
  updateIds: string[];
}): Promise<
  ActionResult<{ effects: BoardEffect[]; run: BoardIntelligenceRun }>
> {
  const parsed = revertSuggestionSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid undo data.");
  const user = await requireUser();
  const supabase = await createClient();
  const run = await loadRun(supabase, parsed.data.runId);
  if (!run) return fail("Brief not found.");
  const access = await getBoardAccess(run.boardId);
  if (access !== "owner" && access !== "editor") return fail(EDITOR_ONLY);
  const payload = await getBoardPayload(run.boardId);
  if (!payload) return fail("Board not found.");
  const kinds = new Map(payload.columns.map((c) => [c.id, c.kind]));
  const writes = [];
  for (const b of parsed.data.before) {
    const kind = kinds.get(b.columnId);
    if (!kind || !payload.items.some((i) => i.id === b.itemId))
      return fail("Invalid undo data.");
    if (b.value === null || b.value === undefined) {
      writes.push({ item_id: b.itemId, column_id: b.columnId, value: null });
      continue;
    }
    const v = cellValueSchema(kind as ColumnKind).safeParse(b.value);
    if (!v.success) return fail("Invalid undo data.");
    writes.push({
      item_id: b.itemId,
      column_id: b.columnId,
      value: v.data as Json,
    });
  }
  try {
    const effects: BoardEffect[] = [];
    if (writes.length)
      effects.push(
        ...(await applyCellWrites(supabase, run.boardId, writes)).effects,
      );
    if (parsed.data.updateIds.length) {
      const { error } = await supabase
        .from("item_updates")
        .delete()
        .in("id", parsed.data.updateIds)
        .eq("author_id", user.id);
      if (error) throw new Error(error.message);
    }
    const next = await setApplied(
      supabase,
      run,
      run.applied.filter((id) => id !== parsed.data.suggestionId),
    );
    return { ok: true, data: { effects, run: next } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Couldn't undo.");
  }
}
