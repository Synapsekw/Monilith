import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ItemAssistPanel } from "./ItemAssistPanel";
import { generateItemAssist } from "@/lib/ai/item-assist/actions";
import { upsertCell } from "@/lib/boards/actions/cell";
import { addSubitem } from "@/lib/boards/actions/item";
import type { Column } from "@/lib/collaboration/activity";

vi.mock("@/lib/ai/item-assist/actions", () => ({
  generateItemAssist: vi.fn(),
}));
vi.mock("@/lib/boards/actions/cell", () => ({
  upsertCell: vi.fn(),
}));
vi.mock("@/lib/boards/actions/item", () => ({
  addSubitem: vi.fn(),
}));

const mockGenerate = vi.mocked(generateItemAssist);
const mockUpsertCell = vi.mocked(upsertCell);
const mockAddSubitem = vi.mocked(addSubitem);

const ITEM_ID = "11111111-1111-1111-1111-111111111111";
const TEXT_COL_ID = "22222222-2222-2222-2222-222222222222";
const STATUS_COL_ID = "33333333-3333-3333-3333-333333333333";
const DROPDOWN_COL_ID = "44444444-4444-4444-4444-444444444444";

function col(overrides: Partial<Column> & { id: string }): Column {
  return {
    board_id: "b1",
    org_id: "o1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    position: 0,
    width: null,
    name: "Column",
    kind: "text",
    settings: null,
    ...overrides,
  } as Column;
}

const textColumn = col({ id: TEXT_COL_ID, name: "Notes", kind: "text" });
const statusColumn = col({
  id: STATUS_COL_ID,
  name: "Status",
  kind: "status",
  settings: {
    options: [
      { id: "opt-done", label: "Done", color: "#22c55e" },
      { id: "opt-todo", label: "To do", color: "#94a3b8" },
    ],
  },
});
const dropdownColumn = col({
  id: DROPDOWN_COL_ID,
  name: "Priority",
  kind: "dropdown",
  settings: {
    options: [{ id: "opt-high", label: "High", color: "#ef4444" }],
  },
});

const allColumns: Column[] = [textColumn, statusColumn, dropdownColumn];

beforeEach(() => {
  vi.clearAllMocks();
});

function renderPanel(props?: { isSubitem?: boolean; columns?: Column[] }) {
  return render(
    <ItemAssistPanel
      itemId={ITEM_ID}
      boardId="b1"
      columns={props?.columns ?? allColumns}
      isSubitem={props?.isSubitem}
    />,
  );
}

describe("ItemAssistPanel", () => {
  it("renders the three assist entries", () => {
    renderPanel();
    expect(
      screen.getByRole("heading", { name: /draft description/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /suggest subtasks/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /set status/i }),
    ).toBeInTheDocument();
  });

  it("disables the description entry and shows a hint when there is no text column", () => {
    renderPanel({ columns: [statusColumn, dropdownColumn] });
    expect(
      screen.getByText(/add a text column to draft a description into/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^draft$/i }),
    ).not.toBeInTheDocument();
  });

  it("disables the subtasks entry when the item is a subitem", () => {
    renderPanel({ isSubitem: true });
    expect(
      screen.getByText(/subtasks can't be added to a subitem/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^suggest$/i }),
    ).not.toBeInTheDocument();
  });

  it("drafts a description then applies it via upsertCell", async () => {
    mockGenerate.mockResolvedValue({
      ok: true,
      data: { proposal: { description: "A crisp draft." }, warnings: [] },
    });
    mockUpsertCell.mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: /^draft$/i }));

    expect(mockGenerate).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      want: { description: { columnId: TEXT_COL_ID } },
    });

    const textarea = await screen.findByRole("textbox", {
      name: /proposed description/i,
    });
    expect(textarea).toHaveValue("A crisp draft.");

    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(mockUpsertCell).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      columnId: TEXT_COL_ID,
      value: { text: "A crisp draft." },
    });
  });

  it("accepts a proposed subtask and applies it via addSubitem", async () => {
    mockGenerate.mockResolvedValue({
      ok: true,
      data: {
        proposal: { subtasks: ["Write tests", "Ship it"] },
        warnings: [],
      },
    });
    mockAddSubitem.mockResolvedValue({
      ok: true,
      data: {
        item: {
          id: "sub-1",
          org_id: "o1",
          board_id: "b1",
          group_id: "g1",
          parent_id: ITEM_ID,
          name: "Write tests",
          position: 0,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          created_by: "u1",
          archived_at: null,
          archived_by: null,
        },
      },
    });
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: /^suggest$/i }));

    expect(mockGenerate).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      want: { subtasks: true },
    });

    const first = await screen.findByRole("checkbox", {
      name: /accept subtask 1/i,
    });
    expect(first).toBeChecked();
    const second = screen.getByRole("checkbox", { name: /accept subtask 2/i });
    await user.click(second); // reject the second suggestion

    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(mockAddSubitem).toHaveBeenCalledTimes(1);
    expect(mockAddSubitem).toHaveBeenCalledWith({
      parentId: ITEM_ID,
      name: "Write tests",
    });
  });

  it("writes a status-column proposal as { optionId }", async () => {
    mockGenerate.mockResolvedValue({
      ok: true,
      data: {
        proposal: { status: { columnId: STATUS_COL_ID, optionId: "opt-done" } },
        warnings: [],
      },
    });
    mockUpsertCell.mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup();
    renderPanel();

    const select = screen.getByRole("combobox", { name: /status column/i });
    await user.selectOptions(select, STATUS_COL_ID);
    await user.click(screen.getByRole("button", { name: /^propose$/i }));

    expect(await screen.findByText("Done")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(mockUpsertCell).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      columnId: STATUS_COL_ID,
      value: { optionId: "opt-done" },
    });
  });

  it("writes a dropdown-column proposal as { optionIds: [optionId] }", async () => {
    mockGenerate.mockResolvedValue({
      ok: true,
      data: {
        proposal: {
          status: { columnId: DROPDOWN_COL_ID, optionId: "opt-high" },
        },
        warnings: [],
      },
    });
    mockUpsertCell.mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup();
    renderPanel();

    const select = screen.getByRole("combobox", { name: /status column/i });
    await user.selectOptions(select, DROPDOWN_COL_ID);
    await user.click(screen.getByRole("button", { name: /^propose$/i }));

    expect(await screen.findByText("High")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(mockUpsertCell).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      columnId: DROPDOWN_COL_ID,
      value: { optionIds: ["opt-high"] },
    });
  });

  it("renders a quota error inline without crashing", async () => {
    mockGenerate.mockResolvedValue({
      ok: false,
      error: "You've used this month's AI allowance.",
    });
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: /^draft$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You've used this month's AI allowance.");
    // No crash: the entry is still interactive.
    expect(
      screen.getByRole("button", { name: /^draft$/i }),
    ).toBeInTheDocument();
  });

  it("shows an inline error when applying fails", async () => {
    mockGenerate.mockResolvedValue({
      ok: true,
      data: { proposal: { description: "Draft text." }, warnings: [] },
    });
    mockUpsertCell.mockResolvedValue({
      ok: false,
      error: "Could not save the field.",
    });
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: /^draft$/i }));
    await screen.findByRole("textbox", { name: /proposed description/i });
    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not save the field.");
  });
});
