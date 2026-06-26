import { afterEach, describe, expect, it, vi } from "vitest";

function makeChain(maybe: unknown, list: unknown[]) {
  const thenable: Record<string, unknown> = {
    select: () => thenable,
    eq: () => thenable,
    order: () => thenable,
    maybeSingle: async () => ({ data: maybe, error: null }),
    then: (onF: (r: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: list, error: null }).then(onF),
  };
  return thenable;
}

// vi.hoisted() ensures the mock fn is initialized before vi.mock() factories run
// (vi.mock is hoisted to the top of the module by Vitest).
const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn(async () => ({
    from: () =>
      makeChain({ id: "d1", name: "Dash" }, [{ id: "w1", dashboard_id: "d1" }]),
  })),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

import { getDashboardPayload } from "./queries";

afterEach(() => vi.clearAllMocks());

describe("getDashboardPayload", () => {
  it("returns the dashboard with its widgets", async () => {
    const payload = await getDashboardPayload("d1");
    expect(payload?.dashboard.id).toBe("d1");
    expect(payload?.widgets).toHaveLength(1);
  });

  it("returns null when the dashboard is not visible", async () => {
    createClient.mockResolvedValueOnce({
      from: () => makeChain(null, []),
    } as never);
    expect(await getDashboardPayload("missing")).toBeNull();
  });
});
