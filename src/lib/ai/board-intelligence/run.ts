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
import {
  computeSignals,
  latestActivityISO,
} from "@/lib/boards/intelligence/signals";
import {
  MAX_PAYLOAD_SIGNALS,
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
  // The active org's id, not the board's, is what gets metered and entitled
  // below — a board whose org_id doesn't match the caller's active org must
  // never reach entitlement/runAi, even though getBoardPayload already
  // proved RLS-visibility (a cross-org share can make a board readable).
  if (org.id !== payload.board.org_id) return fail("Board not found.");

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
    const signalsInput = {
      items: payload.items,
      columns: payload.columns,
      cellValues: payload.cellValues,
      groups: payload.groups,
      dependencies: payload.dependencies,
    };
    const signals = computeSignals(signalsInput, {
      now,
      lastSeenAt: lastSeen ? new Date(lastSeen) : null,
      currentUserId: user.id,
      memberNames,
    });
    /**
     * What the MODEL sees and what the payload STORES — the full set is what
     * the hash is computed over.
     *
     * `computeSignals` emits one `overloaded` row per overloaded person, so a
     * busy board easily exceeds `payloadSchema`'s ten-signal cap. Storing the
     * full set made `validateIntelligenceOutput` throw AFTER the model call was
     * metered, with nothing cached — so every retry paid again and failed
     * again. Slicing here (the rows are already in `SIGNAL_ORDER`, most urgent
     * first) keeps the hash sensitive to every signal while the payload stays
     * inside the schema.
     */
    const topSignals = signals.slice(0, MAX_PAYLOAD_SIGNALS);
    // items.updated_at is NOT bumped by cell edits (signals.ts) — use the
    // cell-aware helper so a cell-only edit still changes the hash.
    const maxUpdatedAt = latestActivityISO(signalsInput);
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
    const [
      { data: activities, error: activitiesError },
      { data: updates, error: updatesError },
    ] = await Promise.all([
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
    // A failed transcript read must not silently produce a brief built on an
    // empty (wrong) transcript — fail loud instead of caching a bad run.
    if (activitiesError || updatesError)
      return fail("Couldn't read recent activity.");
    const ctx = buildBoardContext(payload, members, topSignals);
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
            signals: topSignals,
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
    const { payload: out, warnings } = validateIntelligenceOutput(
      generated.raw,
      ctx,
      topSignals,
    );
    // Not user-facing (the brief is still good), but a run that silently drops
    // half the model's suggestions is the only trace that the prompt and the
    // board have drifted apart.
    if (warnings.length)
      console.warn("[intelligence] dropped suggestions", { boardId, warnings });

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
    // The user sees mapAiError's copy; the real cause must reach the server
    // log or a failed run is undiagnosable (no ai_usage row is written when
    // the provider call itself throws).
    console.error("[intelligence] run failed", {
      boardId,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      cause: e instanceof Error && e.cause ? String(e.cause) : undefined,
    });
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
  // Re-read immediately before the update rather than reusing the array from
  // the top of this action: `applied`/`dismissed` are read-modify-written by
  // apply, undo AND dismiss, so a list captured a round-trip ago can drop a
  // mark another call made in between.
  const { data: current } = await supabase
    .from("board_intelligence_runs")
    .select("dismissed")
    .eq("id", run.id)
    .maybeSingle();
  const dismissed = Array.from(
    new Set([
      ...(current?.dismissed ?? run.dismissed),
      parsed.data.suggestionId,
    ]),
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
