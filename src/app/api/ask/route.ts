import { NextResponse, after } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { listWorkspacesCached } from "@/lib/workspaces/queries-cached";
import { getActiveWorkspaceId } from "@/lib/workspaces/active";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { runAi } from "@/lib/ai/gateway";
import { ProviderNotCapableError } from "@/lib/ai/errors";
import { createClient } from "@/lib/supabase/server";
import { getMessages } from "@/lib/ai/ask/conversations";
import { askPulseStream } from "@/lib/ai/ask/ask-stream";
import {
  buildAskMessages,
  splitForCompaction,
  composeSystem,
  summarize,
  generateTitle,
  KEEP_RECENT,
} from "@/lib/ai/ask/context";
import {
  encodeEvent,
  OPENING_STATUS,
  type AskStreamEvent,
} from "@/lib/ai/ask/stream-protocol";
import { MODEL } from "@/lib/ai/providers/anthropic";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import { getUserTimeZoneCached } from "@/lib/profile/queries-cached";
import { zonedDayOf } from "@/lib/datetime/timezone";
import type { AskToolTrace } from "@/lib/ai/ask/tool-trace";
import type { Json } from "@/types/database.types";

// Runs on the default Node.js runtime (Cache Components forbids an explicit
// `runtime` export). The Anthropic SDK + service client need Node APIs anyway.

/** Today's calendar date in a given IANA zone, so "Friday" resolves correctly
 *  for a write. `zonedDayOf` is the canonical helper; a stored zone the runtime
 *  rejects falls back to UTC rather than failing the turn. */
function todayIn(timezone: string): string {
  try {
    return zonedDayOf(new Date(), timezone);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * One prompt for one loop: the read guidance that grounds every answer, plus
 * the write guidance already proven in `src/lib/ai/write/propose.ts`. The
 * propose_* tools do not write — the "stop after proposing" instruction matches
 * the engine, which ends the turn at the confirm card either way.
 */
function buildSystem(today: string, timezone: string): string {
  return [
    "You are the AI assistant for Monolith, a helpful analyst answering questions about the user's boards — and, when asked, proposing changes to them.",
    "Use the read tools to ground every claim in real data. Never fabricate.",
    "Start broad (list_boards, get_board_overview) and query_items only for the rows a question needs.",
    "Cell values reference option/user ids — decode labels via get_board_overview before answering.",
    "If you cannot answer from the data, say so plainly.",
    "",
    `Today is ${today} (timezone ${timezone}). Resolve relative dates like "Friday" to an ISO date (YYYY-MM-DD).`,
    "When the user asks you to CHANGE something, first resolve the exact board, group, status option and owner userIds with the read tools (list_boards, get_board_overview, list_board_members). NEVER assume an id you have not read.",
    "Then call a propose_* tool with the resolved ids. The propose_* tools do NOT write — the user confirms first. Say in ONE short sentence what you are about to propose, then stop.",
    "If the target board, group or item is ambiguous, DO NOT propose — ask exactly ONE focused question and wait for the answer.",
  ].join("\n");
}

const bodySchema = z.object({ conversationId: z.string().uuid() });

/**
 * The ONE sanctioned exception to "Server Actions for all mutations": the
 * streaming completion. The user turn was already persisted by
 * conversation-actions; this handler reads the thread, compacts older turns into
 * a rolling summary, runs the streaming tool-use loop through the `runAi`
 * metering chokepoint (entitlement-gated first), streams NDJSON events, then
 * persists the assistant message and auto-titles a fresh conversation.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  // Active org via the org switcher (mirrors actions.ts) — never getUserOrgs()[0].
  const org = await resolveActiveOrg();
  if (!org)
    return NextResponse.json({ error: "No organization." }, { status: 400 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { conversationId } = parsed.data;

  try {
    await requireAiEntitlement(org.id, "ask_pulse");
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 402 });
  }

  const supabase = await createClient();
  const workspaceId = await getActiveWorkspaceId(
    await listWorkspacesCached(org.id),
  );
  if (!workspaceId)
    return NextResponse.json({ error: "No workspace." }, { status: 400 });

  const timezone = (await getUserTimeZoneCached(user.id)) ?? "UTC";
  const system = buildSystem(todayIn(timezone), timezone);

  const conv = await supabase
    .from("ai_conversations")
    .select("summary, summarized_upto")
    .eq("id", conversationId)
    .single();
  if (conv.error || !conv.data)
    return NextResponse.json(
      { error: "Conversation not found." },
      { status: 404 },
    );

  // The response body is a pure OBSERVER of the turn, never its host
  // (gotcha-62). It owns a controller that `emit` writes to while a reader is
  // attached; when the client disconnects the controller is dropped and the
  // turn — which is a detached promise, not stream work — carries on to
  // persistence and metering. A drop now costs a render, not the answer.
  const enc = new TextEncoder();
  let sink: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    // `start` runs synchronously inside the constructor, so `sink` is live
    // before the turn below emits its opening byte.
    start(controller) {
      sink = controller;
    },
    cancel() {
      sink = null;
    },
  });
  const emit = (e: AskStreamEvent) => {
    const s = sink;
    if (!s) return;
    try {
      s.enqueue(enc.encode(encodeEvent(e)));
    } catch {
      // Cancelled between the check and the write — same outcome: stop writing.
      sink = null;
    }
  };
  const closeSink = () => {
    try {
      sink?.close();
    } catch {
      /* already cancelled */
    }
    sink = null;
  };

  const turn = (async () => {
    // The turn's first byte, before ANY model work: compaction and the first
    // tool round together account for most of the opening wait, and the
    // engine's statuses cannot fire until a round has finished (gotcha-62).
    emit({ type: "status", text: OPENING_STATUS });
    try {
      const allRows = await getMessages(conversationId);
      let summary = conv.data.summary;
      const isFirstExchange =
        allRows.length === 1 && allRows[0].role === "user";

      // Rolling-summary compaction of older turns (keeps per-turn cost bounded).
      const { toFold, recent } = splitForCompaction(allRows, KEEP_RECENT);

      const result = await runAi(
        { orgId: org.id, userId: user.id, feature: "ask_pulse" },
        async ({ apiKey, adapter }) => {
          if (!adapter.supportsTools)
            throw new ProviderNotCapableError("ask_pulse");
          const client = new Anthropic({ apiKey });
          const usage: AiUsageTokens = {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          };

          if (toFold.length > 0) {
            const s = await summarize(client.messages, MODEL, summary, toFold);
            summary = s.summary;
            usage.inputTokens += s.usage.inputTokens;
            usage.outputTokens += s.usage.outputTokens;
            await supabase
              .from("ai_conversations")
              .update({
                summary,
                summarized_upto: toFold[toFold.length - 1].created_at,
              })
              .eq("id", conversationId);
          }

          const r = await askPulseStream({
            apiKey,
            orgId: org.id,
            workspaceId,
            client,
            messages: buildAskMessages(recent),
            system: composeSystem(system, summary),
            emit,
          });
          usage.inputTokens += r.usage.inputTokens;
          usage.outputTokens += r.usage.outputTokens;
          usage.cacheReadTokens =
            (usage.cacheReadTokens ?? 0) + (r.usage.cacheReadTokens ?? 0);
          usage.cacheWriteTokens =
            (usage.cacheWriteTokens ?? 0) + (r.usage.cacheWriteTokens ?? 0);

          // Auto-title on the first exchange — reuses the resolved key (works
          // for managed/BYO/per-user) and meters its tokens. Best-effort.
          let title: string | undefined;
          if (isFirstExchange) {
            try {
              const t = await generateTitle(
                client.messages,
                MODEL,
                allRows[0].content,
              );
              title = t.title;
              usage.inputTokens += t.usage.inputTokens;
              usage.outputTokens += t.usage.outputTokens;
            } catch {
              /* title is best-effort */
            }
          }

          return {
            result: {
              answer: r.answer,
              boardsConsulted: r.boardsConsulted,
              proposedActions: r.proposedActions,
              title,
            },
            usage,
            model: MODEL,
          };
        },
      );

      // One column, two shapes (see lib/ai/ask/tool-trace.ts): a read-only
      // turn stores only boardsConsulted; a proposal turn also stores the
      // actions, which is what makes an unconfirmed card survive a reload.
      const trace: AskToolTrace = { boardsConsulted: result.boardsConsulted };
      if (result.proposedActions.length)
        trace.proposedActions = result.proposedActions;

      const ins = await supabase
        .from("ai_messages")
        .insert({
          conversation_id: conversationId,
          role: "assistant",
          content: result.answer,
          tool_trace: trace as unknown as Json,
        })
        .select("id")
        .single();

      if (result.title) {
        await supabase
          .from("ai_conversations")
          .update({ title: result.title })
          .eq("id", conversationId);
      }

      emit({
        type: "done",
        conversationId,
        assistantMessageId: ins.data?.id ?? "",
        boardsConsulted: result.boardsConsulted,
        title: result.title,
      });
    } catch (e) {
      emit({
        type: "error",
        message: (e as Error).message || "The AI assistant hit a snag.",
      });
      // A detached turn may have no reader left to show the error event to, so
      // the server log is the only remaining trace.
      console.error("[ask] turn failed:", e);
    } finally {
      closeSink();
    }
  })();

  // Hold the platform's invocation open until the turn settles — on Vercel this
  // is `waitUntil`, which is what makes "the response ended" and "the work
  // ended" independent. `after` throws outside a request scope (a direct POST()
  // in a unit test), and there is no invocation to hold in that case anyway.
  try {
    after(() => turn);
  } catch {
    /* no request scope — the detached promise still runs to completion */
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
