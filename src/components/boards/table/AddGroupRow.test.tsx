import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AddGroupRow } from "./AddGroupRow";

describe("AddGroupRow", () => {
  it("renders the add-group button for editors", () => {
    render(<AddGroupRow onAdd={vi.fn()} canEdit />);
    expect(
      screen.getByRole("button", { name: "Add group" }),
    ).toBeInTheDocument();
  });

  it("renders nothing at all for viewers (read-only / offline boards)", () => {
    const { container } = render(
      <AddGroupRow onAdd={vi.fn()} canEdit={false} />,
    );
    expect(
      screen.queryByRole("button", { name: "Add group" }),
    ).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
