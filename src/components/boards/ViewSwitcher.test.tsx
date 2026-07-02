import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ViewSwitcher } from "@/components/boards/ViewSwitcher";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const createBoardView = vi.fn();
const deleteBoardView = vi.fn();
const updateBoardView = vi.fn();
vi.mock("@/lib/boards/view-actions", () => ({
  createBoardView: (...a: unknown[]) => createBoardView(...a),
  deleteBoardView: (...a: unknown[]) => deleteBoardView(...a),
  updateBoardView: (...a: unknown[]) => updateBoardView(...a),
}));

const views = [
  { id: "v1", kind: "table", name: "Main Table" },
  { id: "v2", kind: "kanban", name: "Kanban" },
] as never;

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  createBoardView.mockReset();
  deleteBoardView.mockReset();
  updateBoardView.mockReset();
});

describe("ViewSwitcher", () => {
  it("renders a tab per view and marks the selected one", () => {
    render(<ViewSwitcher boardId="b1" views={views} selectedViewId="v2" />);
    expect(screen.getByRole("tab", { name: /Main Table/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("tab", { name: /Kanban/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("view tab button carries the branded focus ring", () => {
    render(<ViewSwitcher boardId="b1" views={views} selectedViewId="v1" />);
    const tab = screen.getAllByRole("tab")[0];
    expect(tab.className).toContain("focus-visible:ring");
  });

  it("switches view via the History API (no RSC navigation)", async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    render(<ViewSwitcher boardId="b1" views={views} selectedViewId="v1" />);
    await userEvent.click(screen.getByRole("tab", { name: /Kanban/ }));
    expect(pushState).toHaveBeenCalledWith(null, "", "/boards/b1?view=v2");
    // Switching must NOT trigger a router navigation (which would refetch).
    expect(push).not.toHaveBeenCalled();
    pushState.mockRestore();
  });

  it("does not push history when clicking the already-selected tab", async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    render(<ViewSwitcher boardId="b1" views={views} selectedViewId="v2" />);
    await userEvent.click(screen.getByRole("tab", { name: /Kanban/ }));
    expect(pushState).not.toHaveBeenCalled();
    pushState.mockRestore();
  });

  it("opens the add-view menu and creates a Kanban view", async () => {
    createBoardView.mockResolvedValue({ ok: true, data: { viewId: "v3" } });
    render(<ViewSwitcher boardId="b1" views={views} selectedViewId="v1" />);
    await userEvent.click(screen.getByRole("button", { name: /add view/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /kanban/i }));
    expect(createBoardView).toHaveBeenCalledWith({
      boardId: "b1",
      kind: "kanban",
    });
    expect(push).toHaveBeenCalledWith("/boards/b1?view=v3");
  });

  it("opens the add-view menu and creates a Calendar view", async () => {
    createBoardView.mockResolvedValue({ ok: true, data: { viewId: "v4" } });
    render(<ViewSwitcher boardId="b1" views={views} selectedViewId="v1" />);
    await userEvent.click(screen.getByRole("button", { name: /add view/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /calendar/i }));
    expect(createBoardView).toHaveBeenCalledWith({
      boardId: "b1",
      kind: "calendar",
    });
    expect(push).toHaveBeenCalledWith("/boards/b1?view=v4");
  });

  it("opens the add-view menu and creates a Timeline view", async () => {
    createBoardView.mockResolvedValue({ ok: true, data: { viewId: "v5" } });
    render(<ViewSwitcher boardId="b1" views={views} selectedViewId="v1" />);
    await userEvent.click(screen.getByRole("button", { name: /add view/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /timeline/i }));
    expect(createBoardView).toHaveBeenCalledWith({
      boardId: "b1",
      kind: "timeline",
    });
    expect(push).toHaveBeenCalledWith("/boards/b1?view=v5");
  });

  it("renames a view via the tab menu and refreshes", async () => {
    updateBoardView.mockResolvedValue({ ok: true, data: undefined });
    render(<ViewSwitcher boardId="b1" views={views} selectedViewId="v1" />);
    await userEvent.click(
      screen.getByRole("button", { name: /view options for main table/i }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /rename/i }));
    const input = screen.getByRole("textbox", { name: /view name/i });
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed{Enter}");
    expect(updateBoardView).toHaveBeenCalledWith({
      viewId: "v1",
      name: "Renamed",
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("deletes a view and navigates to the first remaining view", async () => {
    deleteBoardView.mockResolvedValue({ ok: true, data: undefined });
    render(<ViewSwitcher boardId="b1" views={views} selectedViewId="v2" />);
    await userEvent.click(
      screen.getByRole("button", { name: /view options for kanban/i }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    expect(deleteBoardView).toHaveBeenCalledWith({ viewId: "v2" });
    expect(push).toHaveBeenCalledWith("/boards/b1?view=v1");
  });

  it("deletes a non-selected view in place without navigating away", async () => {
    deleteBoardView.mockResolvedValue({ ok: true, data: undefined });
    // Selected = v1 (Main Table); delete the other tab (v2/Kanban).
    render(<ViewSwitcher boardId="b1" views={views} selectedViewId="v1" />);
    await userEvent.click(
      screen.getByRole("button", { name: /view options for kanban/i }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    expect(deleteBoardView).toHaveBeenCalledWith({ viewId: "v2" });
    expect(refresh).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("hides delete when only one view remains", async () => {
    render(
      <ViewSwitcher
        boardId="b1"
        views={[views[0]] as never}
        selectedViewId="v1"
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /view options for main table/i }),
    );
    // Rename is still available; Delete must be absent when there's one view.
    expect(
      screen.getByRole("menuitem", { name: /rename/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /delete/i }),
    ).not.toBeInTheDocument();
  });
});
