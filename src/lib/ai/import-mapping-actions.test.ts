import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeResolvedModel } from "@/test/adapter-fakes";
import {
  AiDisabledError,
  AiQuotaExceededError,
  ByoKeyMissingError,
  AiNotConfiguredError,
} from "@/lib/ai/errors";

const generateImportMapping = vi.fn();
vi.mock("@/lib/ai/import-mapping-generate", () => ({
  generateImportMapping: (...args: unknown[]) => generateImportMapping(...args),
}));

const FAKE_RESOLVED = {
  adapter: { kind: "anthropic" },
  apiKey: "k",
  mode: "per_user",
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

const ORG_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "66666666-6666-4666-8666-666666666666";

beforeEach(() => {
  generateImportMapping.mockReset();
  generateImportMapping.mockResolvedValue({
    suggestions: [{ sourceIndex: 0, kind: "status", role: "data" }],
    usage: { inputTokens: 1, outputTokens: 1 },
  });
  requireAiEntitlement.mockReset();
  requireAiEntitlement.mockResolvedValue(undefined);
  getUserOrgs.mockReset();
  getUserOrgs.mockResolvedValue([{ id: ORG_ID, name: "Acme" }]);
  requireUser.mockReset();
  requireUser.mockResolvedValue({ id: USER_ID });
  runAi.mockClear();
  runAi.mockImplementation(async (_args, fn) => {
    const { result } = await fn(FAKE_RESOLVED);
    return result;
  });
});

describe("suggestImportMapping", () => {
  it("gates entitlement before runAi and passes the import_mapping feature", async () => {
    const { suggestImportMapping } =
      await import("@/lib/ai/import-mapping-actions");
    const res = await suggestImportMapping({
      columns: [{ sourceIndex: 0, header: "Stage", sampleValues: ["Done"] }],
    });
    expect(res.ok).toBe(true);
    expect(requireAiEntitlement).toHaveBeenCalledWith(ORG_ID, "import_mapping");
    expect(requireAiEntitlement.mock.invocationCallOrder[0]).toBeLessThan(
      runAi.mock.invocationCallOrder[0],
    );
    expect(runAi.mock.calls[0][0]).toEqual({
      orgId: ORG_ID,
      userId: USER_ID,
      feature: "import_mapping",
    });
  });

  it("caps the egress: ≤40 columns, ≤5 sample values per column, each length-bounded", async () => {
    const columns = Array.from({ length: 60 }, (_, i) => ({
      sourceIndex: i,
      header: `Col ${i}`,
      sampleValues: Array.from({ length: 12 }, (_, j) => `v${j}`.repeat(200)),
    }));
    const { suggestImportMapping } =
      await import("@/lib/ai/import-mapping-actions");
    await suggestImportMapping({ columns });

    const sent = generateImportMapping.mock.calls[0][0];
    expect(sent.columns).toHaveLength(40);
    for (const c of sent.columns) {
      expect(c.sampleValues.length).toBeLessThanOrEqual(5);
      for (const v of c.sampleValues) expect(v.length).toBeLessThanOrEqual(500);
    }
  });

  it("filters suggestions with an unknown kind, invalid role, or dangling targetColumnId, collecting warnings", async () => {
    generateImportMapping.mockResolvedValueOnce({
      suggestions: [
        { sourceIndex: 0, kind: "status", role: "data" }, // kept
        { sourceIndex: 1, kind: "bogus", role: "data" }, // dropped: kind
        { sourceIndex: 2, kind: "text", role: "sideways" }, // dropped: role
        {
          sourceIndex: 3,
          kind: "text",
          role: "data",
          targetColumnId: "ghost",
        }, // kept but target stripped
      ],
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const { suggestImportMapping } =
      await import("@/lib/ai/import-mapping-actions");
    const res = await suggestImportMapping({
      columns: [
        { sourceIndex: 0, header: "A", sampleValues: [] },
        { sourceIndex: 1, header: "B", sampleValues: [] },
        { sourceIndex: 2, header: "C", sampleValues: [] },
        { sourceIndex: 3, header: "D", sampleValues: [] },
      ],
      boardColumns: [{ id: "col-real", name: "Real", kind: "text" }],
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const kept = res.data.suggestions;
      expect(kept.map((s) => s.sourceIndex).sort()).toEqual([0, 3]);
      const d = kept.find((s) => s.sourceIndex === 3)!;
      expect(d.targetColumnId).toBeUndefined();
      expect(res.data.warnings.length).toBeGreaterThan(0);
    }
  });

  it("keeps a valid targetColumnId that matches a supplied board column", async () => {
    generateImportMapping.mockResolvedValueOnce({
      suggestions: [
        {
          sourceIndex: 0,
          kind: "status",
          role: "data",
          targetColumnId: "col-real",
        },
      ],
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const { suggestImportMapping } =
      await import("@/lib/ai/import-mapping-actions");
    const res = await suggestImportMapping({
      columns: [{ sourceIndex: 0, header: "A", sampleValues: [] }],
      boardColumns: [{ id: "col-real", name: "Real", kind: "status" }],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.suggestions[0].targetColumnId).toBe("col-real");
  });

  it("rejects an empty columns payload before any token spend", async () => {
    const { suggestImportMapping } =
      await import("@/lib/ai/import-mapping-actions");
    const res = await suggestImportMapping({ columns: [] });
    expect(res.ok).toBe(false);
    expect(requireAiEntitlement).not.toHaveBeenCalled();
    expect(generateImportMapping).not.toHaveBeenCalled();
  });

  it("fails with 'No organization.' when the user has no org", async () => {
    getUserOrgs.mockResolvedValueOnce([]);
    const { suggestImportMapping } =
      await import("@/lib/ai/import-mapping-actions");
    const res = await suggestImportMapping({
      columns: [{ sourceIndex: 0, header: "A", sampleValues: [] }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("No organization.");
    expect(requireAiEntitlement).not.toHaveBeenCalled();
  });

  it.each([
    [
      "AiDisabledError",
      () => new AiDisabledError(),
      "AI is turned off for your organization.",
    ],
    [
      "AiQuotaExceededError",
      () => new AiQuotaExceededError(),
      "You've used this month's AI allowance.",
    ],
    [
      "ByoKeyMissingError",
      () => new ByoKeyMissingError(),
      "Your organization's AI key is missing — ask an admin to update Settings.",
    ],
    [
      "AiNotConfiguredError",
      () => new AiNotConfiguredError(),
      "AI mapping isn't configured.",
    ],
  ])("maps %s to its exact message", async (_n, makeError, message) => {
    requireAiEntitlement.mockRejectedValueOnce(makeError());
    const { suggestImportMapping } =
      await import("@/lib/ai/import-mapping-actions");
    const res = await suggestImportMapping({
      columns: [{ sourceIndex: 0, header: "A", sampleValues: [] }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe(message);
  });

  it("returns a graceful message when the model yields zero usable suggestions", async () => {
    generateImportMapping.mockResolvedValueOnce({
      suggestions: [],
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const { suggestImportMapping } =
      await import("@/lib/ai/import-mapping-actions");
    const res = await suggestImportMapping({
      columns: [{ sourceIndex: 0, header: "A", sampleValues: [] }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(res.error).toBe(
        "Couldn't suggest a mapping — set the columns manually.",
      );
  });
});
