import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DockTiles, dockTileId, DOCK_RAIL_TILE_ID_PREFIX } from "./DockTiles";

const names = () =>
  screen.getAllByRole("tab").map((t) => t.getAttribute("aria-label"));

const selectedName = () =>
  screen
    .getAllByRole("tab")
    .find((t) => t.getAttribute("aria-selected") === "true")
    ?.getAttribute("aria-label");

describe("DockTiles — tiles", () => {
  it("renders Intelligence and Ask as one tab row, with no agent tiles", () => {
    render(<DockTiles tab="chat" badge={0} onSelect={() => {}} />);
    expect(screen.getByRole("tablist")).toHaveAttribute(
      "aria-label",
      "Dock sections",
    );
    expect(screen.getByRole("tablist")).not.toHaveAttribute("aria-orientation");
    expect(names()).toEqual(["Intelligence", "Ask"]);
  });

  it("gives every tile a stable id the panels can point at", () => {
    expect(dockTileId({ kind: "intelligence" })).toBe("dock-tab-intelligence");
    expect(dockTileId({ kind: "ask" })).toBe("dock-tab-ask");
    render(<DockTiles tab="chat" badge={0} onSelect={() => {}} />);
    expect(screen.getByRole("tab", { name: "Ask" })).toHaveAttribute(
      "id",
      "dock-tab-ask",
    );
  });
});

describe("DockTiles — one row, two layers", () => {
  it("mints ids in the namespace it is given, so the band and the rail never collide", () => {
    expect(dockTileId({ kind: "ask" }, DOCK_RAIL_TILE_ID_PREFIX)).toBe(
      "dock-rail-tab-ask",
    );
    expect(DOCK_RAIL_TILE_ID_PREFIX).not.toBe("dock-tab");
    render(
      <DockTiles
        tab="chat"
        badge={0}
        orientation="vertical"
        idPrefix={DOCK_RAIL_TILE_ID_PREFIX}
        panelMounted={false}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("tab", { name: "Ask" })).toHaveAttribute(
      "id",
      "dock-rail-tab-ask",
    );
    // No panel is mounted beside the rail, so the selected tile points at
    // nothing rather than at an id that is not in the document.
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).not.toHaveAttribute("aria-controls");
    }
  });
});

describe("DockTiles — badge", () => {
  it("shows the unresolved count on the Intelligence tile and says it in the name", () => {
    render(<DockTiles tab="chat" badge={3} onSelect={() => {}} />);
    const intel = screen.getByRole("tab", {
      name: "Intelligence · 3 suggestions",
    });
    const chip = intel.querySelector("[data-dock-badge]");
    expect(chip).toHaveTextContent("3");
    expect(chip!.className).toContain("text-primary");
    expect(chip!.className).toContain("tabular-nums");
    // The badge stays pinned to the fixed 32px face box.
    expect(chip!.parentElement!.className).toContain("size-8");
  });

  it("singular for one, and hides a zero badge", () => {
    const { rerender } = render(
      <DockTiles tab="chat" badge={1} onSelect={() => {}} />,
    );
    expect(
      screen.getByRole("tab", { name: "Intelligence · 1 suggestion" }),
    ).toBeInTheDocument();
    rerender(<DockTiles tab="chat" badge={0} onSelect={() => {}} />);
    expect(
      screen.getByRole("tab", { name: "Intelligence" }),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-dock-badge]")).toBeNull();
  });
});

describe("DockTiles — selection follows tab", () => {
  it("selects Intelligence when the tab is intelligence", () => {
    render(<DockTiles tab="intelligence" badge={0} onSelect={() => {}} />);
    expect(selectedName()).toBe("Intelligence");
    expect(screen.getByRole("tab", { name: "Intelligence" })).toHaveAttribute(
      "aria-controls",
      "dock-panel-intelligence",
    );
    // Only the OPEN section is mounted, so only the selected tile has a panel
    // to point at.
    expect(screen.getByRole("tab", { name: "Ask" })).not.toHaveAttribute(
      "aria-controls",
    );
  });

  it("selects Ask on the chat tab, controlling the chat panel", () => {
    render(<DockTiles tab="chat" badge={0} onSelect={() => {}} />);
    expect(selectedName()).toBe("Ask");
    expect(screen.getByRole("tab", { name: "Ask" })).toHaveAttribute(
      "aria-controls",
      "dock-panel-chat",
    );
  });

  it("is one tab stop: only the selected tile is tabbable", () => {
    render(<DockTiles tab="chat" badge={0} onSelect={() => {}} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0]);
  });

  it("draws the edge bar under the selected tile (band) or on its right (rail)", () => {
    const { rerender } = render(
      <DockTiles tab="chat" badge={0} onSelect={() => {}} />,
    );
    const ask = () => screen.getByRole("tab", { name: "Ask" });
    expect(ask().className).toContain("after:bg-primary");
    expect(ask().className).toContain("after:bottom-0");
    expect(ask().className).toContain("w-8");
    expect(ask().className).not.toContain("size-8");
    expect(
      screen.getByRole("tab", { name: "Intelligence" }).className,
    ).not.toContain("after:bg-primary");
    rerender(
      <DockTiles
        tab="chat"
        badge={0}
        orientation="vertical"
        onSelect={() => {}}
      />,
    );
    expect(ask().className).toContain("after:right-0");
    expect(ask().className).toContain("after:inset-y-2");
    expect(ask().className).not.toContain("after:bottom-0");
    expect(ask().className).toContain("size-8");
    expect(ask().className).toContain("pointer-coarse:size-11");
  });

  it("keeps hover/selected/focus chrome on the fixed-size face box, never on the band-stretched button", () => {
    const classesOf = (el: Element) => el.className.split(/\s+/);
    render(<DockTiles tab="chat" badge={0} onSelect={() => {}} />);
    const ask = screen.getByRole("tab", { name: "Ask" });
    const askFace = ask.firstElementChild as HTMLElement;
    for (const cls of [
      "border",
      "border-border",
      "group-hover/tile:border-border-hover",
      "group-focus-visible/tile:ring-2",
    ]) {
      expect(classesOf(ask)).not.toContain(cls);
    }
    expect(classesOf(ask)).toContain("focus-visible:outline-none");
    expect(classesOf(askFace)).toEqual(
      expect.arrayContaining([
        "border",
        "border-border",
        "group-hover/tile:border-border-hover",
        "group-focus-visible/tile:ring-ring",
        "group-focus-visible/tile:ring-2",
      ]),
    );
    const intelFace = screen.getByRole("tab", { name: "Intelligence" })
      .firstElementChild as HTMLElement;
    expect(classesOf(intelFace)).toContain("border-transparent");
    expect(classesOf(intelFace)).not.toContain("border-border");
  });
});

// MANUAL activation (ARIA APG): landing on Intelligence can kick a metered
// model call, so an arrow only moves focus.
describe("DockTiles — keyboard", () => {
  it("ArrowRight/ArrowLeft move focus ONLY, wrapping, from the focused tile", async () => {
    const onSelect = vi.fn();
    render(<DockTiles tab="chat" badge={0} onSelect={onSelect} />);
    screen.getByRole("tab", { name: "Ask" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Intelligence" })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Ask" })).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
    expect(selectedName()).toBe("Ask");
  });

  it("Enter and Space activate the focused tile", async () => {
    const onSelect = vi.fn();
    render(<DockTiles tab="chat" badge={0} onSelect={onSelect} />);
    screen.getByRole("tab", { name: "Ask" }).focus();
    await userEvent.keyboard("{ArrowRight}{Enter}");
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "intelligence" });
    await userEvent.keyboard("{ArrowRight} ");
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "ask" });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("Home and End jump to the ends, still without activating", async () => {
    const onSelect = vi.fn();
    render(<DockTiles tab="chat" badge={0} onSelect={onSelect} />);
    screen.getByRole("tab", { name: "Ask" }).focus();
    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Intelligence" })).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Ask" })).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("vertical: ArrowDown/ArrowUp move, ArrowRight/ArrowLeft are ignored", async () => {
    const onSelect = vi.fn();
    render(
      <DockTiles
        tab="chat"
        badge={0}
        orientation="vertical"
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole("tablist")).toHaveAttribute(
      "aria-orientation",
      "vertical",
    );
    screen.getByRole("tab", { name: "Ask" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Ask" })).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByRole("tab", { name: "Intelligence" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("tab", { name: "Ask" })).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("clicking each tile reports it", async () => {
    const onSelect = vi.fn();
    render(<DockTiles tab="chat" badge={0} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("tab", { name: "Intelligence" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "intelligence" });
    await userEvent.click(screen.getByRole("tab", { name: "Ask" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "ask" });
  });
});
