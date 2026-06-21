import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RelationCell } from "./RelationCell";
import type { RelationLink } from "@/lib/boards/relations";

const mk = (id: string, name: string | null, pos: number): RelationLink => ({
  id,
  itemId: "i",
  columnId: "c",
  linkedItemId: `t-${id}`,
  linkedItemName: name,
  position: pos,
});

const base = {
  allowMultiple: true,
  loadCandidates: async () => [],
  onChange: () => {},
};

describe("RelationCell", () => {
  it("renders a chip per linked item up to the cap", () => {
    render(<RelationCell {...base} links={[mk("a", "Acquisition Q3", 0)]} />);
    expect(screen.getByText("Acquisition Q3")).toBeInTheDocument();
  });

  it("collapses overflow into +N more in stored order", () => {
    render(
      <RelationCell
        {...base}
        maxChips={2}
        links={[
          mk("c", "C", 2),
          mk("a", "A", 0),
          mk("b", "B", 1),
          mk("d", "D", 3),
        ]}
      />,
    );
    // sorted by position → A,B shown; C,D collapsed
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("+2 more")).toBeInTheDocument();
    expect(screen.queryByText("C")).not.toBeInTheDocument();
  });

  it("omits chips whose linked name is RLS-filtered (null)", () => {
    render(<RelationCell {...base} links={[mk("a", null, 0)]} />);
    expect(screen.queryByText(/t-a/)).not.toBeInTheDocument();
  });

  it("shows the add affordance when empty and editable", () => {
    render(<RelationCell {...base} links={[]} />);
    expect(
      screen.getByRole("button", { name: "Edit linked items" }),
    ).toBeInTheDocument();
  });

  it("read-only cells render chips but no editor button is disabled-interactive", () => {
    render(<RelationCell {...base} readOnly links={[mk("a", "A", 0)]} />);
    expect(
      screen.getByRole("button", { name: "Edit linked items" }),
    ).toBeDisabled();
  });
});
