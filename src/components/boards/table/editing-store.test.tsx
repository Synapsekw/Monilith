import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useEditingCell, useIsCellEditing } from "./editing-store";

function Probe({
  itemId,
  columnId,
  onRender,
}: {
  itemId: string;
  columnId: string;
  onRender: (editing: boolean) => void;
}) {
  onRender(useIsCellEditing(itemId, columnId));
  return null;
}

beforeEach(() => {
  act(() => useEditingCell.getState().setEditing(null));
});

describe("useIsCellEditing", () => {
  it("re-renders only the cells whose edit state changed", () => {
    const target = vi.fn();
    const sibling = vi.fn();
    render(
      <>
        <Probe itemId="i1" columnId="c1" onRender={target} />
        <Probe itemId="i2" columnId="c1" onRender={sibling} />
      </>,
    );
    expect(target).toHaveBeenCalledTimes(1);
    expect(sibling).toHaveBeenCalledTimes(1);

    act(() =>
      useEditingCell.getState().setEditing({ itemId: "i1", columnId: "c1" }),
    );

    // The edited cell flips to true; the sibling's slice never left `false`, so
    // it is not re-rendered. This is what keeps one click off ~300 cells.
    expect(target).toHaveBeenCalledTimes(2);
    expect(target).toHaveBeenLastCalledWith(true);
    expect(sibling).toHaveBeenCalledTimes(1);
  });

  it("matches on the item AND the column", () => {
    const seen = vi.fn();
    render(<Probe itemId="i1" columnId="c2" onRender={seen} />);
    act(() =>
      useEditingCell.getState().setEditing({ itemId: "i1", columnId: "c1" }),
    );
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenLastCalledWith(false);
  });

  it("keeps setEditing referentially stable across updates", () => {
    const { setEditing } = useEditingCell.getState();
    act(() => setEditing({ itemId: "i1", columnId: "c1" }));
    expect(useEditingCell.getState().setEditing).toBe(setEditing);
  });
});
