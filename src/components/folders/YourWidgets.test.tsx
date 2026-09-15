import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEffect, useState, type ComponentType } from "react";

let searchParamsValue = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => searchParamsValue,
}));
vi.mock("@/components/dashboards/DashboardCanvasLazy", () => ({
  DashboardCanvasLazy: (p: {
    initialData: { dashboard: { name: string } };
  }) => <div data-testid="canvas">{p.initialData.dashboard.name}</div>,
}));
vi.mock("@/components/dashboards/NewDashboardDialog", () => ({
  NewDashboardDialog: (p: { open: boolean; folderId?: string }) =>
    p.open ? <div data-testid="new-dialog">{p.folderId}</div> : null,
}));
// Resolve the component's `next/dynamic(..., { ssr: false })` wizard loader in
// a jsdom-friendly way (same pattern as UnfiledDashboards.test.tsx): run the
// loader in an effect and swap the resolved component in. The wizard is code
// split so it never lands in the folder page's first-paint bundle.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<unknown>) => {
    return function Lazy(props: Record<string, unknown>) {
      const [Comp, setComp] = useState<ComponentType<
        Record<string, unknown>
      > | null>(null);
      useEffect(() => {
        void loader().then((m) => {
          const resolved =
            typeof m === "function"
              ? (m as ComponentType<Record<string, unknown>>)
              : null;
          setComp(() => resolved);
        });
      }, []);
      return Comp ? <Comp {...props} /> : null;
    };
  },
}));
vi.mock("@/components/dashboards/ai/AiDashboardWizard", () => ({
  AiDashboardWizard: (p: { open: boolean; folderId?: string }) =>
    p.open ? <div data-testid="ai-wizard">{p.folderId}</div> : null,
}));
vi.mock("@/lib/folders/actions", () => ({
  attachDashboardToFolder: vi.fn(async () => ({ ok: true, data: undefined })),
}));
import { attachDashboardToFolder } from "@/lib/folders/actions";
import { YourWidgets } from "./YourWidgets";

const dash = (id: string, name: string) => ({
  dashboard: {
    id,
    name,
    org_id: "o1",
    workspace_id: "w1",
    created_by: "u1",
    created_at: "",
    updated_at: "",
    folder_id: "f1",
  },
  widgets: [],
});

describe("YourWidgets", () => {
  it("renders one canvas section per folded-in dashboard, in the given order", () => {
    render(
      <YourWidgets
        folderId="f1"
        workspaceId="w1"
        dashboards={[dash("d1", "Ops"), dash("d2", "Sales")]}
        boards={[]}
        unfiled={[]}
      />,
    );
    expect(screen.getAllByTestId("canvas").map((c) => c.textContent)).toEqual([
      "Ops",
      "Sales",
    ]);
  });
  it("opens New dashboard and Generate with AI seeded with the folder id", async () => {
    render(
      <YourWidgets
        folderId="f1"
        workspaceId="w1"
        dashboards={[]}
        boards={[]}
        unfiled={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "New dashboard" }));
    expect(screen.getByTestId("new-dialog")).toHaveTextContent("f1");
    fireEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
    expect(await screen.findByTestId("ai-wizard")).toHaveTextContent("f1");
  });
  it("attaches an existing unfiled dashboard", async () => {
    render(
      <YourWidgets
        folderId="f1"
        workspaceId="w1"
        dashboards={[]}
        boards={[]}
        unfiled={[{ id: "d9", name: "Old" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Attach existing" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Old" }));
    expect(attachDashboardToFolder).toHaveBeenCalledWith({
      dashboardId: "d9",
      folderId: "f1",
    });
  });
  it("opens the AI wizard on mount when the URL carries ?ai=1", async () => {
    searchParamsValue = new URLSearchParams("ai=1");
    render(
      <YourWidgets
        folderId="f1"
        workspaceId="w1"
        dashboards={[]}
        boards={[]}
        unfiled={[]}
      />,
    );
    expect(await screen.findByTestId("ai-wizard")).toHaveTextContent("f1");
    searchParamsValue = new URLSearchParams();
  });
});
