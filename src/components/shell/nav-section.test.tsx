import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavSection } from "./nav-section";
import { useUIStore } from "@/stores/ui";

// Reset persisted collapse state so per-key state can't leak between cases.
beforeEach(() => {
  useUIStore.setState({ collapsedSections: {} });
});

function renderSection() {
  return render(
    <NavSection storageKey="planning" title="Planning">
      <a href="/goals">Goals</a>
    </NavSection>,
  );
}

describe("NavSection", () => {
  it("defaults to expanded with a resolvable aria-controls target", () => {
    renderSection();
    const toggle = screen.getByRole("button", { name: /collapse planning/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const bodyId = toggle.getAttribute("aria-controls");
    expect(bodyId).toBe("nav-section-planning");
    const body = document.getElementById(bodyId!);
    expect(body).not.toBeNull();
    expect(body).not.toHaveAttribute("hidden");
  });

  it("keeps the body element in the DOM (hidden) when collapsed", async () => {
    renderSection();
    await userEvent.click(
      screen.getByRole("button", { name: /collapse planning/i }),
    );
    const toggle = screen.getByRole("button", { name: /expand planning/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const body = document.getElementById("nav-section-planning");
    // aria-controls must still resolve to a real (hidden) element.
    expect(body).not.toBeNull();
    expect(body).toHaveAttribute("hidden");
  });

  it("gives the title toggle button matching aria-expanded/controls", () => {
    renderSection();
    const titleBtn = screen.getByRole("button", { name: "Planning" });
    expect(titleBtn).toHaveAttribute("aria-expanded", "true");
    expect(titleBtn).toHaveAttribute("aria-controls", "nav-section-planning");
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
