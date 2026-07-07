import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useBoardSelection } from "@/stores/board-selection";
import { BoardBulkBar } from "./BoardBulkBar";
import type { Column } from "@/lib/boards/queries";

const bulkArchive = vi.fn();
const bulkMove = vi.fn();
const bulkSetCell = vi.fn();
vi.mock("@/lib/boards/use-bulk-mutations", () => ({
  useBulkMutations: () => ({ bulkArchive, bulkMove, bulkSetCell }),
}));

const groups = [
  { id: "g1", name: "Group A" },
  { id: "g2", name: "Group B" },
];

const statusColumn = {
  id: "col-status",
  kind: "status",
  name: "Status",
  settings: {
    options: [
      { id: "done", label: "Done", color: "#22c55e" },
      { id: "wip", label: "Working", color: "#3b82f6" },
    ],
  },
} as unknown as Column;

const peopleColumn = {
  id: "col-people",
  kind: "people",
  name: "Owner",
  settings: {},
} as unknown as Column;

const members = [
  { userId: "u1", fullName: "Ada Lovelace", email: null, avatarUrl: null },
];

function renderBar(columns: Column[] = [statusColumn, peopleColumn]) {
  return render(
    <BoardBulkBar
      boardId="b1"
      groups={groups}
      columns={columns}
      members={members}
    />,
  );
}

function select(ids: string[]) {
  useBoardSelection.setState({
    selectedIds: new Set(ids),
    anchorId: null,
    orderedIds: ids,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useBoardSelection.setState({
    selectedIds: new Set(),
    anchorId: null,
    orderedIds: [],
  });
});
afterEach(cleanup);

describe("BoardBulkBar", () => {
  it("renders nothing when no rows are selected", () => {
    const { container } = renderBar();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the selection count when rows are selected", () => {
    select(["i1", "i2", "i3"]);
    renderBar();
    expect(screen.getByText("3 selected")).toBeInTheDocument();
  });

  it("clears the selection via the deselect button", async () => {
    const user = userEvent.setup();
    select(["i1", "i2"]);
    renderBar();
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(useBoardSelection.getState().selectedIds.size).toBe(0);
  });

  it("moves the selected items to a chosen group", async () => {
    const user = userEvent.setup();
    select(["i1", "i2"]);
    renderBar();
    await user.click(screen.getByRole("button", { name: /Move to/ }));
    await user.click(screen.getByRole("menuitem", { name: "Group B" }));
    expect(bulkMove).toHaveBeenCalledWith(["i1", "i2"], "g2");
    // Selection clears after firing the action.
    expect(useBoardSelection.getState().selectedIds.size).toBe(0);
  });

  it("sets a status option across the selection", async () => {
    const user = userEvent.setup();
    select(["i1", "i2"]);
    renderBar();
    await user.click(screen.getByRole("button", { name: /Status/ }));
    await user.click(screen.getByRole("option", { name: "Done" }));
    expect(bulkSetCell).toHaveBeenCalledWith(["i1", "i2"], "col-status", {
      optionId: "done",
    });
  });

  it("confirms before moving the selection to Trash (reversible copy)", async () => {
    const user = userEvent.setup();
    select(["i1", "i2"]);
    renderBar();
    await user.click(screen.getByRole("button", { name: /Delete/ }));
    // Confirm dialog appears with reversible Trash copy, not a permanent destroy.
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/move 2 items to trash/i);
    expect(dialog).not.toHaveTextContent(/permanent/i);
    expect(dialog).not.toHaveTextContent(/can(no|')t be undone/i);
    await user.click(
      within(dialog).getByRole("button", { name: /move to trash/i }),
    );
    expect(bulkArchive).toHaveBeenCalledWith(["i1", "i2"]);
    expect(useBoardSelection.getState().selectedIds.size).toBe(0);
  });

  it("hides the status action when the board has no status column", () => {
    select(["i1"]);
    renderBar([peopleColumn]);
    expect(
      screen.queryByRole("button", { name: /Status/ }),
    ).not.toBeInTheDocument();
  });
});
