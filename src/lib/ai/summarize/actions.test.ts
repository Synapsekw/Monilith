import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeResolvedModel } from "@/test/adapter-fakes";

// A resolved adapter+key, as the real gateway hands to runAi's callback.
// `provider` is per-test so the not-capable branch is exercisable — the gate
// reads the PROVIDER id, not the (per-wire-format) adapter.
let FAKE_RESOLVED = {
  adapter: { kind: "anthropic" },
  apiKey: "k",
  mode: "managed",
  provider: "anthropic",
  baseUrl: null,
  model: fakeResolvedModel(),
};
const runAi = vi.fn(
  async (
    _args: { orgId: string; userId: string; feature: string },
    fn: (resolved: typeof FAKE_RESOLVED) => Promise<{ result: unknown }>,
  ) => {
    const { result } = await fn(FAKE_RESOLVED);
    return result;
  },
);
vi.mock("@/lib/ai/gateway", () => ({
  runAi: (...args: unknown[]) =>
    (runAi as unknown as (...a: unknown[]) => unknown)(...args),
}));

const requireAiEntitlement = vi.fn();
vi.mock("@/lib/ai/entitlement", () => ({
  requireAiEntitlement: (...args: unknown[]) => requireAiEntitlement(...args),
}));

const getUserOrgs = vi.fn();
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: async () => (await getUserOrgs())[0] ?? null,
}));
const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getUserOrgs: (...args: unknown[]) => getUserOrgs(...args),
  requireUser: (...args: unknown[]) => requireUser(...args),
}));

const getBoardPayload = vi.fn();
vi.mock("@/lib/boards/queries", () => ({
  getBoardPayload: (...args: unknown[]) => getBoardPayload(...args),
}));

const listOrgMembersCached = vi.fn();
vi.mock("@/lib/org/queries-cached", () => ({
  listOrgMembersCached: (...args: unknown[]) => listOrgMembersCached(...args),
}));

const buildTranscript = vi.fn();
const summarizeThreadWithAi = vi.fn();
vi.mock("@/lib/ai/summarize/summarize", () => ({
  buildTranscript: (...args: unknown[]) => buildTranscript(...args),
  summarizeThread: (...args: unknown[]) => summarizeThreadWithAi(...args),
}));

// Minimal chainable fake for the two query shapes the action issues:
//   .from("items").select().eq().maybeSingle()
//   .from("item_updates"|"item_activities").select().eq().order().limit()
let ITEM_RESULT: { data: unknown; error: unknown } = {
  data: { id: "item-1", board_id: "board-1" },
  error: null,
};
let UPDATES_RESULT: { data: unknown[]; error: unknown } = {
  data: [],
  error: null,
};
let ACTIVITIES_RESULT: { data: unknown[]; error: unknown } = {
  data: [],
  error: null,
};
const createClient = vi.fn(async () => ({
  from: (table: string) => {
    if (table === "items") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ITEM_RESULT,
          }),
        }),
      };
    }
    if (table === "item_updates") {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => UPDATES_RESULT,
            }),
          }),
        }),
      };
    }
    if (table === "item_activities") {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => ACTIVITIES_RESULT,
            }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const ITEM_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  runAi.mockClear();
  requireAiEntitlement.mockReset();
  getUserOrgs.mockReset();
  requireUser.mockReset();
  getBoardPayload.mockReset();
  listOrgMembersCached.mockReset();
  buildTranscript.mockReset();
  summarizeThreadWithAi.mockReset();
  createClient.mockClear();

  FAKE_RESOLVED = {
    adapter: { kind: "anthropic" },
    apiKey: "k",
    mode: "managed",
    provider: "anthropic",
    baseUrl: null,
    model: fakeResolvedModel(),
  };
  ITEM_RESULT = { data: { id: "item-1", board_id: "board-1" }, error: null };
  UPDATES_RESULT = { data: [], error: null };
  ACTIVITIES_RESULT = { data: [], error: null };

  requireUser.mockResolvedValue({ id: "user-1" });
  getUserOrgs.mockResolvedValue([{ id: "org-1", name: "Org" }]);
  getBoardPayload.mockResolvedValue({
    board: { id: "board-1", org_id: "org-1" },
    columns: [{ id: "col-1" }],
  });
  listOrgMembersCached.mockResolvedValue([{ userId: "u1", fullName: "Ada" }]);
  buildTranscript.mockReturnValue("[t] Ada: hello");
  summarizeThreadWithAi.mockResolvedValue({
    summary: "Catch-up summary.",
    usage: { inputTokens: 10, outputTokens: 5 },
  });
});

describe("summarizeThread action", () => {
  it("rejects a non-uuid itemId before any work", async () => {
    const { summarizeThread } = await import("@/lib/ai/summarize/actions");
    const res = await summarizeThread({ itemId: "not-a-uuid" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Invalid item.");
    expect(requireUser).not.toHaveBeenCalled();
    expect(requireAiEntitlement).not.toHaveBeenCalled();
  });

  it("gates on entitlement before invoking runAi", async () => {
    const { summarizeThread } = await import("@/lib/ai/summarize/actions");
    await summarizeThread({ itemId: ITEM_ID });
    expect(requireAiEntitlement).toHaveBeenCalledWith(
      "org-1",
      "thread_summary",
    );
    expect(requireAiEntitlement.mock.invocationCallOrder[0]).toBeLessThan(
      runAi.mock.invocationCallOrder[0],
    );
  });

  it("fails with 'Nothing to summarize yet.' and never calls runAi when the transcript is empty", async () => {
    buildTranscript.mockReturnValue("");
    const { summarizeThread } = await import("@/lib/ai/summarize/actions");
    const res = await summarizeThread({ itemId: ITEM_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Nothing to summarize yet.");
    expect(runAi).not.toHaveBeenCalled();
    expect(summarizeThreadWithAi).not.toHaveBeenCalled();
  });

  it("returns the summary on the happy path", async () => {
    const { summarizeThread } = await import("@/lib/ai/summarize/actions");
    const res = await summarizeThread({ itemId: ITEM_ID });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.summary).toBe("Catch-up summary.");
    expect(summarizeThreadWithAi).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "k" }),
    );
  });

  it("returns 'Item not found.' when the item row is missing", async () => {
    ITEM_RESULT = { data: null, error: null };
    const { summarizeThread } = await import("@/lib/ai/summarize/actions");
    const res = await summarizeThread({ itemId: ITEM_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Item not found.");
    expect(runAi).not.toHaveBeenCalled();
  });

  it("maps a not-capable provider to the Anthropic-specific copy and never calls the lib", async () => {
    FAKE_RESOLVED = {
      adapter: { kind: "openai" },
      apiKey: "k",
      mode: "managed",
      provider: "openai",
      baseUrl: null,
      model: fakeResolvedModel(),
    };
    const { summarizeThread } = await import("@/lib/ai/summarize/actions");
    const res = await summarizeThread({ itemId: ITEM_ID });
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toBe("Thread summaries need an Anthropic key.");
    expect(summarizeThreadWithAi).not.toHaveBeenCalled();
  });

  it("maps a typed AiDisabledError from requireAiEntitlement to its copy", async () => {
    const { AiDisabledError } = await import("@/lib/ai/errors");
    requireAiEntitlement.mockRejectedValue(new AiDisabledError());
    const { summarizeThread } = await import("@/lib/ai/summarize/actions");
    const res = await summarizeThread({ itemId: ITEM_ID });
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toBe("AI is turned off for your organization.");
  });
});
