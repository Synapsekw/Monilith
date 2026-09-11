"use client";

import { useRef } from "react";
import { AskAiMark } from "@/components/brand/ask-ai-mark";
import { MonolithMark } from "@/components/brand/monolith-mark";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DockTab } from "@/stores/board-intelligence";

/** One of the owner's agents, as the board page reads them (`user_agents`). */
export type DockAgent = { id: string; name: string };

/** Live state of an agent, for the presence dot. Phase 1: `running` only
 *  while that persona's chat turn is streaming (spec §2). */
export type DockPresence = "idle" | "running";

/** What a tile stands for. Everything the reader can consult is one of these. */
export type DockTile =
  | { kind: "intelligence" }
  | { kind: "ask" }
  | { kind: "agent"; agentId: string };

export type DockTilesProps = {
  agents: DockAgent[];
  /** Which section is open (persisted, `use-dock-state`). */
  tab: DockTab;
  /** The chat persona on screen — the open thread's, or the one queued for
   *  the next thread. `null` is plain Ask. Ignored while `tab` is
   *  intelligence, which is the active tile regardless. */
  agentId: string | null;
  /** Unresolved Intelligence suggestions. 0 hides the chip. */
  badge: number;
  presence?: Readonly<Record<string, DockPresence>>;
  /** `vertical` is the mini rail: Up/Down move, the edge bar sits on the
   *  right edge (the left rail's bar sits on its left — mirrored twins). */
  orientation?: "horizontal" | "vertical";
  onSelect: (tile: DockTile) => void;
};

const EMPTY_PRESENCE: Readonly<Record<string, DockPresence>> = {};

/** The tab's element id — also what the mounted panel's `aria-labelledby`
 *  names, so the id is shared here rather than spelled in two files. */
export function dockTileId(tile: DockTile): string {
  switch (tile.kind) {
    case "intelligence":
      return "dock-tab-intelligence";
    case "ask":
      return "dock-tab-ask";
    case "agent":
      return `dock-tab-agent-${tile.agentId}`;
  }
}

/** Only the OPEN section is mounted (DockBody), so only the selected tile has
 *  a panel to point at; the chat panel is one panel however many personas. */
function panelIdFor(tile: DockTile): string {
  return tile.kind === "intelligence"
    ? "dock-panel-intelligence"
    : "dock-panel-chat";
}

function isActive(tile: DockTile, tab: DockTab, agentId: string | null) {
  if (tab === "intelligence") return tile.kind === "intelligence";
  if (tile.kind === "intelligence") return false;
  return tile.kind === "ask" ? agentId === null : tile.agentId === agentId;
}

/** The accessible name — and the tooltip. Presence and the badge are said in
 *  words here so neither is colour-only (spec §8). */
function labelFor(
  tile: DockTile,
  agents: DockAgent[],
  badge: number,
  presence: Readonly<Record<string, DockPresence>>,
): string {
  if (tile.kind === "intelligence") {
    if (badge <= 0) return "Intelligence";
    return `Intelligence · ${badge} suggestion${badge === 1 ? "" : "s"}`;
  }
  if (tile.kind === "ask") return "Ask";
  const name = agents.find((a) => a.id === tile.agentId)?.name ?? "Agent";
  return presence[tile.agentId] === "running" ? `${name} · running` : name;
}

/** The 26px face inside the 32px tab. Intelligence and Ask are marks on the
 *  chrome fill; an agent is its initial on a brand tint — the same tile the
 *  transcript uses for that agent's turns (MessageList, `atmosphere`). */
function TileFace({ tile, agents }: { tile: DockTile; agents: DockAgent[] }) {
  if (tile.kind === "intelligence") {
    return (
      <span className="bg-chrome-fill text-brand flex size-6.5 items-center justify-center rounded-sm border">
        <AskAiMark className="size-3.5" />
      </span>
    );
  }
  if (tile.kind === "ask") {
    return (
      <span className="bg-chrome-fill text-foreground flex size-6.5 items-center justify-center rounded-sm border">
        <MonolithMark className="size-3.5" />
      </span>
    );
  }
  const name = agents.find((a) => a.id === tile.agentId)?.name ?? "?";
  return (
    <span className="bg-primary/15 text-primary text-2xs flex size-6.5 items-center justify-center rounded-sm font-bold uppercase">
      {name.slice(0, 1)}
    </span>
  );
}

/**
 * The dock's one tab row: Intelligence, Ask, and each of the owner's agents
 * (spec §2). Replaces the pill tabs (`DockTabs`) and the native persona select
 * (`AgentSwitcher`): agents are the hero, so they ARE the tabs.
 *
 * Icon-only tiles, 32px, hairline that brightens on hover; the active one gets
 * a `border-border` hairline and the sidebar's 3px edge bar — under the tile
 * in the band, on the right edge on the mini rail. Names are tooltips AND the
 * tile's aria-label; the only colour on an idle tile is the accent count.
 *
 * Arrow keys move from the FOCUSED tile, not from the selection: the component
 * is controlled, so a parent that ignores `onSelect` would otherwise pin every
 * arrow press to the same origin — and the two reads disagree for exactly one
 * frame on every real switch, which is the frame the user is pressing in.
 * Roving tabindex: the tablist is ONE tab stop.
 */
export function DockTiles({
  agents,
  tab,
  agentId,
  badge,
  presence = EMPTY_PRESENCE,
  orientation = "horizontal",
  onSelect,
}: DockTilesProps) {
  const vertical = orientation === "vertical";
  const tiles: DockTile[] = [
    { kind: "intelligence" },
    { kind: "ask" },
    ...agents.map((a) => ({ kind: "agent" as const, agentId: a.id })),
  ];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // An agentId that names no roster entry (e.g. dock state persisted an id
  // whose agent was since deleted) reads as plain Ask, never as index 0 —
  // that would light up Intelligence while `tab` is still "chat". Resolved
  // once here so `activeIndex` and every tile's `aria-selected` agree.
  const resolvedAgentId =
    agentId !== null && !agents.some((a) => a.id === agentId) ? null : agentId;
  const activeIndex = tiles.findIndex((t) => isActive(t, tab, resolvedAgentId));

  const move = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const focused = refs.current.findIndex(
      (el) => el === document.activeElement,
    );
    const from = focused === -1 ? Math.max(activeIndex, 0) : focused;
    const back = vertical ? "ArrowUp" : "ArrowLeft";
    const forward = vertical ? "ArrowDown" : "ArrowRight";
    let next: number;
    if (e.key === forward) next = (from + 1) % tiles.length;
    else if (e.key === back) next = (from - 1 + tiles.length) % tiles.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tiles.length - 1;
    else return;
    e.preventDefault();
    refs.current[next]?.focus();
    onSelect(tiles[next]);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div
        role="tablist"
        aria-label="Dock sections"
        aria-orientation={vertical ? "vertical" : undefined}
        onKeyDown={move}
        className={cn(
          "flex min-w-0 shrink-0",
          vertical ? "flex-col items-center gap-2" : "items-center gap-1",
        )}
      >
        {tiles.map((tile, i) => {
          const selected = i === activeIndex;
          const label = labelFor(tile, agents, badge, presence);
          const running =
            tile.kind === "agent" && presence[tile.agentId] === "running";
          return (
            <Tooltip key={dockTileId(tile)}>
              <TooltipTrigger asChild>
                <button
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={dockTileId(tile)}
                  aria-label={label}
                  aria-selected={selected}
                  aria-controls={selected ? panelIdFor(tile) : undefined}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onSelect(tile)}
                  className={cn(
                    "focus-visible:ring-ring hover:border-border-hover ease-keystone relative flex size-8 shrink-0 items-center justify-center rounded-lg border border-transparent transition-colors duration-300 focus-visible:ring-2 focus-visible:outline-none pointer-coarse:size-11",
                    selected &&
                      "border-border after:bg-primary after:absolute after:content-['']",
                    // The 3px bar sits flush on the band's bottom edge (tile is
                    // 32px in a 56px band → 12px below it) or on the rail's
                    // right edge (32px in a 48px rail → 8px beside it).
                    selected &&
                      (vertical
                        ? "after:inset-y-2 after:-right-2 after:w-[3px] after:rounded-l-full"
                        : "after:inset-x-2 after:-bottom-3 after:h-[3px] after:rounded-t-full"),
                  )}
                >
                  <TileFace tile={tile} agents={agents} />
                  {tile.kind === "intelligence" && badge > 0 ? (
                    <span
                      aria-hidden="true"
                      data-dock-badge
                      className="text-primary text-3xs absolute top-0 right-0 translate-x-1/3 -translate-y-1/3 font-semibold tabular-nums"
                    >
                      {badge}
                    </span>
                  ) : null}
                  {running ? (
                    // A 2px `border-border` hairline separates the dot from the
                    // tile — not a wash-coloured ring, the wash is a gradient
                    // (spec §7). The pulse is a box-shadow: nothing scales.
                    <span
                      aria-hidden="true"
                      data-dock-presence
                      className="bg-primary border-border animate-pulse-ring absolute right-0.5 bottom-0.5 size-[9px] rounded-full border-2"
                    />
                  ) : null}
                </button>
              </TooltipTrigger>
              <TooltipContent side={vertical ? "left" : "bottom"}>
                {label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
