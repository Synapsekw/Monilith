import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FooterCell, FooterValue } from "./FooterCell";
import { allowedAggregations } from "@/lib/boards/aggregation";

describe("FooterValue", () => {
  it("renders a plain number", () => {
    render(<FooterValue result={{ kind: "number", value: 30 }} />);
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("renders a percent as a colorized fill bar with a % label", () => {
    render(
      <FooterValue result={{ kind: "number", value: 67, style: "percent" }} />,
    );
    // mirrors the cell: PercentBar (progressbar + "%" text), not plain text
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "67",
    );
  });

  it("renders a checked/total", () => {
    render(<FooterValue result={{ kind: "checkbox", checked: 2, total: 3 }} />);
    expect(screen.getByText("2/3")).toBeInTheDocument();
  });

  it("renders nothing when empty", () => {
    const { container } = render(<FooterValue result={{ kind: "empty" }} />);
    expect(container.textContent).toBe("");
  });
});

describe("FooterCell", () => {
  const numberValues = [{ n: 10 }, { n: 5 }, { n: 15 }];

  it("computes and shows the chosen aggregate with its label", () => {
    render(
      <FooterCell
        aggregateKind="numbers"
        values={numberValues}
        current="sum"
        allowed={allowedAggregations("numbers")}
        canEdit={false}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Sum")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("shows a Summary affordance only for editors when unset", () => {
    const { rerender } = render(
      <FooterCell
        aggregateKind="numbers"
        values={numberValues}
        allowed={allowedAggregations("numbers")}
        canEdit
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Summary")).toBeInTheDocument();

    rerender(
      <FooterCell
        aggregateKind="numbers"
        values={numberValues}
        allowed={allowedAggregations("numbers")}
        canEdit={false}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByText("Summary")).not.toBeInTheDocument();
  });

  it("offers the allowed aggregations and clears via None", async () => {
    const onChange = vi.fn();
    const { userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(
      <FooterCell
        aggregateKind="numbers"
        values={numberValues}
        current="sum"
        allowed={allowedAggregations("numbers")}
        canEdit
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button"));
    await user.click(screen.getByText("Average"));
    expect(onChange).toHaveBeenCalledWith("avg");
  });

  it("does not render a picker trigger for non-editors", () => {
    render(
      <FooterCell
        aggregateKind="numbers"
        values={numberValues}
        current="sum"
        allowed={allowedAggregations("numbers")}
        canEdit={false}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
