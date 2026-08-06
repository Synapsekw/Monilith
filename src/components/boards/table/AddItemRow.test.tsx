import { render, screen } from "@testing-library/react";
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
});
