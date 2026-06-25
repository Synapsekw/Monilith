import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/boards",
  useParams: () => ({}),
}));
vi.mock("@/lib/auth/session", () => ({
  getUser: vi.fn(async () => ({ id: "u1" })),
  getUserOrgs: vi.fn(async () => [{ id: "org1", name: "Acme" }]),
}));
vi.mock("@/lib/boards/queries-cached", () => ({
  listMyBoardsCached: vi.fn(async () => [
    {
      id: "b1",
      name: "Sprint backlog",
      workspace_id: "w1",
      position: 0,
      shared_out: false,
    },
  ]),
}));
vi.mock("@/lib/dashboards/queries-cached", () => ({
  listDashboardsCached: vi.fn(async () => [{ id: "d1", name: "Velocity" }]),
}));
vi.mock("@/lib/workspaces/queries-cached", () => ({
  listWorkspacesCached: vi.fn(async () => [{ id: "w1", name: "Eng" }]),
}));

beforeEach(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

describe("CommandPaletteData", () => {
  it("renders the command palette from the cached reads without throwing", async () => {
    const { CommandPaletteData } = await import("./command-palette-data");
    // The palette is closed by default; assert the component resolves + renders.
    const el = await CommandPaletteData();
    expect(() => render(el)).not.toThrow();
  });
});
