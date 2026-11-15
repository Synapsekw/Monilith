import { render, screen, act, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Column, Item } from "@/lib/boards/queries";
import { EditableCell } from "./EditableCell";
import { useEditingCell } from "./editing-store";
import type { CellControls } from "./shared";

vi.mock("@/lib/boards/relation-candidates", () => ({
  listRelationCandidates: vi.fn(async () => []),
}));

/**
 * View-only access (a direct board grant or a folder grant, both resolved to
 * the board's one `canEdit`): a cell shows its value and nothing that writes.
 * The write would be refused by RLS anyway, after an optimistic flash and an
 * error toast. Read-only is not inert, though: links, linked-item chips and
 * file previews keep working.
 */
const ITEM_ID = "22222222-2222-4222-8222-222222222222";

const item: Item = {
  id: ITEM_ID,
  org_id: "o1",
  board_id: "b1",
  group_id: "g1",
  parent_id: null,
  name: "Ship it",
  position: 1,
  created_by: "",
  created_at: "2026-09-09T00:00:00Z",
  updated_at: "2026-09-09T00:00:00Z",
  archived_at: null,
  archived_by: null,
};

function column(
  kind: string,
  name: string,
  settings: Record<string, unknown> = {},
): Column {
  return {
    id: "c1",
    board_id: "b1",
    name,
    kind,
    position: 1,
    settings,
    width: null,
  } as unknown as Column;
}

const cache = {
  attachments: [
    {
      id: "a1",
      item_id: ITEM_ID,
      column_id: "c1",
      file_name: "brief.pdf",
      mime_type: "application/pdf",
      uploaded_by: "someone",
    },
  ],
  timeEntries: [
    {
      id: "t1",
      item_id: ITEM_ID,
      column_id: "c1",
      user_id: "u1",
      started_at: "2026-09-09T10:00:00Z",
      ended_at: "2026-09-09T11:00:00Z",
      duration_secs: 3600,
    },
  ],
  relationLinks: [
    {
      id: "l1",
      itemId: ITEM_ID,
      columnId: "c1",
      linkedItemId: "target-1",
      linkedItemName: "Milestone A",
      linkedItemStatus: null,
      position: 0,
    },
  ],
};

function controls(
  canEdit: boolean,
  over: Partial<CellControls> = {},
): CellControls {
  return {
    canEdit,
    setEditing: useEditingCell.getState().setEditing,
    setCell: vi.fn(),
    clearCellValue: vi.fn(),
    members: [],
    currentUserId: "u1",
    cache,
    statusColumn: null,
    openFilesLightbox: vi.fn(),
    uploadColumnFile: vi.fn(),
    startTimer: vi.fn(),
    stopTimer: vi.fn(),
    addManualEntry: vi.fn(),
    editEntry: vi.fn(),
    deleteEntry: vi.fn(),
    setEstimate: vi.fn(),
    setRelationLinks: vi.fn(),
    ...over,
  } as unknown as CellControls;
}

beforeEach(() => {
  act(() => useEditingCell.getState().setEditing(null));
});

describe("EditableCell for a viewer", () => {
  it("shows a text value without a button role, pointer cursor or editor", () => {
    render(
      <EditableCell
        item={item}
        column={column("text", "Notes")}
        value={{ text: "Hello" }}
        controls={controls(false)}
      />,
    );
    const cell = screen.getByLabelText("Ship it Notes");
    expect(cell).not.toHaveAttribute("role", "button");
    expect(cell.className).not.toContain("cursor-pointer");
    expect(screen.getByText("Hello")).toBeInTheDocument();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(useEditingCell.getState().editing).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("does not fire the status done-burst or a write when edit mode is forced", () => {
    const setCell = vi.fn();
    render(
      <EditableCell
        item={item}
        column={column("status", "Status", {
          options: [{ id: "o1", label: "Done", color: "#00c875" }],
        })}
        value={null}
        controls={controls(false, { setCell })}
      />,
    );
    act(() =>
      useEditingCell.getState().setEditing({ itemId: ITEM_ID, columnId: "c1" }),
    );
    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(setCell).not.toHaveBeenCalled();
  });

  it("keeps a link cell's anchor working", () => {
    render(
      <EditableCell
        item={item}
        column={column("link", "Website")}
        value={{ url: "https://example.com", text: "Example" }}
        controls={controls(false)}
      />,
    );
    expect(screen.getByRole("link", { name: "Example" })).toHaveAttribute(
      "href",
      "https://example.com",
    );
  });

  it("keeps relation chips as links but drops the picker and its pencil", () => {
    const setRelationLinks = vi.fn();
    render(
      <EditableCell
        item={item}
        column={column("relation", "Milestone", {
          target_board_id: "board-2",
        })}
        value={null}
        controls={controls(false, { setRelationLinks })}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Open Milestone A" }),
    ).toHaveAttribute("href", "/boards/board-2?item=target-1");
    expect(screen.queryByLabelText("Edit linked items")).toBeNull();
    expect(setRelationLinks).not.toHaveBeenCalled();
  });

  it("opens a file preview but offers no upload", () => {
    const openFilesLightbox = vi.fn();
    const uploadColumnFile = vi.fn();
    const { container } = render(
      <EditableCell
        item={item}
        column={column("files", "Files")}
        value={null}
        controls={controls(false, { openFilesLightbox, uploadColumnFile })}
      />,
    );
    expect(screen.queryByLabelText("Add file")).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    fireEvent.click(screen.getByTitle("brief.pdf"));
    expect(openFilesLightbox).toHaveBeenCalledWith(expect.any(Array), 0);
    expect(uploadColumnFile).not.toHaveBeenCalled();
  });

  it("shows tracked time but no timer, estimate or manual-entry controls", () => {
    const startTimer = vi.fn();
    render(
      <EditableCell
        item={item}
        column={column("time_tracking", "Time")}
        value={null}
        controls={controls(false, { startTimer })}
      />,
    );
    expect(screen.queryByLabelText("Start timer")).toBeNull();
    expect(screen.queryByLabelText("Stop timer")).toBeNull();
    // The entry log is a read: the popover still opens, without write controls.
    fireEvent.click(screen.getByLabelText("Open time tracking"));
    expect(screen.getByText("tracked")).toBeInTheDocument();
    expect(screen.queryByLabelText("Estimate")).toBeNull();
    expect(screen.queryByLabelText("Duration to add")).toBeNull();
    expect(screen.queryByLabelText("Edit entry")).toBeNull();
    expect(screen.queryByLabelText("Delete entry")).toBeNull();
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
    expect(startTimer).not.toHaveBeenCalled();
  });
});

describe("EditableCell for an editor (unchanged)", () => {
  it("is a button that enters edit mode on click and on Enter", () => {
    const setEditing = vi.fn();
    render(
      <EditableCell
        item={item}
        column={column("text", "Notes")}
        value={{ text: "Hello" }}
        controls={controls(true, { setEditing })}
      />,
    );
    const cell = screen.getByRole("button", { name: "Ship it Notes" });
    expect(cell.className).toContain("cursor-pointer");
    fireEvent.keyDown(cell, { key: "Enter" });
    fireEvent.click(cell);
    expect(setEditing).toHaveBeenCalledTimes(2);
    expect(setEditing).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      columnId: "c1",
    });
  });

  it("keeps the relation picker, the file upload and the timer", () => {
    const { unmount } = render(
      <EditableCell
        item={item}
        column={column("relation", "Milestone", {
          target_board_id: "board-2",
        })}
        value={null}
        controls={controls(true)}
      />,
    );
    expect(screen.getByLabelText("Edit linked items")).toBeInTheDocument();
    unmount();

    const files = render(
      <EditableCell
        item={item}
        column={column("files", "Files")}
        value={null}
        controls={controls(true)}
      />,
    );
    expect(screen.getByLabelText("Add file")).toBeInTheDocument();
    files.unmount();

    render(
      <EditableCell
        item={item}
        column={column("time_tracking", "Time")}
        value={null}
        controls={controls(true)}
      />,
    );
    expect(screen.getByLabelText("Start timer")).toBeInTheDocument();
  });
});
