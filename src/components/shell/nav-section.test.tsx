import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavSection } from "./nav-section";
import { useUIStore } from "@/stores/ui";

beforeEach(() => useUIStore.setState({ collapsedSections: {} }));

describe("NavSection", () => {
  it("renders children when open (default)", () => {
    render(
      <NavSection storageKey="planning" title="Planning">
        <a href="/goals">Goals</a>
      </NavSection>,
    );
    expect(screen.getByText("Goals")).toBeInTheDocument();
  });

  it("hides children after toggling collapsed", async () => {
    render(
      <NavSection storageKey="planning" title="Planning">
        <a href="/goals">Goals</a>
      </NavSection>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /collapse planning/i }),
    );
    expect(screen.queryByText("Goals")).not.toBeInTheDocument();
  });

  it("renders the title as a link when titleHref is set", () => {
    render(
      <NavSection storageKey="dash" title="Dashboards" titleHref="/dashboards">
        <span>child</span>
      </NavSection>,
    );
    expect(screen.getByRole("link", { name: "Dashboards" })).toHaveAttribute(
      "href",
      "/dashboards",
    );
  });
});
