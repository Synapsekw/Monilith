import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "@/stores/ui";

// Mutable so individual tests can seed the URL the component reads on mount
// (`useSearchParams().get("ai")`) without re-registering the whole mock.
const { searchParamsStore, newDashboardDialogProps } = vi.hoisted(() => ({
  searchParamsStore: { value: new URLSearchParams() },
  newDashboardDialogProps: { current: null as { open: boolean } | null },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => searchParamsStore.value,
}));
vi.mock("@/lib/folders/actions", () => ({
  attachDashboardToFolder: vi.fn(async () => ({ ok: true, data: undefined })),
}));
vi.mock("@/components/dashboards/NewDashboardDialog", () => ({
  // Always mounted (matches the "hosts the dialog" contract below); records
  // the last `open` value so a test can assert the ⌘K store flag reached it.
  NewDashboardDialog: (props: { open: boolean }) => {
    newDashboardDialogProps.current = props;
    return <div data-testid="new-dashboard-dialog" />;
  },
}));
vi.mock("@/components/dashboards/ai/AiDashboardWizard", () => ({
  AiDashboardWizard: () => <div data-testid="ai-dashboard-wizard" />,
}));
import { attachDashboardToFolder } from "@/lib/folders/actions";
import { UnfiledDashboards } from "./UnfiledDashboards";

beforeEach(() => {
  searchParamsStore.value = new URLSearchParams();
  newDashboardDialogProps.current = null;
  useUIStore.setState({ newDashboardOpen: false });
});

describe("UnfiledDashboards", () => {
  it("lists unfiled dashboards with an attach picker", async () => {
    render(
      <UnfiledDashboards
        workspaceId="w1"
        dashboards={[{ id: "d1", name: "Team overview" }]}
        folders={[{ id: "f1", name: "Q4 Launch" }]}
      />,
    );
    expect(screen.getByRole("link", { name: "Team overview" })).toHaveAttribute(
      "href",
      "/dashboards/d1",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Attach Team overview to a folder" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Q4 Launch" }));
    expect(attachDashboardToFolder).toHaveBeenCalledWith({
      dashboardId: "d1",
      folderId: "f1",
    });
  });
  it("hosts the New dashboard dialog", () => {
    render(<UnfiledDashboards workspaceId="w1" dashboards={[]} folders={[]} />);
    expect(screen.getByTestId("new-dashboard-dialog")).toBeInTheDocument();
  });

  // Ruling 1: the gallery's client island reproduces the two global
  // "create a dashboard" entry points that died with the deleted
  // `DashboardsNav` — the ⌘K "New dashboard" command and the AI review
  // banner's "Regenerate" round-trip to `/dashboards?ai=1`.
  it("opens the New dashboard dialog when the ⌘K store flag is set", () => {
    useUIStore.setState({ newDashboardOpen: true });
    render(<UnfiledDashboards workspaceId="w1" dashboards={[]} folders={[]} />);
    expect(newDashboardDialogProps.current?.open).toBe(true);
  });

  it("opens the AI dashboard wizard when the URL has ?ai=1", () => {
    searchParamsStore.value = new URLSearchParams("ai=1");
    render(<UnfiledDashboards workspaceId="w1" dashboards={[]} folders={[]} />);
    expect(screen.getByTestId("ai-dashboard-wizard")).toBeInTheDocument();
  });

  it("does not mount the AI dashboard wizard without ?ai=1", () => {
    render(<UnfiledDashboards workspaceId="w1" dashboards={[]} folders={[]} />);
    expect(screen.queryByTestId("ai-dashboard-wizard")).not.toBeInTheDocument();
  });
});
