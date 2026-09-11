import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ListTodo } from "lucide-react";
import {
  RailDivider,
  SIDEBAR_LEAD_CLASS,
  SidebarLink,
  SidebarRow,
  railTileClass,
  sidebarLabelClass,
  sidebarRowClass,
} from "./sidebar-row";

describe("sidebarRowClass", () => {
  it("uses the Keystone tint + edge bar when active, never the 80% brand fill", () => {
    const active = sidebarRowClass({ active: true });
    expect(active).toContain("bg-state-selected");
    expect(active).toContain("text-foreground");
    expect(active).toContain("before:bg-primary");
    expect(active).toContain("before:-left-2");
    expect(active).not.toContain("bg-primary/80");
    expect(active).not.toMatch(/\bborder-primary/);
  });

  it("hovers with a fill, not a hairline", () => {
    const idle = sidebarRowClass({});
    expect(idle).toContain("hover:bg-state-hover");
    expect(idle).not.toContain("hover:border");
    expect(idle).toContain("text-muted-foreground");
  });

  it("carries no row-level gap or left padding (text edge comes from slot + label)", () => {
    for (const cls of [sidebarRowClass({}), sidebarRowClass({ child: true })]) {
      expect(cls).not.toMatch(/(^|\s)gap-/);
      expect(cls).not.toMatch(/(^|\s)pl-\d/);
    }
    expect(SIDEBAR_LEAD_CLASS).toContain("size-6");
    expect(sidebarLabelClass()).toContain("pl-1");
    expect(sidebarLabelClass(true)).toContain("pl-1");
  });

  it("sizes top-level rows 32px/text-sm and child rows 28px/text-xs", () => {
    expect(sidebarRowClass({})).toContain("min-h-8");
    expect(sidebarRowClass({ child: true })).toContain("min-h-7");
    expect(sidebarLabelClass()).toContain("text-sm");
    expect(sidebarLabelClass(true)).toContain("text-xs");
  });

  it("lets a caller override the bar offset for indented rows", () => {
    // tailwind-merge keeps the last conflicting utility.
    const cls = sidebarRowClass({ active: true, className: "before:-left-5" });
    expect(cls).toContain("before:-left-5");
    expect(cls).not.toContain("before:-left-2 ");
  });
});

describe("SidebarRow", () => {
  it("always renders the 24px lead slot first, even when no lead is given", () => {
    const { container } = render(<SidebarRow>label</SidebarRow>);
    const row = container.firstElementChild as HTMLElement;
    expect(row.firstElementChild?.className).toContain("size-6");
  });

  it("renders nothing in the slot position when lead is null", () => {
    const { container } = render(
      <SidebarRow lead={null}>
        <button className={SIDEBAR_LEAD_CLASS}>own</button>
      </SidebarRow>,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row.firstElementChild?.tagName).toBe("BUTTON");
  });

  it("forwards ref, style and data attributes (drag layer contract)", () => {
    let node: HTMLDivElement | null = null;
    render(
      <SidebarRow
        ref={(n) => {
          node = n;
        }}
        data-board-row="b1"
        style={{ transform: "translate(1px, 0)" }}
      >
        x
      </SidebarRow>,
    );
    expect(node).not.toBeNull();
    expect(node!.dataset.boardRow).toBe("b1");
    expect(node!.style.transform).toBe("translate(1px, 0)");
  });

  it("puts trailing controls after the label", () => {
    render(
      <SidebarRow trailing={<button>menu</button>}>
        <span>Roadmap</span>
      </SidebarRow>,
    );
    const label = screen.getByText("Roadmap");
    const menu = screen.getByRole("button", { name: "menu" });
    expect(
      label.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("SidebarLink", () => {
  it("renders a link with icon in the lead slot and aria-current when active", () => {
    render(
      <SidebarLink href="/my-work" label="My Work" icon={ListTodo} active />,
    );
    const link = screen.getByRole("link", { name: "My Work" });
    expect(link).toHaveAttribute("href", "/my-work");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link.className).toContain("bg-state-selected");
    expect(link.firstElementChild?.className).toContain("size-6");
  });

  it("omits aria-current when idle", () => {
    render(<SidebarLink href="/goals" label="Goals" icon={ListTodo} />);
    expect(screen.getByRole("link", { name: "Goals" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});

describe("rail", () => {
  it("tiles are 36px, keep the coarse-pointer 44px contract, and use the tint + bar when active", () => {
    const idle = railTileClass({});
    expect(idle).toContain("size-9");
    expect(idle).toContain("pointer-coarse:min-h-11");
    expect(idle).toContain("hover:bg-state-hover");
    expect(idle).not.toContain("hover:border");
    const active = railTileClass({ active: true });
    expect(active).toContain("bg-state-selected");
    expect(active).toContain("before:bg-primary");
    expect(active).not.toContain("bg-primary/80");
  });

  it("RailDivider is a decorative 16px hairline", () => {
    const { container } = render(<RailDivider />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveAttribute("aria-hidden", "true");
    // Stable hook for the rail tests (they used to match on utility classes).
    expect(el).toHaveAttribute("data-rail-divider");
    expect(el.className).toContain("h-px");
    expect(el.className).toContain("w-4");
    expect(el.className).toContain("bg-border");
  });
});
