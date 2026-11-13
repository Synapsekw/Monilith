import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeResolvedModel } from "@/test/adapter-fakes";

// `after` throws outside a Next request scope, so a direct POST() call in a unit
// test can never run the real one. Capturing the tasks is also the assertion
// that the turn is handed to the platform's keep-alive (gotcha-62).
const { afterTasks } = vi.hoisted(() => ({ afterTasks: [] as unknown[] }));
vi.mock("next/server", async (importActual) => {
  const actual = await importActual<typeof import("next/server")>();
  return { ...actual, after: (task: unknown) => void afterTasks.push(task) };
});

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1" })),
}));
const { activeOrg } = vi.hoisted(() => ({
  activeOrg: {
    current: { id: "org1", name: "Acme", timezone: null } as {
      id: string;
      name: string;
      timezone: string | null;
    },
  },
}));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: vi.fn(async () => activeOrg.current),
}));
vi.mock("@/lib/ai/entitlement", () => ({
  requireAiEntitlement: vi.fn(async () => undefined),
}));
// Mirrors the real chokepoint: usage is recorded AFTER fn resolves, so
// `meteredSpy` standing in for `record_ai_usage` is the billing assertion.
const { meteredSpy } = vi.hoisted(() => ({ meteredSpy: vi.fn() }));
const supportsToolsRef = vi.hoisted(() => ({ value: true }));
const adapterKindRef = vi.hoisted(() => ({
  value: "anthropic" as "anthropic" | "openai",
}));
const requestModelRef = vi.hoisted(() => ({
  value: "claude-sonnet-5-20260101",
}));
const reportUsageSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/gateway", () => ({
  runAi: vi.fn(
    async (
      _a: unknown,
      fn: (
        r: {
          adapter: { kind: "anthropic" | "openai" };
          apiKey: string;
          baseUrl: null;
          provider: string;
          model: ReturnType<typeof fakeResolvedModel> & {
            supportsTools: boolean;
          };
        },
        reportUsage: (u: unknown) => void,
      ) => Promise<{ result: unknown; usage: unknown }>,
    ) => {
      const r = await fn(
        {
          adapter: { kind: adapterKindRef.value },
          apiKey: "k",
          baseUrl: null,
          provider: "anthropic",
          model: {
            ...fakeResolvedModel({ requestModel: requestModelRef.value }),
            supportsTools: supportsToolsRef.value,
          },
        },
        reportUsageSpy,
      );
      meteredSpy(r.usage);
      return r.result;
    },
  ),
}));

type LoopUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};
type LoopArgs = {
  emit: (e: { type: "token" | "status"; text: string }) => void;
  system: string;
  messages: { role: string; content: string }[];
  onUsage?: (u: LoopUsage) => void;
  providerOptions?: Record<string, Record<string, unknown>>;
};
type LoopResult = {
  text: string;
  usage: LoopUsage;
  steps: number;
  toolsUsed: string[];
  hitStepCap: boolean;
  wroteText: boolean;
};
const loopResult = (over: Partial<LoopResult> = {}): LoopResult => ({
  text: "Answer.",
  usage: {
    inputTokens: 5,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
  steps: 1,
  toolsUsed: [],
  hitStepCap: false,
  wroteText: true,
  ...over,
});
const runAssistantLoop = vi.fn<(a: LoopArgs) => Promise<LoopResult>>();
vi.mock("@/lib/assistant/runtime", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/assistant/runtime")>()),
  runAssistantLoop: (a: LoopArgs) => runAssistantLoop(a),
}));
const { languageModelFor } = vi.hoisted(() => ({
  languageModelFor: vi.fn(() => ({ fake: "model" })),
}));
vi.mock("@/lib/ai/providers/language-model", () => ({ languageModelFor }));
const { summarizeThread, titleThread } = vi.hoisted(() => ({
  summarizeThread: vi.fn(async () => ({
    summary: "S",
    usage: { inputTokens: 1, outputTokens: 1 },
  })),
  titleThread: vi.fn(async () => ({
    title: "Overdue items",
    usage: { inputTokens: 1, outputTokens: 1 },
  })),
}));
vi.mock("@/lib/assistant/thread-housekeeping", () => ({
  summarizeThread,
  titleThread,
}));
type ToolsArgs = {
  ctx: { getClient: () => Promise<unknown>; actorId: string };
  client: unknown;
  orgId: string;
  stage: (c: unknown) => boolean;
  describe?: (tool: string, input: Record<string, unknown>) => string | null;
};
const buildAssistantTools = vi.fn<(a: ToolsArgs) => Record<string, never>>();
vi.mock("@/lib/assistant/tools", () => ({
  buildAssistantTools: (a: ToolsArgs) => buildAssistantTools(a),
}));
const { getBoardPayload, listOrgMembersCached } = vi.hoisted(() => ({
  getBoardPayload: vi.fn<(id: string) => Promise<unknown>>(async () => null),
  listOrgMembersCached: vi.fn(
    async (): Promise<
      { userId: string; fullName: string | null; email: string }[]
    > => [],
  ),
}));
vi.mock("@/lib/boards/queries", () => ({ getBoardPayload }));
const { resolveMonoTurn, getMonoClient } = vi.hoisted(() => ({
  resolveMonoTurn: vi.fn(),
  getMonoClient: vi.fn(async () => ({ mono: "client" })),
}));
vi.mock("@/lib/monos/turn", () => ({
  resolveMonoTurn,
  monoSystemLines: () => "MONO LINES",
}));
vi.mock("@/lib/mono/session", () => ({ getMonoClient }));
vi.mock("@/lib/org/queries-cached", () => ({ listOrgMembersCached }));
vi.mock("@/lib/profile/queries-cached", () => ({
  getUserTimeZoneCached: vi.fn(async () => "Europe/Berlin"),
}));
// Mutable so tests can shape the thread the route reads — the real
// implementation is kept (spread `actual`) for everything else.
type FakeMessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tool_trace: null;
  created_at: string;
  agent_id: string | null;
};
const { getMessagesRows, setMessagesRows } = vi.hoisted(() => {
  let rows: FakeMessageRow[] = [];
  return {
    getMessagesRows: () => rows,
    setMessagesRows: (r: FakeMessageRow[]) => {
      rows = r;
    },
  };
});
const defaultMessagesRows = (): FakeMessageRow[] => [
  {
    id: "m1",
    role: "user",
    content: "hi",
    tool_trace: null,
    created_at: "t",
    agent_id: null,
  },
];
vi.mock("@/lib/ai/ask/conversations", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/ai/ask/conversations")>();
  return {
    ...actual,
    getMessages: vi.fn(async () => getMessagesRows()),
  };
});

// conversation fetch + assistant insert + title update via a chained mock client
const single = vi.fn<
  () => Promise<{ data: { id: string } | null; error: unknown }>
>(async () => ({ data: { id: "a1" }, error: null }));
const insertSpy = vi.fn(() => ({ select: () => ({ single }) }));
const updateSpy = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));

const USER_ID = "u1"; // matches the requireUser mock above.

type ConversationRow = {
  summary: string | null;
  summarized_upto: string | null;
  board_id: string | null;
  folder_id: string | null;
  agent_id: string | null;
  user_id: string;
  mono_id: string | null;
};
const defaultConversationRow = (): ConversationRow => ({
  summary: null,
  summarized_upto: null,
  board_id: null,
  folder_id: null,
  agent_id: null,
  user_id: USER_ID,
  mono_id: null,
});
let conversationRow: { data: ConversationRow | null; error: unknown } = {
  data: defaultConversationRow(),
  error: null,
};
/** Overrides the conversation row `ai_conversations` reads back for the next
 *  POST. `user_id` defaults to the caller so existing tests keep passing the
 *  owner gate without having to know it exists. */
function mockConversationRow(overrides: Partial<ConversationRow>) {
  conversationRow = {
    data: { ...defaultConversationRow(), ...overrides },
    error: null,
  };
}
/** The RLS-scoped payload `getBoardPayload` returns for `board_id`. Pass
 *  `null` to simulate an RLS-invisible or dangling board. Only the fields
 *  `buildBoardFocus` reads are filled; the rest are empty collections. */
function mockBoardPayload(
  board: { id: string; name: string; org_id?: string } | null,
) {
  getBoardPayload.mockResolvedValue(
    board
      ? {
          board: { org_id: "org1", ...board },
          groups: [],
          columns: [],
          items: [],
          cellValues: [],
          dependencies: [],
        }
      : null,
  );
}

type FolderRowData = {
  id: string;
  name: string;
  workspace_id: string;
  org_id: string;
  position: number;
};
let folderRow: { data: FolderRowData | null; error: unknown } = {
  data: null,
  error: null,
};
type FolderBoardsRow = {
  position: number;
  boards: { id: string; name: string; archived_at: string | null };
};
let folderBoardsRows: { data: FolderBoardsRow[] | null; error: unknown } = {
  data: [],
  error: null,
};

/** Overrides the `folders` row `getFolderHead` reads back for `folder_id`.
 *  Pass `null` to simulate an RLS-invisible or dangling folder id, which
 *  `getFolderHead` maps to `null` for the route to degrade on. */
function mockFolderHead(
  folder: Omit<FolderRowData, "workspace_id" | "org_id" | "position"> &
    Partial<Pick<FolderRowData, "workspace_id" | "org_id" | "position">>,
  boards: { id: string; name: string }[],
) {
  folderRow = {
    data: {
      workspace_id: "ws1",
      org_id: "org1",
      position: 0,
      ...folder,
    },
    error: null,
  };
  folderBoardsRows = {
    data: boards.map((b, i) => ({
      position: i,
      boards: { id: b.id, name: b.name, archived_at: null },
    })),
    error: null,
  };
}
function mockFolderMissing() {
  folderRow = { data: null, error: null };
  folderBoardsRows = { data: [], error: null };
}

// Table-routed, because the route reads several tables through the same
// client: ai_conversations (owner gate + board/folder ids), the folder
// tables, and ai_messages (the assistant insert). `user_agents` is not
// mocked: the route must never read it, and an unmocked table throws. The board focus goes
// through `getBoardPayload`, mocked above, never this client.
//
// ONE client object for the whole file, so a test can prove the tool builder
// got exactly the client the route created.
const { theClient } = vi.hoisted(() => ({
  theClient: { current: null as unknown },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => theClient.current),
}));
theClient.current = {
  from: (table: string) => {
    if (table === "ai_conversations") {
      return {
        select: () => ({
          eq: () => ({ single: vi.fn(async () => conversationRow) }),
        }),
        update: updateSpy,
      };
    }
    if (table === "ai_messages") {
      return { insert: insertSpy };
    }
    if (table === "folders") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: vi.fn(async () => folderRow) }),
        }),
      };
    }
    if (table === "folder_boards") {
      return {
        select: () => ({
          eq: () => ({
            is: () => ({
              order: () => ({
                limit: vi.fn(async () => folderBoardsRows),
              }),
            }),
          }),
        }),
      };
    }
    throw new Error(`unmocked table in test double: ${table}`);
  },
};

import { POST } from "./route";
import { runAi } from "@/lib/ai/gateway";
import {
  OPENING_STATUS,
  PROPOSAL_FALLBACK_ANSWER,
} from "@/lib/ai/ask/stream-protocol";

const CONV_ID = "11111111-1111-4111-8111-111111111111";
// `agentId` (or any other extra key) is accepted here so a test can prove the
// route ignores it — `bodySchema` has no such field and zod strips it silently.
const request = (body: Record<string, unknown>) =>
  new Request("http://x/api/ask", {
    method: "POST",
    body: JSON.stringify(body),
  });
const makeReq = () => request({ conversationId: CONV_ID });

async function readEvents() {
  const res = await POST(makeReq());
  return (await res.text())
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { type: string; [k: string]: unknown });
}

const stagedCall = (id: string) => ({
  id,
  tool: "update_item",
  input: { itemId: "i-1" },
  summary: "Update an item.",
  destructive: false,
  boardId: null,
});

/** Make the tool builder stage these calls the moment it is built — what a
 *  turn that lined up changes looks like from the route's side. */
function stageOnBuild(...ids: string[]) {
  buildAssistantTools.mockImplementation((args) => {
    for (const id of ids) args.stage(stagedCall(id));
    return {};
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  afterTasks.length = 0;
  conversationRow = { data: defaultConversationRow(), error: null };
  mockBoardPayload(null);
  listOrgMembersCached.mockResolvedValue([]);
  mockFolderMissing();
  single.mockResolvedValue({ data: { id: "a1" }, error: null });
  setMessagesRows(defaultMessagesRows());
  supportsToolsRef.value = true;
  adapterKindRef.value = "anthropic";
  requestModelRef.value = "claude-sonnet-5-20260101";
  activeOrg.current = { id: "org1", name: "Acme", timezone: null };
  // Emits one token so the streaming tests still see a token on the wire.
  runAssistantLoop.mockImplementation(async (a) => {
    a.emit({ type: "token", text: "Answer." });
    return loopResult();
  });
  buildAssistantTools.mockReturnValue({});
});

describe("POST /api/ask", () => {
  it("streams tokens then a done event with the assistant message id", async () => {
    const res = await POST(makeReq());
    const text = await res.text();
    expect(text).toContain('"type":"token"');
    expect(text).toContain('"type":"done"');
    expect(text).toContain('"assistantMessageId":"a1"');
  });

  // gotcha-62: statuses only ever appeared AFTER a tool round completed, so the
  // opening 25–42s of a turn carried no server signal at all.
  it("opens the turn with a status event, before any token", async () => {
    const res = await POST(makeReq());
    const events = (await res.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { type: string; text?: string });

    expect(events[0]).toEqual({ type: "status", text: OPENING_STATUS });
    expect(events.findIndex((e) => e.type === "status")).toBeLessThan(
      events.findIndex((e) => e.type === "token"),
    );
  });

  it("auto-titles on the first exchange", async () => {
    const res = await POST(makeReq());
    const text = await res.text();
    expect(text).toMatch(/"type":"done"/);
    expect(text).toContain('"title":"Overdue items"');
  });

  // The persistence work lives in the ReadableStream's `start()`, which only
  // runs once the body is consumed — so every insert assertion drains it first.
  const post = async () => {
    await (await POST(makeReq())).text();
  };

  it("persists an empty trace (no staged calls) on a read-only turn", async () => {
    await post();
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        tool_trace: { boardsConsulted: [] },
      }),
    );
  });

  // Replaces "persists proposedActions into tool_trace on a proposal turn":
  // the unified runtime stages calls instead of proposing ValidatedActions.
  it("stores staged calls on the assistant message and emits a staged event", async () => {
    stageOnBuild("c1");
    const events = await readEvents();
    expect(events).toContainEqual({
      type: "staged",
      calls: [stagedCall("c1")],
    });
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        tool_trace: { boardsConsulted: [], stagedCalls: [stagedCall("c1")] },
      }),
    );
    // Emitted before `done`, so the client can bind it to the real message id.
    expect(events.findIndex((e) => e.type === "staged")).toBeLessThan(
      events.findIndex((e) => e.type === "done"),
    );
  });

  it("emits no staged event for a turn that staged nothing", async () => {
    const events = await readEvents();
    expect(events.some((e) => e.type === "staged")).toBe(false);
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tool_trace: { boardsConsulted: [] } }),
    );
  });

  it("refuses to stage beyond the cap", async () => {
    let accepted = 0;
    buildAssistantTools.mockImplementation((args) => {
      for (let i = 0; i < 60; i++)
        if (args.stage(stagedCall(`c${i}`))) accepted++;
      return {};
    });
    const events = await readEvents();
    expect(accepted).toBe(50);
    const staged = events.find((e) => e.type === "staged");
    expect(staged?.calls).toHaveLength(50);
  });

  it("tells the model no page is in focus for a thread with no board", async () => {
    await readEvents();
    const args = runAssistantLoop.mock.calls[0]![0];
    expect(args.system).toContain("No page is in focus");
    expect(getBoardPayload).not.toHaveBeenCalled();
  });

  // SECURITY: reads run, and staged writes are later applied, under the
  // signed-in user's own cookie-bound client, so RLS is the boundary.
  it("hands the tool builder the signed-in user's own client and id", async () => {
    await readEvents();
    const args = buildAssistantTools.mock.calls[0]![0];
    expect(args.ctx.actorId).toBe(USER_ID);
    expect(args.client).toBe(theClient.current);
    await expect(args.ctx.getClient()).resolves.toBe(theClient.current);
  });

  it("rejects a model that cannot use tools, without running the loop", async () => {
    supportsToolsRef.value = false;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events = await readEvents();
    const error = events.find((e) => e.type === "error");
    expect(error?.message).toMatch(/can't use tools/);
    expect(error?.message).toContain("Settings");
    expect(events.some((e) => e.type === "done")).toBe(false);
    expect(runAssistantLoop).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("runs the loop on the model runAi resolved, by its wire id", async () => {
    await readEvents();
    expect(languageModelFor).toHaveBeenCalledWith({
      kind: "anthropic",
      apiKey: "k",
      baseUrl: null,
      model: "claude-sonnet-5-20260101",
    });
    expect(runAssistantLoop.mock.calls[0]![0]).toMatchObject({
      model: { fake: "model" },
      messages: [{ role: "user", content: "hi" }],
    });
  });

  it("reports running usage from the loop, on top of what the turn spent first", async () => {
    // A thread long enough to fold, so the summary really spent tokens first.
    setMessagesRows(
      Array.from({ length: 12 }, (_, i) => ({
        id: `m${i}`,
        role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `turn ${i}`,
        tool_trace: null,
        created_at: `t${String(i).padStart(2, "0")}`,
        agent_id: null,
      })),
    );
    summarizeThread.mockResolvedValueOnce({
      summary: "S",
      usage: { inputTokens: 7, outputTokens: 3 },
    });
    runAssistantLoop.mockImplementationOnce(async (a) => {
      a.onUsage?.({
        inputTokens: 10,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      return loopResult();
    });
    await readEvents();
    expect(summarizeThread).toHaveBeenCalledTimes(1);
    expect(reportUsageSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ inputTokens: 17, outputTokens: 5 }),
    );
  });

  it("meters the summary spend even when the loop dies on its first step", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setMessagesRows(
      Array.from({ length: 12 }, (_, i) => ({
        id: `m${i}`,
        role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `turn ${i}`,
        tool_trace: null,
        created_at: `t${String(i).padStart(2, "0")}`,
        agent_id: null,
      })),
    );
    summarizeThread.mockResolvedValueOnce({
      summary: "S",
      usage: { inputTokens: 7, outputTokens: 3 },
    });
    runAssistantLoop.mockImplementationOnce(async () => {
      throw new Error("provider down");
    });
    const events = await readEvents();
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(reportUsageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 7, outputTokens: 3 }),
    );
    spy.mockRestore();
  });

  // Once caching engages, Anthropic's input_tokens is the UNCACHED remainder
  // only — a 26k-token turn reports ~2k input_tokens + ~24k
  // cache_read_input_tokens. Dropping the cache fields on the way to the
  // ledger would under-bill the org by the entire cached prefix.
  it("forwards cacheReadTokens/cacheWriteTokens from the loop to the metering call", async () => {
    runAssistantLoop.mockImplementationOnce(async ({ emit }) => {
      emit({ type: "token", text: "Hi" });
      return loopResult({
        text: "Hi",
        usage: {
          inputTokens: 2_000,
          outputTokens: 50,
          cacheReadTokens: 24_000,
          cacheWriteTokens: 1_500,
        },
      });
    });
    await post();
    expect(meteredSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheReadTokens: 24_000,
        cacheWriteTokens: 1_500,
      }),
    );
  });

  it("returns 402 when entitlement throws", async () => {
    const { requireAiEntitlement } = await import("@/lib/ai/entitlement");
    (requireAiEntitlement as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("AiQuotaExceeded"),
    );
    const res = await POST(makeReq());
    expect(res.status).toBe(402);
  });
});

// gotcha-62: the turn used to live inside the response body's lifetime, so a
// reload / RSC navigation cancelled the stream, the next enqueue threw, and the
// turn died before it persisted OR billed — model work already paid for
// upstream, lost. The turn must now outlive the reader.
describe("POST /api/ask · client disconnect", () => {
  /** Drive a turn until the engine is mid-flight, then sever the body. Returns
   *  `release`, which lets the now client-less turn run to completion. */
  async function severMidTurn(
    result: Partial<LoopResult> = {},
  ): Promise<() => void> {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const enteredEngine = new Promise<void>((r) => (entered = r));

    runAssistantLoop.mockImplementationOnce(async ({ emit }) => {
      entered();
      await held;
      // The first write after the client is gone — this is what used to throw.
      emit({ type: "token", text: "Hi" });
      return loopResult({
        text: "Hi",
        usage: { inputTokens: 3, outputTokens: 5 },
        ...result,
      });
    });

    const res = await POST(makeReq());
    const reader = res.body!.getReader();
    await reader.read(); // the opening status byte
    await enteredEngine;
    await reader.cancel(); // the browser goes away mid-turn
    return release;
  }

  it("persists the assistant message after the reader cancels mid-stream", async () => {
    const release = await severMidTurn();
    release();
    await vi.waitFor(() =>
      expect(insertSpy).toHaveBeenCalledWith(
        expect.objectContaining({ role: "assistant", content: "Hi" }),
      ),
    );
  });

  it("still meters usage after the reader cancels mid-stream", async () => {
    const release = await severMidTurn();
    release();
    await vi.waitFor(() =>
      expect(meteredSpy).toHaveBeenCalledWith(
        expect.objectContaining({ inputTokens: expect.any(Number) }),
      ),
    );
  });

  // Was "persists a proposal turn's confirm card after a disconnect": the
  // confirm card is now the staged batch.
  it("persists a staged turn's confirm card after a disconnect", async () => {
    stageOnBuild("c1");
    const release = await severMidTurn();
    release();
    await vi.waitFor(() =>
      expect(insertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tool_trace: {
            boardsConsulted: [],
            stagedCalls: [stagedCall("c1")],
          },
        }),
      ),
    );
  });

  it("still auto-titles the conversation after a disconnect", async () => {
    const release = await severMidTurn();
    release();
    await vi.waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({ title: "Overdue items" }),
    );
  });

  it("hands the turn to after() so the platform keeps the invocation alive", async () => {
    await (await POST(makeReq())).text();
    expect(afterTasks).toHaveLength(1);
  });
});

// The conversation row — not the request body — is the source of the board
// id for a turn, so ownership and scope are asserted against `ai_conversations`
// and `boards` reads.
describe("POST /api/ask · ownership and board scope", () => {
  const BOARD_ID = "board-1";
  const AGENT_ID = "agent-1";
  const SOMEONE_ELSE_ID = "u2";

  it("refuses a turn on a conversation the caller does not own", async () => {
    // A board member can READ a shared thread, but a turn spends the OWNER's
    // tokens and appends to their thread. Without this gate, read access to a
    // shared thread would be a licence to bill its owner.
    mockConversationRow({
      board_id: BOARD_ID,
      agent_id: null,
      user_id: SOMEONE_ELSE_ID,
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(403);
    expect(runAi).not.toHaveBeenCalled();
  });

  it("answers a legacy agent thread as the org assistant, without reading user_agents", async () => {
    // The table double throws on `user_agents`, so reaching it would fail
    // the turn rather than pass silently.
    mockConversationRow({ board_id: null, agent_id: AGENT_ID });
    const text = await (await POST(makeReq())).text();
    expect(text).toContain('"type":"done"');
    const system = runAssistantLoop.mock.calls[0]![0].system;
    expect(system).not.toContain("personal agent");
    expect(insertSpy).toHaveBeenCalledWith(
      expect.not.objectContaining({ agent_id: expect.anything() }),
    );
  });

  it("composes the board focus into the system prompt for a board thread", async () => {
    // The `if (conv.data.board_id)` branch: the board the thread belongs to is
    // what the user is looking at, so it rides the prompt as a FOCUS block.
    mockConversationRow({ board_id: BOARD_ID, agent_id: null });
    mockBoardPayload({ id: BOARD_ID, name: "Roadmap" });
    listOrgMembersCached.mockResolvedValue([
      { userId: "u-ana", fullName: "Ana", email: "ana@example.com" },
    ]);
    await (await POST(makeReq())).text();
    expect(getBoardPayload).toHaveBeenCalledWith(BOARD_ID);
    const system = runAssistantLoop.mock.calls[0]![0].system;
    expect(system).toContain("=== FOCUS");
    expect(system).toContain(BOARD_ID);
    expect(system).toContain("Roadmap");
    expect(system).toContain("u-ana | Ana");
    // Email never reaches a prompt.
    expect(system).not.toContain("ana@example.com");
  });

  it("degrades to no focus when the board is not readable", async () => {
    mockConversationRow({ board_id: BOARD_ID, agent_id: null });
    mockBoardPayload(null);
    await (await POST(makeReq())).text();
    const system = runAssistantLoop.mock.calls[0]![0].system;
    expect(system).toContain("No page is in focus");
    expect(system).not.toContain("=== FOCUS");
  });

  it("gives no focus for a board that belongs to another org", async () => {
    // A cross-org share can make a board RLS-readable; it is still not this
    // org's turn to describe it.
    mockConversationRow({ board_id: BOARD_ID, agent_id: null });
    mockBoardPayload({ id: BOARD_ID, name: "Roadmap", org_id: "org2" });
    await (await POST(makeReq())).text();
    const system = runAssistantLoop.mock.calls[0]![0].system;
    expect(system).not.toContain("Roadmap");
    expect(system).toContain("No page is in focus");
  });

  it("keeps the board focus on a legacy agent board thread", async () => {
    mockConversationRow({ board_id: BOARD_ID, agent_id: AGENT_ID });
    mockBoardPayload({ id: BOARD_ID, name: "Roadmap" });
    await (await POST(makeReq())).text();
    const system = runAssistantLoop.mock.calls[0]![0].system;
    expect(system).not.toContain("personal agent");
    expect(system).toContain("=== FOCUS");
    expect(system).toContain("Roadmap");
  });

  it("composes the folder scope into the system prompt for a folder thread", async () => {
    const FOLDER_ID = "folder-1";
    mockConversationRow({
      board_id: null,
      folder_id: FOLDER_ID,
      agent_id: null,
    });
    mockFolderHead({ id: FOLDER_ID, name: "Q4 Launch" }, [
      { id: "b1", name: "Backend" },
      { id: "b2", name: "Mobile" },
    ]);
    await (await POST(makeReq())).text();
    const system = runAssistantLoop.mock.calls[0]![0].system;
    expect(system).toContain('folder "');
    expect(system).toContain("Backend");
    expect(system).toContain("Mobile");
    // A folder thread is scoped by its folder block, not a FOCUS line.
    expect(system).not.toContain("No page is in focus");
  });

  it("degrades to plain Ask when the folder is no longer readable", async () => {
    const FOLDER_ID = "folder-1";
    mockConversationRow({
      board_id: null,
      folder_id: FOLDER_ID,
      agent_id: null,
    });
    mockFolderMissing();
    await (await POST(makeReq())).text();
    const system = runAssistantLoop.mock.calls[0]![0].system;
    expect(system).not.toContain('folder "');
  });

  it("ignores folder_id when board_id is also set (board wins)", async () => {
    mockConversationRow({
      board_id: BOARD_ID,
      folder_id: "folder-1",
      agent_id: null,
    });
    mockBoardPayload({ id: BOARD_ID, name: "Roadmap" });
    await (await POST(makeReq())).text();
    const system = runAssistantLoop.mock.calls[0]![0].system;
    expect(system).toContain("Roadmap");
    expect(system).not.toContain('folder "');
  });

  it("meters a dock turn as ask_pulse, never against the agent run cap", async () => {
    // max_agent_runs_per_user_per_day bounds UNATTENDED spend. Charging
    // conversation against it would let an afternoon of chat silently cancel
    // tomorrow's briefing.
    mockConversationRow({ board_id: BOARD_ID, agent_id: AGENT_ID });
    await (await POST(makeReq())).text();
    expect(runAi).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "ask_pulse" }),
      expect.any(Function),
    );
  });
});

// Every turn is the org assistant: a stamped user turn or a request-body
// `agentId` never selects a persona, and the assistant row carries no agent.
describe("POST /api/ask · every turn is the org assistant", () => {
  it("ignores a turn stamped with an old agent and a request-body agentId", async () => {
    setMessagesRows([
      {
        id: "m1",
        role: "user",
        content: "what about invoices?",
        tool_trace: null,
        created_at: "t1",
        agent_id: "a-fin",
      },
    ]);
    await (
      await POST(request({ conversationId: CONV_ID, agentId: "a-attacker" }))
    ).text();
    const system = runAssistantLoop.mock.calls[0]![0].system;
    expect(system).not.toContain("personal agent");
    expect(system).not.toContain("a-attacker");
    const inserted = (insertSpy.mock.calls as unknown[][])[0]![0];
    expect(inserted).toMatchObject({ role: "assistant" });
    expect(inserted).not.toHaveProperty("agent_id");
  });
});

describe("POST /api/ask · a lost answer is not a completed turn", () => {
  it("emits an error instead of a done when the assistant row cannot be saved", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    single.mockResolvedValue({
      data: null,
      error: { message: "insert or update violates foreign key constraint" },
    });
    const text = await (await POST(makeReq())).text();
    expect(text).toContain('"type":"error"');
    expect(text).not.toContain('"type":"done"');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// Rolling-summary compaction. `summarizeThread` hands back the PRIOR summary
// when the model returns nothing, so "non-empty" alone does not mean "new":
// advancing `summarized_upto` on an unchanged summary drops the folded turns
// for good.
describe("POST /api/ask · rolling summary", () => {
  /** 12 rows: the 2 oldest fold, the newest 10 stay verbatim. */
  const longThread = () =>
    setMessagesRows(
      Array.from({ length: 12 }, (_, i) => ({
        id: `m${i}`,
        role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `turn ${i}`,
        tool_trace: null,
        created_at: `t${String(i).padStart(2, "0")}`,
        agent_id: null,
      })),
    );

  it("folds older turns, advances the cursor, and sends only recent turns", async () => {
    longThread();
    summarizeThread.mockResolvedValueOnce({
      summary: "New summary",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    await readEvents();
    expect(updateSpy).toHaveBeenCalledWith({
      summary: "New summary",
      summarized_upto: "t01",
    });
    const args = runAssistantLoop.mock.calls[0]![0];
    expect(args.messages).toHaveLength(10);
    expect(args.system).toContain("New summary");
  });

  it("does not advance the cursor when the summary came back unchanged", async () => {
    longThread();
    mockConversationRow({ summary: "Old summary" });
    summarizeThread.mockResolvedValueOnce({
      summary: "Old summary",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    await readEvents();
    expect(updateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ summarized_upto: expect.anything() }),
    );
  });

  it("does not advance the cursor on an empty summary", async () => {
    longThread();
    summarizeThread.mockResolvedValueOnce({
      summary: "",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    await readEvents();
    expect(updateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ summarized_upto: expect.anything() }),
    );
  });
});

// A3: card labels come from the board the route already loaded for FOCUS.
describe("POST /api/ask · staged labels from real board data", () => {
  const BOARD_ID = "board-1";
  const ITEM = "i0000000-0000-4000-8000-000000000001";

  it("passes a describe function built from the focus payload on a board thread", async () => {
    mockConversationRow({ board_id: BOARD_ID, agent_id: null });
    getBoardPayload.mockResolvedValue({
      board: { id: BOARD_ID, name: "Roadmap", org_id: "org1" },
      groups: [],
      columns: [],
      items: [{ id: ITEM, name: "Press kit", group_id: "g", parent_id: null }],
      cellValues: [],
      dependencies: [],
    });
    await readEvents();
    const describe = buildAssistantTools.mock.calls[0]![0].describe;
    expect(describe).toBeTypeOf("function");
    expect(describe!("manage_item", { action: "archive", itemId: ITEM })).toBe(
      'Archive the item "Press kit"',
    );
    // No extra read: the payload was loaded once, for the focus block.
    expect(getBoardPayload).toHaveBeenCalledTimes(1);
  });

  it("passes no describe function on a thread with no board", async () => {
    await readEvents();
    expect(buildAssistantTools.mock.calls[0]![0].describe).toBeUndefined();
  });

  it("passes no describe function when the board is not readable", async () => {
    mockConversationRow({ board_id: BOARD_ID, agent_id: null });
    mockBoardPayload(null);
    await readEvents();
    expect(buildAssistantTools.mock.calls[0]![0].describe).toBeUndefined();
  });
});

// gotcha-62: the opening status is the turn's first byte. A full board
// payload read must never sit in front of it.
describe("POST /api/ask · board focus is read inside the turn", () => {
  const BOARD_ID = "board-1";

  it("emits the opening status before the board read starts", async () => {
    mockConversationRow({ board_id: BOARD_ID, agent_id: null });
    // Call order across the wire and the read: every encoded event, and the
    // moment the payload read begins.
    const order: string[] = [];
    const realEncode = TextEncoder.prototype.encode;
    const encodeSpy = vi
      .spyOn(TextEncoder.prototype, "encode")
      .mockImplementation(function (this: TextEncoder, input?: string) {
        const type = /"type":"(\w+)"/.exec(input ?? "")?.[1];
        if (type) order.push(`emit:${type}`);
        return realEncode.call(this, input);
      });
    let releasePayload!: () => void;
    const held = new Promise<void>((r) => (releasePayload = r));
    getBoardPayload.mockImplementation(async () => {
      order.push("payload read started");
      await held;
      return null;
    });
    try {
      // POST returns while the board read is still held: the read is not in
      // front of the response.
      const res = await POST(makeReq());
      const reader = res.body!.getReader();
      const first = await reader.read();
      expect(JSON.parse(new TextDecoder().decode(first.value).trim())).toEqual({
        type: "status",
        text: OPENING_STATUS,
      });
      await vi.waitFor(() => expect(order).toContain("payload read started"));
      expect(order.indexOf("emit:status")).toBe(0);
      expect(order.indexOf("emit:status")).toBeLessThan(
        order.indexOf("payload read started"),
      );
      expect(runAssistantLoop).not.toHaveBeenCalled();
      releasePayload();
      while (!(await reader.read()).done) {
        /* drain */
      }
      expect(runAssistantLoop).toHaveBeenCalledTimes(1);
    } finally {
      encodeSpy.mockRestore();
    }
  });

  it("degrades to no focus, and still completes, when the board read throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockConversationRow({ board_id: BOARD_ID, agent_id: null });
    getBoardPayload.mockRejectedValue(new Error("transport down"));
    const events = await readEvents();
    expect(events.some((e) => e.type === "done")).toBe(true);
    expect(events.some((e) => e.type === "error")).toBe(false);
    const system = runAssistantLoop.mock.calls[0]![0].system;
    expect(system).toContain("No page is in focus");
    spy.mockRestore();
  });
});

describe("POST /api/ask · fallback text on a staged turn", () => {
  it("stores the live fallback line when a staged turn wrote no text", async () => {
    stageOnBuild("c1");
    runAssistantLoop.mockImplementationOnce(async () =>
      loopResult({
        text: "I finished without writing an answer. I did not complete any lookups.",
        wroteText: false,
      }),
    );
    await readEvents();
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ content: PROPOSAL_FALLBACK_ANSWER }),
    );
  });

  it("keeps the runtime fallback for a turn that staged nothing", async () => {
    const fallback =
      "I finished without writing an answer. I did not complete any lookups.";
    runAssistantLoop.mockImplementationOnce(async () =>
      loopResult({ text: fallback, wroteText: false }),
    );
    await readEvents();
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ content: fallback }),
    );
  });

  it("keeps the model's own text on a staged turn that wrote some", async () => {
    stageOnBuild("c1");
    await readEvents();
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Answer." }),
    );
  });
});

// F1: the catalog was built for a user-level MCP connection. Here every
// org-scoped call is pinned to the org the user is working in.
describe("POST /api/ask · pinned to the active org", () => {
  it("hands the tool builder the active org", async () => {
    await readEvents();
    expect(buildAssistantTools.mock.calls[0]![0].orgId).toBe("org1");
  });

  it("names the active org in the turn's system text", async () => {
    await readEvents();
    const system = runAssistantLoop.mock.calls[0]![0].system;
    expect(system).toMatch(/organization "Acme" \(id org1\)/);
    expect(system).toMatch(/only inside that organization/);
  });

  it("names the signed-in user so 'me' resolves to them, without an email", async () => {
    listOrgMembersCached.mockResolvedValue([
      { userId: "u-other", fullName: "Ana", email: "ana@example.com" },
      { userId: USER_ID, fullName: "Dana\nJones", email: "dana@example.com" },
    ]);
    await readEvents();
    const system = runAssistantLoop.mock.calls[0]![0].system;
    expect(system).toContain(USER_ID);
    expect(system).toContain('"Dana Jones"');
    expect(system).toMatch(/"me", "my" and "I"/);
    expect(system).not.toContain("@");
  });

  it("names the signed-in user by id alone when no name is available", async () => {
    listOrgMembersCached.mockResolvedValue([
      { userId: USER_ID, fullName: null, email: "dana@example.com" },
    ]);
    await readEvents();
    const system = runAssistantLoop.mock.calls[0]![0].system;
    expect(system).toContain(`user id ${USER_ID}`);
    expect(system).toMatch(/"me", "my" and "I"/);
    expect(system).not.toContain("@");
  });

  it("follows the org switcher, not a fixed org", async () => {
    activeOrg.current = { id: "org2", name: "Beta", timezone: null };
    await readEvents();
    expect(buildAssistantTools.mock.calls[0]![0].orgId).toBe("org2");
    expect(runAssistantLoop.mock.calls[0]![0].system).toContain("org2");
  });
});

// F3: a turn whose model wrote no text used to show an empty bubble live and
// the fallback line only after a reload.
describe("POST /api/ask · a turn with no text streams its stored answer", () => {
  const tokens = (events: { type: string; text?: unknown }[]) =>
    events
      .filter((e) => e.type === "token")
      .map((e) => e.text)
      .join("");

  it("streams the staged fallback before done", async () => {
    stageOnBuild("c1");
    runAssistantLoop.mockImplementationOnce(async () =>
      loopResult({
        text: "I finished without writing an answer.",
        wroteText: false,
      }),
    );
    const events = await readEvents();
    expect(tokens(events)).toBe(PROPOSAL_FALLBACK_ANSWER);
    const tokenAt = events.findIndex((e) => e.type === "token");
    expect(tokenAt).toBeGreaterThan(-1);
    expect(tokenAt).toBeLessThan(events.findIndex((e) => e.type === "done"));
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ content: PROPOSAL_FALLBACK_ANSWER }),
    );
  });

  it("streams the step-cap fallback that it stores", async () => {
    const capped =
      "I reached my 12-step limit before I could finish. I used: list_items. Ask me to continue.";
    runAssistantLoop.mockImplementationOnce(async () =>
      loopResult({ text: capped, wroteText: false, hitStepCap: true }),
    );
    const events = await readEvents();
    expect(tokens(events)).toBe(capped);
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ content: capped }),
    );
  });

  it("adds nothing to a turn whose model wrote its own text", async () => {
    const events = await readEvents();
    expect(tokens(events)).toBe("Answer.");
  });
});

// F4: the old loop sent an explicit thinking shape; the AI SDK sends none
// unless asked, so the route maps the repo's own request shape onto the
// Anthropic provider options.
describe("POST /api/ask · reasoning options", () => {
  it("sends the model's thinking shape and effort on the anthropic adapter", async () => {
    await readEvents();
    expect(runAssistantLoop.mock.calls[0]![0].providerOptions).toEqual({
      anthropic: { thinking: { type: "adaptive" }, effort: "high" },
    });
  });

  it("sends the budgeted thinking form, and no effort, for Haiku", async () => {
    requestModelRef.value = "claude-haiku-4-5-20251001";
    await readEvents();
    expect(runAssistantLoop.mock.calls[0]![0].providerOptions).toEqual({
      anthropic: { thinking: { type: "enabled", budgetTokens: 1024 } },
    });
  });

  it("sends no provider options on another adapter", async () => {
    adapterKindRef.value = "openai";
    await readEvents();
    expect(runAssistantLoop.mock.calls[0]![0].providerOptions).toBeUndefined();
  });
});

describe("POST /api/ask · a Mono thread", () => {
  it("acts as the Mono, on the owner's own key, metered as mono_chat", async () => {
    mockConversationRow({ mono_id: "m1" });
    resolveMonoTurn.mockResolvedValue({
      ok: true,
      turn: { mono: { userId: "m1", name: "Nova" }, provider: "openai" },
    });
    await (await POST(makeReq())).text();

    expect(resolveMonoTurn).toHaveBeenCalledWith(
      theClient.current,
      USER_ID,
      "org1",
      "m1",
    );
    expect(getMonoClient).toHaveBeenCalledWith("m1");
    const built = buildAssistantTools.mock.calls[0]![0];
    expect(built.ctx.actorId).toBe("m1");
    expect(await built.ctx.getClient()).toEqual({ mono: "client" });
    expect(built.client).toEqual({ mono: "client" });
    expect(vi.mocked(runAi).mock.calls[0]![0]).toMatchObject({
      orgId: "org1",
      userId: USER_ID,
      feature: "mono_chat",
      credential: "personal",
      provider: "openai",
    });
    expect(runAssistantLoop.mock.calls[0]![0].system).toContain("MONO LINES");
  });

  it("refuses before streaming when the Mono cannot answer", async () => {
    mockConversationRow({ mono_id: "m1" });
    resolveMonoTurn.mockResolvedValue({
      ok: false,
      status: 409,
      error: "Your Mono is asleep.",
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(409);
    expect(runAi).not.toHaveBeenCalled();
  });

  it("never resolves a Mono for an ordinary thread", async () => {
    await (await POST(makeReq())).text();
    expect(resolveMonoTurn).not.toHaveBeenCalled();
    expect(getMonoClient).not.toHaveBeenCalled();
    expect(vi.mocked(runAi).mock.calls[0]![0]).toMatchObject({
      feature: "ask_pulse",
    });
    expect(vi.mocked(runAi).mock.calls[0]![0]).not.toHaveProperty("credential");
  });
});
