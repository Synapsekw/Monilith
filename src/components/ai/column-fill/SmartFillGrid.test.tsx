import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  SmartFillGrid,
  type PreviewRow,
  type TargetOption,
} from "./SmartFillGrid";

const options: TargetOption[] = [
  { id: "opt-todo", label: "To do", color: "#6b7280" },
  { id: "opt-done", label: "Done", color: "#22c55e" },
];

const preview: PreviewRow[] = [
  {
    itemId: "item-1",
    itemName: "Item One",
    sourceText: "please start soon",
    proposedOptionId: "opt-todo",
  },
  {
    itemId: "item-2",
    itemName: "Item Two",
    sourceText: "already finished",
    proposedOptionId: "opt-done",
  },
  {
    itemId: "item-3",
    itemName: "Item Three",
    sourceText: "unclear text",
    proposedOptionId: null,
  },
];

function renderGrid(
  overrides: Partial<Parameters<typeof SmartFillGrid>[0]> = {},
) {
  const onApply = vi.fn();
  const onBack = vi.fn();
  render(
    <SmartFillGrid
      preview={preview}
      options={options}
      onApply={onApply}
      onBack={onBack}
      {...overrides}
    />,
  );
  return { onApply, onBack };
}

describe("SmartFillGrid", () => {
  it("renders one row per preview item with source text and the proposed chip", () => {
    renderGrid();
    expect(screen.getByText("please start soon")).toBeInTheDocument();
    expect(screen.getByText("already finished")).toBeInTheDocument();
    expect(screen.getByText("unclear text")).toBeInTheDocument();
    expect(screen.getByText("To do", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Done", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText(/no match/i)).toBeInTheDocument();
  });

  it("accepts rows with a proposed option by default and leaves unclassified rows off", () => {
    renderGrid();
    expect(
      screen.getByRole("checkbox", { name: /accept item one/i }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /accept item two/i }),
    ).toBeChecked();
    const unclassified = screen.getByRole("checkbox", {
      name: /accept item three/i,
    });
    expect(unclassified).not.toBeChecked();
    expect(unclassified).toBeDisabled();

    expect(screen.getByRole("button", { name: "Apply 2" })).toBeInTheDocument();
  });

  it("deselecting a row removes it from Apply N and from the applied assignments", async () => {
    const user = userEvent.setup();
    const { onApply } = renderGrid();

    await user.click(
      screen.getByRole("checkbox", { name: /accept item one/i }),
    );
    expect(screen.getByRole("button", { name: "Apply 1" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apply 1" }));
    expect(onApply).toHaveBeenCalledWith([
      { itemId: "item-2", optionId: "opt-done" },
    ]);
  });

  it("lets the user override the proposed option, enabling and including the row", async () => {
    const user = userEvent.setup();
    const { onApply } = renderGrid();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /value for item three/i }),
      "opt-todo",
    );
    expect(
      screen.getByRole("checkbox", { name: /accept item three/i }),
    ).toBeChecked();
    expect(screen.getByRole("button", { name: "Apply 3" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apply 3" }));
    expect(onApply).toHaveBeenCalledWith(
      expect.arrayContaining([{ itemId: "item-3", optionId: "opt-todo" }]),
    );
  });

  it("disables Apply when nothing is accepted", async () => {
    const user = userEvent.setup();
    renderGrid();

    await user.click(
      screen.getByRole("checkbox", { name: /accept item one/i }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: /accept item two/i }),
    );

    expect(screen.getByRole("button", { name: "Apply 0" })).toBeDisabled();
  });

  it("renders an empty state without crashing when there is nothing to classify", () => {
    renderGrid({ preview: [] });
    expect(screen.getByText(/nothing to classify/i)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("surfaces warnings and an apply error without crashing", () => {
    renderGrid({
      warnings: ["2 rows were skipped: no confident match."],
      applyError: "Couldn't apply Smart Fill. Please try again.",
    });
    expect(
      screen.getByText("2 rows were skipped: no confident match."),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't apply Smart Fill. Please try again.",
    );
  });
});
