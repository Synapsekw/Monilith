"use server";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { runAi } from "@/lib/ai/gateway";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { mapAiError } from "@/lib/ai/action-guard";
import { buildBoardSnapshot } from "@/lib/ai/board-snapshot";
import { getBoardPayload } from "@/lib/boards/queries";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import { getBoardLastSeenAt } from "@/lib/boards/intelligence/visits";
import { computeSignals } from "@/lib/boards/intelligence/signals";
import {
  TRANSCRIPT_ACTIVITY_LIMIT,
  TRANSCRIPT_DAYS,
  TRANSCRIPT_TOKEN_BUDGET,
  TRANSCRIPT_UPDATES_LIMIT,
} from "@/lib/boards/intelligence/constants";
import { fail, type ActionResult } from "@/lib/actions/result";
import {
  dismissSuggestionSchema,
  runBoardIntelligenceSchema,
} from "@/lib/validations/board-intelligence";
import type { Json } from "@/types/database.types";
import { buildBoardContext } from "./board-context";
import { generateBoardIntelligence } from "./generate";
import { intelligenceInputHash } from "./input-hash";
import {
  getLatestBoardIntelligenceRun,
  isRunStale,
  rowToRun,
  type BoardIntelligenceRun,
} from "./runs";
import { buildBoardTranscript } from "./transcript";
import { validateIntelligenceOutput } from "./validate";

/**
 * "Catch me up" / Refresh / first tab open (spec §4.1). NEVER called on page
 * load. Order: RLS-scoped payload (access) → user/org → entitlement → signals
 * + input hash → cached row (served with no model call when fresh) → bounded
 * transcript reads → one metered structured call → validate → insert.
 */
export async function runBoardIntelligence(input: {
  boardId: string;
  force?: boolean;
}): Promise<ActionResult<BoardIntelligenceRun>> {
  const parsed = runBoardIntelligenceSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid board.");
  const { boardId, force = false } = parsed.data;

  const payload = await getBoardPayload(boardId);
  if (!payload) return fail("Board not found.");
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");

  try {
    await requireAiEntitlement(org.id, "board_intelligence");
    const supabase = await createClient();
    const now = new Date();
    const members = (await listOrgMembersCached(payload.board.org_id)).map(
      (m) => ({ userId: m.userId, fullName: m.fullName }),
    ); // email never reaches a prompt
    const memberNames = new Map(
      members.map((m) => [m.userId, m.fullName ?? "someone"]),
    );
    const lastSeen = await getBoardLastSeenAt(supabase, boardId, user.id);
    const signals = computeSignals(
      {
        items: payload.items,
        columns: payload.columns,
        cellValues: payload.cellValues,
        groups: payload.groups,
        dependencies: payload.dependencies,
      },
      {
        now,
        lastSeenAt: lastSeen ? new Date(lastSeen) : null,
        currentUserId: user.id,
        memberNames,
      },
    );
    const maxUpdatedAt = payload.items.reduce<string | null>(
      (m, i) => (m === null || i.updated_at > m ? i.updated_at : m),
      null,
    );
    const inputHash = intelligenceInputHash({
      itemCount: payload.items.length,
      maxUpdatedAt,
      signals,
    });

    const cached = await getLatestBoardIntelligenceRun(
      supabase,
      boardId,
      user.id,
    );
    if (
      cached &&
      !force &&
      !isRunStale(cached, { nowMs: now.getTime(), inputHash })
    )
      return { ok: true, data: cached };

    const since = new Date(
      now.getTime() - TRANSCRIPT_DAYS * 86_400_000,
    ).toISOString();
    const [{ data: activities }, { data: updates }] = await Promise.all([
      supabase
        .from("item_activities")
        .select("*")
        .eq("board_id", boardId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(TRANSCRIPT_ACTIVITY_LIMIT),
      supabase
        .from("item_updates")
        .select("*")
        .eq("board_id", boardId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(TRANSCRIPT_UPDATES_LIMIT),
    ]);
    const ctx = buildBoardContext(payload, members);
    const transcript = buildBoardTranscript({
      updates: updates ?? [],
      activities: activities ?? [],
      columns: payload.columns,
      members,
      itemNames: new Map(payload.items.map((i) => [i.id, i.name])),
      tokenBudget: TRANSCRIPT_TOKEN_BUDGET,
    });
    const snapshot = buildBoardSnapshot({
      board: { id: payload.board.id, name: payload.board.name },
      groups: payload.groups,
      columns: payload.columns,
      items: payload.items,
      cellValues: payload.cellValues,
    });

    const generated = await runAi(
      { orgId: org.id, userId: user.id, feature: "board_intelligence" },
      async ({ adapter, apiKey, baseUrl, model }) => {
        const {
          raw,
          usage,
          model: used,
        } = await generateBoardIntelligence(
          {
            snapshot,
            ctx,
            signals,
            transcript,
            now: now.toISOString(),
            timezone: org.timezone ?? "UTC",
            cellValues: payload.cellValues,
            itemsByRecency: payload.items,
          },
          { adapter, apiKey, baseUrl, model: model.requestModel },
        );
        return { result: { raw, usage, model: used }, usage };
      },
    );
    const { payload: out } = validateIntelligenceOutput(
      generated.raw,
      ctx,
      signals.map((s) => ({ kind: s.kind, count: s.count, label: s.label })),
    );

    const { data: row, error } = await supabase
      .from("board_intelligence_runs")
      .insert({
        org_id: payload.board.org_id,
        board_id: boardId,
        user_id: user.id,
        input_hash: inputHash,
        payload: out as unknown as Json,
        model: generated.model,
        tokens_in: generated.usage.inputTokens,
        tokens_out: generated.usage.outputTokens,
      })
      .select("*")
      .single();
    if (error || !row)
      return fail(error?.message ?? "Couldn't save the brief.");
    const run = rowToRun(row);
    if (!run) return fail("Couldn't read the saved brief.");
    return { ok: true, data: run };
  } catch (e) {
    return fail(
      mapAiError(e, {
        fallback: "Couldn't read this board. Please try again.",
        notConfigured:
          "Add an AI provider key in Settings to use Intelligence.",
      }),
    );
  }
}

/** Dismiss = hide the card for this user (spec §4.5). Own row; no model call. */
export async function dismissSuggestion(input: {
  runId: string;
  suggestionId: string;
}): Promise<ActionResult<BoardIntelligenceRun>> {
  const parsed = dismissSuggestionSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid suggestion.");
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("board_intelligence_runs")
    .select("*")
    .eq("id", parsed.data.runId)
    .maybeSingle();
  const run = row ? rowToRun(row) : null;
  if (!run) return fail("Brief not found.");
  if (!run.payload.suggestions.some((s) => s.id === parsed.data.suggestionId))
    return fail("Suggestion not found.");
  const dismissed = Array.from(
    new Set([...run.dismissed, parsed.data.suggestionId]),
  );
  const { data: updated, error } = await supabase
    .from("board_intelligence_runs")
    .update({ dismissed })
    .eq("id", run.id)
    .select("*")
    .single();
  if (error || !updated) return fail(error?.message ?? "Couldn't dismiss.");
  const next = rowToRun(updated);
  return next ? { ok: true, data: next } : fail("Couldn't read the brief.");
}
