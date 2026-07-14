import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SmartFillDialog } from "./SmartFillDialog";
import { classifyColumn, applyColumnFill } from "@/lib/ai/column-fill/actions";
import type { CacheColumn } from "@/lib/boards/cache";

vi.mock("@/lib/ai/column-fill/actions", () => ({
  classifyColumn: vi.fn(),
  applyColumnFill: vi.fn(),
}));

const mockClassify = vi.mocked(classifyColumn);
const mockApply = vi.mocked(applyColumnFill);

function col(over: Partial<CacheColumn> = {}): CacheColumn {
  return {
    id: "c-text",
    org_id: "o",
    board_id: "b",
    kind: "text",
    name: "Notes",
    settings: {},
    position: 0,
    width: null,
    created_at: "2026-06-17T00:00:00Z",
    updated_at: "2026-06-17T00:00:00Z",
    ...over,
  } as CacheColumn;
}

const sourceColumn = col({ id: "c-text", name: "Notes", kind: "text" });
const statusColumn = col({
  id: "c-status",
  name: "Status",
  kind: "status",
  settings: {
    options: [
      { id: "opt-todo", label: "To do", color: "#6b7280" },
      { id: "opt-done", label: "Done", color: "#22c55e" },
    ],
  },
});
const dropdownColumn = col({
  id: "c-dropdown",
  name: "Priority",
  kind: "dropdown",
  settings: { options: [{ id: "opt-low", label: "Low", color: "#3b82f6" }] },
});
const otherTextColumn = col({
  id: "c-other",
  name: "Description",
  kind: "text",
});

const previewPayload = {
  preview: [
    {
      itemId: "item-1",
      itemName: "Item One",
      sourceText: "please start soon",
      proposedOptionId: "opt-todo",
    },
  ],
  warnings: [] as string[],
};

beforeEach(() => {
  vi.clearAllMocks();
});

function renderDialog(
  overrides: Partial<Parameters<typeof SmartFillDialog>[0]> = {},
) {
  const onClose = vi.fn();
  render(
    <SmartFillDialog
      boardId="board-1"
      sourceColumn={sourceColumn}
      targetColumns={[statusColumn, dropdownColumn, otherTextColumn]}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onClose };
}

describe("SmartFillDialog", () => {
  it("shows the privacy notice up front, before any classify call", () => {
    renderDialog();
    expect(screen.getByText(/sent to our ai provider/i)).toBeInTheDocument();
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it("lists only status and dropdown target columns", () => {
    renderDialog();
    expect(screen.getByRole("radio", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Priority" })).toBeInTheDocument();
    expect(
      screen.queryByRole("radio", { name: "Description" }),
    ).not.toBeInTheDocument();
  });

  it("disables Classify until a target column is picked", async () => {
    const user = userEvent.setup();
    renderDialog();
    const classifyBtn = screen.getByRole("button", { name: /^classify$/i });
    expect(classifyBtn).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: "Status" }));
    expect(classifyBtn).toBeEnabled();
  });

  it("classifies against the chosen target and renders the preview grid", async () => {
    mockClassify.mockResolvedValue({ ok: true, data: previewPayload });
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("radio", { name: "Status" }));
    await user.click(screen.getByRole("button", { name: /^classify$/i }));

    expect(mockClassify).toHaveBeenCalledWith({
      boardId: "board-1",
      sourceColumnId: "c-text",
      targetColumnId: "c-status",
    });
    expect(await screen.findByText("please start soon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply 1" })).toBeInTheDocument();
  });

  it("shows a thinking state while classification is pending", async () => {
    let resolve!: (v: Awaited<ReturnType<typeof classifyColumn>>) => void;
    mockClassify.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("radio", { name: "Status" }));
    await user.click(screen.getByRole("button", { name: /^classify$/i }));

    expect(
      await screen.findByRole("button", { name: /classifying/i }),
    ).toBeDisabled();

    resolve({ ok: true, data: previewPayload });
    expect(await screen.findByText("please start soon")).toBeInTheDocument();
  });

  it("renders a returned classify error inline without crashing", async () => {
    mockClassify.mockResolvedValue({
      ok: false,
      error: "Smart Fill needs an Anthropic key.",
    });
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("radio", { name: "Status" }));
    await user.click(screen.getByRole("button", { name: /^classify$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Smart Fill needs an Anthropic key.");
    expect(
      screen.getByRole("button", { name: /^classify$/i }),
    ).toBeInTheDocument();
  });

  it("applies only the accepted rows via applyColumnFill and closes on success", async () => {
    mockClassify.mockResolvedValue({ ok: true, data: previewPayload });
    mockApply.mockResolvedValue({
      ok: true,
      data: { succeeded: ["item-1"], failed: [] },
    });
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await user.click(screen.getByRole("radio", { name: "Status" }));
    await user.click(screen.getByRole("button", { name: /^classify$/i }));
    await screen.findByText("please start soon");

    await user.click(screen.getByRole("button", { name: "Apply 1" }));

    expect(mockApply).toHaveBeenCalledWith({
      targetColumnId: "c-status",
      assignments: [{ itemId: "item-1", optionId: "opt-todo" }],
    });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("renders an empty-board-state without crashing when there are no fillable columns", () => {
    renderDialog({ targetColumns: [otherTextColumn] });
    expect(
      screen.getByText(/add a status or dropdown column/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^classify$/i })).toBeDisabled();
  });
});
