import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddSubitemRow } from "./AddSubitemRow";
import { NAME_FREEZE_RULE } from "@/components/boards/SummaryRow";
import type { CellControls } from "./shared";

// AddSubitemRow only ever touches `controls.addSubitem`.
function renderRow(addSubitem: CellControls["addSubitem"]) {
  render(
    <AddSubitemRow
      parentId="p1"
      controls={{ addSubitem } as unknown as CellControls}
      nameWidth={240}
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
        nameWidth={240}
      />,
    );
    const plus = container.querySelector("[data-testid='add-affordance']");
    expect(plus?.className).toContain("border-dashed");
  });

  it("keeps the frozen name-column element sticky under a full-width separator host", () => {
    // Same shape as AddItemRow: the OUTER host spans the full row width and
    // carries only the top hairline; the INNER element is `sticky` and
    // capped to `width: nameWidth`.
    const { container } = render(
      <AddSubitemRow
        parentId="p1"
        controls={{ addSubitem: vi.fn() } as unknown as CellControls}
        nameWidth={240}
      />,
    );
    const host = container.firstElementChild as HTMLElement;
    expect(host.className).toContain("before:left-4");
    expect(host.className).toContain("w-full");
    const sticky = host.querySelector(".sticky") as HTMLElement | null;
    expect(sticky).not.toBeNull();
    expect(sticky!.className).toContain("sticky");
    expect(sticky!.className).toContain("left-0");
  });

  it("puts the permanent Name-column right-edge hairline on the inner sticky element, not the full-width host", () => {
    // Regression guard: a bare `border-r` on the full-width host (or no rule
    // at all) is exactly the "hole in the line" bug — the Name-column
    // hairline must be continuous through this row too, not just skip it.
    const { container } = render(
      <AddSubitemRow
        parentId="p1"
        controls={{ addSubitem: vi.fn() } as unknown as CellControls}
        nameWidth={240}
      />,
    );
    const host = container.firstElementChild as HTMLElement;
    const sticky = host.querySelector(".sticky") as HTMLElement;
    for (const cls of NAME_FREEZE_RULE.split(" ")) {
      expect(sticky.className).toContain(cls);
    }
    // The full-width host itself must NOT carry the rule — that was the
    // original (correct) reasoning for excluding this element entirely,
    // before the fix moved the rule onto the inner, Name-width-capped node.
    expect(host.className).not.toMatch(/\bborder-r\b/);
  });

  it("keeps the sunken background and left indent unchanged on the inner element", () => {
    const { container } = render(
      <AddSubitemRow
        parentId="p1"
        controls={{ addSubitem: vi.fn() } as unknown as CellControls}
        nameWidth={240}
      />,
    );
    const host = container.firstElementChild as HTMLElement;
    const sticky = host.querySelector(".sticky") as HTMLElement;
    expect(sticky.className).toContain("bg-surface-sunken");
    expect(sticky.className).toContain("pl-10");
    expect(sticky.className).toContain("pr-4");
  });
});
