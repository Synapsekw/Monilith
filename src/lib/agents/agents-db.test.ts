import { describe, it, expect, vi } from "vitest";
import { findUserAgentRun, insertUserAgentRun } from "./agents-db";

function clientReturning(data: unknown, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error });
  const eq3 = vi.fn(() => ({ maybeSingle }));
  const eq2 = vi.fn(() => ({ eq: eq3 }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  const insert = vi.fn().mockResolvedValue({ error });
  return { client: { from: vi.fn(() => ({ select, insert })) }, insert };
}

describe("findUserAgentRun", () => {
  it("returns the row when the fire slot already ran", async () => {
    const { client } = clientReturning({ id: "run-1" });
    const r = await findUserAgentRun(
      client as never,
      "agent-1",
      "2026-08-01",
      7,
    );
    expect(r).toEqual({ id: "run-1" });
  });

  it("returns null for an unseen fire slot", async () => {
    const { client } = clientReturning(null);
    const r = await findUserAgentRun(
      client as never,
      "agent-1",
      "2026-08-01",
      7,
    );
    expect(r).toBeNull();
  });
});

describe("insertUserAgentRun", () => {
  it("throws when the insert errors", async () => {
    const { client } = clientReturning(null, { message: "boom" });
    await expect(
      insertUserAgentRun(client as never, {
        user_agent_id: "a",
        org_id: "o",
        owner_id: "u",
        fire_date: "2026-08-01",
        fire_hour: 7,
        status: "ran",
      }),
    ).rejects.toThrow(/boom/);
  });
});
