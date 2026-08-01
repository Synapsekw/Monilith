import { describe, it, expect, vi, beforeEach } from "vitest";

const requireUser = vi.fn();
const resolveActiveOrg = vi.fn();
const assertCanCreateAgent = vi.fn();
const insert = vi.fn();
const revalidatePath = vi.fn();

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
vi.mock("next/cache", () => ({ revalidatePath: () => revalidatePath() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      insert: (row: unknown) => ({
        select: () => ({ single: () => insert(row) }),
      }),
    }),
  }),
}));

const { createAgent } = await import("./actions");

const valid = {
  name: "Morning Brief",
  templateId: "morning-brief",
  instructions: "Summarise what is pending.",
  boardScope: { mode: "all" as const },
  cadence: "daily" as const,
  runAtLocalHour: 7,
  enabled: true,
};

beforeEach(() => {
  requireUser.mockReset();
  resolveActiveOrg.mockReset();
  assertCanCreateAgent.mockReset();
  insert.mockReset();
  requireUser.mockResolvedValue({ id: "user-1" });
  resolveActiveOrg.mockResolvedValue({
    id: "org-1",
    name: "Acme",
    timezone: "UTC",
  });
  insert.mockResolvedValue({ data: { id: "agent-1" }, error: null });
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
});
