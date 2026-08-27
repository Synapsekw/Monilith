import { describe, expect, it } from "vitest";
import { makeFakeMemoryClient } from "./memory-db.fake";
import {
  listMemoryForAgent,
  listMemoryKeys,
  listMemoryTotalsByAgent,
  countMemoryForAgent,
  agentRemember,
  agentForget,
  upsertOwnerNote,
  deleteMemoryRow,
  MEMORY_TOTALS_SCAN_LIMIT,
} from "./memory-db";

const AGENT = "agent-1";
const OTHER = "agent-2";

describe("listMemoryForAgent", () => {
  it("is bounded and ordered by the index", async () => {
    const { client, selects } = makeFakeMemoryClient({ rows: [] });
    await listMemoryForAgent(client, AGENT);
    const s = selects[0]!;
    expect(s.predicates).toEqual([{ column: "user_agent_id", value: AGENT }]);
    expect(s.order[0]).toEqual({ column: "updated_at", ascending: false });
    expect(s.limit).toBe(50);
  });

  it("returns only THIS agent's notes — the predicate is applied, not just recorded", async () => {
    const { client } = makeFakeMemoryClient({
      rows: [
        { user_agent_id: AGENT, key: "mine", value: "a", token_estimate: 1 },
        { user_agent_id: OTHER, key: "theirs", value: "b", token_estimate: 1 },
      ],
    });
    const notes = await listMemoryForAgent(client, AGENT);
    expect(notes.map((n) => n.key)).toEqual(["mine"]);
  });

  it("maps snake_case columns onto the camelCase note shape", async () => {
    const { client } = makeFakeMemoryClient({
      rows: [
        {
          id: "n1",
          user_agent_id: AGENT,
          key: "dana-group",
          value: "Ops",
          origin: "owner",
          token_estimate: 3,
          last_run_id: "run-9",
          updated_at: "2026-08-01T00:00:00Z",
        },
      ],
    });
    expect(await listMemoryForAgent(client, AGENT)).toEqual([
      {
        id: "n1",
        key: "dana-group",
        value: "Ops",
        origin: "owner",
        tokenEstimate: 3,
        lastRunId: "run-9",
        updatedAt: "2026-08-01T00:00:00Z",
      },
    ]);
  });

  it("throws with the table name when the read fails", async () => {
    const { client } = makeFakeMemoryClient({
      rows: [],
      error: { message: "boom" },
    });
    await expect(listMemoryForAgent(client, AGENT)).rejects.toThrow(
      /listMemoryForAgent: boom/,
    );
  });
});

describe("listMemoryKeys", () => {
  it("selects only keys, bounded and in key order", async () => {
    const { client, selects } = makeFakeMemoryClient({
      rows: [
        { user_agent_id: AGENT, key: "beta", value: "x" },
        { user_agent_id: AGENT, key: "alpha", value: "y" },
        { user_agent_id: OTHER, key: "zeta", value: "z" },
      ],
    });
    expect(await listMemoryKeys(client, AGENT)).toEqual(["alpha", "beta"]);
    const s = selects[0]!;
    // Selecting values on a refusal path would ship 25 KB to build one
    // sentence.
    expect(s.columns).toBe("key");
    expect(s.limit).toBe(50);
  });
});

describe("listMemoryTotalsByAgent", () => {
  it("NEVER selects `value`, and is bounded", async () => {
    const { client, selects } = makeFakeMemoryClient({ rows: [] });
    await listMemoryTotalsByAgent(client, "owner-1");
    const s = selects[0]!;
    expect(s.columns).not.toContain("value");
    expect(s.limit).toBe(MEMORY_TOTALS_SCAN_LIMIT);
  });

  it("filters through the embedded owner — one owner never sees another's totals", async () => {
    const { client } = makeFakeMemoryClient({
      rows: [
        {
          user_agent_id: "a",
          key: "k1",
          token_estimate: 10,
          user_agents: { owner_id: "owner-1" },
        },
        {
          user_agent_id: "a",
          key: "k2",
          token_estimate: 5,
          user_agents: { owner_id: "owner-1" },
        },
        {
          user_agent_id: "b",
          key: "k3",
          token_estimate: 7,
          user_agents: { owner_id: "owner-1" },
        },
        {
          user_agent_id: "z",
          key: "k4",
          token_estimate: 99,
          user_agents: { owner_id: "someone-else" },
        },
      ],
    });
    const totals = await listMemoryTotalsByAgent(client, "owner-1");
    expect(totals).toEqual({
      a: { noteCount: 2, tokenTotal: 15 },
      b: { noteCount: 1, tokenTotal: 7 },
    });
  });
});

describe("countMemoryForAgent", () => {
  it("asks for the count with no rows on the wire", async () => {
    const { client, selects } = makeFakeMemoryClient({
      rows: [
        { user_agent_id: AGENT, key: "a" },
        { user_agent_id: AGENT, key: "b" },
        { user_agent_id: OTHER, key: "c" },
      ],
    });
    expect(await countMemoryForAgent(client, AGENT)).toBe(2);
    expect(selects[0]!.options).toEqual({ count: "exact", head: true });
  });
});

describe("agentRemember", () => {
  it("computes token_estimate SERVER-side and forwards the RPC status", async () => {
    const { client, rpcCalls } = makeFakeMemoryClient({
      rows: [],
      rpcResult: "written",
    });
    const status = await agentRemember(client, {
      userAgentId: AGENT,
      key: "dana-group",
      value: "12345678", // 8 chars -> 2 tokens
      runId: "run-1",
    });
    expect(status).toBe("written");
    const [name, params] = rpcCalls[0]!;
    expect(name).toBe("agent_remember");
    expect(params).toEqual({
      p_user_agent_id: AGENT,
      p_key: "dana-group",
      p_value: "12345678",
      // NEVER model-supplied: a model whose note is over budget has every
      // incentive to under-report its size.
      p_token_estimate: 2,
      p_run_id: "run-1",
    });
  });

  it("passes a null run id through rather than inventing one", async () => {
    const { client, rpcCalls } = makeFakeMemoryClient({
      rows: [],
      rpcResult: "replaced",
    });
    await agentRemember(client, {
      userAgentId: AGENT,
      key: "k",
      value: "v",
      runId: null,
    });
    expect(rpcCalls[0]![1]).toMatchObject({ p_run_id: null });
  });

  it("throws when the RPC errors, so tools.ts can funnel it to { error }", async () => {
    const { client } = makeFakeMemoryClient({
      rows: [],
      error: { message: "no such user_agent" },
    });
    await expect(
      agentRemember(client, {
        userAgentId: AGENT,
        key: "k",
        value: "v",
        runId: null,
      }),
    ).rejects.toThrow(/agentRemember: no such user_agent/);
  });
});

describe("agentForget", () => {
  it("deletes by (agent, key) and reports whether a row went", async () => {
    const { client, deletes } = makeFakeMemoryClient({
      rows: [{ user_agent_id: AGENT, key: "stale", value: "x" }],
    });
    expect(await agentForget(client, AGENT, "stale")).toBe(true);
    expect(deletes[0]!.predicates).toEqual([
      { column: "user_agent_id", value: AGENT },
      { column: "key", value: "stale" },
    ]);
  });

  it("does NOT delete another agent's identically-keyed note", async () => {
    // The failure this fake exists to catch: `agent_memory` is keyed on
    // (user_agent_id, key), so a forget that dropped the agent predicate would
    // take a sibling agent's note with it.
    const { client, table } = makeFakeMemoryClient({
      rows: [
        { user_agent_id: AGENT, key: "stale", value: "mine" },
        { user_agent_id: OTHER, key: "stale", value: "theirs" },
      ],
    });
    await agentForget(client, AGENT, "stale");
    expect(table).toHaveLength(1);
    expect(table[0]!.user_agent_id).toBe(OTHER);
  });

  it("reports false when there was no such note", async () => {
    const { client } = makeFakeMemoryClient({ rows: [] });
    expect(await agentForget(client, AGENT, "never-existed")).toBe(false);
  });
});

describe("upsertOwnerNote", () => {
  it("recomputes token_estimate on EVERY write and stamps origin", async () => {
    const { client, upserts } = makeFakeMemoryClient({ rows: [] });
    await upsertOwnerNote(client, {
      userAgentId: AGENT,
      orgId: "org-1",
      ownerId: "owner-1",
      key: "frozen-board",
      value: "12345678",
    });
    expect(upserts[0]!.row).toMatchObject({
      user_agent_id: AGENT,
      org_id: "org-1",
      owner_id: "owner-1",
      key: "frozen-board",
      origin: "owner",
      token_estimate: 2,
      // An owner note has no run that authored it; stamping one would make the
      // provenance column lie.
      last_run_id: null,
    });
    expect(upserts[0]!.options).toEqual({ onConflict: "user_agent_id,key" });
  });

  it("overwrites an AGENT-written note on the same key — the owner is the fixed point", async () => {
    const { client, table } = makeFakeMemoryClient({
      rows: [
        {
          user_agent_id: AGENT,
          key: "frozen-board",
          value: "chase the design board daily",
          origin: "agent",
          token_estimate: 7,
        },
      ],
    });
    await upsertOwnerNote(client, {
      userAgentId: AGENT,
      orgId: "org-1",
      ownerId: "owner-1",
      key: "frozen-board",
      value: "frozen until October",
    });
    expect(table).toHaveLength(1);
    expect(table[0]).toMatchObject({
      value: "frozen until October",
      origin: "owner",
    });
  });
});

describe("deleteMemoryRow", () => {
  it("deletes by id only", async () => {
    const { client, deletes, table } = makeFakeMemoryClient({
      rows: [
        { id: "n1", user_agent_id: AGENT, key: "a" },
        { id: "n2", user_agent_id: AGENT, key: "b" },
      ],
    });
    await deleteMemoryRow(client, "n1");
    expect(deletes[0]!.predicates).toEqual([{ column: "id", value: "n1" }]);
    expect(table.map((r) => r.id)).toEqual(["n2"]);
  });
});
