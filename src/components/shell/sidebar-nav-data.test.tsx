import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/boards",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/workspaces/actions", () => ({
  createWorkspace: vi.fn(),
  renameWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
}));
// Identity reads (cookie-bound, uncached) are mocked to a user + one org.
vi.mock("@/lib/auth/session", () => ({
  getUser: vi.fn(async () => ({ id: "u1" })),
  getUserOrgs: vi.fn(async () => [{ id: "org1", name: "Acme" }]),
}));
// Cached shell reads (Phase 9.3) — the component now consumes these.
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
  listSharedBoardsCached: vi.fn(async () => []),
}));
vi.mock("@/lib/dashboards/queries-cached", () => ({
  listDashboardsCached: vi.fn(async () => [{ id: "d1", name: "Velocity" }]),
}));
vi.mock("@/lib/workspaces/queries-cached", () => ({
  listWorkspacesCached: vi.fn(async () => [{ id: "w1", name: "Eng" }]),
}));
// Active-workspace resolution reads a cookie (uncached, request-scoped); mocked
// here since the RSC render in this test happens outside a request context.
vi.mock("@/lib/workspaces/active", () => ({
  getActiveWorkspaceId: vi.fn(async () => "w1"),
}));
vi.mock("@/lib/platform/guard", () => ({
  isPlatformAdminCached: vi.fn(async () => false),
}));
vi.mock("@/lib/org/guard", () => ({
  isOrgAdminCached: vi.fn(async () => false),
}));

beforeEach(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

describe("SidebarNavData", () => {
  // Rendering the full async RSC tree takes ~2-5s and breaches the default
  // 5s cap when the suite runs fully parallel; the generous cap only guards
  // against a hang, not slowness.
  it(
    "renders boards, dashboards and workspaces from the cached reads",
    { timeout: 20_000 },
    async () => {
      const { SidebarNavData } = await import("./sidebar-nav-data");
      render(await SidebarNavData());
      expect(screen.getByText("Sprint backlog")).toBeInTheDocument();
      expect(screen.getByText("Velocity")).toBeInTheDocument();
      expect(screen.getByText("Eng")).toBeInTheDocument();
    },
  );
});
