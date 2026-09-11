import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavSection } from "./nav-section";
import { useUIStore } from "@/stores/ui";

beforeEach(() => {
  useUIStore.setState({ collapsedSections: {} });
});

function renderSection() {
  return render(
    <NavSection
      storageKey="planning"
      title="Planning"
      action={<button>add</button>}
    >
      <a href="/goals">Goals</a>
    </NavSection>,
  );
}

describe("NavSection (ledger header)", () => {
  it("is one toggle button named by the title, with a resolvable aria-controls", () => {
    renderSection();
    const toggle = screen.getByRole("button", { name: "Planning" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", "nav-section-planning");
    expect(document.getElementById("nav-section-planning")).not.toHaveAttribute(
      "hidden",
    );
    // Exactly one toggle — the old chevron button + title button pair is gone.
    expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(1);
  });

  it("keeps the body in the DOM (hidden) when collapsed and persists the key", async () => {
    renderSection();
    await userEvent.click(screen.getByRole("button", { name: "Planning" }));
    expect(screen.getByRole("button", { name: "Planning" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(document.getElementById("nav-section-planning")).toHaveAttribute(
      "hidden",
    );
    expect(useUIStore.getState().collapsedSections["planning"]).toBe(true);
  });

  it("renders the label as a mono Keystone kicker on the 36px text edge", () => {
    renderSection();
    const label = screen.getByText("Planning");
    expect(label.className).toContain("font-mono");
    expect(label).toHaveClass("text-kicker", "uppercase");
    const header = screen.getByRole("button", {
      name: "Planning",
    }).parentElement!;
    expect(header.className).toContain("pl-7");
  });

  it("draws a hairline rule that brightens on hover, and no section icon", () => {
    const { container } = renderSection();
    const rule = container.querySelector("[data-nav-rule]") as HTMLElement;
    expect(rule).not.toBeNull();
    expect(rule.className).toContain("bg-border");
    expect(rule.className).toContain("group-hover/sec:bg-border-bright");
    expect(rule.className).toContain("ease-keystone");
    expect(container.querySelector("svg.lucide-folder-kanban")).toBeNull();
  });

  it("hides the chevron until hover while open, shows it while closed, always on touch", async () => {
    renderSection();
    const chevron = () =>
      document.querySelector("[data-nav-chevron]") as HTMLElement;
    expect(chevron().className).toContain("opacity-0");
    expect(chevron().className).toContain("group-hover/sec:opacity-100");
    expect(chevron().className).toContain("pointer-coarse:opacity-100");
    await userEvent.click(screen.getByRole("button", { name: "Planning" }));
    expect(chevron().className).not.toContain("opacity-0");
    expect(chevron().className).toContain("-rotate-90");
  });

  it("keeps the action outside the toggle button", () => {
    renderSection();
    const toggle = screen.getByRole("button", { name: "Planning" });
    expect(toggle).not.toContainElement(
      screen.getByRole("button", { name: "add" }),
    );
  });

  it("renders the title as a link when titleHref is set, with a separate toggle", async () => {
    render(
      <NavSection storageKey="dash" title="Dashboards" titleHref="/dashboards">
        <span>child</span>
      </NavSection>,
    );
    expect(screen.getByRole("link", { name: "Dashboards" })).toHaveAttribute(
      "href",
      "/dashboards",
    );
    const toggle = screen.getByRole("button", { name: /collapse dashboards/i });
    expect(toggle).toHaveAttribute("aria-controls", "nav-section-dash");
    await userEvent.click(toggle);
    expect(
      screen.getByRole("button", { name: /expand dashboards/i }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});
