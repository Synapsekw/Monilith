import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MirrorColumnConfig } from "./MirrorColumnConfig";

const relCols = [{ id: "rel1", name: "Projects", target_board_id: "boardB" }];

describe("MirrorColumnConfig", () => {
  it("shows an empty state when the board has no relation column", () => {
    render(
      <MirrorColumnConfig
        relationColumns={[]}
        loadTargetColumns={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Add a Relation column first/i),
    ).toBeInTheDocument();
  });

  it("disables confirm until both selects are set, then emits settings", async () => {
    const loadTargetColumns = vi
      .fn()
      .mockResolvedValue([{ id: "tcol", name: "Status", kind: "status" }]);
    const onConfirm = vi.fn();
    render(
      <MirrorColumnConfig
        relationColumns={relCols}
        loadTargetColumns={loadTargetColumns}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /add column/i }),
    ).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/source relation/i), {
      target: { value: "rel1" },
    });
    await waitFor(() =>
      expect(loadTargetColumns).toHaveBeenCalledWith("boardB"),
    );
    await waitFor(() => screen.getByRole("option", { name: "Status" }));

    fireEvent.change(screen.getByLabelText(/column to mirror/i), {
      target: { value: "tcol" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add column/i }));
    expect(onConfirm).toHaveBeenCalledWith({
      source_relation_column_id: "rel1",
      target_column_id: "tcol",
    });
  });
});
