import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddItemRow } from "./AddItemRow";
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
});
