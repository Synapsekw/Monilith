import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const maybeSingle = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    rpc,
  }),
}));

import { getWidgetPreviewData } from "./actions";

const BOARD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

beforeEach(() => {
  rpc.mockReset();
  maybeSingle.mockReset();
});

describe("getWidgetPreviewData", () => {
  it("derives org from the board and returns an aggregate payload", async () => {
    maybeSingle.mockResolvedValue({ data: { org_id: "org1" }, error: null });
    rpc.mockResolvedValue({
      data: [{ group_key: null, metric: 3 }],
      error: null,
    });

    const res = await getWidgetPreviewData({
      kind: "number",
      sourceBoardId: BOARD,
      config: { agg: "count" },
    });

    expect(res.ok).toBe(true);
    if (res.ok && res.data.ok && res.data.shape === "aggregate") {
      expect(res.data.payload.buckets).toEqual([
        { group_key: null, metric: 3 },
      ]);
    } else {
      throw new Error("expected aggregate payload");
    }
  });

  it("errors when the board is not visible under RLS", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await getWidgetPreviewData({
      kind: "number",
      sourceBoardId: BOARD,
      config: { agg: "count" },
    });
    expect(res.ok).toBe(false);
  });

  it("returns a neutral empty aggregate for a transiently-invalid draft config", async () => {
    maybeSingle.mockResolvedValue({ data: { org_id: "org1" }, error: null });
    // agg:"sum" without valueColumnId fails configSchemaForKind → empty, not error.
    const res = await getWidgetPreviewData({
      kind: "number",
      sourceBoardId: BOARD,
      config: { agg: "sum" },
    });
    expect(res.ok).toBe(true);
    if (res.ok && res.data.ok && res.data.shape === "aggregate") {
      expect(res.data.payload.buckets).toEqual([]);
    } else {
      throw new Error("expected empty aggregate payload");
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});
