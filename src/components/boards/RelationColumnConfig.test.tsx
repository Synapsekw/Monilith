import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RelationColumnConfig } from "./RelationColumnConfig";

const boards = [{ id: "b2", name: "Projects" }];

describe("RelationColumnConfig", () => {
  it("disables confirm until a target board is chosen", () => {
    const onConfirm = vi.fn();
    render(
      <RelationColumnConfig
        boards={boards}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    const add = screen.getByRole("button", { name: "Add column" });
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms with target board + allow_multiple (default true)", () => {
    const onConfirm = vi.fn();
    render(
      <RelationColumnConfig
        boards={boards}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Connect to board"), {
      target: { value: "b2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    expect(onConfirm).toHaveBeenCalledWith({
      target_board_id: "b2",
      allow_multiple: true,
    });
  });

  it("can disable allow_multiple", () => {
    const onConfirm = vi.fn();
    render(
      <RelationColumnConfig
        boards={boards}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Connect to board"), {
      target: { value: "b2" },
    });
    fireEvent.click(screen.getByLabelText("Allow linking multiple items"));
    fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    expect(onConfirm).toHaveBeenCalledWith({
      target_board_id: "b2",
      allow_multiple: false,
    });
  });
});
