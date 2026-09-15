import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { NewDashboardDialog } from "./NewDashboardDialog";
import { createDashboard } from "@/lib/dashboards/actions";
import { attachDashboardToFolder } from "@/lib/folders/actions";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));
vi.mock("@/lib/dashboards/actions", () => ({ createDashboard: vi.fn() }));
vi.mock("@/lib/folders/actions", () => ({
  attachDashboardToFolder: vi.fn(),
}));

const created = {
  ok: true as const,
  data: { dashboard: { id: "d9" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createDashboard).mockResolvedValue(
    created as unknown as Awaited<ReturnType<typeof createDashboard>>,
  );
  vi.mocked(attachDashboardToFolder).mockResolvedValue({
    ok: true,
    data: undefined,
  });
});

function open(folderId?: string) {
  render(
    <NewDashboardDialog
      workspaceId="ws1"
      folderId={folderId}
      open
      onOpenChange={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Dashboard name"), {
    target: { value: "Team overview" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create dashboard" }));
}

describe("NewDashboardDialog", () => {
  it("creates the dashboard and routes to it", async () => {
    open();
    await waitFor(() =>
      expect(createDashboard).toHaveBeenCalledWith({
        workspaceId: "ws1",
        name: "Team overview",
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboards/d9"));
    expect(attachDashboardToFolder).not.toHaveBeenCalled();
  });

  it("shows the action's error and stays open", async () => {
    vi.mocked(createDashboard).mockResolvedValue({
      ok: false,
      error: "Name already taken.",
    } as unknown as Awaited<ReturnType<typeof createDashboard>>);
    open();
    expect(await screen.findByText("Name already taken.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("attaches to the folder when folderId is given", async () => {
    open("f1");
    await waitFor(() =>
      expect(attachDashboardToFolder).toHaveBeenCalledWith({
        dashboardId: "d9",
        folderId: "f1",
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboards/d9"));
  });

  it("will not submit an empty name", () => {
    render(
      <NewDashboardDialog workspaceId="ws1" open onOpenChange={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: "Create dashboard" }),
    ).toBeDisabled();
  });
});
