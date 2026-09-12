import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddSubitemRow } from "./AddSubitemRow";
import type { CellControls } from "./shared";

// AddSubitemRow only ever touches `controls.addSubitem`.
function renderRow(addSubitem: CellControls["addSubitem"]) {
  render(
    <AddSubitemRow
      parentId="p1"
      controls={{ addSubitem } as unknown as CellControls}
    />,
  );
  return screen.getByLabelText("Add subitem");
}

describe("AddSubitemRow", () => {
  it("clears the input and keeps it enabled + focused before the add resolves", async () => {
    const user = userEvent.setup();
    // Never invokes its callbacks — stands in for an in-flight round-trip.
    const addSubitem = vi.fn();
    const input = renderRow(
      addSubitem as unknown as CellControls["addSubitem"],
    );

    await user.type(input, "Design{Enter}");

    expect(addSubitem).toHaveBeenCalledWith("p1", "Design", expect.anything());
    expect(input).toHaveValue("");
    expect(input).toBeEnabled();
    expect(input).toHaveFocus();
  });

  it("restores the typed text when the add fails", async () => {
    const user = userEvent.setup();
    let fail: (() => void) | null = null;
    const addSubitem = vi.fn(
      (
        _parentId: string,
        _name: string,
        cbs?: { onError?: (e: Error) => void },
      ) => {
        fail = () => cbs?.onError?.(new Error("boom"));
      },
    );
    const input = renderRow(
      addSubitem as unknown as CellControls["addSubitem"],
    );

    await user.type(input, "Design{Enter}");
    await act(async () => fail!());

    expect(input).toHaveValue("Design");
  });

  it("shows the failure inline, naming the subitem that failed", async () => {
    const user = userEvent.setup();
    const addSubitem = vi.fn(
      (
        _parentId: string,
        _name: string,
        cbs?: { onError?: (e: Error) => void },
      ) => cbs?.onError?.(new Error("Could not create item.")),
    );
    const input = renderRow(
      addSubitem as unknown as CellControls["addSubitem"],
    );

    await user.type(input, "Design{Enter}");

    expect(screen.getByRole("alert")).toHaveTextContent(
      `Couldn't add "Design" — Could not create item.`,
    );
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("renders the dashed add affordance", () => {
    const { container } = render(
      <AddSubitemRow
        parentId="p1"
        controls={{ addSubitem: vi.fn() } as unknown as CellControls}
      />,
    );
    const plus = container.querySelector("[data-testid='add-affordance']");
    expect(plus?.className).toContain("border-dashed");
  });

  it("keeps the row sticky under its own top hairline", () => {
    const { container } = render(
      <AddSubitemRow
        parentId="p1"
        controls={{ addSubitem: vi.fn() } as unknown as CellControls}
      />,
    );
    // Regression guard for a tailwind-merge trap: ROW_HAIRLINE opens with
    // `relative`, which shares a conflict group with `sticky` — ROW_HAIRLINE
    // must come FIRST in the cn() call so the literal `sticky` (later in the
    // list) wins the group instead of being silently dropped.
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toContain("sticky");
    expect(row.className).toContain("left-0");
    expect(row.className).toContain("before:left-4");
  });
});
