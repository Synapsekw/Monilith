import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tables } from "@/types/database.types";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ORG_ID = "99999999-9999-4999-8999-999999999999";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const BOARD_ID = "44444444-4444-4444-8444-444444444444";

const requireUser = vi.fn();
const resolveActiveOrg = vi.fn();

vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: () => resolveActiveOrg(),
}));

/** A stored row whose jsonb payload really does satisfy `payloadSchema`, so
 *  `rowToRun` returns a run rather than null. */
const sampleRow = (
  over: Partial<Tables<"board_intelligence_runs">> = {},
): Tables<"board_intelligence_runs"> =>
  ({
    id: RUN_ID,
    org_id: ORG_ID,
    board_id: BOARD_ID,
    user_id: USER_ID,
    generated_at: "2026-09-15T10:00:00.000Z",
    input_hash: "h",
    payload: {
      brief: "Two items slipped this week.",
      suggestions: [],
      signals: [],
    },
    dismissed: [],
    applied: [],
    model: "m",
    tokens_in: 1,
    tokens_out: 1,
    ...over,
  }) as unknown as Tables<"board_intelligence_runs">;

let runRow: Tables<"board_intelligence_runs"> | null = sampleRow();
function mockRun(row: Tables<"board_intelligence_runs"> | null) {
  runRow = row;
}

/** Honours its `.eq()` filters against the row — the same shape
 *  `ask-route.test.ts` uses to prove a scoping filter is actually SENT, not
 *  merely satisfiable. Dropping `.eq("org_id", …)` from the action makes the
 *  cross-org test below fail, which is the only way that test means anything. */
function filteringChain(row: Record<string, unknown> | null) {
  const filters: [string, unknown][] = [];
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = (column: string, value: unknown) => {
    filters.push([column, value]);
    return q;
  };
  q.maybeSingle = async () => ({
    data: row && filters.every(([c, v]) => row[c] === v) ? row : null,
    error: null,
  });
  return q;
}

type ConversationInsert = {
  org_id: string;
  user_id: string;
  board_id: string;
  title: string;
};
type MessageInsert = { conversation_id: string; role: string; content: string };

const inserted: {
  conversations: ConversationInsert[];
  messages: MessageInsert[];
} = { conversations: [], messages: [] };
const deletedConversationIds: string[] = [];
let convError: { message: string } | null = null;
let msgError: { message: string } | null = null;

function makeClient() {
  return {
    from(table: string) {
      if (table === "board_intelligence_runs") {
        return filteringChain(runRow as Record<string, unknown> | null);
      }
      if (table === "ai_conversations") {
        return {
          insert: (row: ConversationInsert) => {
            inserted.conversations.push(row);
            return {
              select: () => ({
                single: async () =>
                  convError
                    ? { data: null, error: convError }
                    : { data: { id: "conv-1" }, error: null },
              }),
            };
          },
          delete: () => ({
            eq: async (_col: string, id: string) => {
              deletedConversationIds.push(id);
              return { error: null };
            },
          }),
        };
      }
      if (table === "ai_messages") {
        return {
          insert: async (rows: MessageInsert[]) => {
            if (msgError) return { error: msgError };
            inserted.messages.push(...rows);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => makeClient(),
}));

import { openQaInChat } from "./qa-thread";

beforeEach(() => {
  vi.clearAllMocks();
  inserted.conversations.length = 0;
  inserted.messages.length = 0;
  deletedConversationIds.length = 0;
  convError = null;
  msgError = null;
  runRow = sampleRow();
  requireUser.mockResolvedValue({ id: USER_ID });
  resolveActiveOrg.mockResolvedValue({ id: ORG_ID });
});

describe("openQaInChat", () => {
  it("writes the conversation and both turns, user first", async () => {
    const res = await openQaInChat({
      runId: RUN_ID,
      question: "what slipped?",
      answer: "Two items.",
    });
    expect(res.ok).toBe(true);

    expect(inserted.conversations[0]).toMatchObject({
      org_id: ORG_ID,
      user_id: USER_ID,
      board_id: BOARD_ID,
      title: "what slipped?",
    });
    // `visibility` never set explicitly — the column default is the
    // guarantee, exactly as `writeBriefingThread` relies on.
    expect(inserted.conversations[0]).not.toHaveProperty("visibility");
    // The FK on `run_id` points at `user_agent_runs`, not
    // `board_intelligence_runs` — setting it would be a foreign-key
    // violation, so it must be absent.
    expect(inserted.conversations[0]).not.toHaveProperty("run_id");

    expect(inserted.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "what slipped?"],
      ["assistant", "Two items."],
    ]);
    expect(inserted.messages).toHaveLength(2);
  });

  it("truncates a long question into the title", async () => {
    await openQaInChat({
      runId: RUN_ID,
      question: "q".repeat(120),
      answer: "a",
    });
    expect(inserted.conversations[0].title).toHaveLength(60);
    expect(inserted.conversations[0].title).toBe("q".repeat(60));
  });

  it("fails for a run the caller cannot read, and writes nothing", async () => {
    mockRun(null);
    const res = await openQaInChat({
      runId: RUN_ID,
      question: "q",
      answer: "a",
    });
    expect(res).toEqual({ ok: false, error: expect.any(String) });
    expect(inserted.conversations).toHaveLength(0);
    expect(inserted.messages).toHaveLength(0);
  });

  it("fails for a run scoped to a different org, and writes nothing", async () => {
    // RLS already scopes this to the owning user; org_id is the second,
    // explicit filter — same belt-and-braces as the ask route. A run that
    // exists but belongs to another org must read as "not found", not leak
    // its board into this org's ledger.
    mockRun(sampleRow({ org_id: OTHER_ORG_ID }));
    const res = await openQaInChat({
      runId: RUN_ID,
      question: "what slipped?",
      answer: "Two items.",
    });
    expect(res).toEqual({ ok: false, error: expect.any(String) });
    expect(inserted.conversations).toHaveLength(0);
  });

  it("deletes the empty conversation when the message insert fails", async () => {
    msgError = { message: "boom" };
    const res = await openQaInChat({
      runId: RUN_ID,
      question: "what slipped?",
      answer: "Two items.",
    });
    expect(res).toEqual({ ok: false, error: expect.any(String) });
    // A thread with no turns is worse than no thread: the conversation row
    // that was inserted is cleaned up rather than left behind.
    expect(deletedConversationIds).toEqual(["conv-1"]);
  });

  it("fails closed on malformed input without touching the database", async () => {
    const res = await openQaInChat({
      runId: "not-a-uuid",
      question: "q",
      answer: "a",
    });
    expect(res).toEqual({ ok: false, error: expect.any(String) });
    expect(inserted.conversations).toHaveLength(0);
  });
});
