import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "@/components/goals/ProgressBar";

describe("ProgressBar", () => {
  it("renders the fill with keystone transition classes and the data-driven width", () => {
    const { container } = render(<ProgressBar progress={0.5} />);
    const fill = container.querySelector(".bg-primary");
    expect(fill).not.toBeNull();
    expect(fill).toHaveClass("bg-primary");
    expect(fill).toHaveClass("rounded-full");
    expect(fill).toHaveClass("ease-keystone");
    expect(fill).toHaveStyle({ width: "50%" });
  });

  it("shows n/a when progress is null", () => {
    const { getByText } = render(<ProgressBar progress={null} />);
    expect(getByText("n/a")).toBeInTheDocument();
  });
});
