import { NextResponse, after } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { listWorkspacesCached } from "@/lib/workspaces/queries-cached";
import { getActiveWorkspaceId } from "@/lib/workspaces/active";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { runAi } from "@/lib/ai/gateway";
import { assertToolLoopCapable } from "@/lib/ai/tool-capability";
import { createClient } from "@/lib/supabase/server";
import { askPulseStream } from "@/lib/ai/ask/ask-stream";
import { rowToRun } from "@/lib/ai/board-intelligence/runs";
import { intelAskRequestSchema } from "@/lib/ai/board-intelligence/ask-input";
import {
  buildIntelAskMessages,
  buildIntelAskSystem,
} from "@/lib/ai/board-intelligence/ask-context";
import {
  encodeIntelEvent,
  INTEL_ASK_OPENING_STATUS,
  type IntelAskEvent,
} from "@/lib/ai/board-intelligence/ask-protocol";

// Runs on the default Node.js runtime (Cache Components forbids an explicit
// `runtime` export). Same shape as POST /api/ask, whose engine this reuses.

/**
 * One Q&A turn about ONE board, grounded in a cached Intelligence run.
 *
 * The second sanctioned exception to "Server Actions for all mutations" — and
 * the weaker one, because this handler mutates nothing at all: the loop is
 * READ-ONLY (`toolset: "read-only"` offers no propose_* tool), and no
 * `ai_conversations` / `ai_messages` row is written. The only side effect is
 * the usage `runAi` meters under `board_intelligence`, the same feature key the
 * brief itself is generated on.
 */
export async function POST(request: Request) {
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org)
    return NextResponse.json({ error: "No organization." }, { status: 400 });

  const parsed = intelAskRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  const { runId, question, history } = parsed.data;

  try {
    await requireAiEntitlement(org.id, "board_intelligence");
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 402 });
  }

  const supabase = await createClient();
  const workspaceId = await getActiveWorkspaceId(
    await listWorkspacesCached(org.id),
  );
  if (!workspaceId)
    return NextResponse.json({ error: "No workspace." }, { status: 400 });

  // RLS already restricts board_intelligence_runs to the owning user, so a
  // miss is "not yours or not there" and both answer the same way: 404. No
  // context is ever invented for a run we cannot read — and `rowToRun` returns
  // null on a payload that no longer validates, which is the same answer.
  //
  // `org_id` is filtered EXPLICITLY, because RLS does not answer this question.
  // RLS scopes the row to the owning user; the org comes from
  // `resolveActiveOrg()` and `runId` comes from the client. A user in orgs A
  // and B, holding a run id for a board in B while A is active, would
  // otherwise clear the entitlement check for org A and then reach `runAi`
  // with `orgId` set to A — resolving A's key and writing A's `ai_usage` row
  // for a turn answered over B's board, billing A and bypassing B's
  // entitlement entirely. A mismatch is the same 404 as "not yours".
  //
  // The prose above deliberately avoids writing that call out as
  // `runAi` + `(` + `{`: model-request-shape.test.ts scans for that exact
  // sequence to find call sites, and a comment shaped like one is reported as
  // an inert call site with no `feature:` and no `model` in its "callback".
  const row = await supabase
    .from("board_intelligence_runs")
    .select("*")
    .eq("id", runId)
    .eq("org_id", org.id)
    .maybeSingle();
  const run = row.data ? rowToRun(row.data) : null;
  if (!run)
    return NextResponse.json({ error: "Run not found." }, { status: 404 });

  const { data: board } = await supabase
    .from("boards")
    .select("id, name")
    .eq("id", run.boardId)
    .maybeSingle();
  if (!board)
    return NextResponse.json({ error: "Board not found." }, { status: 404 });

  // The response body is a pure OBSERVER of the turn, never its host
  // (gotcha-62). `emit` writes into the sink while a reader is attached; a
  // client that disconnects drops the controller and the detached turn carries
  // on to metering. A drop costs a render, not the answer.
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
  const emit = (e: IntelAskEvent) => {
    const s = sink;
    if (!s) return;
    try {
      s.enqueue(enc.encode(encodeIntelEvent(e)));
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
    // The turn's first byte, before ANY model work: the engine's own statuses
    // cannot fire until a tool round has finished (gotcha-62).
    emit({ type: "status", text: INTEL_ASK_OPENING_STATUS });
    try {
      await runAi(
        { orgId: org.id, userId: user.id, feature: "board_intelligence" },
        async ({ apiKey, provider, model }) => {
          assertToolLoopCapable(provider, "board_intelligence");
          const r = await askPulseStream({
            apiKey,
            // The WIRE id, not the catalog key: the engine calls the
            // Anthropic SDK directly, and its request shape is derived from
            // this same model — never hand-rolled here.
            model: model.requestModel,
            orgId: org.id,
            workspaceId,
            messages: buildIntelAskMessages(history, question),
            system: buildIntelAskSystem(run, board),
            toolset: "read-only",
            emit: (e) => {
              // Bridge the two protocols: this turn has no conversation, so
              // `done`/`proposal` have nothing to say here and are dropped.
              if (e.type === "token" || e.type === "status") emit(e);
            },
          });
          // Nothing to return but the meter reading: the answer was already
          // streamed, and there is no row to write it to.
          return { result: null, usage: r.usage };
        },
      );
      emit({ type: "done" });
    } catch (e) {
      emit({
        type: "error",
        message: (e as Error).message || "The assistant hit a snag.",
      });
      // A detached turn may have no reader left to show the error event to, so
      // the server log is the only remaining trace.
      console.error("[intelligence-ask] turn failed:", e);
    } finally {
      closeSink();
    }
  })();

  // Hold the platform's invocation open until the turn settles — on Vercel this
  // is `waitUntil`. `after` throws outside a request scope (a direct POST() in
  // a unit test), and there is no invocation to hold in that case anyway.
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
