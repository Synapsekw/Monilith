import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/boards",
  useParams: () => ({}),
}));
vi.mock("@/lib/auth/session", () => ({
  getUser: vi.fn(async () => ({ id: "u1" })),
}));
vi.mock("@/lib/org/active", () => ({
  getActiveOrgId: vi.fn(async () => "org1"),
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
vi.mock("@/lib/folders/queries-cached", () => ({
  listFoldersCached: vi.fn(async () => ({
    folders: [
      {
        id: "f1",
        name: "Q4 Launch",
        workspaceId: "w1",
        orgId: "org1",
        position: 0,
      },
    ],
    placements: [],
  })),
}));
vi.mock("@/lib/workspaces/queries-cached", () => ({
  listWorkspacesCached: vi.fn(async () => [{ id: "w1", name: "Eng" }]),
}));
vi.mock("@/lib/workspaces/active", () => ({
  getActiveWorkspaceId: vi.fn(async () => "w1"),
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
