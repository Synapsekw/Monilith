import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/boards",
  useParams: () => ({}),
}));
vi.mock("@/lib/workspaces/actions", () => ({
  createWorkspace: vi.fn(),
  renameWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
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
  listSharedBoards: vi.fn(async () => []),
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
vi.mock("@/lib/platform/guard", () => ({
  isPlatformAdmin: vi.fn(async () => false),
}));
vi.mock("@/lib/org/guard", () => ({ isOrgAdmin: vi.fn(async () => false) }));

beforeEach(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

describe("SidebarNavData", () => {
  it("renders boards, dashboards and workspaces from the queries", async () => {
    const { SidebarNavData } = await import("./sidebar-nav-data");
    render(await SidebarNavData());
    expect(screen.getByText("Sprint backlog")).toBeInTheDocument();
    expect(screen.getByText("Velocity")).toBeInTheDocument();
    expect(screen.getByText("Eng")).toBeInTheDocument();
  });
});
