import { NextResponse, after } from "next/server";
import * as z from "zod";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { runAi } from "@/lib/ai/gateway";
import { createClient } from "@/lib/supabase/server";
import { composeFolderScope } from "@/lib/ai/ask/persona";
import { getFolderHead } from "@/lib/folders/queries";
import { getMessages } from "@/lib/ai/ask/conversations";
import {
  splitForCompaction,
  composeSystem,
  KEEP_RECENT,
} from "@/lib/ai/ask/context";
import { languageModelFor } from "@/lib/ai/providers/language-model";
import { anthropicReasoningOptions } from "@/lib/ai/providers/anthropic-options";
import { getBoardPayload } from "@/lib/boards/queries";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import type { Member } from "@/lib/collaboration/activity";
import { sanitizeInline } from "@/lib/ai/prompt-sanitize";
import {
  ASSISTANT_PREAMBLE,
  addUsage,
  runAssistantLoop,
} from "@/lib/assistant/runtime";
import { buildAssistantTools } from "@/lib/assistant/tools";
import { MAX_STAGED_CALLS, type StagedCall } from "@/lib/assistant/staged";
import { renderFocusBlock } from "@/lib/assistant/focus/types";
import { buildBoardFocus } from "@/lib/assistant/focus/board";
import {
  buildDescribeContext,
  describeCall,
  type DescribeContext,
} from "@/lib/assistant/describe";
import {
  summarizeThread,
  titleThread,
} from "@/lib/assistant/thread-housekeeping";
import {
  encodeEvent,
  OPENING_STATUS,
  PROPOSAL_FALLBACK_ANSWER,
  type AskStreamEvent,
} from "@/lib/ai/ask/stream-protocol";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import { getUserTimeZoneCached } from "@/lib/profile/queries-cached";
import { zonedDayOf } from "@/lib/datetime/timezone";
import type { AskToolTrace } from "@/lib/ai/ask/tool-trace";
import type { Json } from "@/types/database.types";

// Runs on the default Node.js runtime (Cache Components forbids an explicit
// `runtime` export). The provider SDKs + service client need Node APIs anyway.

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

/** The signed-in user's display name for the prompt, or null. Sanitised to
 *  one line; anything that looks like an email address is dropped, because an
 *  email never goes into a prompt. */
function promptSafeName(fullName: string | null | undefined): string | null {
  const name = sanitizeInline(fullName ?? "").trim();
  return name.length > 0 && !name.includes("@") ? name : null;
}

/** The stable preamble plus the per-turn lines (the date, the active org and
 *  the signed-in user). The focus block is appended by the caller, after this,
 *  so the preamble stays cacheable. User-written names are JSON-quoted. */
function buildSystem(
  today: string,
  timezone: string,
  org: { id: string; name?: string | null },
  me: { id: string; name: string | null },
): string {
  const orgLabel = org.name
    ? `organization ${JSON.stringify(org.name)} (id ${org.id})`
    : `organization ${org.id}`;
  const meLabel = me.name
    ? `${JSON.stringify(me.name)} (user id ${me.id})`
    : `the person with user id ${me.id}`;
  return [
    ASSISTANT_PREAMBLE,
    "",
    `Today is ${today} (timezone ${timezone}). Resolve relative dates like "Friday" to an ISO date (YYYY-MM-DD).`,
    `You are working in the ${orgLabel}. Work only inside that organization; never read or change another one.`,
    `The signed-in user is ${meLabel}. "me", "my" and "I" in the user's messages refer to that person.`,
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

  const timezone = (await getUserTimeZoneCached(user.id)) ?? "UTC";

  const conv = await supabase
    .from("ai_conversations")
    .select("summary, summarized_upto, board_id, folder_id, user_id")
    .eq("id", conversationId)
    .single();
  if (conv.error || !conv.data)
    return NextResponse.json(
      { error: "Conversation not found." },
      { status: 404 },
    );

  // A shared board thread is READABLE by every member of that board, so "the row
  // came back" no longer implies "it is mine". A turn appends to the thread and
  // spends the owner's budget, so only the owner may take one.
  if (conv.data.user_id !== user.id)
    return NextResponse.json(
      { error: "Not your conversation." },
      { status: 403 },
    );

  // Board scope only, here. Every turn is answered by the org assistant. This
  // read goes through the USER client, so RLS decides what is visible; a row
  // that reads back null degrades to plain Ask rather than failing a turn
  // whose history is still worth continuing.
  // The system text itself is composed inside the turn, after the opening
  // status, because it names the signed-in user (a members read).
  let folderScope: Parameters<typeof composeFolderScope>[1] = null;

  // Folder scope, mutually exclusive with board focus (a thread is scoped to
  // one or the other; `createConversation` never stamps both; the board's
  // FOCUS block is built inside the turn below). The
  // ruling for this task: a folder read that fails — RLS hides it, it was
  // deleted, or an unexpected transport error — degrades the turn to plain
  // Ask rather than leaking Postgres error text or branching on a specific
  // error code. `getFolderHead` already returns `null` for the RLS-hidden /
  // nonexistent case; the try/catch below is only for the unexpected-failure
  // case, which would otherwise throw and fail the whole turn.
  if (!conv.data.board_id && conv.data.folder_id) {
    let head: Awaited<ReturnType<typeof getFolderHead>> = null;
    try {
      head = await getFolderHead(supabase, conv.data.folder_id);
    } catch {
      head = null;
    }
    folderScope = head
      ? {
          id: head.folder.id,
          name: head.folder.name,
          boards: head.boards.map((b) => ({ id: b.id, name: b.name })),
        }
      : null;
  }

  // A folder thread is scoped by its folder block above; every other thread
  // gets a FOCUS block (or the explicit "no page is in focus" line), built
  // inside the turn below. Same guard as the folder branch, so a thread
  // carrying both ids (board wins) still gets its board.
  const wantsFocus = Boolean(conv.data.board_id) || !conv.data.folder_id;
  const focusBoardId = conv.data.board_id;

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
      // MEMBERS. The org's members, from the existing cached helper (the same
      // read the board focus below always used). Read after the opening status
      // so it never delays the first byte. Email is dropped here: it never
      // reaches a prompt. A failed read only costs the name in the prompt.
      let members: Member[] = [];
      try {
        members = (await listOrgMembersCached(org.id)).map((m) => ({
          userId: m.userId,
          fullName: m.fullName,
        }));
      } catch (e) {
        console.error("[ask] members read failed:", e);
        members = [];
      }
      const me = members.find((m) => m.userId === user.id);
      let system = composeFolderScope(
        buildSystem(todayIn(timezone), timezone, org, {
          id: user.id,
          name: promptSafeName(me?.fullName),
        }),
        folderScope,
      );

      // FOCUS. Read HERE, after the opening status, so a full board payload
      // never delays the turn's first byte (gotcha-62). A board thread's board
      // is what the user is looking at. The read is RLS-scoped; a board that
      // reads back null, belongs to another org, or fails to read at all
      // degrades to no focus rather than failing the turn.
      // The same payload and members also label staged changes on the card
      // (A3): no extra query, and only for the board the user is looking at.
      let describeCtx: DescribeContext | null = null;
      if (wantsFocus) {
        let focusText: string | null = null;
        if (focusBoardId) {
          try {
            const payload = await getBoardPayload(focusBoardId);
            if (payload && payload.board.org_id === org.id) {
              focusText = buildBoardFocus({ payload, members });
              describeCtx = buildDescribeContext(payload, members);
            }
          } catch (e) {
            console.error("[ask] board focus read failed:", e);
            focusText = null;
            describeCtx = null;
          }
        }
        system = `${system}\n\n${renderFocusBlock(focusText)}`;
      }

      const allRows = await getMessages(conversationId);

      let summary = conv.data.summary;
      const isFirstExchange =
        allRows.length === 1 && allRows[0].role === "user";

      // Rolling-summary compaction of older turns (keeps per-turn cost bounded).
      const { toFold, recent } = splitForCompaction(allRows, KEEP_RECENT);

      const result = await runAi(
        { orgId: org.id, userId: user.id, feature: "ask_pulse" },
        async ({ adapter, apiKey, baseUrl, model }, reportUsage) => {
          if (!model.supportsTools)
            throw new Error(
              `${model.model} can't use tools. Pick a tool-capable model in Settings → AI.`,
            );
          // The whole turn — rolling summary, the tool loop and the auto-title —
          // runs on the ONE model runAi resolved, so all three agree with the
          // ledger row it meters. The WIRE id, never the catalog key.
          const lm = languageModelFor({
            kind: adapter.kind,
            apiKey,
            baseUrl,
            model: model.requestModel,
          });
          let usage: AiUsageTokens = {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          };

          if (toFold.length > 0) {
            const s = await summarizeThread(lm, summary, toFold);
            usage = addUsage(usage, s.usage);
            // Metered NOW, so a turn that dies before the loop's first step
            // still pays for the summary it already spent.
            reportUsage(usage);
            // `summarizeThread` hands back the PRIOR summary when the model
            // returned nothing. Advancing the cursor then would drop the
            // folded turns for good, so only a new, non-empty summary moves it.
            if (s.summary.length > 0 && s.summary !== (summary ?? "")) {
              summary = s.summary;
              await supabase
                .from("ai_conversations")
                .update({
                  summary,
                  summarized_upto: toFold[toFold.length - 1].created_at,
                })
                .eq("id", conversationId);
            }
          }

          // SECURITY: reads run, and staged writes are later applied, as the
          // signed-in user through their own cookie-bound client, so RLS is
          // the boundary. Never a service-role client here.
          const staged: StagedCall[] = [];
          const tools = buildAssistantTools({
            ctx: { getClient: async () => supabase, actorId: user.id },
            client: supabase,
            // Every org-scoped call is pinned to the org this turn runs in.
            orgId: org.id,
            stage: (call) => {
              if (staged.length >= MAX_STAGED_CALLS) return false;
              staged.push(call);
              return true;
            },
            // Labels from real board data for the exact pinned input; a
            // non-board thread keeps the generic summaries.
            describe: describeCtx
              ? (tool, input) => describeCall(tool, input, describeCtx)
              : undefined,
          });

          const beforeLoop = usage;
          const r = await runAssistantLoop({
            model: lm,
            system: composeSystem(system, summary),
            messages: recent.map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
            tools,
            emit,
            // The AI SDK sends no thinking config unless asked. Anthropic
            // models get the repo's own per-model request shape; other wire
            // formats have no such knob.
            providerOptions:
              adapter.kind === "anthropic"
                ? anthropicReasoningOptions(model.requestModel)
                : undefined,
            // A turn that dies at step 9 still spent steps 1 to 8.
            onUsage: (running) => reportUsage(addUsage(beforeLoop, running)),
          });
          usage = addUsage(usage, r.usage);

          // Auto-title on the first exchange — same model, metered. Best-effort.
          let title: string | undefined;
          if (isFirstExchange) {
            try {
              const t = await titleThread(lm, allRows[0].content);
              title = t.title;
              usage = addUsage(usage, t.usage);
            } catch {
              /* title is best-effort */
            }
          }

          // A staged turn whose model wrote nothing stores the same line the
          // client bubble shows live, so a reload reads identically.
          const answer =
            staged.length > 0 && !r.wroteText
              ? PROPOSAL_FALLBACK_ANSWER
              : r.text;
          // The model wrote nothing, so nothing was streamed: send the stored
          // answer now, so the live bubble reads exactly like the reloaded row.
          if (!r.wroteText) emit({ type: "token", text: answer });
          return { result: { answer, staged, title }, usage };
        },
      );

      // The staged batch rides the trace (see lib/ai/ask/tool-trace.ts), which
      // is what makes an unconfirmed card survive a reload. Apply re-reads the
      // calls from this row; the client copy is only for the live render.
      if (result.staged.length) emit({ type: "staged", calls: result.staged });

      const trace: AskToolTrace = { boardsConsulted: [] };
      if (result.staged.length) trace.stagedCalls = result.staged;

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
      // A failed insert is NOT a completed turn. `done` with an empty message
      // id reads as success to the client — the answer sits in the transcript
      // until the next reload silently drops it, and an unconfirmed proposal
      // card loses the row Approve re-reads its actions from. Say so instead:
      // the catch below emits `error` and logs, which is the one honest
      // outcome available once the tokens are already spent.
      if (ins.error || !ins.data) {
        console.error(
          `[ask] assistant insert failed for ${conversationId}`,
          ins.error,
        );
        throw new Error("Your answer couldn't be saved to this thread.");
      }

      if (result.title) {
        await supabase
          .from("ai_conversations")
          .update({ title: result.title })
          .eq("id", conversationId);
      }

      emit({
        type: "done",
        conversationId,
        assistantMessageId: ins.data.id,
        boardsConsulted: [],
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
