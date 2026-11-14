import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThreadHeader } from "./ThreadHeader";

describe("ThreadHeader", () => {
  it("names the thread and the org assistant, with no persona switcher", () => {
    render(<ThreadHeader title="Q3 slippage" />);
    expect(screen.getByText("Q3 slippage")).toBeInTheDocument();
    expect(screen.getByText("Monolith assistant")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names the speaker instead when a Mono answers", () => {
    render(
      <ThreadHeader
        title="Q3 slippage"
        speaker={{ name: "Aria", tint: "#ff6fa8" }}
      />,
    );
    expect(screen.getByText("Aria")).toBeInTheDocument();
    expect(screen.queryByText("Monolith assistant")).toBeNull();
  });
});
