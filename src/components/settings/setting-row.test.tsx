import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SettingRow } from "./setting-row";

describe("SettingRow", () => {
  it("renders label, description and control", () => {
    render(
      <SettingRow label="Full name" description="Shown to teammates.">
        <input aria-label="name input" />
      </SettingRow>,
    );
    expect(screen.getByText("Full name")).toBeInTheDocument();
    expect(screen.getByText("Shown to teammates.")).toBeInTheDocument();
    expect(screen.getByLabelText("name input")).toBeInTheDocument();
  });

  it("associates the label with the control when htmlFor is given", () => {
    render(
      <SettingRow label="Time zone" htmlFor="tz">
        <input id="tz" />
      </SettingRow>,
    );
    expect(screen.getByLabelText("Time zone")).toHaveAttribute("id", "tz");
  });

  it("omits the description paragraph when none is given", () => {
    const { container } = render(
      <SettingRow label="Email">
        <span>a@b.c</span>
      </SettingRow>,
    );
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });
});
