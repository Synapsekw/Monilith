import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DockTiles, dockTileId, type DockTile } from "./DockTiles";

const AGENTS = [
  { id: "a1", name: "Morning Brief" },
  { id: "a2", name: "Overdue Chaser" },
];

const names = () =>
  screen.getAllByRole("tab").map((t) => t.getAttribute("aria-label"));

const selectedName = () =>
  screen
    .getAllByRole("tab")
    .find((t) => t.getAttribute("aria-selected") === "true")
    ?.getAttribute("aria-label");

describe("DockTiles — roster", () => {
  it("renders Intelligence, Ask and every agent as one tab row, names in tooltips not text", () => {
    render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={0}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("tablist")).toHaveAttribute(
      "aria-label",
      "Dock sections",
    );
    expect(screen.getByRole("tablist")).not.toHaveAttribute("aria-orientation");
    expect(names()).toEqual([
      "Intelligence",
      "Ask",
      "Morning Brief",
      "Overdue Chaser",
    ]);
    // Icon-only: the visible content is a mark or an initial, never the name.
    expect(screen.queryByText("Morning Brief")).toBeNull();
    expect(
      screen.getByRole("tab", { name: "Morning Brief" }),
    ).toHaveTextContent("M");
  });

  it("gives every tile a stable id the panels can point at", () => {
    expect(dockTileId({ kind: "intelligence" })).toBe("dock-tab-intelligence");
    expect(dockTileId({ kind: "ask" })).toBe("dock-tab-ask");
    expect(dockTileId({ kind: "agent", agentId: "a1" })).toBe(
      "dock-tab-agent-a1",
    );
    render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId="a1"
        badge={0}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("tab", { name: "Morning Brief" })).toHaveAttribute(
      "id",
      "dock-tab-agent-a1",
    );
  });
});

describe("DockTiles — badge", () => {
  it("shows the unresolved count on the Intelligence tile and says it in the name", () => {
    render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={3}
        onSelect={() => {}}
      />,
    );
    const intel = screen.getByRole("tab", {
      name: "Intelligence · 3 suggestions",
    });
    const chip = intel.querySelector("[data-dock-badge]");
    expect(chip).toHaveTextContent("3");
    expect(chip!.className).toContain("text-primary");
    expect(chip!.className).toContain("tabular-nums");
  });

  it("singular for one, and hides a zero badge", () => {
    const { rerender } = render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={1}
        onSelect={() => {}}
      />,
    );
    expect(
      screen.getByRole("tab", { name: "Intelligence · 1 suggestion" }),
    ).toBeInTheDocument();
    rerender(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={0}
        onSelect={() => {}}
      />,
    );
    expect(
      screen.getByRole("tab", { name: "Intelligence" }),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-dock-badge]")).toBeNull();
  });
});

describe("DockTiles — selection follows tab + agentId", () => {
  it("selects Intelligence when the tab is intelligence, whatever the persona", () => {
    render(
      <DockTiles
        agents={AGENTS}
        tab="intelligence"
        agentId="a2"
        badge={0}
        onSelect={() => {}}
      />,
    );
    expect(selectedName()).toBe("Intelligence");
    expect(screen.getByRole("tab", { name: "Intelligence" })).toHaveAttribute(
      "aria-controls",
      "dock-panel-intelligence",
    );
    // Only the OPEN section is mounted, so only the selected tile has a panel
    // to point at — anything else would be a dangling reference.
    expect(
      screen.getByRole("tab", { name: "Overdue Chaser" }),
    ).not.toHaveAttribute("aria-controls");
  });

  it("selects Ask for a null persona and the agent tile for its id, controlling the chat panel", () => {
    const { rerender } = render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={0}
        onSelect={() => {}}
      />,
    );
    expect(selectedName()).toBe("Ask");
    expect(screen.getByRole("tab", { name: "Ask" })).toHaveAttribute(
      "aria-controls",
      "dock-panel-chat",
    );
    rerender(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId="a2"
        badge={0}
        onSelect={() => {}}
      />,
    );
    expect(selectedName()).toBe("Overdue Chaser");
    expect(screen.getByRole("tab", { name: "Overdue Chaser" })).toHaveAttribute(
      "aria-controls",
      "dock-panel-chat",
    );
  });

  it("falls back to Ask — not index 0 — when agentId names no roster entry", () => {
    render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId="deleted-agent"
        badge={0}
        onSelect={() => {}}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(selectedName()).toBe("Ask");
    expect(
      tabs.filter((t) => t.getAttribute("aria-selected") === "true"),
    ).toHaveLength(1);
    expect(tabs.filter((t) => t.tabIndex === 0)).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "Ask" }).tabIndex).toBe(0);
  });

  it("is one tab stop: only the selected tile is tabbable", () => {
    render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId="a1"
        badge={0}
        onSelect={() => {}}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, -1, 0, -1]);
  });

  it("draws the edge bar under the selected tile (band) or on its right (rail)", () => {
    const { rerender } = render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={0}
        onSelect={() => {}}
      />,
    );
    const ask = () => screen.getByRole("tab", { name: "Ask" });
    expect(ask().className).toContain("after:bg-primary");
    // The bar anchors to the BUTTON's own bottom edge (`bottom-0`, inside its
    // box) rather than a fixed offset below a fixed-size tile — that box
    // itself stretches to the band's height (`w-8`, no fixed height, inside
    // an `items-stretch` row), so the bar lands flush with the band for any
    // tile size or a scrollbar-shrunk row, not just a 32px fine-pointer one.
    expect(ask().className).toContain("after:bottom-0");
    expect(ask().className).not.toContain("after:-bottom-3");
    // `border-border` (the selected fill) lives on the fixed-size face box
    // now, not this stretched button — see the dedicated chrome-placement
    // test below.
    expect(ask().className).not.toContain("border-border");
    // Width is still pinned (so horizontal spacing is unaffected); height is
    // deliberately NOT — that is what lets the button stretch.
    expect(ask().className).toContain("w-8");
    expect(ask().className).not.toContain("size-8");
    expect(ask().className).not.toContain("pointer-coarse:size-11");
    expect(
      screen.getByRole("tab", { name: "Morning Brief" }).className,
    ).not.toContain("after:bg-primary");
    rerender(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={0}
        orientation="vertical"
        onSelect={() => {}}
      />,
    );
    expect(ask().className).toContain("after:-right-2");
    expect(ask().className).not.toContain("after:bottom-0");
    // Vertical is unaffected: the rail button stays a fixed square, not a
    // stretched rectangle.
    expect(ask().className).toContain("size-8");
    expect(ask().className).toContain("pointer-coarse:size-11");
  });

  it("keeps hover/selected/focus chrome on the fixed-size face box, never on the band-stretched button", () => {
    // Regression guard: the hairline, hover-brighten, selected fill and
    // focus ring used to live on the outer button — which this task's
    // horizontal fix deliberately stretches up to the band's full height —
    // so a border there paints a ~56px-tall halo around a 32px icon.
    const classesOf = (el: Element) => el.className.split(/\s+/);
    const { rerender } = render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={0}
        onSelect={() => {}}
      />,
    );
    const ask = () => screen.getByRole("tab", { name: "Ask" }); // selected
    const askFace = () => ask().firstElementChild as HTMLElement;

    // The outer (band-stretched) button carries NONE of it.
    for (const cls of [
      "border",
      "border-transparent",
      "border-border",
      "hover:border-border-hover",
      "group-hover/tile:border-border-hover",
      "focus-visible:ring-2",
      "focus-visible:ring-ring",
      "group-focus-visible/tile:ring-2",
      "group-focus-visible/tile:ring-ring",
    ]) {
      expect(classesOf(ask())).not.toContain(cls);
    }
    // It DOES keep the one focus concern that belongs to whichever element
    // is really focused: suppressing the native outline.
    expect(classesOf(ask())).toContain("focus-visible:outline-none");

    // The fixed 32px face box carries all of it, driven by the outer
    // button's own hover/focus state through the named `group/tile`.
    expect(classesOf(askFace())).toEqual(
      expect.arrayContaining([
        "border",
        "border-border", // Ask is selected here
        "group-hover/tile:border-border-hover",
        "group-focus-visible/tile:ring-ring",
        "group-focus-visible/tile:ring-2",
      ]),
    );

    // An unselected tile keeps the (transparent) hairline but not the
    // selected fill.
    const briefFace = () =>
      screen.getByRole("tab", { name: "Morning Brief" })
        .firstElementChild as HTMLElement;
    expect(classesOf(briefFace())).toContain("border-transparent");
    expect(classesOf(briefFace())).not.toContain("border-border");

    // Vertical (the rail): the outer button is still a fixed 32/44px square
    // — IDENTICALLY sized to the face box moving the chrome changed nothing
    // about — so this placement is a no-op there. Confirmed by re-asserting
    // the same "outer carries none of it" property, and that outer and
    // inner now share the same fixed-size classes (no visual gap between
    // the two possible only when they're literally the same box).
    rerender(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={0}
        orientation="vertical"
        onSelect={() => {}}
      />,
    );
    expect(classesOf(ask())).not.toContain("border-border");
    expect(classesOf(ask())).not.toContain(
      "group-hover/tile:border-border-hover",
    );
    expect(classesOf(askFace())).toContain("border-border");
    expect(classesOf(ask())).toEqual(
      expect.arrayContaining(["size-8", "pointer-coarse:size-11"]),
    );
    expect(classesOf(askFace())).toEqual(
      expect.arrayContaining(["size-8", "pointer-coarse:size-11"]),
    );
  });

  it("keeps the face, badge and presence dot pinned to a fixed 32px box even though the horizontal button itself stretches", () => {
    // Regression guard for the stretch fix above: the visible face/badge/dot
    // must stay anchored to their own small box, not drift to the edges of
    // the now taller-or-shorter outer button.
    render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId="a1"
        badge={2}
        presence={{ a1: "running" }}
        onSelect={() => {}}
      />,
    );
    const running = screen.getByRole("tab", {
      name: "Morning Brief · running",
    });
    const innerBox = running.querySelector(
      "[data-dock-presence]",
    )!.parentElement!;
    expect(innerBox.className).toContain("size-8");
    expect(innerBox.className).toContain("pointer-coarse:size-11");
    expect(innerBox.className).toContain("relative");
    // The badge/dot are direct descendants of that fixed inner box, not of
    // the outer (potentially taller) button.
    const intel = screen.getByRole("tab", {
      name: "Intelligence · 2 suggestions",
    });
    const badgeParent =
      intel.querySelector("[data-dock-badge]")!.parentElement!;
    expect(badgeParent.className).toContain("size-8");
  });
});

describe("DockTiles — presence", () => {
  it("shows the pulsing dot only on a running agent, and says so in the name", () => {
    render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId="a1"
        badge={0}
        presence={{ a1: "running", a2: "idle" }}
        onSelect={() => {}}
      />,
    );
    const running = screen.getByRole("tab", {
      name: "Morning Brief · running",
    });
    const dot = running.querySelector("[data-dock-presence]");
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("animate-pulse-ring");
    expect(dot!.className).toContain("bg-primary");
    expect(dot!.className).toContain("border-border");
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(
      screen
        .getByRole("tab", { name: "Overdue Chaser" })
        .querySelector("[data-dock-presence]"),
    ).toBeNull();
  });
});

describe("DockTiles — keyboard", () => {
  const tiles = (calls: DockTile[][]) => calls.map((c) => c[0]);

  it("ArrowRight/ArrowLeft move focus AND select, wrapping, from the focused tile", async () => {
    const onSelect = vi.fn();
    render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={0}
        onSelect={onSelect}
      />,
    );
    screen.getByRole("tab", { name: "Ask" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "agent", agentId: "a1" });
    expect(screen.getByRole("tab", { name: "Morning Brief" })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "intelligence" });
    await userEvent.keyboard("{ArrowLeft}");
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "agent", agentId: "a2" });
    expect(tiles(onSelect.mock.calls)).toHaveLength(4);
  });

  it("Home and End jump to the ends", async () => {
    const onSelect = vi.fn();
    render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={0}
        onSelect={onSelect}
      />,
    );
    screen.getByRole("tab", { name: "Ask" }).focus();
    await userEvent.keyboard("{End}");
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "agent", agentId: "a2" });
    expect(screen.getByRole("tab", { name: "Overdue Chaser" })).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "intelligence" });
  });

  it("vertical: ArrowDown/ArrowUp move, ArrowRight/ArrowLeft are ignored", async () => {
    const onSelect = vi.fn();
    render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
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
    expect(onSelect).not.toHaveBeenCalled();
    await userEvent.keyboard("{ArrowDown}");
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "agent", agentId: "a1" });
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "intelligence" });
  });

  it("clicking each tile reports it", async () => {
    const onSelect = vi.fn();
    render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={0}
        onSelect={onSelect}
      />,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Intelligence" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "intelligence" });
    await userEvent.click(screen.getByRole("tab", { name: "Ask" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "ask" });
    await userEvent.click(screen.getByRole("tab", { name: "Overdue Chaser" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "agent", agentId: "a2" });
  });
});
