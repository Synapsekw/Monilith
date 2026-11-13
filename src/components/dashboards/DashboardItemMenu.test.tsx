import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
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
// Shared spies so a stray call is observable. Every action here invalidates
// (updateTag/revalidatePath), so its response already carries the re-rendered
// route — the menu must not add a client router.refresh() on top.
const routerPush = vi.fn();
const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: routerRefresh }),
}));
/** Drain the awaited (mocked) Server Action and its transition continuation,
 *  so a "did NOT refresh" assertion runs after the success path, not before. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

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
    await settle();
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("renames without a client refresh", async () => {
    render(
      <DashboardItemMenu
        dashboard={{ id: "d1", name: "Ops" }}
        isActive={false}
      />,
    );
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "Ops 2");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(renameDashboard).toHaveBeenCalledWith({
      dashboardId: "d1",
      name: "Ops 2",
    });
    await waitFor(() =>
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument(),
    );
    expect(routerRefresh).not.toHaveBeenCalled();
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
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    // Not the active dashboard: nothing to navigate away from, nothing to
    // refresh — the action response re-rendered the sidebar.
    expect(routerPush).not.toHaveBeenCalled();
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  it("navigates to /dashboards — without a refresh — when the ACTIVE one is deleted", async () => {
    render(
      <DashboardItemMenu dashboard={{ id: "d1", name: "Ops" }} isActive />,
    );
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await userEvent.click(
      screen.getByRole("button", { name: /delete dashboard/i }),
    );
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/dashboards"));
    expect(routerRefresh).not.toHaveBeenCalled();
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
