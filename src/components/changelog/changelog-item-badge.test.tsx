import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChangelogItemBadge } from "./changelog-item-badge";

describe("ChangelogItemBadge", () => {
  it("renders the human label for each kind", () => {
    const { rerender } = render(<ChangelogItemBadge kind="new" />);
    expect(screen.getByText("New")).toBeInTheDocument();
    rerender(<ChangelogItemBadge kind="improved" />);
    expect(screen.getByText("Improved")).toBeInTheDocument();
    rerender(<ChangelogItemBadge kind="fixed" />);
    expect(screen.getByText("Fixed")).toBeInTheDocument();
  });
});
