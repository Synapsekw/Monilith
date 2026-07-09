import { afterEach, describe, expect, it, vi } from "vitest";

type Res<T> = { data: T; error: { message: string } | null };

function makeChain(
  maybe: Res<unknown>,
  list: Res<unknown[] | null> = { data: [], error: null },
) {
  const thenable: Record<string, unknown> = {
    select: () => thenable,
    eq: () => thenable,
    order: () => thenable,
    maybeSingle: async () => maybe,
    then: (onF: (r: Res<unknown[] | null>) => unknown) =>
      Promise.resolve(list).then(onF),
  };
  return thenable;
}

// vi.hoisted() ensures the mock fn is initialized before vi.mock() factories run
// (vi.mock is hoisted to the top of the module by Vitest).
const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn(async () => ({
    from: () =>
      makeChain(
        { data: { id: "d1", name: "Dash" }, error: null },
        { data: [{ id: "w1", dashboard_id: "d1" }], error: null },
      ),
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

  it("returns null when the dashboard is not visible (RLS) or absent", async () => {
    createClient.mockResolvedValueOnce({
      from: () => makeChain({ data: null, error: null }),
    } as never);
    expect(await getDashboardPayload("missing")).toBeNull();
  });

  it("throws when the dashboard read fails (DB failure is not a 404)", async () => {
    createClient.mockResolvedValueOnce({
      from: () =>
        makeChain({ data: null, error: { message: "connection reset" } }),
    } as never);
    // distinct id: getDashboardPayload is wrapped in React cache()
    await expect(getDashboardPayload("d-err")).rejects.toThrow(
      /connection reset/,
    );
  });

  it("throws when the widgets read fails instead of rendering an empty dashboard", async () => {
    createClient.mockResolvedValueOnce({
      from: () =>
        makeChain(
          { data: { id: "d1", name: "Dash" }, error: null },
          { data: null, error: { message: "widgets read failed" } },
        ),
    } as never);
    await expect(getDashboardPayload("d-widget-err")).rejects.toThrow(
      /widgets read failed/,
    );
  });
});
