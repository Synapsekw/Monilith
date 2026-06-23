import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/boards",
  useParams: () => ({}),
}));
vi.mock("@/lib/boards/queries", () => ({
  listMyBoards: vi.fn(async () => [
    {
      id: "b1",
      name: "Sprint backlog",
      workspace_id: "w1",
      position: 0,
      shared_out: false,
    },
  ]),
}));
vi.mock("@/lib/dashboards/queries", () => ({
  listDashboards: vi.fn(async () => [{ id: "d1", name: "Velocity" }]),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: async () => ({ data: [{ id: "w1", name: "Eng" }] }),
    }),
  })),
}));

beforeEach(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

describe("CommandPaletteData", () => {
  it("renders the command palette from the queries without throwing", async () => {
    const { CommandPaletteData } = await import("./command-palette-data");
    // The palette is closed by default; assert the component resolves + renders.
    const el = await CommandPaletteData();
    expect(() => render(el)).not.toThrow();
  });
});
