import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const updateBoardWorkSettings = vi.fn();
vi.mock("@/lib/boards/actions/work-settings", () => ({
  updateBoardWorkSettings: (...a: unknown[]) => updateBoardWorkSettings(...a),
}));

import { WorkTrackingDialog } from "./WorkTrackingDialog";

const BOARD = "11111111-1111-4111-8111-111111111111";
const STATUS_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_STATUS_ID = "77777777-7777-4777-8777-777777777777";
const DUE_ID = "44444444-4444-4444-8444-444444444444";

const columns = [
  {
    id: OTHER_STATUS_ID,
    name: "Priority",
    kind: "status",
    position: 2,
    settings: {
      options: [
        { id: "p1", label: "High", color: "#e2445c" },
        { id: "p2", label: "Low", color: "#579bfc" },
      ],
    },
  },
  {
    id: STATUS_ID,
    name: "Status",
    kind: "status",
    position: 1,
    settings: {
      options: [
        { id: "o1", label: "Working", color: "#fdab3d" },
        { id: "o2", label: "Done", color: "#00c875" },
        { id: "o3", label: "Completed", color: "#00c875" },
      ],
    },
  },
  { id: DUE_ID, name: "Due", kind: "date", position: 3, settings: {} },
  { id: "t1", name: "Notes", kind: "text", position: 4, settings: {} },
];

const AUTOMATIC = {
  statusColumnId: null,
  doneOptionIds: null,
  dueColumnId: null,
};

function setup(
  props: Partial<React.ComponentProps<typeof WorkTrackingDialog>> = {},
) {
  const onOpenChange = vi.fn();
  render(
    <WorkTrackingDialog
      open
      onOpenChange={onOpenChange}
      boardId={BOARD}
      columns={columns}
      current={AUTOMATIC}
      {...props}
    />,
  );
  return { onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  updateBoardWorkSettings.mockResolvedValue({ ok: true, data: undefined });
});

describe("WorkTrackingDialog", () => {
  it("shows the automatic guesses when nothing is chosen", () => {
    setup();
    expect(screen.getByLabelText("Status column")).toHaveDisplayValue(
      "Automatic (Status)",
    );
    expect(screen.getByLabelText("Due date column")).toHaveDisplayValue(
      "Automatic (Due)",
    );
    expect(screen.getByText(/currently treated as done/i)).toHaveTextContent(
      "Done, Completed",
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("offers only status columns as status and only date columns as due", () => {
    setup();
    const status = screen.getByLabelText("Status column");
    const due = screen.getByLabelText("Due date column");
    expect(status).not.toHaveTextContent("Notes");
    expect(status).not.toHaveTextContent("Due");
    expect(due).toHaveTextContent("Due");
    expect(due).not.toHaveTextContent("Status");
  });

  it("saves the chosen status column and ticked done option", async () => {
    const user = userEvent.setup();
    setup();
    await user.selectOptions(screen.getByLabelText("Status column"), STATUS_ID);
    await user.click(screen.getByRole("checkbox", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateBoardWorkSettings).toHaveBeenCalledWith({
        boardId: BOARD,
        statusColumnId: STATUS_ID,
        doneOptionIds: ["o2"],
        dueColumnId: null,
      }),
    );
  });

  it("starts from the saved selection", () => {
    setup({
      current: {
        statusColumnId: STATUS_ID,
        doneOptionIds: ["o3"],
        dueColumnId: DUE_ID,
      },
    });
    expect(screen.getByLabelText("Status column")).toHaveDisplayValue("Status");
    expect(screen.getByRole("checkbox", { name: "Completed" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Done" })).not.toBeChecked();
    expect(screen.getByLabelText("Due date column")).toHaveDisplayValue("Due");
  });

  it("clears the done options when the status column goes back to automatic", async () => {
    const user = userEvent.setup();
    setup({
      current: {
        statusColumnId: STATUS_ID,
        doneOptionIds: ["o2"],
        dueColumnId: null,
      },
    });
    expect(screen.getByRole("checkbox", { name: "Done" })).toBeChecked();
    await user.selectOptions(screen.getByLabelText("Status column"), "");
    expect(screen.queryByRole("checkbox")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateBoardWorkSettings).toHaveBeenCalledWith({
        boardId: BOARD,
        statusColumnId: null,
        doneOptionIds: null,
        dueColumnId: null,
      }),
    );
  });

  it("drops ticked options when a different status column is chosen", async () => {
    const user = userEvent.setup();
    setup({
      current: {
        statusColumnId: STATUS_ID,
        doneOptionIds: ["o2"],
        dueColumnId: null,
      },
    });
    await user.selectOptions(
      screen.getByLabelText("Status column"),
      OTHER_STATUS_ID,
    );
    expect(screen.getByRole("checkbox", { name: "High" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateBoardWorkSettings).toHaveBeenCalledWith({
        boardId: BOARD,
        statusColumnId: OTHER_STATUS_ID,
        doneOptionIds: null,
        dueColumnId: null,
      }),
    );
  });

  it("shows the error and stays open when the save fails", async () => {
    const user = userEvent.setup();
    updateBoardWorkSettings.mockResolvedValue({ ok: false, error: "x" });
    const { onOpenChange } = setup();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("x")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("closes and reports the saved values on success", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const { onOpenChange } = setup({ onSaved });
    await user.selectOptions(screen.getByLabelText("Due date column"), DUE_ID);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSaved).toHaveBeenCalledWith({
      statusColumnId: null,
      doneOptionIds: null,
      dueColumnId: DUE_ID,
    });
  });

  it("explains a board with no status column", () => {
    setup({ columns: columns.filter((c) => c.kind !== "status") });
    expect(
      screen.getByText(
        "This board has no status column, so every item counts as open.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByLabelText("Status column")).toBeNull();
  });
});
