import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tables } from "@/types/database.types";
import { INTEL_ASK_OPENING_STATUS, type IntelAskEvent } from "./ask-protocol";

// Same mocking shape as `run.test.ts` (the Phase 2 suite for this area): every
// boundary the route crosses is a local `vi.fn`, so a test can both steer it and
// assert on it. `rowToRun` is deliberately NOT mocked — the stored-jsonb
// re-validation is part of what "is this run readable" means here.
const requireUser = vi.fn();
const resolveActiveOrg = vi.fn();
const requireAiEntitlement = vi.fn();
const runAi = vi.fn();
const listWorkspacesCached = vi.fn();
const getActiveWorkspaceId = vi.fn();
const askPulseStream = vi.fn();
const from = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: () => resolveActiveOrg(),
}));
vi.mock("@/lib/ai/entitlement", () => ({
  requireAiEntitlement: (...a: unknown[]) => requireAiEntitlement(...a),
}));
vi.mock("@/lib/ai/gateway", () => ({
  runAi: (...a: unknown[]) => runAi(...a),
}));
vi.mock("@/lib/workspaces/queries-cached", () => ({
  listWorkspacesCached: (...a: unknown[]) => listWorkspacesCached(...a),
}));
vi.mock("@/lib/workspaces/active", () => ({
  getActiveWorkspaceId: (...a: unknown[]) => getActiveWorkspaceId(...a),
}));
vi.mock("@/lib/ai/ask/ask-stream", () => ({
  askPulseStream: (...a: unknown[]) => askPulseStream(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (t: string) => from(t) }),
}));

import { POST } from "@/app/api/board-intelligence/ask/route";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const BOARD_ID = "22222222-2222-4222-8222-222222222222";

/** A stored row whose jsonb payload really does satisfy `payloadSchema`, so the
 *  route's `rowToRun` returns a run rather than null. */
const sampleRow = (): Tables<"board_intelligence_runs"> =>
  ({
    id: RUN_ID,
    org_id: "org1",
    board_id: BOARD_ID,
    user_id: "u1",
    generated_at: "2026-09-15T10:00:00.000Z",
    input_hash: "h",
    payload: {
      brief: "Two items slipped this week.",
      suggestions: [
        {
          id: "s1",
          kind: "overdue",
          title: "Three overdue in Launch",
          evidence: "3 items",
          body: "Pull the dates forward.",
          evidenceRows: [],
          actions: [{ type: "filter", signalKind: "overdue", label: "Show" }],
        },
      ],
      signals: [],
    },
    dismissed: [],
    applied: [],
    model: "m",
    tokens_in: 1,
    tokens_out: 1,
  }) as unknown as Tables<"board_intelligence_runs">;

let runRow: { data: unknown; error: unknown } = { data: null, error: null };
let boardRow: { data: unknown; error: unknown } = { data: null, error: null };
/** The tables the route touched, in order — the assertion that this turn
 *  persists NOTHING (no `ai_messages`, no `ai_conversations`). */
const tablesRead: string[] = [];

/** Steer the row `board_intelligence_runs` reads back. `null` = missing, or
 *  RLS-hidden: the route cannot tell the two apart, and must not try. */
function mockRun(row: Tables<"board_intelligence_runs"> | null) {
  runRow = { data: row, error: null };
}

/** A chain whose builder methods all return itself and which resolves to
 *  `result` — the same double `run.test.ts` uses. */
const chain = (result: unknown) => {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "maybeSingle", "single"])
    q[m] = () => q;
  (q as { then: unknown }).then = (res: (v: unknown) => void) => res(result);
  return q;
};

/**
 * Like `chain`, but it actually HONOURS its `.eq()` filters against the row.
 *
 * Tenancy here is a filter the route must send, not a shape it must have, so a
 * double that returns the row regardless could not tell a scoped read from an
 * unscoped one. This one resolves to null unless every `.eq(column, value)`
 * matches the row — so dropping `.eq("org_id", …)` from the route makes the
 * cross-org test fail, which is the only way that test means anything.
 */
const filteringChain = (row: Record<string, unknown> | null) => {
  const filters: [string, unknown][] = [];
  const q: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "maybeSingle", "single"])
    q[m] = () => q;
  q.eq = (column: string, value: unknown) => {
    filters.push([column, value]);
    return q;
  };
  (q as { then: unknown }).then = (res: (v: unknown) => void) =>
    res({
      data: row && filters.every(([c, v]) => row[c] === v) ? row : null,
      error: null,
    });
  return q;
};

const req = (body: unknown) =>
  new Request("http://x/api/board-intelligence/ask", {
    method: "POST",
    body: JSON.stringify(body),
  });

/** Read the NDJSON body to completion and parse every line. */
const drain = async (res: Response): Promise<IntelAskEvent[]> =>
  (await res.text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as IntelAskEvent);

beforeEach(() => {
  vi.clearAllMocks();
  tablesRead.length = 0;
  requireUser.mockResolvedValue({ id: "u1" });
  resolveActiveOrg.mockResolvedValue({ id: "org1" });
  requireAiEntitlement.mockResolvedValue(undefined);
  listWorkspacesCached.mockResolvedValue([{ id: "ws1" }]);
  getActiveWorkspaceId.mockResolvedValue("ws1");
  runRow = { data: null, error: null };
  boardRow = { data: { id: BOARD_ID, name: "Launch" }, error: null };
  from.mockImplementation((t: string) => {
    tablesRead.push(t);
    if (t === "board_intelligence_runs")
      return filteringChain(runRow.data as Record<string, unknown> | null);
    if (t === "boards") return chain(boardRow);
    throw new Error(`unmocked table in test double: ${t}`);
  });
  runAi.mockImplementation(
    async (
      _args: unknown,
      fn: (r: {
        apiKey: string;
        provider: string;
        model: { requestModel: string; contextLength: number };
      }) => Promise<{ result: unknown; usage: unknown }>,
    ) =>
      (
        await fn({
          apiKey: "k",
          provider: "anthropic",
          model: { requestModel: "wire", contextLength: 200_000 },
        })
      ).result,
  );
  askPulseStream.mockImplementation(
    async ({ emit }: { emit: (e: IntelAskEvent) => void }) => {
      emit({ type: "token", text: "Two slipped." });
      return {
        answer: "Two slipped.",
        boardsConsulted: [BOARD_ID],
        proposedActions: [],
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  );
});

describe("POST /api/board-intelligence/ask", () => {
  it("404s when the run is not readable", async () => {
    mockRun(null);
    const res = await POST(
      req({ runId: RUN_ID, question: "why?", history: [] }),
    );
    expect(res.status).toBe(404);
    expect(askPulseStream).not.toHaveBeenCalled();
  });

  // `rowToRun` fails CLOSED on a payload in an older/broken shape, and that is
  // indistinguishable from "not yours" for the purpose of answering: no context
  // may ever be invented for a run we cannot read.
  it("404s when the stored payload no longer validates", async () => {
    mockRun({
      ...sampleRow(),
      payload: { brief: 42 },
    } as unknown as Tables<"board_intelligence_runs">);
    const res = await POST(
      req({ runId: RUN_ID, question: "why?", history: [] }),
    );
    expect(res.status).toBe(404);
    expect(askPulseStream).not.toHaveBeenCalled();
  });

  // The run read is org-scoped EXPLICITLY, because RLS cannot answer this:
  // it scopes the row to the owning user, while `org` comes from the org
  // switcher and `runId` comes from the client. Without `.eq("org_id", …)` a
  // user in orgs A and B, holding a run id for a board in B with A active,
  // would have A entitled, A's key resolved and A's `ai_usage` row written for
  // a turn answered over B's board.
  it("404s when the run belongs to another org, and never meters the active one", async () => {
    mockRun({
      ...sampleRow(),
      org_id: "orgB",
    } as unknown as Tables<"board_intelligence_runs">);
    const res = await POST(
      req({ runId: RUN_ID, question: "what slipped?", history: [] }),
    );
    expect(res.status).toBe(404);
    expect(runAi).not.toHaveBeenCalled();
    expect(askPulseStream).not.toHaveBeenCalled();
  });

  it("404s when the run's board is not readable", async () => {
    mockRun(sampleRow());
    boardRow = { data: null, error: null };
    const res = await POST(
      req({ runId: RUN_ID, question: "why?", history: [] }),
    );
    expect(res.status).toBe(404);
    expect(askPulseStream).not.toHaveBeenCalled();
  });

  it("rejects a malformed body before any model call", async () => {
    const res = await POST(req({ runId: "nope", question: "", history: [] }));
    expect(res.status).toBe(400);
    expect(askPulseStream).not.toHaveBeenCalled();
    expect(requireAiEntitlement).not.toHaveBeenCalled();
  });

  it("402s when the org is not entitled, before any model call", async () => {
    requireAiEntitlement.mockRejectedValue(new Error("AI is switched off."));
    const res = await POST(req({ runId: RUN_ID, question: "q", history: [] }));
    expect(res.status).toBe(402);
    expect(runAi).not.toHaveBeenCalled();
  });

  it("runs the loop read-only under the board_intelligence feature and streams to done", async () => {
    mockRun(sampleRow());
    const res = await POST(
      req({ runId: RUN_ID, question: "what slipped?", history: [] }),
    );
    expect(res.headers.get("Content-Type")).toContain("application/x-ndjson");

    const events = await drain(res);
    expect(events[0]).toEqual({
      type: "status",
      text: INTEL_ASK_OPENING_STATUS,
    });
    expect(events).toContainEqual({ type: "token", text: "Two slipped." });
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(runAi).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "board_intelligence",
        orgId: "org1",
        userId: "u1",
      }),
      expect.any(Function),
    );
    expect(askPulseStream).toHaveBeenCalledWith(
      expect.objectContaining({ toolset: "read-only" }),
    );
  });

  it("grounds the turn in the cached brief and replays the history pairs", async () => {
    mockRun(sampleRow());
    await drain(
      await POST(
        req({
          runId: RUN_ID,
          question: "and the second one?",
          history: [{ question: "what slipped?", answer: "Two items." }],
        }),
      ),
    );
    const args = askPulseStream.mock.calls[0][0] as {
      system: string;
      messages: { role: string; content: string }[];
    };
    expect(args.system).toContain("Two items slipped this week.");
    expect(args.system).toContain("Three overdue in Launch");
    expect(args.system).toContain("Launch");
    expect(args.messages).toEqual([
      { role: "user", content: "what slipped?" },
      { role: "assistant", content: "Two items." },
      { role: "user", content: "and the second one?" },
    ]);
  });

  // The prompt must describe what the reader is LOOKING AT. The tab renders
  // `payload.suggestions` minus `new Set([...dismissed, ...applied])`, so a
  // card the user dismissed must not come back as context the model can cite
  // ("as the overdue card above suggests…") — the card is gone.
  it("omits dismissed and applied suggestions from the prompt", async () => {
    const row = sampleRow();
    const payload = row.payload as unknown as {
      suggestions: Record<string, unknown>[];
    };
    const first = payload.suggestions[0];
    mockRun({
      ...row,
      payload: {
        ...payload,
        suggestions: [
          first,
          { ...first, id: "s2", title: "Dismissed card" },
          { ...first, id: "s3", title: "Applied card" },
        ],
      },
      dismissed: ["s2"],
      applied: ["s3"],
    } as unknown as Tables<"board_intelligence_runs">);
    await drain(await POST(req({ runId: RUN_ID, question: "q", history: [] })));
    const { system } = askPulseStream.mock.calls[0][0] as { system: string };
    expect(system).toContain("Three overdue in Launch");
    expect(system).not.toContain("Dismissed card");
    expect(system).not.toContain("Applied card");
  });

  // Spec §3.2: this turn is ephemeral. A write here would give the Ask
  // transcript a thread nobody opened, and the memory writer a turn to learn
  // from that the user never saw as a conversation.
  it("persists nothing — it reads only the run and its board", async () => {
    mockRun(sampleRow());
    await drain(
      await POST(
        req({ runId: RUN_ID, question: "what slipped?", history: [] }),
      ),
    );
    expect(new Set(tablesRead)).toEqual(
      new Set(["board_intelligence_runs", "boards"]),
    );
  });

  it("emits an error event when the turn throws, and never a done", async () => {
    mockRun(sampleRow());
    askPulseStream.mockRejectedValueOnce(new Error("provider down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const events = await drain(
      await POST(req({ runId: RUN_ID, question: "q", history: [] })),
    );
    expect(events.at(-1)).toEqual({
      type: "error",
      message: "provider down",
    });
    expect(events).not.toContainEqual({ type: "done" });
  });
});
