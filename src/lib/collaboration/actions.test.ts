import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from, auth: { getUser } }),
}));

// ── the agent trigger's collaborators ───────────────────────────────────
const checkAgentMentionRateLimit = vi.fn();
const claimAgentRun = vi.fn();
const dispatchAgentRun = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ __service: true }),
}));
vi.mock("@/lib/rate-limit/agent-mention-rate-limit", () => ({
  checkAgentMentionRateLimit: (...a: unknown[]) =>
    checkAgentMentionRateLimit(...a),
}));
vi.mock("@/lib/agents/mention-dispatch", () => ({
  dispatchAgentRun: (...a: unknown[]) => dispatchAgentRun(...a),
}));
vi.mock("@/lib/agents/run-claim", async (orig) => ({
  ...(await orig<typeof import("@/lib/agents/run-claim")>()),
  claimAgentRun: (...a: unknown[]) => claimAgentRun(...a),
}));

import {
  addUpdate,
  deleteUpdate,
  markNotificationRead,
} from "@/lib/collaboration/actions";

const ITEM = "11111111-1111-4111-8111-111111111111";
const UPD = "22222222-2222-4222-8222-222222222222";
const USER = "99999999-9999-4999-8999-999999999999";
const RUN = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  from.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
  checkAgentMentionRateLimit.mockReset().mockResolvedValue({ allowed: true });
  claimAgentRun
    .mockReset()
    .mockResolvedValue({ outcome: "claimed", runId: RUN });
  dispatchAgentRun.mockReset().mockResolvedValue(undefined);
});

describe("addUpdate", () => {
  it("rejects invalid input without touching the db", async () => {
    const res = await addUpdate({ itemId: "bad", text: "" });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("derives org/board from the item then inserts the update", async () => {
    const insert = vi.fn().mockReturnValue({
      select: () => ({
        single: async () => ({ data: { id: UPD }, error: null }),
      }),
    });
    from.mockImplementation((table: string) => {
      if (table === "items") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { org_id: "org", board_id: "board" },
                error: null,
              }),
            }),
          }),
        } as never;
      }
      if (table === "item_updates") return { insert } as never;
      return {} as never;
    });
    const res = await addUpdate({ itemId: ITEM, text: "hello" });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: "org",
        board_id: "board",
        item_id: ITEM,
        author_id: USER,
        body: { text: "hello", mentions: [] },
        body_text: "hello",
      }),
    );
    expect(res).toEqual({
      ok: true,
      data: { updateId: UPD, agentRun: null, agentHandle: undefined },
    });
  });

  it("fails when the item is not visible", async () => {
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    }));
    const res = await addUpdate({ itemId: ITEM, text: "hello" });
    expect(res).toEqual({ ok: false, error: "Item not found." });
  });
});

describe("deleteUpdate", () => {
  it("deletes by id and returns ok", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    from.mockImplementation(() => ({ delete: () => ({ eq }) }));
    const res = await deleteUpdate({ updateId: UPD });
    expect(eq).toHaveBeenCalledWith("id", UPD);
    expect(res).toEqual({ ok: true, data: undefined });
  });
});

describe("addUpdate mention fan-out", () => {
  const OTHER = "33333333-3333-4333-8333-333333333333";
  const AGENT = "44444444-4444-4444-8444-444444444444";

  /** The item/item_updates/notifications triple every fan-out case needs, plus
   *  the `user_agents` ownership probe the agent trigger runs. `owned` is what
   *  that probe returns — null models "not yours / does not exist". */
  function mockTables(
    notifInsert: ReturnType<typeof vi.fn>,
    owned: { id: string; handle: string } | null = { id: AGENT, handle: "ops" },
  ) {
    from.mockImplementation((table: string) => {
      if (table === "user_agents")
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: owned, error: null }),
              }),
            }),
          }),
        } as never;
      if (table === "items")
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { org_id: "org", board_id: "board" },
                error: null,
              }),
            }),
          }),
        } as never;
      if (table === "item_updates")
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: UPD }, error: null }),
            }),
          }),
        } as never;
      if (table === "notifications") return { insert: notifInsert } as never;
      return {} as never;
    });
  }
  it("inserts one notification per mention, excluding the author", async () => {
    const notifInsert = vi.fn().mockResolvedValue({ error: null });
    const updInsert = vi.fn().mockReturnValue({
      select: () => ({
        single: async () => ({ data: { id: UPD }, error: null }),
      }),
    });
    from.mockImplementation((table: string) => {
      if (table === "items")
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { org_id: "org", board_id: "board" },
                error: null,
              }),
            }),
          }),
        } as never;
      if (table === "item_updates") return { insert: updInsert } as never;
      if (table === "notifications") return { insert: notifInsert } as never;
      return {} as never;
    });
    await addUpdate({
      itemId: ITEM,
      text: "hi @x @me",
      mentions: [
        { kind: "user", userId: OTHER },
        { kind: "user", userId: USER },
      ],
    });
    expect(notifInsert).toHaveBeenCalledTimes(1);
    expect(notifInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        org_id: "org",
        recipient_id: OTHER,
        actor_id: USER,
        kind: "mention",
        board_id: "board",
        item_id: ITEM,
        update_id: UPD,
      }),
    ]);
  });

  it("does not create a notification row for an agent target", async () => {
    // Agents have no `profiles` row, so a mention notification for one would be
    // undeliverable. The agent trigger path is separate (Spec 3 Task 11).
    const notifInsert = vi.fn().mockResolvedValue({ error: null });
    mockTables(notifInsert);
    const res = await addUpdate({
      itemId: ITEM,
      text: "hi @ops",
      mentions: [{ kind: "agent", agentId: AGENT }],
    });
    expect(res.ok).toBe(true);
    expect(notifInsert).not.toHaveBeenCalled();
  });

  it("rejects more than 20 mentions before any insert", async () => {
    const notifInsert = vi.fn();
    mockTables(notifInsert);
    const res = await addUpdate({
      itemId: ITEM,
      text: "spam",
      mentions: Array.from({ length: 21 }, () => ({
        kind: "user" as const,
        userId: OTHER,
      })),
    });
    expect(res.ok).toBe(false);
    expect(notifInsert).not.toHaveBeenCalled();
  });

  it("does not touch notifications when there are no mentions", async () => {
    const notifInsert = vi.fn();
    from.mockImplementation((table: string) => {
      if (table === "items")
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { org_id: "org", board_id: "board" },
                error: null,
              }),
            }),
          }),
        } as never;
      if (table === "item_updates")
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: UPD }, error: null }),
            }),
          }),
        } as never;
      if (table === "notifications") return { insert: notifInsert } as never;
      return {} as never;
    });
    await addUpdate({ itemId: ITEM, text: "no mentions" });
    expect(notifInsert).not.toHaveBeenCalled();
  });

  it("returns ok but logs when the mention notification insert fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const notifInsert = vi
      .fn()
      .mockResolvedValue({ error: { message: "insert denied" } });
    const updInsert = vi.fn().mockReturnValue({
      select: () => ({
        single: async () => ({ data: { id: UPD }, error: null }),
      }),
    });
    from.mockImplementation((table: string) => {
      if (table === "items")
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { org_id: "org", board_id: "board" },
                error: null,
              }),
            }),
          }),
        } as never;
      if (table === "item_updates") return { insert: updInsert } as never;
      if (table === "notifications") return { insert: notifInsert } as never;
      return {} as never;
    });

    const res = await addUpdate({
      itemId: ITEM,
      text: "hi",
      mentions: [{ kind: "user", userId: OTHER }],
    });

    expect(res).toEqual({
      ok: true,
      data: { updateId: UPD, agentRun: null, agentHandle: undefined },
    });
    expect(spy).toHaveBeenCalledWith(
      "[notifications] mention fan-out failed",
      expect.objectContaining({
        itemId: ITEM,
        recipients: 1,
        error: "insert denied",
      }),
    );
    spy.mockRestore();
  });
});

describe("markNotificationRead", () => {
  it("updates read_at by id (RLS scopes to recipient)", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    from.mockImplementation(() => ({ update }) as never);
    const res = await markNotificationRead({ notificationId: UPD });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ read_at: expect.any(String) }),
    );
    expect(eq).toHaveBeenCalledWith("id", UPD);
    expect(res).toEqual({ ok: true, data: undefined });
  });
});

// ── Task 11: an @handle summons the agent ────────────────────────────────
// Every case here shares one invariant: THE COMMENT IS SAVED. The summons is a
// side effect of posting an update, never a precondition for it.
describe("addUpdate agent trigger", () => {
  const AGENT = "44444444-4444-4444-8444-444444444444";
  const AGENT2 = "66666666-6666-4666-8666-666666666666";
  const OTHER = "33333333-3333-4333-8333-333333333333";

  function mockTables(
    owned: { id: string; handle: string } | null = {
      id: AGENT,
      handle: "ops",
    },
  ) {
    const ownershipEq = vi.fn();
    from.mockImplementation((table: string) => {
      if (table === "items")
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { org_id: "org", board_id: "board" },
                error: null,
              }),
            }),
          }),
        } as never;
      if (table === "item_updates")
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: UPD }, error: null }),
            }),
          }),
        } as never;
      if (table === "notifications")
        return { insert: async () => ({ error: null }) } as never;
      if (table === "user_agents")
        return {
          select: () => ({
            eq: (col: string, val: string) => {
              ownershipEq(col, val);
              return {
                eq: (col2: string, val2: string) => {
                  ownershipEq(col2, val2);
                  return {
                    maybeSingle: async () => ({ data: owned, error: null }),
                  };
                },
              };
            },
          }),
        } as never;
      return {} as never;
    });
    return { ownershipEq };
  }

  it("starts one run for the first agent target only", async () => {
    mockTables();
    const res = await addUpdate({
      itemId: ITEM,
      text: "@ops @planner take a look",
      mentions: [
        { kind: "agent", agentId: AGENT },
        { kind: "agent", agentId: AGENT2 },
      ],
    });
    expect(res).toEqual({
      ok: true,
      data: {
        updateId: UPD,
        agentRun: "started",
        agentHandle: "ops",
        reason: undefined,
      },
    });
    // Two handles, ONE claim: a keystroke must not become two billable runs.
    expect(claimAgentRun).toHaveBeenCalledTimes(1);
    expect(claimAgentRun).toHaveBeenCalledWith(
      { __service: true },
      { agentId: AGENT, trigger: "mention" },
    );
  });

  it("dispatches the run with the item AND the summoning comment", async () => {
    mockTables();
    await addUpdate({
      itemId: ITEM,
      text: "@ops what's blocking us?",
      mentions: [{ kind: "agent", agentId: AGENT }],
    });
    // The update id is how the run finds the question it was asked.
    expect(dispatchAgentRun).toHaveBeenCalledWith(RUN, ITEM, UPD);
  });

  it("never blocks the update when the claim is refused", async () => {
    mockTables();
    claimAgentRun.mockResolvedValue({
      outcome: "refused_cooldown",
      runId: null,
    });
    const res = await addUpdate({
      itemId: ITEM,
      text: "@ops look",
      mentions: [{ kind: "agent", agentId: AGENT }],
    });
    expect(res.ok).toBe(true);
    expect(res.ok && res.data.agentRun).toBeNull();
    // And the refusal is NAMED, so the person is not left waiting.
    expect(res.ok && res.data.reason).toMatch(/less than five minutes ago/);
    expect(dispatchAgentRun).not.toHaveBeenCalled();
  });

  it("surfaces the daily-cap refusal rather than failing silently", async () => {
    mockTables();
    claimAgentRun.mockResolvedValue({
      outcome: "refused_daily_cap",
      runId: null,
    });
    const res = await addUpdate({
      itemId: ITEM,
      text: "@ops again",
      mentions: [{ kind: "agent", agentId: AGENT }],
    });
    expect(res.ok && res.data.reason).toMatch(/used up today's agent runs/);
  });

  it("refuses to summon an agent the author does not own", async () => {
    // RLS answers the probe: a uuid the author cannot see returns no row, so
    // "not yours" and "does not exist" are indistinguishable — as they must be.
    const { ownershipEq } = mockTables(null);
    const res = await addUpdate({
      itemId: ITEM,
      text: "@someone-elses-agent do it",
      mentions: [{ kind: "agent", agentId: AGENT }],
    });
    expect(res.ok).toBe(true);
    expect(res.ok && res.data.reason).toBe("That agent isn't yours.");
    // The claim is never even attempted — the service client would have
    // bypassed the RPC's own auth.uid() ownership arm.
    expect(claimAgentRun).not.toHaveBeenCalled();
    expect(dispatchAgentRun).not.toHaveBeenCalled();
    expect(ownershipEq).toHaveBeenCalledWith("owner_id", USER);
  });

  it("does not dispatch when the rate limiter denies", async () => {
    mockTables();
    checkAgentMentionRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 600,
    });
    const res = await addUpdate({
      itemId: ITEM,
      text: "@ops spam",
      mentions: [{ kind: "agent", agentId: AGENT }],
    });
    expect(res.ok).toBe(true);
    expect(res.ok && res.data.agentRun).toBeNull();
    expect(res.ok && res.data.reason).toMatch(/too many times this hour/);
    // Denied BEFORE the RPC — the point of the limiter is to keep a flood off
    // the row lock entirely.
    expect(claimAgentRun).not.toHaveBeenCalled();
    expect(dispatchAgentRun).not.toHaveBeenCalled();
  });

  it("does not summon anything for a human-only mention", async () => {
    mockTables();
    const res = await addUpdate({
      itemId: ITEM,
      text: "hi @someone",
      mentions: [{ kind: "user", userId: OTHER }],
    });
    expect(res.ok && res.data.agentRun).toBeNull();
    expect(checkAgentMentionRateLimit).not.toHaveBeenCalled();
    expect(claimAgentRun).not.toHaveBeenCalled();
  });

  it("does not summon anything for text that merely LOOKS like a handle", async () => {
    // Nothing anywhere parses `@handle` out of prose — the trigger reads the
    // tagged array only. This is the first of the three things that make an
    // agent's own reply unable to summon another run.
    mockTables();
    const res = await addUpdate({ itemId: ITEM, text: "ping @ops @planner" });
    expect(res.ok && res.data.agentRun).toBeNull();
    expect(claimAgentRun).not.toHaveBeenCalled();
  });
});
