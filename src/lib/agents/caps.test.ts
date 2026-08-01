import { describe, it, expect, vi, beforeEach } from "vitest";

const readOrgAiSettings = vi.fn();
const countAgentsForOwner = vi.fn();
const countRunsToday = vi.fn();

vi.mock("@/lib/ai/org-settings", () => ({
  readOrgAiSettings: (...a: unknown[]) => readOrgAiSettings(...a),
}));
vi.mock("./agents-db", () => ({
  countAgentsForOwner: (...a: unknown[]) => countAgentsForOwner(...a),
  countRunsToday: (...a: unknown[]) => countRunsToday(...a),
}));

const { assertCanCreateAgent, assertRunAllowedToday, AgentCapExceededError } =
  await import("./caps");

beforeEach(() => {
  readOrgAiSettings.mockReset();
  countAgentsForOwner.mockReset();
  countRunsToday.mockReset();
  readOrgAiSettings.mockResolvedValue({
    maxAgentsPerUser: 3,
    maxAgentRunsPerUserPerDay: 3,
  });
});

describe("assertCanCreateAgent", () => {
  it("allows creation below the cap", async () => {
    countAgentsForOwner.mockResolvedValue(2);
    await expect(
      assertCanCreateAgent({} as never, "org", "user"),
    ).resolves.toBeUndefined();
  });

  it("rejects creation at the cap", async () => {
    countAgentsForOwner.mockResolvedValue(3);
    await expect(
      assertCanCreateAgent({} as never, "org", "user"),
    ).rejects.toBeInstanceOf(AgentCapExceededError);
  });

  it("names the limit in the message so the UI can show it", async () => {
    countAgentsForOwner.mockResolvedValue(3);
    await expect(
      assertCanCreateAgent({} as never, "org", "user"),
    ).rejects.toThrow(/3/);
  });
});

describe("assertRunAllowedToday", () => {
  it("allows a run below the daily cap", async () => {
    countRunsToday.mockResolvedValue(1);
    await expect(
      assertRunAllowedToday({} as never, "org", "user", "2026-08-01"),
    ).resolves.toBeUndefined();
  });

  it("rejects a run at the daily cap", async () => {
    countRunsToday.mockResolvedValue(3);
    await expect(
      assertRunAllowedToday({} as never, "org", "user", "2026-08-01"),
    ).rejects.toBeInstanceOf(AgentCapExceededError);
  });
});
