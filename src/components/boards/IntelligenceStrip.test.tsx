import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  IntelligenceStrip,
  IntelligenceStripView,
  type StripViewProps,
} from "./IntelligenceStrip";
import { BoardIntelligenceProvider } from "@/lib/boards/intelligence/context";
import { useBoardIntelligenceStore } from "@/stores/board-intelligence";
import type { BoardCache } from "@/lib/boards/cache";
import type { Signal } from "@/lib/boards/intelligence/types";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const NOW = Date.parse("2026-09-11T12:00:00Z");
const sig = (over: Partial<Signal>): Signal => ({
  kind: "overdue",
  count: 3,
  label: "overdue",
  tone: "red",
  itemIds: ["a", "b", "c"],
  ...over,
});

function props(over: Partial<StripViewProps> = {}): StripViewProps {
  return {
    signals: [],
    selection: null,
    activeSignal: null,
    lastChangeAt: null,
    lastRunAt: null,
    nowMs: NOW,
    loading: false,
    onToggle: vi.fn(),
    onClear: vi.fn(),
    onCatchMeUp: vi.fn(),
    ...over,
  };
}

describe("IntelligenceStripView", () => {
  it("renders the Intelligence kicker and one chip per signal with count + label", () => {
    render(
      <IntelligenceStripView
        {...props({
          signals: [
            sig({}),
            sig({
              kind: "stalled",
              count: 2,
              label: "stalled groups",
              tone: "gray",
              itemIds: ["x"],
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText("Intelligence")).toBeInTheDocument();
    // `group`, not `toolbar`: the chips are plain tab stops, with none of the
    // arrow-key roving focus a toolbar role promises.
    expect(screen.getByRole("group", { name: "Intelligence" })).toBeTruthy();
    expect(screen.queryByRole("toolbar")).toBeNull();
    const chips = screen.getAllByRole("button", { pressed: false });
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent("3");
    expect(chips[0]).toHaveTextContent("overdue");
    expect(chips[0].className).toContain("rounded-sm");
    expect(chips[0].querySelector(".bg-status-red")).not.toBeNull();
    expect(chips[1].querySelector(".bg-status-gray")).not.toBeNull();
  });

  it("hides zero-count chips and never shows more than five", () => {
    const many = [
      "overdue",
      "blocked",
      "overloaded",
      "overloaded",
      "stalled",
      "changed",
    ].map((kind, i) =>
      sig({
        kind: kind as Signal["kind"],
        label: `${kind}${i}`,
        subjectUserId: kind === "overloaded" ? `u${i}` : undefined,
      }),
    );
    render(
      <IntelligenceStripView
        {...props({ signals: [sig({ count: 0, itemIds: [] }), ...many] })}
      />,
    );
    // `pressed: false` scopes to chip buttons (which carry `aria-pressed`) —
    // the trailing "Catch me up" pill is always present and has no
    // aria-pressed attribute, so it is excluded from this count.
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(5);
    expect(screen.queryByText("changed5")).not.toBeInTheDocument();
  });

  it("collapses to the one-line zero state with the last change time", () => {
    render(
      <IntelligenceStripView
        {...props({ lastChangeAt: "2026-09-11T09:00:00Z" })}
      />,
    );
    expect(
      screen.getByText(
        "All on track · nothing overdue · last change 3 hours ago",
      ),
    ).toBeInTheDocument();
    // No chip buttons — "Catch me up" (no aria-pressed) is unaffected by the
    // zero state and still renders.
    expect(
      screen.queryByRole("button", { pressed: false }),
    ).not.toBeInTheDocument();
  });

  it("omits the last-change segment on an empty board", () => {
    render(<IntelligenceStripView {...props()} />);
    expect(
      screen.getByText("All on track · nothing overdue"),
    ).toBeInTheDocument();
  });

  it("marks the active chip pressed with the accent hairline and shows ✕ clear", async () => {
    const onToggle = vi.fn();
    const onClear = vi.fn();
    const overdue = sig({});
    render(
      <IntelligenceStripView
        {...props({
          signals: [overdue],
          selection: { kind: "overdue" },
          activeSignal: overdue,
          onToggle,
          onClear,
        })}
      />,
    );
    const chip = screen.getByRole("button", { pressed: true });
    expect(chip.className).toContain("border-primary");
    expect(chip.className).toContain("bg-primary/10");
    await userEvent.click(chip);
    expect(onToggle).toHaveBeenCalledWith(overdue);
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("chips are keyboard-reachable buttons that toggle on Enter", async () => {
    const onToggle = vi.fn();
    const overdue = sig({});
    render(
      <IntelligenceStripView {...props({ signals: [overdue], onToggle })} />,
    );
    const chip = screen.getByRole("button", { name: /overdue/ });
    chip.focus();
    await userEvent.keyboard("{Enter}");
    expect(onToggle).toHaveBeenCalledWith(overdue);
  });

  it("shows skeleton pills, never a spinner, while loading", () => {
    render(<IntelligenceStripView {...props({ loading: true })} />);
    expect(screen.getByLabelText("Loading intelligence")).toBeInTheDocument();
    // No chip buttons while loading — "Catch me up" still renders.
    expect(
      screen.queryByRole("button", { pressed: false }),
    ).not.toBeInTheDocument();
    expect(document.querySelector(".animate-spin")).toBeNull();
  });

  it("does not render an AI badge, sparkle or glow", () => {
    render(<IntelligenceStripView {...props({ signals: [sig({})] })} />);
    expect(screen.queryByText(/AI/)).not.toBeInTheDocument();
    expect(document.querySelector(".shadow-glow-primary")).toBeNull();
  });

  it("shows a Catch me up pill and, once a run exists, when it was updated", async () => {
    const onCatchMeUp = vi.fn();
    const { rerender } = render(
      <IntelligenceStripView {...props({ lastRunAt: null, onCatchMeUp })} />,
    );
    expect(screen.queryByText(/updated/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Catch me up" }));
    expect(onCatchMeUp).toHaveBeenCalledTimes(1);
    rerender(
      <IntelligenceStripView
        {...props({
          nowMs: Date.parse("2026-09-11T12:10:00.000Z"),
          lastRunAt: "2026-09-11T12:00:00.000Z",
          onCatchMeUp,
        })}
      />,
    );
    expect(screen.getByText("updated 10 minutes ago")).toBeInTheDocument();
  });
});

const minimalCache = {
  board: { id: "b1", org_id: "o1", name: "Board" },
  groups: [],
  columns: [],
  items: [],
  cellValues: [],
  dependencies: [],
  attachments: [],
  timeEntries: [],
  relationLinks: [],
  mirrorTargetCells: [],
  mirrorTargetColumns: [],
} as unknown as BoardCache;

function connectedWrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <BoardIntelligenceProvider
        boardId="b1"
        initialData={minimalCache}
        members={[]}
        lastSeenAt={null}
        currentUserId="u1"
      >
        {children}
      </BoardIntelligenceProvider>
    </QueryClientProvider>
  );
}

describe("IntelligenceStrip (connected)", () => {
  it("renders nothing without a provider", () => {
    const { container } = render(<IntelligenceStrip />);
    expect(container).toBeEmptyDOMElement();
  });

  it("Catch me up requests the dock open and run for this board", async () => {
    render(<IntelligenceStrip />, { wrapper: connectedWrapper });
    await userEvent.click(screen.getByRole("button", { name: "Catch me up" }));
    expect(useBoardIntelligenceStore.getState().openRequest).toEqual({
      boardId: "b1",
      run: true,
      nonce: expect.any(Number),
    });
  });
});
