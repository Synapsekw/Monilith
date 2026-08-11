import { describe, it, expect, vi, beforeEach } from "vitest";

const requireUser = vi.fn();
const resolveActiveOrg = vi.fn();
const assertCanCreateAgent = vi.fn();
const insert = vi.fn();
const revalidatePath = vi.fn();
const listAgentRuns = vi.fn();

/** Every `.eq()` any action applies, as [column, value]. The owner filters are
 *  defence-in-depth on top of RLS; asserting them stops a refactor from quietly
 *  turning `update ... where id = ? and owner_id = ?` into `where id = ?`. */
let eqCalls: [string, unknown][] = [];
/** The patch handed to update(), so tests can assert WHICH columns a mutation
 *  writes — the column-level grants added in 20260802034242 make an extra
 *  column a hard Postgres failure, not a silent no-op. */
let lastUpdate: Record<string, unknown> | null = null;
/** What the update()/delete() chain resolves to. */
let writeResult: { error: unknown } = { error: null };

vi.mock("@/lib/auth/session", () => ({
  requireUser: () => requireUser(),
}));
// requireUser() only carries the JWT claims subset (id/email/metadata) — no
// orgId. The active org is resolved the same way src/lib/ai/settings-actions.ts
// does it, via resolveActiveOrg() (src/lib/org/active.ts).
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: () => resolveActiveOrg(),
}));
vi.mock("./caps", () => ({
  assertCanCreateAgent: (...a: unknown[]) => assertCanCreateAgent(...a),
  AgentCapExceededError: class extends Error {},
}));
vi.mock("./agents-db", async (importOriginal) => ({
  // RUN_HISTORY_LIMIT is a real constant the action clamps against — keep it.
  ...(await importOriginal<typeof import("./agents-db")>()),
  listAgentRuns: (...a: unknown[]) => listAgentRuns(...a),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => revalidatePath() }));

/** A thenable `.eq()` chain, matching the real builder: `await
 *  client.from(t).update(p).eq(a).eq(b)` resolves with no terminal call. */
function eqChain(): Record<string, unknown> {
  const chain = {
    eq(col: string, val: unknown) {
      eqCalls.push([col, val]);
      return chain;
    },
    then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
      return Promise.resolve(writeResult).then(res, rej);
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      insert: (row: unknown) => ({
        select: () => ({ single: () => insert(row) }),
      }),
      update: (patch: Record<string, unknown>) => {
        lastUpdate = patch;
        return eqChain();
      },
      delete: () => eqChain(),
    }),
  }),
}));

const { createAgent, updateAgent, setAgentEnabled, deleteAgent, getAgentRuns } =
  await import("./actions");

const AGENT_ID = "11111111-1111-4111-8111-111111111111";

const valid = {
  name: "Morning Brief",
  templateId: "morning-brief",
  instructions: "Summarise what is pending.",
  boardScope: { mode: "all" as const },
  cadence: "daily" as const,
  runAtLocalHour: 7,
  enabled: true,
  // Unpinned: null on both halves is "inherit the org default", the state
  // every agent that predates the pin is in.
  provider: null,
  modelId: null,
};

beforeEach(() => {
  requireUser.mockReset();
  resolveActiveOrg.mockReset();
  assertCanCreateAgent.mockReset();
  insert.mockReset();
  listAgentRuns.mockReset();
  eqCalls = [];
  lastUpdate = null;
  writeResult = { error: null };
  requireUser.mockResolvedValue({ id: "user-1" });
  resolveActiveOrg.mockResolvedValue({
    id: "org-1",
    name: "Acme",
    timezone: "UTC",
  });
  insert.mockResolvedValue({ data: { id: "agent-1" }, error: null });
  listAgentRuns.mockResolvedValue([]);
});

describe("createAgent", () => {
  it("creates an agent for a valid payload", async () => {
    const r = await createAgent(valid);
    expect(r).toEqual({ ok: true, data: { id: "agent-1" } });
  });

  it("rejects an invalid payload without touching the db", async () => {
    const r = await createAgent({ ...valid, runAtLocalHour: 99 });
    expect(r.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("surfaces a cap failure as a readable error", async () => {
    assertCanCreateAgent.mockRejectedValue(new Error("at most 3 agents"));
    const r = await createAgent(valid);
    expect(r).toEqual({ ok: false, error: "at most 3 agents" });
  });

  it("never leaks a raw db error string", async () => {
    insert.mockResolvedValue({
      data: null,
      error: { message: "pgcode 23505" },
    });
    const r = await createAgent(valid);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain("23505");
  });

  // 20260802034242 revoked authenticated's table-level INSERT and re-granted it
  // column by column, with bridge_secret_id deliberately absent. An insert
  // naming that column would now be rejected by Postgres outright.
  it("does not write bridge_secret_id", async () => {
    await createAgent(valid);
    expect(insert).toHaveBeenCalled();
    const row = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row).not.toHaveProperty("bridge_secret_id");
  });

  // 20260810173752 re-granted insert(provider, model_id) to authenticated
  // specifically so the pin is writable. Not writing them would leave every
  // new agent inheriting the org default no matter what the picker said.
  it("persists the model pin it was given", async () => {
    await createAgent({ ...valid, provider: "moonshotai", modelId: "kimi-k2" });
    const row = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({ provider: "moonshotai", model_id: "kimi-k2" });
  });

  it("writes an unpinned agent as null on both halves, not as absent", async () => {
    await createAgent(valid);
    const row = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row.provider).toBeNull();
    expect(row.model_id).toBeNull();
  });

  it("refuses a model with no provider without touching the db", async () => {
    const r = await createAgent({
      ...valid,
      provider: null,
      modelId: "kimi-k2",
    });
    expect(r.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("updateAgent", () => {
  it("saves a valid payload, scoped to the caller's own agent", async () => {
    const r = await updateAgent(AGENT_ID, { ...valid, name: "Renamed" });
    expect(r).toEqual({ ok: true, data: undefined });
    expect(eqCalls).toEqual([
      ["id", AGENT_ID],
      ["owner_id", "user-1"],
    ]);
    expect(lastUpdate).toMatchObject({ name: "Renamed" });
  });

  it("rejects an invalid payload without writing", async () => {
    const r = await updateAgent(AGENT_ID, { ...valid, instructions: "" });
    expect(r.ok).toBe(false);
    expect(lastUpdate).toBeNull();
  });

  // The board_scope check constraint added in 20260802034242 rejects
  // {"mode":"list"} with no boardIds; Zod must catch it first so the user gets
  // a message instead of a constraint violation.
  it("rejects a list scope with no boards", async () => {
    const r = await updateAgent(AGENT_ID, {
      ...valid,
      boardScope: { mode: "list", boardIds: [] } as never,
    });
    expect(r.ok).toBe(false);
    expect(lastUpdate).toBeNull();
  });

  it("writes only columns authenticated may update", async () => {
    await updateAgent(AGENT_ID, valid);
    expect(Object.keys(lastUpdate ?? {}).sort()).toEqual([
      "board_scope",
      "cadence",
      "enabled",
      "instructions",
      "model_id",
      "name",
      "provider",
      "run_at_local_hour",
      "template_id",
      "updated_at",
    ]);
  });

  it("saves a model pin", async () => {
    await updateAgent(AGENT_ID, {
      ...valid,
      provider: "moonshotai",
      modelId: "kimi-k2",
    });
    expect(lastUpdate).toMatchObject({
      provider: "moonshotai",
      model_id: "kimi-k2",
    });
  });

  // Clearing the pin is how an owner goes back to the org default. Writing
  // `undefined` (or omitting the columns) would leave the old pin in place and
  // make the "Use the organization's default" option a silent no-op.
  it("clears a pin back to null rather than leaving the old one", async () => {
    await updateAgent(AGENT_ID, valid);
    expect(lastUpdate).toMatchObject({ provider: null, model_id: null });
  });

  it("refuses a model with no provider without writing", async () => {
    const r = await updateAgent(AGENT_ID, {
      ...valid,
      provider: null,
      modelId: "kimi-k2",
    });
    expect(r.ok).toBe(false);
    expect(lastUpdate).toBeNull();
  });

  it("reports a db failure without leaking the raw message", async () => {
    writeResult = { error: { message: "pgcode 23505 duplicate" } };
    const r = await updateAgent(AGENT_ID, valid);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain("23505");
  });
});

describe("setAgentEnabled", () => {
  it("flips the switch on the caller's own agent", async () => {
    const r = await setAgentEnabled(AGENT_ID, false);
    expect(r).toEqual({ ok: true, data: undefined });
    expect(lastUpdate).toMatchObject({ enabled: false });
    expect(eqCalls).toEqual([
      ["id", AGENT_ID],
      ["owner_id", "user-1"],
    ]);
  });

  it("touches only enabled and updated_at", async () => {
    await setAgentEnabled(AGENT_ID, true);
    expect(Object.keys(lastUpdate ?? {}).sort()).toEqual([
      "enabled",
      "updated_at",
    ]);
  });

  it("reports a db failure", async () => {
    writeResult = { error: { message: "boom" } };
    const r = await setAgentEnabled(AGENT_ID, true);
    expect(r.ok).toBe(false);
  });
});

describe("deleteAgent", () => {
  it("deletes only the caller's own agent", async () => {
    const r = await deleteAgent(AGENT_ID);
    expect(r).toEqual({ ok: true, data: undefined });
    expect(eqCalls).toEqual([
      ["id", AGENT_ID],
      ["owner_id", "user-1"],
    ]);
  });

  it("reports a db failure", async () => {
    writeResult = { error: { message: "boom" } };
    const r = await deleteAgent(AGENT_ID);
    expect(r.ok).toBe(false);
  });
});

describe("getAgentRuns", () => {
  const runs = [
    {
      id: "run-1",
      status: "ran",
      error: null,
      createdAt: "2026-08-01T07:00:04.000Z",
      fireDate: "2026-08-01",
      fireHour: 7,
      inputTokens: 10,
      outputTokens: 5,
      modelSubstituted: false,
    },
  ];

  it("returns the agent's runs", async () => {
    listAgentRuns.mockResolvedValue(runs);
    await expect(getAgentRuns(AGENT_ID)).resolves.toEqual({
      ok: true,
      data: runs,
    });
  });

  it("defaults to the spec's 50-run cap", async () => {
    await getAgentRuns(AGENT_ID);
    expect(listAgentRuns).toHaveBeenCalledWith(expect.anything(), AGENT_ID, 50);
  });

  // Clamped rather than rejected, so a bad caller still renders something —
  // but never an unbounded read.
  it("clamps an oversized limit to the cap", async () => {
    await getAgentRuns(AGENT_ID, 5000);
    expect(listAgentRuns).toHaveBeenCalledWith(expect.anything(), AGENT_ID, 50);
  });

  it("clamps a zero or negative limit up to 1", async () => {
    await getAgentRuns(AGENT_ID, 0);
    expect(listAgentRuns).toHaveBeenCalledWith(expect.anything(), AGENT_ID, 1);
  });

  it("rejects a non-uuid agent id without querying", async () => {
    const r = await getAgentRuns("not-a-uuid");
    expect(r.ok).toBe(false);
    expect(listAgentRuns).not.toHaveBeenCalled();
  });

  it("requires a signed-in caller", async () => {
    requireUser.mockRejectedValue(new Error("unauthenticated"));
    await expect(getAgentRuns(AGENT_ID)).rejects.toThrow();
    expect(listAgentRuns).not.toHaveBeenCalled();
  });

  // A read failure must be distinguishable from an empty history — the UI
  // renders different states for the two, and conflating them is exactly what
  // made agent failures invisible in the first place.
  it("reports a read failure rather than an empty history", async () => {
    listAgentRuns.mockRejectedValue(new Error("listAgentRuns: boom"));
    const r = await getAgentRuns(AGENT_ID);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain("boom");
  });
});
