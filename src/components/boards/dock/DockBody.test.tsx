import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BoardThreadRow } from "@/lib/ai/ask/board-threads";

// The chat and the Intelligence body have their own suites; here they are
// probes for what the dock body hands them.
vi.mock("@/components/ai/ask/AskChat", () => ({
  AskChat: (p: { surface?: string; onBusyChange?: (b: boolean) => void }) => (
    <div
      data-testid="ask-chat"
      data-surface={p.surface ?? ""}
      data-busy-wired={p.onBusyChange ? "yes" : "no"}
    />
  ),
}));
vi.mock("./intelligence/IntelligenceTab", () => ({
  IntelligenceTab: () => (
    <div
      id="dock-panel-intelligence"
      role="tabpanel"
      aria-labelledby="dock-tab-intelligence"
    >
      intelligence body
    </div>
  ),
}));

import { DockBody, type DockBodyProps } from "./DockBody";

const AGENTS = [
  { id: "a1", name: "Morning Brief" },
  { id: "a2", name: "Overdue Chaser" },
];

const thread = (over: Partial<BoardThreadRow> = {}): BoardThreadRow => ({
  id: "c1",
  title: "About the roadmap",
  updated_at: "2026-08-03T10:00:00Z",
  agent_id: null,
  board_id: "b1",
  visibility: "private",
  user_id: "me",
  ...over,
});

function props(over: Partial<DockBodyProps> = {}): DockBodyProps {
  return {
    agents: AGENTS,
    agentNames: { a1: "Morning Brief", a2: "Overdue Chaser" },
    tileAgentId: null,
    presence: {},
    onSelectTile: vi.fn(),
    onNew: vi.fn(),
    onClose: vi.fn(),
    error: null,
    loading: false,
    boardThreads: [],
    agentThreads: [],
    activeId: null,
    activeThread: null,
    currentUserId: "me",
    onSelectThread: vi.fn(),
    onToggleShare: vi.fn(),
    sharingId: null,
    threadLoading: false,
    readOnly: false,
    boardId: "b1",
    messages: [],
    agentId: null,
    chatKey: "chat-0",
    onStarted: vi.fn(),
    onTurnComplete: vi.fn(),
    onBusyChange: vi.fn(),
    tab: "chat",
    badge: 0,
    canApply: true,
    runOnMount: false,
    onRanOnMount: vi.fn(),
    ...over,
  };
}

const ledger = () => screen.getByRole("button", { name: /^threads/i });

describe("DockBody — band", () => {
  it("puts the tile row, New and Close in one 56px band", () => {
    render(<DockBody {...props()} />);
    expect(screen.getByRole("banner")).toHaveClass("h-14");
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New thread" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Close agent dock" }),
    ).toBeInTheDocument();
  });

  it("enables New once a thread is open, and omits Close inside the Sheet", () => {
    render(<DockBody {...props({ activeId: "c1", onClose: undefined })} />);
    expect(screen.getByRole("button", { name: "New thread" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Close agent dock" }),
    ).toBeNull();
  });

  it("hands the band over to Intelligence: no New, no title row, its own panel", () => {
    render(<DockBody {...props({ tab: "intelligence" })} />);
    expect(screen.queryByRole("button", { name: "New thread" })).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "dock-tab-intelligence",
    );
    expect(screen.getByRole("tab", { name: "Intelligence" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("DockBody — title row", () => {
  it("says New thread · Ask when nothing is open", () => {
    render(<DockBody {...props()} />);
    expect(
      screen.getByRole("heading", { name: "New thread" }),
    ).toBeInTheDocument();
    const row = screen.getByRole("heading").parentElement!;
    expect(row).toHaveTextContent("Ask");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "dock-tab-ask",
    );
  });

  it("shows the open thread's title and its persona, and labels the panel by that tile", () => {
    render(
      <DockBody
        {...props({
          activeId: "c1",
          activeThread: thread({ agent_id: "a2" }),
          tileAgentId: "a2",
        })}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "About the roadmap" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading").parentElement).toHaveTextContent(
      "Overdue Chaser",
    );
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "dock-tab-agent-a2",
    );
    expect(screen.getByRole("tab", { name: "Overdue Chaser" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("falls back to Ask when the queued persona has left the roster", () => {
    // `tileAgentId` names an agent no longer in `agentNames` — e.g. the owner
    // disabled it after it was queued for a new thread. `DockTiles` already
    // collapses this to its Ask tile; the panel's `aria-labelledby` must
    // agree, not point at a `dock-tab-agent-<id>` nothing renders.
    render(<DockBody {...props({ tileAgentId: "gone" })} />);
    expect(screen.getByRole("heading").parentElement).toHaveTextContent("Ask");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "dock-tab-ask",
    );
    expect(screen.getByRole("tab", { name: "Ask" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("treats an agent with an empty-string name as still on the roster", () => {
    // A truthiness check on `agentNames[id]` would wrongly treat an agent
    // whose display name happens to be "" as absent — disagreeing with
    // `DockTiles`, which checks its own `agents` array by id, never by name.
    render(
      <DockBody {...props({ tileAgentId: "a1", agentNames: { a1: "" } })} />,
    );
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "dock-tab-agent-a1",
    );
    expect(screen.getByRole("heading").parentElement).not.toHaveTextContent(
      "Ask",
    );
  });

  it("appends a Shared chip for a thread shared with the board", () => {
    render(
      <DockBody
        {...props({
          activeId: "c1",
          activeThread: thread({
            user_id: "someone-else",
            visibility: "board",
          }),
          readOnly: true,
        })}
      />,
    );
    const row = screen.getByRole("heading").parentElement!;
    expect(row).toHaveTextContent("Shared");
  });
});

describe("DockBody — threads ledger", () => {
  const rows = [thread(), thread({ id: "c2", title: "Sprint review" })];

  it("is collapsed by default, counts the threads, and unfolds on click", async () => {
    render(<DockBody {...props({ boardThreads: rows })} />);
    expect(ledger()).toHaveAttribute("aria-expanded", "false");
    expect(ledger()).toHaveAttribute("aria-controls", "dock-threads");
    expect(ledger()).toHaveTextContent("2");
    const well = document.getElementById("dock-threads")!;
    expect(well).toHaveAttribute("hidden");
    expect(well.className).toContain("max-h-48");

    await userEvent.click(ledger());
    expect(ledger()).toHaveAttribute("aria-expanded", "true");
    expect(well).not.toHaveAttribute("hidden");
    expect(screen.getByText("Sprint review")).toBeVisible();
  });

  it("folds again when a thread is picked, and reports the pick", async () => {
    const onSelectThread = vi.fn();
    render(<DockBody {...props({ boardThreads: rows, onSelectThread })} />);
    await userEvent.click(ledger());
    await userEvent.click(screen.getByText("Sprint review"));
    expect(onSelectThread).toHaveBeenCalledWith("c2");
    expect(ledger()).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("dock-threads")).toHaveAttribute("hidden");
  });

  it("is a ledger header: kicker, hairline rule that brightens, mono count, chevron", () => {
    render(<DockBody {...props({ boardThreads: rows })} />);
    const rule = ledger().querySelector("[data-ledger-rule]")!;
    expect(rule.className).toContain("bg-border");
    expect(rule.className).toContain("group-hover/ledger:bg-border-bright");
    expect(ledger().querySelector(".tabular-nums")).toHaveTextContent("2");
    expect(ledger().querySelector("svg")).not.toBeNull();
  });

  it("shows the list skeleton inside the well while the first read is in flight, painted for the wash", async () => {
    render(<DockBody {...props({ loading: true })} />);
    await userEvent.click(ledger());
    const blocks = document
      .getElementById("dock-threads")!
      .querySelectorAll(".animate-pulse");
    expect(blocks.length).toBeGreaterThan(0);
    // On the wash an opaque `--muted` block reads as a grey rectangle punched
    // into the gradient — the chrome variant is alpha-on-parent.
    for (const block of blocks) {
      expect(block.className).toContain("bg-chrome-fill");
      expect(block.className).not.toContain("bg-muted");
    }
  });
});

describe("DockBody — transcript", () => {
  it("renders the chat on the wash and wires the busy signal", () => {
    render(<DockBody {...props()} />);
    expect(screen.getByTestId("ask-chat")).toHaveAttribute(
      "data-surface",
      "atmosphere",
    );
    expect(screen.getByTestId("ask-chat")).toHaveAttribute(
      "data-busy-wired",
      "yes",
    );
  });

  it("replaces the chat with the read-only notice on someone else's shared thread", () => {
    render(
      <DockBody
        {...props({
          activeId: "c1",
          activeThread: thread({
            user_id: "someone-else",
            visibility: "board",
          }),
          readOnly: true,
        })}
      />,
    );
    expect(screen.queryByTestId("ask-chat")).toBeNull();
    const note = screen.getByText(/only its owner can reply/i);
    expect(note.className).toContain("px-3.5");
    expect(note.className).not.toMatch(/\bborder-/);
  });

  it("shows the loading skeleton while a thread's messages are read", () => {
    render(<DockBody {...props({ threadLoading: true })} />);
    expect(
      screen.getByRole("status", { name: /loading thread/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("ask-chat")).toBeNull();
  });
});

describe("DockBody — errors", () => {
  it("shows the error with a retry, aligned to the title row and without a hairline", async () => {
    const onRetry = vi.fn();
    render(
      <DockBody {...props({ error: "Couldn't load threads.", onRetry })} />,
    );
    const message = screen.getByText("Couldn't load threads.");
    expect(message.parentElement!.className).toContain("px-3.5");
    expect(message.parentElement!.className).not.toMatch(/\bborder-b\b/);
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("offers no retry when there is nothing to re-run", () => {
    render(
      <DockBody
        {...props({ error: "Couldn't change who can see this thread." })}
      />,
    );
    expect(screen.getByText(/who can see this thread/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });
});
