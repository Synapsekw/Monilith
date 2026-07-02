import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RelationPicker } from "./RelationPicker";

const candidates = [
  { id: "b1", name: "Acquisition Q3" },
  { id: "b2", name: "Mobile App" },
];

describe("RelationPicker", () => {
  it("renders candidates and marks the selected one", () => {
    render(
      <RelationPicker
        candidates={candidates}
        selectedIds={["b1"]}
        searchValue=""
        onToggle={() => {}}
        onSearch={() => {}}
        allowMultiple
      />,
    );
    expect(screen.getByText("Acquisition Q3")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Acquisition Q3/ }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /Mobile App/ })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("toggles on click and searches on input", () => {
    const onToggle = vi.fn();
    const onSearch = vi.fn();
    render(
      <RelationPicker
        candidates={candidates}
        selectedIds={[]}
        searchValue=""
        onToggle={onToggle}
        onSearch={onSearch}
        allowMultiple
      />,
    );
    fireEvent.click(screen.getByText("Mobile App"));
    expect(onToggle).toHaveBeenCalledWith("b2");
    fireEvent.change(screen.getByLabelText("Search items to link"), {
      target: { value: "mob" },
    });
    expect(onSearch).toHaveBeenCalledWith("mob");
  });

  it("shows an empty state", () => {
    render(
      <RelationPicker
        candidates={[]}
        selectedIds={[]}
        searchValue=""
        onToggle={() => {}}
        onSearch={() => {}}
        allowMultiple
      />,
    );
    expect(screen.getByText("No items found.")).toBeInTheDocument();
  });
});
