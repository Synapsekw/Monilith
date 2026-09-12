import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddItemRow } from "./AddItemRow";
import { NAME_FREEZE_RULE } from "@/components/boards/SummaryRow";
import type { CellControls } from "./shared";

// AddItemRow only ever touches `controls.addItem`; the rest of the bundle is
// irrelevant to the access gate under test.
const controls = { addItem: vi.fn() } as unknown as CellControls;

describe("AddItemRow", () => {
  it("renders the add-item affordance for editors", () => {
    render(
      <AddItemRow groupId="g1" controls={controls} nameWidth={240} canEdit />,
    );
    expect(screen.getByLabelText("Add item")).toBeInTheDocument();
  });

  it("renders nothing at all for viewers (read-only / offline boards)", () => {
    const { container } = render(
      <AddItemRow
        groupId="g1"
        controls={controls}
        nameWidth={240}
        canEdit={false}
      />,
    );
    // Not merely disabled — absent, so the e2e offline spec's
    // getByLabel("Add item") has count 0.
    expect(screen.queryByLabelText("Add item")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  // ── Optimistic add ────────────────────────────────────────────────────────
  // The row is painted by the mutation's `onMutate`, so the input must not wait
  // for the round-trip: it clears, stays enabled and keeps focus at once.
  it("clears the input and keeps it enabled + focused before the add resolves", async () => {
    const user = userEvent.setup();
    // Never invokes its callbacks — stands in for an in-flight round-trip.
    const addItem = vi.fn();
    render(
      <AddItemRow
        groupId="g1"
        controls={{ addItem } as unknown as CellControls}
        nameWidth={240}
        canEdit
      />,
    );

    const input = screen.getByLabelText("Add item");
    await user.type(input, "Ship it{Enter}");

    expect(addItem).toHaveBeenCalledWith(
      { groupId: "g1", name: "Ship it" },
      expect.anything(),
    );
    expect(input).toHaveValue("");
    expect(input).toBeEnabled();
    expect(input).toHaveFocus();
  });

  it("restores the typed text and shows the error when the add fails", async () => {
    const user = userEvent.setup();
    const addItem = vi.fn(
      (
        _vars: { groupId: string; name: string },
        cbs?: { onError?: (e: Error) => void },
      ) => cbs?.onError?.(new Error("Could not create item.")),
    );
    render(
      <AddItemRow
        groupId="g1"
        controls={{ addItem } as unknown as CellControls}
        nameWidth={240}
        canEdit
      />,
    );

    const input = screen.getByLabelText("Add item");
    await user.type(input, "Ship it{Enter}");

    expect(input).toHaveValue("Ship it");
    // The failed name is in the message, so it survives even when the text is
    // not restored (see the next case).
    expect(screen.getByRole("alert")).toHaveTextContent(
      `Couldn't add "Ship it" — Could not create item.`,
    );
  });

  it("does not clobber the next item the user already typed when the add fails", async () => {
    const user = userEvent.setup();
    let fail: (() => void) | null = null;
    const addItem = vi.fn(
      (
        _vars: { groupId: string; name: string },
        cbs?: { onError?: (e: Error) => void },
      ) => {
        fail = () => cbs?.onError?.(new Error("boom"));
      },
    );
    render(
      <AddItemRow
        groupId="g1"
        controls={{ addItem } as unknown as CellControls}
        nameWidth={240}
        canEdit
      />,
    );

    const input = screen.getByLabelText("Add item");
    await user.type(input, "First{Enter}");
    await user.type(input, "Second");
    await act(async () => fail!());

    expect(input).toHaveValue("Second");
    // The dropped name is still recoverable from the message.
    expect(screen.getByRole("alert")).toHaveTextContent(
      `Couldn't add "First" — boom`,
    );
  });

  it("renders the dashed add affordance", () => {
    const { container } = render(
      <AddItemRow groupId="g1" controls={controls} nameWidth={240} canEdit />,
    );
    const plus = container.querySelector("[data-testid='add-affordance']");
    expect(plus?.className).toContain("border-dashed");
  });

  it("keeps the frozen name-column element sticky under a full-width separator host", () => {
    const { container } = render(
      <AddItemRow groupId="g1" controls={controls} nameWidth={240} canEdit />,
    );
    // Regression guard for a tailwind-merge trap: ROW_HAIRLINE opens with
    // `relative`, which shares a conflict group with `sticky` — merging both
    // onto one element's class list drops whichever loses the group, so the
    // hairline lives on a full-width OUTER host and `sticky` stays on the
    // INNER, name-width-constrained element untouched.
    const host = container.firstElementChild as HTMLElement;
    expect(host.className).toContain("before:left-4");
    expect(host.className).toContain("w-full");
    const sticky = host.querySelector(".sticky") as HTMLElement | null;
    expect(sticky).not.toBeNull();
    expect(sticky!.className).toContain("sticky");
    expect(sticky!.className).toContain("left-0");
  });

  it("puts the permanent Name-column right-edge hairline on the inner sticky element, not the full-width host", () => {
    const { container } = render(
      <AddItemRow groupId="g1" controls={controls} nameWidth={240} canEdit />,
    );
    const host = container.firstElementChild as HTMLElement;
    const sticky = host.querySelector(".sticky") as HTMLElement;
    for (const cls of NAME_FREEZE_RULE.split(" ")) {
      expect(sticky.className).toContain(cls);
    }
    // The full-width host spans the whole row — a border here would draw a
    // stray vertical line at the far right of the board, not at the Name
    // column's edge (the same reason AddSubitemRow is excluded entirely).
    expect(host.className).not.toMatch(/\bborder-r\b/);
  });
});
