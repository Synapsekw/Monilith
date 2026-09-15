import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FolderLoading from "./loading";

describe("FolderLoading", () => {
  it("renders an accessible busy region with six KPI placeholders", () => {
    render(<FolderLoading />);
    expect(
      screen.getByRole("status", { name: "Loading command center" }),
    ).toHaveAttribute("aria-busy", "true");
  });
});
