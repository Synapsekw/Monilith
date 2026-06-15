import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DateCell,
  DropdownCell,
  NumberCell,
  PeopleCell,
  StatusCell,
  TextCell,
} from "./index";

const statusSettings = {
  options: [{ id: "o1", label: "Done", color: "#00c875" }],
};

describe("cell renderers (read-only, 2a)", () => {
  it("TextCell shows the text value", () => {
    render(<TextCell value={{ text: "Hello" }} settings={{}} />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("TextCell renders an empty cell when value is null", () => {
    const { container } = render(<TextCell value={null} settings={{}} />);
    expect(container.textContent).toBe("");
  });

  it("StatusCell shows the matching option label", () => {
    render(<StatusCell value={{ optionId: "o1" }} settings={statusSettings} />);
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("StatusCell shows nothing for a null optionId", () => {
    const { container } = render(
      <StatusCell value={{ optionId: null }} settings={statusSettings} />,
    );
    expect(container.textContent).toBe("");
  });

  it("DropdownCell shows all selected option labels", () => {
    render(
      <DropdownCell value={{ optionIds: ["o1"] }} settings={statusSettings} />,
    );
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("PeopleCell shows the count of assignees", () => {
    render(<PeopleCell value={{ userIds: ["u1", "u2"] }} settings={{}} />);
    expect(screen.getByText(/2/)).toBeInTheDocument();
  });

  it("DateCell shows the formatted date", () => {
    render(<DateCell value={{ date: "2026-06-15" }} settings={{}} />);
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it("NumberCell shows the number with its unit", () => {
    render(<NumberCell value={{ n: 42 }} settings={{ unit: "$" }} />);
    expect(screen.getByText(/42/)).toBeInTheDocument();
  });

  it("renderers do not expose editing affordances in 2a", () => {
    render(<TextCell value={{ text: "x" }} settings={{}} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
