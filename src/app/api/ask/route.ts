import { NextResponse } from "next/server";
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
import { encodeEvent, type AskStreamEvent } from "@/lib/ai/ask/stream-protocol";
import { MODEL } from "@/lib/ai/providers/anthropic";
import type { AiUsageTokens } from "@/lib/ai/pricing";

// Anthropic SDK + the service client need Node APIs — not the Edge runtime.
export const runtime = "nodejs";

const SYSTEM = [
  "You are Ask Pulse, a helpful analyst answering questions about the user's boards.",
  "Use the read tools to ground every claim in real data. Never fabricate.",
  "Start broad (list_boards, get_board_overview) and query_items only for the rows a question needs.",
  "Cell values reference option/user ids — decode labels via get_board_overview before answering.",
  "If you cannot answer from the data, say so plainly.",
].join("\n");

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

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const emit = (e: AskStreamEvent) =>
        controller.enqueue(enc.encode(encodeEvent(e)));
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
            const usage: AiUsageTokens = { inputTokens: 0, outputTokens: 0 };

            if (toFold.length > 0) {
              const s = await summarize(
                client.messages,
                MODEL,
                summary,
                toFold,
              );
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
              workspaceId,
              client,
              messages: buildAskMessages(recent),
              system: composeSystem(SYSTEM, summary),
              emit,
            });
            usage.inputTokens += r.usage.inputTokens;
            usage.outputTokens += r.usage.outputTokens;

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
                title,
              },
              usage,
              model: MODEL,
            };
          },
        );

        const ins = await supabase
          .from("ai_messages")
          .insert({
            conversation_id: conversationId,
            role: "assistant",
            content: result.answer,
            tool_trace: { boardsConsulted: result.boardsConsulted },
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
          message: (e as Error).message || "Ask Pulse hit a snag.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
