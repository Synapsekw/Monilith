import { describe, it, expect, vi } from "vitest";
import { writeBriefingThread } from "./briefing-thread";

function clientDouble(opts: { convError?: { code?: string } | null } = {}) {
  const inserted: Record<string, unknown[]> = {};
  const client = {
    from: (table: string) => ({
      insert: (row: unknown) => {
        (inserted[table] ??= []).push(row);
        return {
          select: () => ({
            single: async () =>
              table === "ai_conversations" && opts.convError
                ? { data: null, error: opts.convError }
                : { data: { id: "conv-1" }, error: null },
          }),
        };
      },
    }),
    inserted,
  };
  return client;
}

const ARGS = {
  orgId: "org-1",
  ownerId: "user-1",
  agentId: "agent-1",
  agentName: "Morning Brief",
  runId: "run-1",
  fireDate: "2026-08-03",
  summary: "Three items are overdue.",
};

describe("writeBriefingThread", () => {
  it("writes an owner-scoped, private, agent-tagged thread keyed by run_id", async () => {
    const c = clientDouble();
    const id = await writeBriefingThread(c as never, ARGS);

    expect(id).toBe("conv-1");
    expect(c.inserted.ai_conversations[0]).toMatchObject({
      org_id: "org-1",
      user_id: "user-1",
      agent_id: "agent-1",
      run_id: "run-1",
      board_id: null,
    });
    // Cross-board by construction, so it is NOT a board thread — and the
    // default keeps it private without being passed.
    expect(c.inserted.ai_conversations[0]).not.toHaveProperty("visibility");
  });

  it("stores the briefing as the assistant turn so a reply continues it", async () => {
    const c = clientDouble();
    await writeBriefingThread(c as never, ARGS);
    expect(c.inserted.ai_messages[0]).toMatchObject({
      conversation_id: "conv-1",
      role: "assistant",
      content: "Three items are overdue.",
    });
  });

  it("returns null on a duplicate run without throwing", async () => {
    // The unique index on run_id is the second line of defence behind claimRun.
    const c = clientDouble({ convError: { code: "23505" } });
    expect(await writeBriefingThread(c as never, ARGS)).toBeNull();
  });

  it("returns null on any other write failure — a briefing must still send", async () => {
    const c = clientDouble({ convError: { code: "08006" } });
    expect(await writeBriefingThread(c as never, ARGS)).toBeNull();
  });
});
