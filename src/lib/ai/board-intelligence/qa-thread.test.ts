import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tables } from "@/types/database.types";
import { filteringChain } from "@/test/query-double";

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
/** The compensating delete's own outcome — `null` (default) means it
 *  succeeds; set to reject or to resolve with `.error` to exercise the
 *  branch where the cleanup ITSELF fails. */
let delError: { message: string } | null = null;
let delThrows: Error | null = null;
/** Anything else that should make a database await reject outright, to
 *  prove the action never lets an unexpected throw escape as an unhandled
 *  Server Action error. */
let runReadThrows: Error | null = null;

function makeClient() {
  return {
    from(table: string) {
      if (table === "board_intelligence_runs") {
        if (runReadThrows) {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => {
                    throw runReadThrows;
                  },
                }),
              }),
            }),
          };
        }
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
              if (delThrows) throw delThrows;
              return { error: delError };
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
  delError = null;
  delThrows = null;
  runReadThrows = null;
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
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
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
    // Logged with enough to find it: which insert failed, and the orphaned
    // conversation's id.
    expect(spy).toHaveBeenCalledWith(
      "[qa-thread] message insert failed:",
      expect.objectContaining({ conversationId: "conv-1", cause: "boom" }),
    );
  });

  it("returns a message distinguishable from the normal case, and logs loudly, when the compensating delete ALSO fails", async () => {
    // This is the branch the brief calls "worse than no thread": the message
    // insert failed AND the cleanup that was supposed to remove the empty
    // conversation failed too, so an orphaned row may now sit in the user's
    // ledger. The caller must be told something DIFFERENT from the ordinary
    // "couldn't save" case, and it must be logged loudly enough to find.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    msgError = { message: "boom" };
    delError = { message: "delete denied" };
    const res = await openQaInChat({
      runId: RUN_ID,
      question: "what slipped?",
      answer: "Two items.",
    });
    expect(res.ok).toBe(false);
    expect((res as { ok: false; error: string }).error).not.toBe(
      "Couldn't save that answer to a thread.",
    );
    expect(deletedConversationIds).toEqual(["conv-1"]);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("compensating delete ALSO failed"),
      expect.objectContaining({
        conversationId: "conv-1",
        cause: "delete denied",
      }),
    );
  });

  it("never throws — a rejected delete still returns an ActionResult, not an unhandled error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    msgError = { message: "boom" };
    delThrows = new Error("network dropped mid-delete");
    const res = await openQaInChat({
      runId: RUN_ID,
      question: "what slipped?",
      answer: "Two items.",
    });
    expect(res).toEqual({ ok: false, error: expect.any(String) });
    expect(spy).toHaveBeenCalledWith(
      "[qa-thread] openQaInChat threw:",
      delThrows,
    );
  });

  it("never throws — an unexpected error reading the run still returns an ActionResult", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    runReadThrows = new Error("connection reset");
    const res = await openQaInChat({
      runId: RUN_ID,
      question: "what slipped?",
      answer: "Two items.",
    });
    expect(res).toEqual({ ok: false, error: expect.any(String) });
    expect(inserted.conversations).toHaveLength(0);
    expect(spy).toHaveBeenCalledWith(
      "[qa-thread] openQaInChat threw:",
      runReadThrows,
    );
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
