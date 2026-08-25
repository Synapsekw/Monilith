import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));
vi.mock("@/lib/ai/org-settings", () => ({ readOrgAiSettings: vi.fn() }));
vi.mock("@/lib/ai/entitlement", () => ({ requireAiEntitlement: vi.fn() }));
vi.mock("@/lib/ai/gateway", () => ({ runAi: vi.fn() }));

import { readOrgAiSettings } from "@/lib/ai/org-settings";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { runAi } from "@/lib/ai/gateway";
import { generateDigestNarrative } from "@/lib/digest/narrative";

const boards = [
  {
    boardId: "11111111-1111-4111-8111-111111111111",
    boardName: "Launch",
    totalItems: 5,
    doneItems: 1,
    overdueItems: 2,
    incompleteItems: 3,
    newItems: 1,
    newSample: ["Kickoff"],
    incompleteSample: ["Design"],
  },
];
const totals = { newCount: 1, incompleteCount: 3, overdueCount: 2 };

describe("generateDigestNarrative", () => {
  // The repo convention (see gateway.test.ts, settings-actions.test.ts) is to
  // clear mock call history/state between tests — without it, `runAi`'s call
  // count from an earlier test leaks into a later `not.toHaveBeenCalled()`
  // assertion.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a narrative string for managed mode", async () => {
    vi.mocked(readOrgAiSettings).mockResolvedValue({
      mode: "managed",
    } as never);
    vi.mocked(runAi).mockResolvedValue("A calm summary of the week.");
    const res = await generateDigestNarrative("org-1", boards, totals);
    expect(res).toBe("A calm summary of the week.");
    expect(requireAiEntitlement).toHaveBeenCalledWith(
      "org-1",
      "digest_narrative",
    );
  });

  it("returns a narrative string for org_byo mode", async () => {
    vi.mocked(readOrgAiSettings).mockResolvedValue({
      mode: "org_byo",
    } as never);
    vi.mocked(runAi).mockResolvedValue("BYO week summary.");
    const res = await generateDigestNarrative("org-1", boards, totals);
    expect(res).toBe("BYO week summary.");
  });

  it("skips per_user mode (no session user in cron)", async () => {
    vi.mocked(readOrgAiSettings).mockResolvedValue({
      mode: "per_user",
    } as never);
    const res = await generateDigestNarrative("org-1", boards, totals);
    expect(res).toBeNull();
    expect(runAi).not.toHaveBeenCalled();
  });

  it("skips off mode", async () => {
    vi.mocked(readOrgAiSettings).mockResolvedValue({ mode: "off" } as never);
    const res = await generateDigestNarrative("org-1", boards, totals);
    expect(res).toBeNull();
  });

  it("returns null and swallows a runAi failure", async () => {
    vi.mocked(readOrgAiSettings).mockResolvedValue({
      mode: "managed",
    } as never);
    vi.mocked(runAi).mockRejectedValue(new Error("provider down"));
    const res = await generateDigestNarrative("org-1", boards, totals);
    expect(res).toBeNull();
  });

  it("returns null when entitlement is exhausted", async () => {
    vi.mocked(readOrgAiSettings).mockResolvedValue({
      mode: "managed",
    } as never);
    vi.mocked(requireAiEntitlement).mockRejectedValueOnce(new Error("quota"));
    const res = await generateDigestNarrative("org-1", boards, totals);
    expect(res).toBeNull();
  });
});
