import { afterEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) =>
      store.has(n) ? { name: n, value: store.get(n)! } : undefined,
  }),
}));

import { getActiveWorkspaceId } from "./active";

afterEach(() => store.clear());

describe("getActiveWorkspaceId", () => {
  const ws = [{ id: "w1" }, { id: "w2" }];

  it("returns the cookie value when it matches a workspace", async () => {
    store.set("pulse_active_ws", "w2");
    expect(await getActiveWorkspaceId(ws)).toBe("w2");
  });

  it("falls back to the first workspace when the cookie is stale", async () => {
    store.set("pulse_active_ws", "gone");
    expect(await getActiveWorkspaceId(ws)).toBe("w1");
  });

  it("falls back to the first workspace when no cookie is set", async () => {
    expect(await getActiveWorkspaceId(ws)).toBe("w1");
  });

  it("returns empty string when there are no workspaces", async () => {
    expect(await getActiveWorkspaceId([])).toBe("");
  });
});
