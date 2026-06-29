import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardItemMenu } from "./DashboardItemMenu";

const duplicateDashboard = vi.fn<
  (input: { dashboardId: string }) => Promise<unknown>
>(async () => ({
  ok: true,
  data: { dashboardId: "x" },
}));
const renameDashboard = vi.fn<
  (input: { dashboardId: string; name: string }) => Promise<unknown>
>(async () => ({ ok: true, data: { dashboard: {} } }));
const deleteDashboard = vi.fn<
  (input: { dashboardId: string }) => Promise<unknown>
>(async () => ({
  ok: true,
  data: undefined,
}));

vi.mock("@/lib/dashboards/actions", () => ({
  duplicateDashboard: (input: { dashboardId: string }) =>
    duplicateDashboard(input),
  renameDashboard: (input: { dashboardId: string; name: string }) =>
    renameDashboard(input),
  deleteDashboard: (input: { dashboardId: string }) => deleteDashboard(input),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => vi.clearAllMocks());
const open = () =>
  userEvent.click(screen.getByRole("button", { name: /dashboard actions/i }));

describe("DashboardItemMenu", () => {
  it("shows Rename, Duplicate and Delete", async () => {
    render(
      <DashboardItemMenu
        dashboard={{ id: "d1", name: "Ops" }}
        isActive={false}
      />,
    );
    await open();
    expect(
      screen.getByRole("menuitem", { name: "Rename" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Duplicate" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Delete" }),
    ).toBeInTheDocument();
  });

  it("calls duplicateDashboard when Duplicate is chosen", async () => {
    render(
      <DashboardItemMenu
        dashboard={{ id: "d1", name: "Ops" }}
        isActive={false}
      />,
    );
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(duplicateDashboard).toHaveBeenCalledWith({ dashboardId: "d1" });
  });

  it("deletes after confirming", async () => {
    render(
      <DashboardItemMenu
        dashboard={{ id: "d1", name: "Ops" }}
        isActive={false}
      />,
    );
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await userEvent.click(
      screen.getByRole("button", { name: /delete dashboard/i }),
    );
    expect(deleteDashboard).toHaveBeenCalledWith({ dashboardId: "d1" });
  });

  it("gives the actions trigger a coarse-pointer touch target (>=44px)", () => {
    render(
      <DashboardItemMenu
        dashboard={{ id: "d1", name: "Ops" }}
        isActive={false}
      />,
    );
    const trigger = screen.getByRole("button", { name: /dashboard actions/i });
    expect(trigger.className).toContain("pointer-coarse:size-11");
  });

  it("wraps the actions trigger in RevealOnHover (always-visible on coarse)", () => {
    render(
      <DashboardItemMenu
        dashboard={{ id: "d1", name: "Ops" }}
        isActive={false}
      />,
    );
    const trigger = screen.getByRole("button", { name: /dashboard actions/i });
    expect(trigger.closest('[data-slot="reveal-on-hover"]')).not.toBeNull();
  });
});
