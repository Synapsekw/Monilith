import { describe, expect, it } from "vitest";
import { updateBoardViewCore } from "./view";

function fakeClient(view: { kind: string; board_id: string } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: view, error: null }) }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  } as never;
}

describe("updateBoardViewCore", () => {
  it("rejects a config that does not match the view kind", async () => {
    const r = await updateBoardViewCore(
      fakeClient({ kind: "kanban", board_id: "b1" }),
      { viewId: "v1", config: { nonsense: true } },
    );
    expect(r.ok).toBe(false);
  });

  it("reports a missing view rather than succeeding silently", async () => {
    const r = await updateBoardViewCore(fakeClient(null), {
      viewId: "v1",
      name: "Board",
    });
    expect(r.ok).toBe(false);
  });

  // Preserved from updateBoardView: nothing to change is not an error.
  it("is a no-op success when neither name nor config is supplied", async () => {
    const r = await updateBoardViewCore(
      fakeClient({ kind: "table", board_id: "b1" }),
      { viewId: "v1" },
    );
    expect(r.ok).toBe(true);
  });
});
