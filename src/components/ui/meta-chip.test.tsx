// src/components/ui/meta-chip.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetaChip } from "./meta-chip";

describe("MetaChip", () => {
  it("renders an uppercased mono label and its value", () => {
    render(<MetaChip label="Due">Jul 14</MetaChip>);
    const label = screen.getByText("Due");
    // label carries the kicker recipe (mono + kicker color + uppercase)
    expect(label).toHaveClass("font-mono", "text-kicker", "uppercase");
    // value is rendered and readable
    expect(screen.getByText("Jul 14")).toBeInTheDocument();
  });

  it("applies the accent tone to the value when tone='accent'", () => {
    render(
      <MetaChip label="Status" tone="accent">
        Working
      </MetaChip>,
    );
    expect(screen.getByText("Working")).toHaveClass("text-primary");
  });

  it("merges a passed className onto the root", () => {
    const { container } = render(
      <MetaChip label="Owner" className="test-hook">
        Synapse
      </MetaChip>,
    );
    expect(container.firstChild).toHaveClass("test-hook");
  });
});
