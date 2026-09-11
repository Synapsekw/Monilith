import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const loadDockThreads = vi.fn();
const loadThreadMessages = vi.fn();
vi.mock("./dock-actions", () => ({
  loadDockThreads: (i: unknown) => loadDockThreads(i),
  loadThreadMessages: (i: unknown) => loadThreadMessages(i),
}));

const setThreadVisibility = vi.fn();
vi.mock("@/lib/ai/ask/conversation-actions", () => ({
  setThreadVisibility: (i: unknown) => setThreadVisibility(i),
}));

const runBoardIntelligence = vi.fn();
const dismissSuggestion = vi.fn();
vi.mock("@/lib/ai/board-intelligence/run", () => ({
  runBoardIntelligence: (i: unknown) => runBoardIntelligence(i),
  dismissSuggestion: (i: unknown) => dismissSuggestion(i),
}));

const applySuggestion = vi.fn();
vi.mock("@/lib/ai/board-intelligence/apply", () => ({
  applySuggestion: (i: unknown) => applySuggestion(i),
  revertSuggestion: vi.fn(),
}));

// The real hook reaches for a react-query client the dock is never rendered
// with; the tab's own suite covers what it does with the effects.
vi.mock("@/lib/boards/use-ai-effects", () => ({
  useApplyBoardEffects: () => vi.fn(),
}));

/**
 * AskChat is exercised by its own suite; here it stands in as a probe for what
 * the dock does TO it.
 *
 * Two things it deliberately reproduces from the real component: a per-mount
 * identity, and internal state only a remount can destroy. The earlier version
 * of this mock had neither, which is why it could not see that adopting a new
 * conversation id was unmounting a live turn.
 */
// Keyed by mount instance, never cleared on unmount: this is what lets a test
// simulate a turn's `finally` firing AFTER the reader has switched away and
// the real component has unmounted — the actual shape of finding #2's bug,
// which no amount of clicking a still-mounted button can reach, because the
// stale instance's buttons are gone from the DOM too. `vi.hoisted` because
// `vi.mock` factories are hoisted above ordinary top-level declarations.
const { busyHandlers } = vi.hoisted(() => ({
  busyHandlers: new Map<number, (busy: boolean) => void>(),
}));

vi.mock("@/components/ai/ask/AskChat", async () => {
  const { useRef, useState } = await import("react");
  let seq = 0;
  return {
    AskChat: (p: {
      conversationId: string | null;
      initialMessages: unknown[];
      boardId?: string;
      agentId?: string;
      surface?: string;
      agentNames?: Readonly<Record<string, string>>;
      agents?: readonly unknown[];
      readOnly?: boolean;
      onStarted?: (id: string) => void;
      onTurnComplete?: () => void;
      onBusyChange?: (busy: boolean) => void;
    }) => {
      const instance = useRef(0);
      if (instance.current === 0) instance.current = ++seq;
      busyHandlers.set(instance.current, p.onBusyChange ?? (() => {}));
      const [draft, setDraft] = useState("");
      return (
        <div
          data-testid="ask-chat"
          data-instance={String(instance.current)}
          data-conversation={p.conversationId ?? ""}
          data-board={p.boardId ?? ""}
          data-agent={p.agentId ?? ""}
          data-surface={p.surface ?? ""}
          data-messages={String(p.initialMessages.length)}
          data-agent-names={
            p.agentNames ? JSON.stringify(p.agentNames) : "none"
          }
          data-agents={p.agents ? String(p.agents.length) : "none"}
          data-read-only={p.readOnly ? "yes" : "no"}
        >
          {/* The real component renders the transcript AND this sentence in
              place of the composer when `readOnly` — the dock no longer
              substitutes its own notice for the whole chat (finding #7). */}
          {p.readOnly ? (
            <p>
              This thread was shared with the board. You can read it, but only
              its owner can reply.
            </p>
          ) : null}
          {/* The real `Composer` autofocuses its textarea on mount (and
              renders none at all when `readOnly`), which is what the dock's
              open-direction focus defers to — so the probe carries it too. */}
          {p.readOnly ? null : (
            <textarea autoFocus aria-label="Your question" readOnly />
          )}
          <span data-testid="chat-draft">{draft}</span>
          <button type="button" onClick={() => setDraft("in-flight turn")}>
            mock type
          </button>
          <button type="button" onClick={() => p.onStarted?.("minted-1")}>
            mock started
          </button>
          <button type="button" onClick={() => p.onTurnComplete?.()}>
            mock complete
          </button>
          <button type="button" onClick={() => p.onBusyChange?.(true)}>
            mock busy
          </button>
          <button type="button" onClick={() => p.onBusyChange?.(false)}>
            mock idle
          </button>
        </div>
      );
    },
  };
});

import { BoardDock } from "./BoardDock";
import { DOCK_MIN_WIDTH, DOCK_RAIL_WIDTH } from "./use-dock-state";
import type { BoardIntelligenceRun } from "@/lib/ai/board-intelligence/runs";
import { useBoardIntelligenceStore } from "@/stores/board-intelligence";

const AGENTS = [
  { id: "a1", name: "Morning Brief" },
  { id: "a2", name: "Overdue Chaser" },
];

const thread = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  title: "About the roadmap",
  updated_at: "2026-08-03T10:00:00Z",
  agent_id: null,
  // Docked to the board this dock is rendered for — which is what makes the
  // share toggle available at all (a boardless thread cannot be shared).
  board_id: "b1",
  visibility: "private",
  user_id: "me",
  ...over,
});

const EMPTY = { ok: true, data: { board: [], agent: [] } };
const withThread = (over: Record<string, unknown> = {}) => ({
  ok: true,
  data: { board: [thread(over)], agent: [] },
});

/** Remember this board's dock as open, the way a previous visit would have. */
const rememberOpen = () =>
  window.localStorage.setItem(
    "monolith.dock.b1",
    JSON.stringify({ open: true, width: 360 }),
  );

/** Pretend the viewport is below `md`: `useNarrowViewport` reads exactly the
 *  negated-md query, so only that query matches (a coarse pointer stays off). */
function stubNarrow() {
  const NARROW = "not all and (min-width: 48rem)";
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === NARROW,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

const aside = () =>
  document.querySelector<HTMLElement>("aside[aria-label='Agent dock']");

/** A run with two suggestions still open: one write, one browser-side filter. */
const intelRun = (): BoardIntelligenceRun => ({
  id: "r1",
  boardId: "b1",
  generatedAt: new Date().toISOString(),
  inputHash: "h1",
  model: "gemini-2.5-flash",
  tokensIn: 900,
  tokensOut: 340,
  dismissed: [],
  applied: [],
  payload: {
    brief: "Two items slipped and Design has not moved.",
    signals: [],
    suggestions: [
      {
        id: "s1",
        kind: "overdue",
        title: "Three items are overdue",
        evidence: "3 items",
        body: "Push the dates or hand them over.",
        evidenceRows: [],
        actions: [
          {
            type: "set_due",
            itemId: "i1",
            columnId: "c1",
            date: "2026-09-18",
            label: "Push to Friday",
          },
        ],
      },
      {
        id: "s2",
        kind: "stalled",
        title: "Design is stalled",
        evidence: "5 days",
        body: "Nothing in Design changed since Friday.",
        evidenceRows: [],
        actions: [
          { type: "filter", signalKind: "stalled", label: "Show stalled" },
        ],
      },
    ],
  },
});

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/boards/b1");
  loadDockThreads.mockResolvedValue(EMPTY);
  setThreadVisibility.mockResolvedValue({ ok: true, data: {} });
  runBoardIntelligence.mockResolvedValue({ ok: true, data: intelRun() });
  useBoardIntelligenceStore.setState({
    runs: {},
    openRequest: null,
    filterRequest: null,
    busy: {},
  });
});

type MountProps = {
  access?: "owner" | "editor" | "viewer";
  initialRun?: BoardIntelligenceRun | null;
};

const mount = (props: MountProps = {}) =>
  render(
    <>
      {/* The static shell's slot (app-shell.tsx). On the wide surface the dock
          portals its <aside> into it; with no slot it renders nothing. */}
      <div id="app-dock-slot" className="flex shrink-0" />
      <BoardDock
        boardId="b1"
        agents={AGENTS}
        currentUserId="me"
        access={props.access ?? "editor"}
        initialRun={props.initialRun ?? null}
      />
    </>,
  );

const openDock = () =>
  userEvent.click(screen.getByRole("button", { name: /open agent dock/i }));

const chat = () => screen.getByTestId("ask-chat");

/** Unfold the threads ledger (collapsed by default) if it is not open yet. */
const openThreads = async () => {
  const ledger = screen.getByRole("button", { name: /^threads/i });
  if (ledger.getAttribute("aria-expanded") !== "true") {
    await userEvent.click(ledger);
  }
};

/** The row's SELECT target, with the ledger unfolded. Queried through its
 *  title text because the row's share toggle is labelled with that same
 *  title, so a role+name lookup is ambiguous by construction. */
const threadRow = async (title: string) => {
  await openThreads();
  return (await screen.findByText(title)).closest("button")!;
};

/** Wait for an open/close toggle's motion window to clear. */
const settled = () =>
  waitFor(() => expect(aside()).not.toHaveAttribute("data-animating"));

describe("BoardDock", () => {
  it("fetches NOTHING while collapsed", () => {
    mount();
    expect(loadDockThreads).not.toHaveBeenCalled();
    expect(loadThreadMessages).not.toHaveBeenCalled();
  });

  it("loads threads once, on first open", async () => {
    mount();
    await openDock();
    await waitFor(() => expect(loadDockThreads).toHaveBeenCalledTimes(1));
    await userEvent.click(
      screen.getByRole("button", { name: /close agent dock/i }),
    );
    await openDock();
    expect(loadDockThreads).toHaveBeenCalledTimes(1);
  });

  it("offers Intelligence, Ask and the roster as one tab row, opening on Ask", async () => {
    mount();
    await openDock();
    expect(
      screen.getAllByRole("tab").map((t) => t.getAttribute("aria-label")),
    ).toEqual(["Intelligence", "Ask", "Morning Brief", "Overdue Chaser"]);
    expect(screen.getByRole("tab", { name: "Ask" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(chat()).toHaveAttribute("data-agent", "");
    expect(chat()).toHaveAttribute("data-board", "b1");
    expect(chat()).toHaveAttribute("data-surface", "atmosphere");
  });

  it("mounts the chat on a selected thread only once its messages are in hand", async () => {
    loadDockThreads.mockResolvedValue(withThread());
    loadThreadMessages.mockResolvedValue({
      ok: true,
      data: {
        messages: [
          { id: "m1", role: "user", content: "hi" },
          { id: "m2", role: "assistant", content: "hello" },
        ],
      },
    });
    mount();
    await openDock();
    await userEvent.click(await threadRow("About the roadmap"));

    await waitFor(() =>
      expect(chat()).toHaveAttribute("data-conversation", "c1"),
    );
    // `initialMessages` is read at mount and never again, so a chat mounted
    // before the read returned would show an empty thread forever.
    expect(chat()).toHaveAttribute("data-messages", "2");
    expect(loadThreadMessages).toHaveBeenCalledWith({ conversationId: "c1" });
  });

  it("syncs the selected thread into the URL without disturbing ?view=", async () => {
    // The board's active view lives in the same query string and is read
    // through useSearchParams(). Overwriting it here would throw the user back
    // to the default view every time they opened a thread.
    window.history.replaceState(null, "", "/boards/b1?view=kanban");
    loadDockThreads.mockResolvedValue(withThread());
    loadThreadMessages.mockResolvedValue({ ok: true, data: { messages: [] } });
    mount();
    await openDock();
    await userEvent.click(await threadRow("About the roadmap"));
    await waitFor(() =>
      expect(window.location.search).toBe("?view=kanban&thread=c1"),
    );

    // And starting a new thread drops only `thread`.
    await userEvent.click(screen.getByRole("button", { name: /new thread/i }));
    expect(window.location.search).toBe("?view=kanban");
  });

  it("reads out a thread someone else shared, and refuses a turn on it", async () => {
    // Finding #7: the dock used to swap the whole chat for that one sentence,
    // so a shared thread opened to a title row, a Shared chip and an empty
    // body. It goes through AskChat's own read-only mode now: transcript
    // rendered, composer withheld, same sentence.
    loadDockThreads.mockResolvedValue(
      withThread({ user_id: "someone-else", visibility: "board" }),
    );
    loadThreadMessages.mockResolvedValue({
      ok: true,
      data: { messages: [{ id: "m1", role: "user", content: "hi" }] },
    });
    mount();
    await openDock();
    await userEvent.click(await threadRow("About the roadmap"));
    expect(
      await screen.findByText(/only its owner can reply/i),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(chat()).toHaveAttribute("data-read-only", "yes"),
    );
    expect(chat()).toHaveAttribute("data-messages", "1");
  });

  // Finding #3: the band, the title kicker and the presence dot all name the
  // answering persona; the transcript stamped every answer "Monolith" because
  // the roster never reached it.
  it("hands the chat the persona names — but not the @handle roster", async () => {
    mount();
    await openDock();
    expect(chat()).toHaveAttribute(
      "data-agent-names",
      JSON.stringify({ a1: "Morning Brief", a2: "Overdue Chaser" }),
    );
    expect(chat()).toHaveAttribute("data-agents", "none");
  });

  it("tap an agent and talk: an agent tile starts a new thread on that persona", async () => {
    mount();
    await openDock();
    await userEvent.click(screen.getByRole("tab", { name: "Overdue Chaser" }));
    expect(chat()).toHaveAttribute("data-agent", "a2");
    expect(chat()).toHaveAttribute("data-conversation", "");
    expect(screen.getByRole("tab", { name: "Overdue Chaser" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("heading", { name: "New thread" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading").parentElement).toHaveTextContent(
      "Overdue Chaser",
    );
  });
});

// The dock hands AskChat a fresh conversation id in the MIDDLE of the turn that
// minted it — createConversation resolves before the stream opens. Keying the
// chat on that id unmounts the live turn and mounts a replacement whose
// `initialMessages` is still `[]`, and AskChat snapshots that prop at mount
// with no re-sync, so the question and the streaming answer are gone for good.
describe("BoardDock — a turn survives its own conversation being created", () => {
  it("keeps the SAME chat instance when a new thread adopts its id", async () => {
    mount();
    await openDock();
    const before = chat().getAttribute("data-instance");

    await userEvent.click(screen.getByRole("button", { name: /mock type/i }));
    expect(screen.getByTestId("chat-draft")).toHaveTextContent(
      "in-flight turn",
    );

    await userEvent.click(
      screen.getByRole("button", { name: /mock started/i }),
    );

    // Same instance, and the in-flight state it was holding is still there.
    await waitFor(() =>
      expect(chat()).toHaveAttribute("data-conversation", "minted-1"),
    );
    expect(chat()).toHaveAttribute("data-instance", before!);
    expect(screen.getByTestId("chat-draft")).toHaveTextContent(
      "in-flight turn",
    );
  });

  it("still re-reads the list when that first turn completes", async () => {
    mount();
    await openDock();
    await waitFor(() => expect(loadDockThreads).toHaveBeenCalledTimes(1));

    await userEvent.click(
      screen.getByRole("button", { name: /mock started/i }),
    );
    loadDockThreads.mockResolvedValue(
      withThread({ id: "minted-1", title: "Roadmap risks" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /mock complete/i }),
    );

    // The server auto-titles a thread on its first turn, so that one turn earns
    // a re-read of the bounded list — and the new thread appears in it, which
    // the title row picks up too (queried by role: the same title also shows
    // in the collapsed ledger's row).
    await waitFor(() => expect(loadDockThreads).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("heading", { name: "Roadmap risks" }),
    ).toBeInTheDocument();
  });

  it("DOES remount when the user genuinely starts over", async () => {
    mount();
    await openDock();
    await userEvent.click(
      screen.getByRole("button", { name: /mock started/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /mock type/i }));
    const before = chat().getAttribute("data-instance");

    await userEvent.click(screen.getByRole("button", { name: /new thread/i }));

    expect(chat()).not.toHaveAttribute("data-instance", before!);
    expect(screen.getByTestId("chat-draft")).toHaveTextContent("");
  });
});

// A dock remembered as open must arrive with its threads. The fetch used to
// hang off the click handler alone, so every visit after the first rendered an
// open, empty dock saying "No threads yet" over a board that had threads.
describe("BoardDock — restored open", () => {
  it("loads threads with no click when storage says the dock was open", async () => {
    rememberOpen();
    loadDockThreads.mockResolvedValue(withThread());
    mount();

    await waitFor(() => expect(loadDockThreads).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("About the roadmap")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /open agent dock/i }),
    ).toBeNull();
  });

  it("honours a ?thread= deep link on a restored-open dock", async () => {
    window.history.replaceState(null, "", "/boards/b1?thread=c1");
    rememberOpen();
    loadDockThreads.mockResolvedValue(withThread());
    loadThreadMessages.mockResolvedValue({ ok: true, data: { messages: [] } });
    mount();

    await waitFor(() =>
      expect(loadThreadMessages).toHaveBeenCalledWith({ conversationId: "c1" }),
    );
  });

  it("opens the thread named by a ?thread= deep link after a click, too", async () => {
    window.history.replaceState(null, "", "/boards/b1?thread=c1");
    loadDockThreads.mockResolvedValue(withThread());
    loadThreadMessages.mockResolvedValue({ ok: true, data: { messages: [] } });
    mount();
    await openDock();
    await waitFor(() =>
      expect(loadThreadMessages).toHaveBeenCalledWith({ conversationId: "c1" }),
    );
  });
});

// `ok: false` was handled; a REJECTION was not. A dropped connection, a 500 or
// a deploy that moved the action id skipped every setLoading(false) and left a
// skeleton on screen with no way back.
describe("BoardDock — a Server Action that throws", () => {
  it("clears the list skeleton and offers a retry", async () => {
    loadDockThreads.mockRejectedValueOnce(new Error("network"));
    mount();
    await openDock();

    expect(
      await screen.findByText("Couldn't load threads."),
    ).toBeInTheDocument();
    expect(screen.getByText(/no threads yet/i)).toBeInTheDocument();

    loadDockThreads.mockResolvedValueOnce(withThread());
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText("About the roadmap")).toBeInTheDocument();
  });

  it("clears the transcript skeleton when a thread read throws", async () => {
    loadDockThreads.mockResolvedValue(withThread());
    loadThreadMessages.mockRejectedValueOnce(new Error("network"));
    mount();
    await openDock();
    await userEvent.click(await threadRow("About the roadmap"));

    expect(
      await screen.findByText("Couldn't open this thread."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/loading thread/i)).toBeNull();
  });

  it("retries the read that actually failed, not always the list", async () => {
    loadDockThreads.mockResolvedValue(withThread());
    loadThreadMessages.mockResolvedValueOnce({
      ok: false,
      error: "Couldn't reach the server.",
    });
    mount();
    await openDock();
    await waitFor(() => expect(loadDockThreads).toHaveBeenCalledTimes(1));
    await userEvent.click(await threadRow("About the roadmap"));
    await screen.findByText("Couldn't reach the server.");

    loadThreadMessages.mockResolvedValueOnce({
      ok: true,
      data: { messages: [{ id: "m1", role: "user", content: "hi" }] },
    });
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => expect(loadThreadMessages).toHaveBeenCalledTimes(2));
    // The list read was NOT re-run: it never failed.
    expect(loadDockThreads).toHaveBeenCalledTimes(1);
  });

  it("re-honours a ?thread= link when the FIRST list load failed", async () => {
    window.history.replaceState(null, "", "/boards/b1?thread=c1");
    loadDockThreads.mockRejectedValueOnce(new Error("network"));
    loadThreadMessages.mockResolvedValue({ ok: true, data: { messages: [] } });
    mount();
    await openDock();
    await screen.findByText("Couldn't load threads.");
    expect(loadThreadMessages).not.toHaveBeenCalled();

    loadDockThreads.mockResolvedValueOnce(withThread());
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    // The link the user followed is still the link they followed.
    await waitFor(() =>
      expect(loadThreadMessages).toHaveBeenCalledWith({ conversationId: "c1" }),
    );
  });
});

describe("BoardDock — sharing a thread with the board", () => {
  it("flips visibility optimistically and persists it", async () => {
    loadDockThreads.mockResolvedValue(withThread());
    mount();
    await openDock();
    await openThreads();

    await userEvent.click(
      await screen.findByRole("button", {
        name: /share "about the roadmap" with this board/i,
      }),
    );

    expect(setThreadVisibility).toHaveBeenCalledWith({
      conversationId: "c1",
      visibility: "board",
    });
    // The row reports its new state without waiting for a re-read.
    expect(
      await screen.findByRole("button", {
        name: /make "about the roadmap" private/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/shared/i)).toBeInTheDocument();
  });

  it("takes a shared thread back", async () => {
    loadDockThreads.mockResolvedValue(withThread({ visibility: "board" }));
    mount();
    await openDock();
    await openThreads();

    await userEvent.click(
      await screen.findByRole("button", {
        name: /make "about the roadmap" private/i,
      }),
    );
    expect(setThreadVisibility).toHaveBeenCalledWith({
      conversationId: "c1",
      visibility: "private",
    });
  });

  it("reverts and says so when the action refuses", async () => {
    loadDockThreads.mockResolvedValue(withThread());
    setThreadVisibility.mockResolvedValue({
      ok: false,
      error: "Couldn't change who can see this thread.",
    });
    mount();
    await openDock();
    await openThreads();

    await userEvent.click(
      await screen.findByRole("button", {
        name: /share "about the roadmap" with this board/i,
      }),
    );

    expect(
      await screen.findByText("Couldn't change who can see this thread."),
    ).toBeInTheDocument();
    // Rolled back: the control offers the same action it did before.
    expect(
      screen.getByRole("button", {
        name: /share "about the roadmap" with this board/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^shared$/i)).toBeNull();
    // Nothing to re-run — the row already tells the truth again.
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });

  it("reverts when the action throws", async () => {
    loadDockThreads.mockResolvedValue(withThread());
    setThreadVisibility.mockRejectedValue(new Error("network"));
    mount();
    await openDock();
    await openThreads();

    await userEvent.click(
      await screen.findByRole("button", {
        name: /share "about the roadmap" with this board/i,
      }),
    );

    expect(
      await screen.findByText("Couldn't change who can see this thread."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /share "about the roadmap" with this board/i,
      }),
    ).toBeInTheDocument();
  });
});

// The dock is two sections now. The rule that matters is that SWITCHING between
// them is free: the thread read is guarded by `loaded`, and the Intelligence
// tab renders a run the page already handed to the store.
describe("BoardDock — Chat and Intelligence", () => {
  const openIntelligence = () =>
    userEvent.click(screen.getByRole("tab", { name: /intelligence/i }));

  it("shows every tile and opens on Ask with the title row", async () => {
    mount();
    await openDock();
    expect(
      screen.getAllByRole("tab").map((t) => t.getAttribute("aria-label")),
    ).toEqual(["Intelligence", "Ask", "Morning Brief", "Overdue Chaser"]);
    expect(screen.getByRole("tab", { name: "Ask" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("heading", { name: "New thread" }),
    ).toBeInTheDocument();
  });

  it("hands the band over to Intelligence, and never re-reads the threads", async () => {
    mount({ initialRun: intelRun() });
    await openDock();
    await waitFor(() => expect(loadDockThreads).toHaveBeenCalledTimes(1));

    await openIntelligence();
    expect(screen.queryByRole("button", { name: /new thread/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: "New thread" })).toBeNull();
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "dock-tab-intelligence",
    );

    await userEvent.click(screen.getByRole("tab", { name: "Ask" }));
    expect(
      screen.getByRole("button", { name: /new thread/i }),
    ).toBeInTheDocument();
    await openIntelligence();
    expect(loadDockThreads).toHaveBeenCalledTimes(1);
  });

  it("counts the unresolved suggestions on the Intelligence tile, in words", async () => {
    mount({ initialRun: intelRun() });
    await openDock();
    const intel = screen.getByRole("tab", {
      name: "Intelligence · 2 suggestions",
    });
    expect(intel.querySelector("[data-dock-badge]")).toHaveTextContent("2");
  });

  it("lets a viewer read and filter, but never apply", async () => {
    mount({ access: "viewer", initialRun: intelRun() });
    await openDock();
    await openIntelligence();

    expect(screen.getByText("Three items are overdue")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Push to Friday" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show stalled" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Read-only · /)).toBeInTheDocument();
  });

  it("reads the board ONCE when the tab is opened with nothing cached", async () => {
    mount({ initialRun: null });
    await openDock();
    expect(runBoardIntelligence).not.toHaveBeenCalled();

    await openIntelligence();
    await waitFor(() =>
      expect(runBoardIntelligence).toHaveBeenCalledWith({
        boardId: "b1",
        force: false,
      }),
    );
    expect(runBoardIntelligence).toHaveBeenCalledTimes(1);

    // Coming back to the tab renders the run that read produced — it does not
    // read again.
    await userEvent.click(screen.getByRole("tab", { name: "Ask" }));
    await openIntelligence();
    expect(runBoardIntelligence).toHaveBeenCalledTimes(1);
  });

  it("reads NOTHING on page load when the dock was left open on Intelligence", async () => {
    // `tab` is remembered per board, so the dock comes back where it was left.
    // Restoring a tab is not the reader asking for a brief — kicking a model
    // call here is a metered request on first paint, which the budget forbids.
    window.localStorage.setItem(
      "monolith.dock.b1",
      JSON.stringify({ open: true, width: 360, tab: "intelligence" }),
    );
    mount({ initialRun: null });
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: /intelligence/i }),
      ).toHaveAttribute("aria-selected", "true"),
    );
    await act(async () => {});
    expect(runBoardIntelligence).not.toHaveBeenCalled();

    // Asking for it — leaving and coming back to the tab — still reads once.
    await userEvent.click(screen.getByRole("tab", { name: "Ask" }));
    await openIntelligence();
    await waitFor(() => expect(runBoardIntelligence).toHaveBeenCalledTimes(1));
  });
});

// The strip's "Catch me up" lives in a different subtree, so it asks through
// the store. A request must open the dock, land on the right section, read the
// board once, and then be gone — a request that survived would re-fire on every
// later render.
describe("BoardDock — the strip asks for a brief", () => {
  it("opens on Intelligence and reads the board once", async () => {
    mount();
    expect(
      screen.getByRole("button", { name: /open agent dock/i }),
    ).toBeInTheDocument();

    await act(async () => {
      useBoardIntelligenceStore.getState().requestOpen("b1", { run: true });
    });

    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: /intelligence/i }),
      ).toHaveAttribute("aria-selected", "true"),
    );
    await waitFor(() => expect(runBoardIntelligence).toHaveBeenCalledTimes(1));
    expect(useBoardIntelligenceStore.getState().openRequest).toBeNull();
  });

  it("ignores a request meant for another board", async () => {
    mount();
    await act(async () => {
      useBoardIntelligenceStore.getState().requestOpen("other", { run: true });
    });
    expect(
      screen.getByRole("button", { name: /open agent dock/i }),
    ).toBeInTheDocument();
    expect(runBoardIntelligence).not.toHaveBeenCalled();
  });
});

// The dock is chrome, not content (spec §1): it leaves the board page's flex
// row and renders through the static shell's slot, beside the card.
describe("BoardDock — placement in the shell's dock slot", () => {
  it("portals the wide dock into #app-dock-slot, closed and open", async () => {
    mount();
    const slot = document.getElementById("app-dock-slot")!;
    await waitFor(() => expect(slot).not.toBeEmptyDOMElement());
    expect(aside()!.closest("#app-dock-slot")).toBe(slot);
    expect(aside()!.querySelector("[data-layer='mini']")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /open agent dock/i }).closest("aside"),
    ).toBe(aside());

    await openDock();
    expect(aside()!.querySelector("[data-layer='full']")).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: /close agent dock/i })
        .closest("aside"),
    ).toBe(aside());
  });

  it("renders nothing on the wide surface when the page has no slot", async () => {
    render(<BoardDock boardId="b1" agents={AGENTS} currentUserId="me" />);
    await act(async () => {});
    expect(aside()).toBeNull();
    expect(
      screen.queryByRole("button", { name: /open agent dock/i }),
    ).toBeNull();
    expect(loadDockThreads).not.toHaveBeenCalled();
  });

  it("is DOCK_RAIL_WIDTH closed and the remembered width open", async () => {
    mount();
    await waitFor(() => expect(aside()).not.toBeNull());
    expect(aside()!.style.width).toBe(`${DOCK_RAIL_WIDTH}px`);
    expect(aside()).toHaveAttribute("data-open", "false");
    await openDock();
    expect(aside()!.style.width).toBe(`${DOCK_MIN_WIDTH}px`);
    expect(aside()).toHaveAttribute("data-open", "true");
  });

  it("keeps the floating trigger and the Sheet below md — no portal there", async () => {
    stubNarrow();
    mount();
    const trigger = screen.getByRole("button", { name: /open agent dock/i });
    expect(trigger.closest("#app-dock-slot")).toBeNull();
    expect(aside()).toBeNull();
    await userEvent.click(trigger);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /close agent dock/i }),
    ).toBeInTheDocument();
  });
});

// Spec §2 selection semantics: a tile is "tap an agent and talk". Same
// persona as the thread on screen is a no-op; a different one starts over.
describe("BoardDock — tile selection", () => {
  it("re-tapping the open thread's agent is a no-op; another persona starts over", async () => {
    loadDockThreads.mockResolvedValue(withThread({ agent_id: "a1" }));
    loadThreadMessages.mockResolvedValue({ ok: true, data: { messages: [] } });
    mount();
    await openDock();
    await userEvent.click(await threadRow("About the roadmap"));
    await waitFor(() =>
      expect(chat()).toHaveAttribute("data-conversation", "c1"),
    );
    const instance = chat().getAttribute("data-instance");
    expect(screen.getByRole("tab", { name: "Morning Brief" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await userEvent.click(screen.getByRole("tab", { name: "Morning Brief" }));
    expect(chat()).toHaveAttribute("data-conversation", "c1");
    expect(chat()).toHaveAttribute("data-instance", instance!);

    await userEvent.click(screen.getByRole("tab", { name: "Ask" }));
    expect(chat()).toHaveAttribute("data-conversation", "");
    expect(chat()).not.toHaveAttribute("data-instance", instance!);
    expect(window.location.search).toBe("");
  });

  it("New starts over on the persona on screen and is disabled until there is a thread", async () => {
    mount();
    await openDock();
    expect(screen.getByRole("button", { name: /new thread/i })).toBeDisabled();
    await userEvent.click(screen.getByRole("tab", { name: "Overdue Chaser" }));
    await userEvent.click(
      screen.getByRole("button", { name: /mock started/i }),
    );
    expect(screen.getByRole("button", { name: /new thread/i })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: /new thread/i }));
    expect(chat()).toHaveAttribute("data-conversation", "");
    expect(chat()).toHaveAttribute("data-agent", "a2");
  });

  it("selecting Intelligence by tile counts as asking for it", async () => {
    mount({ initialRun: null });
    await openDock();
    await userEvent.click(screen.getByRole("tab", { name: "Intelligence" }));
    await waitFor(() => expect(runBoardIntelligence).toHaveBeenCalledTimes(1));
  });

  it("pulses the answering agent's tile while its turn streams, and only then", async () => {
    mount();
    await openDock();
    await userEvent.click(screen.getByRole("tab", { name: "Morning Brief" }));
    expect(document.querySelector("[data-dock-presence]")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /mock busy/i }));
    const running = screen.getByRole("tab", {
      name: "Morning Brief · running",
    });
    expect(running.querySelector("[data-dock-presence]")).not.toBeNull();
    expect(
      screen
        .getByRole("tab", { name: "Overdue Chaser" })
        .querySelector("[data-dock-presence]"),
    ).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /mock idle/i }));
    expect(
      screen.getByRole("tab", { name: "Morning Brief" }),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-dock-presence]")).toBeNull();
  });

  // Finding #2: `startNewAs` unmounts the old `AskChat` (a fresh `key`), but
  // its `onSubmit` promise keeps running detached — real turns are never
  // aborted on unmount. That stale instance's `finally` still fires
  // `onBusyChange(false)` on whichever closure it was handed before it
  // unmounted. A clear that isn't scoped to the turn that is actually
  // ending would blank whatever persona is running NOW.
  it("a stale turn settling after a tile switch does not clear the new persona's dot", async () => {
    mount();
    await openDock();
    await userEvent.click(screen.getByRole("tab", { name: "Morning Brief" }));
    const staleInstance = Number(chat().getAttribute("data-instance"));
    await userEvent.click(screen.getByRole("button", { name: /mock busy/i }));
    expect(
      screen
        .getByRole("tab", { name: "Morning Brief · running" })
        .querySelector("[data-dock-presence]"),
    ).not.toBeNull();

    // Switch tiles before that turn settles. The old AskChat (captured above
    // as `staleInstance`) unmounts; its buttons are gone from the DOM, which
    // is exactly why this can't be driven by clicking — `busyHandlers` (the
    // mock's escape hatch) still holds its `onBusyChange` closure.
    await userEvent.click(screen.getByRole("tab", { name: "Overdue Chaser" }));
    expect(chat().getAttribute("data-instance")).not.toBe(
      String(staleInstance),
    );
    await userEvent.click(screen.getByRole("button", { name: /mock busy/i }));
    expect(
      screen
        .getByRole("tab", { name: "Overdue Chaser · running" })
        .querySelector("[data-dock-presence]"),
    ).not.toBeNull();

    // The stale, unmounted instance's turn finally settles.
    act(() => busyHandlers.get(staleInstance)?.(false));

    expect(
      screen
        .getByRole("tab", { name: "Overdue Chaser · running" })
        .querySelector("[data-dock-presence]"),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("tab", { name: "Morning Brief" })
        .querySelector("[data-dock-presence]"),
    ).toBeNull();
  });

  // Finding #5: the earlier presence tests only ever mount fresh, so
  // `currentPersona` always comes from the queued `agentId` branch — never
  // from an OPEN thread's own persona, which is the branch finding #2's race
  // actually lives in.
  it("shows presence for an existing, already-open thread's own persona", async () => {
    loadDockThreads.mockResolvedValue(withThread({ agent_id: "a1" }));
    loadThreadMessages.mockResolvedValue({ ok: true, data: { messages: [] } });
    mount();
    await openDock();
    await userEvent.click(await threadRow("About the roadmap"));
    await waitFor(() =>
      expect(chat()).toHaveAttribute("data-conversation", "c1"),
    );

    await userEvent.click(screen.getByRole("button", { name: /mock busy/i }));
    expect(
      screen
        .getByRole("tab", { name: "Morning Brief · running" })
        .querySelector("[data-dock-presence]"),
    ).not.toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /mock idle/i }));
    expect(document.querySelector("[data-dock-presence]")).toBeNull();
  });
});

// Spec §8 + finding #1: the band is a tablist with MANUAL activation, because
// activating a tile here is not free — it starts a new thread on that persona.
describe("BoardDock — the band's keyboard", () => {
  it("arrowing across the band does not close the open thread; Enter does", async () => {
    loadDockThreads.mockResolvedValue(withThread({ agent_id: "a1" }));
    loadThreadMessages.mockResolvedValue({
      ok: true,
      data: { messages: [{ id: "m1", role: "user", content: "hi" }] },
    });
    mount();
    await openDock();
    await userEvent.click(await threadRow("About the roadmap"));
    await waitFor(() =>
      expect(chat()).toHaveAttribute("data-conversation", "c1"),
    );
    const instance = chat().getAttribute("data-instance");
    // Half a question typed into the composer, which a remount would eat.
    await userEvent.click(screen.getByRole("button", { name: /mock type/i }));
    expect(screen.getByTestId("chat-draft")).toHaveTextContent(
      "in-flight turn",
    );

    // One glance along the roster: back over Ask, onto Intelligence, then all
    // the way out to the far end.
    screen.getByRole("tab", { name: "Morning Brief" }).focus();
    await userEvent.keyboard(
      "{ArrowLeft}{ArrowLeft}{ArrowRight}{ArrowRight}{ArrowRight}",
    );

    // The thread, its id in the URL, the draft and the chat instance all
    // survive; arrowing onto Intelligence did not kick a model call either.
    expect(chat()).toHaveAttribute("data-conversation", "c1");
    expect(chat().getAttribute("data-instance")).toBe(instance);
    expect(screen.getByTestId("chat-draft")).toHaveTextContent(
      "in-flight turn",
    );
    expect(window.location.search).toContain("thread=c1");
    expect(runBoardIntelligence).not.toHaveBeenCalled();
    // Focus DID move — and stayed in the band rather than being pulled into
    // a remounted composer.
    expect(screen.getByRole("tab", { name: "Overdue Chaser" })).toHaveFocus();

    // Enter is the activation, and it does start the new thread.
    await userEvent.keyboard("{Enter}");
    expect(chat()).toHaveAttribute("data-conversation", "");
    expect(chat()).toHaveAttribute("data-agent", "a2");
    expect(window.location.search).not.toContain("thread=");
  });
});

// Finding #2: `onBusyChange`'s guard correctly refuses a stale `false`, but
// nothing then cleared the dot for the turn that was ABANDONED — the reader
// walked away from it, so the `false` that would have cleared it is exactly
// the one the guard ignores.
describe("BoardDock — an abandoned turn's presence dot", () => {
  it("clears when the reader switches persona without starting a new turn", async () => {
    mount();
    await openDock();
    await userEvent.click(screen.getByRole("tab", { name: "Morning Brief" }));
    await userEvent.click(screen.getByRole("button", { name: /mock busy/i }));
    expect(
      screen.getByRole("tab", { name: "Morning Brief · running" }),
    ).toBeInTheDocument();

    // Switch tiles and ask nothing. The old chat is unmounted knowingly.
    await userEvent.click(screen.getByRole("tab", { name: "Overdue Chaser" }));
    expect(document.querySelector("[data-dock-presence]")).toBeNull();
    expect(
      screen.getByRole("tab", { name: "Morning Brief" }),
    ).toBeInTheDocument();
  });

  it("clears when the reader opens an older thread mid-stream", async () => {
    loadDockThreads.mockResolvedValue(withThread());
    loadThreadMessages.mockResolvedValue({ ok: true, data: { messages: [] } });
    mount();
    await openDock();
    await userEvent.click(screen.getByRole("tab", { name: "Morning Brief" }));
    await userEvent.click(screen.getByRole("button", { name: /mock busy/i }));
    expect(
      screen.getByRole("tab", { name: "Morning Brief · running" }),
    ).toBeInTheDocument();

    await userEvent.click(await threadRow("About the roadmap"));
    await waitFor(() =>
      expect(chat()).toHaveAttribute("data-conversation", "c1"),
    );
    expect(document.querySelector("[data-dock-presence]")).toBeNull();
  });
});

// Finding #4: `inert` lands on the leaving layer in the same commit, so the
// control the reader just pressed is blurred and focus falls to <body> — the
// next Tab restarts from the top of the page.
describe("BoardDock — focus across a fold", () => {
  it("hands focus to the rail on close", async () => {
    mount();
    await openDock();
    await settled();
    await userEvent.click(screen.getByRole("tab", { name: "Morning Brief" }));

    await userEvent.click(
      screen.getByRole("button", { name: /close agent dock/i }),
    );
    await settled();
    expect(document.body).not.toBe(document.activeElement);
    expect(
      screen.getByRole("button", { name: /open agent dock/i }),
    ).toHaveFocus();
  });

  // Opening is the direction the chat already answers for itself: the reader
  // came here to type, and the composer autofocuses. The dock must not take
  // the caret off it and park it on a tab tile — that would be worse than
  // what shipped before this branch.
  it("leaves the caret in the composer when the dock opens on a persona", async () => {
    mount();
    await userEvent.click(
      await screen.findByRole("tab", { name: "Morning Brief" }),
    );
    await settled();
    expect(screen.getByLabelText("Your question")).toHaveFocus();
    expect(
      screen.getByRole("tab", { name: "Morning Brief" }),
    ).not.toHaveFocus();

    // And re-opening from the rail's own button, with a persona already
    // chosen, does the same.
    await userEvent.click(
      screen.getByRole("button", { name: /close agent dock/i }),
    );
    await settled();
    await openDock();
    await settled();
    expect(screen.getByLabelText("Your question")).toHaveFocus();
  });

  it("focuses the band tile when the open tab has no composer to catch it", async () => {
    mount({ initialRun: intelRun() });
    await userEvent.click(
      await screen.findByRole("tab", { name: /^intelligence/i }),
    );
    await settled();
    expect(screen.getByRole("tab", { name: /^intelligence/i })).toHaveFocus();
  });

  it("focuses the band tile for a shared thread, which withholds the composer", async () => {
    // The predicate is "did this layer take the caret?", not "is this
    // Intelligence?" — a read-only thread renders a transcript and no
    // composer, and must not drop focus to <body> either.
    loadDockThreads.mockResolvedValue(
      withThread({ user_id: "someone-else", visibility: "board" }),
    );
    loadThreadMessages.mockResolvedValue({ ok: true, data: { messages: [] } });
    mount();
    await openDock();
    await settled();
    await userEvent.click(await threadRow("About the roadmap"));
    await waitFor(() =>
      expect(chat()).toHaveAttribute("data-read-only", "yes"),
    );

    await userEvent.click(
      screen.getByRole("button", { name: /close agent dock/i }),
    );
    await settled();
    await openDock();
    await settled();
    expect(screen.queryByLabelText("Your question")).toBeNull();
    expect(screen.getByRole("tab", { name: "Ask" })).toHaveFocus();
  });
});

// Finding #6: both layers mount their tiles for the ~360ms of a fold.
describe("BoardDock — the two layers' tile ids", () => {
  it("never mints the same tile id twice, and the rail controls no panel", async () => {
    mount();
    await waitFor(() => expect(aside()).not.toBeNull());
    // Collapsed: only the rail's tiles exist, and there is no panel for them
    // to point at.
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).not.toHaveAttribute("aria-controls");
      expect(tab.id).toMatch(/^dock-rail-tab-/);
    }

    // Mid-fold: BOTH layers are mounted. Every id in the document is unique,
    // so the chat panel's `aria-labelledby` can only resolve to the band's.
    await openDock();
    const ids = [...aside()!.querySelectorAll("[role='tab']")].map((t) => t.id);
    expect(ids.length).toBe(8);
    expect(new Set(ids).size).toBe(ids.length);
    const panel = document.getElementById("dock-panel-chat")!;
    const labelledBy = panel.getAttribute("aria-labelledby")!;
    expect(labelledBy).toBe("dock-tab-ask");
    expect(document.getElementById(labelledBy)!.closest("[data-layer]")).toBe(
      aside()!.querySelector("[data-layer='full']"),
    );
    expect(document.querySelectorAll(`[id='${labelledBy}']`).length).toBe(1);
  });
});

// Spec §4: closed, the dock is a 48px rail of the SAME tiles. Any tile opens
// the dock on that tile. Presence and the badge stay visible.
describe("BoardDock — mini rail", () => {
  it("shows the tiles vertically at rail width, badge intact, edge bar on the right, no fetch", async () => {
    mount({ initialRun: intelRun() });
    await waitFor(() => expect(aside()).not.toBeNull());
    expect(screen.getByRole("tablist")).toHaveAttribute(
      "aria-orientation",
      "vertical",
    );
    expect(
      screen.getAllByRole("tab").map((t) => t.getAttribute("aria-label")),
    ).toEqual([
      "Intelligence · 2 suggestions",
      "Ask",
      "Morning Brief",
      "Overdue Chaser",
    ]);
    expect(aside()!.style.width).toBe(`${DOCK_RAIL_WIDTH}px`);
    // Inside the tile's own right edge: the aside is `overflow-hidden` at
    // 48px, so a bar hung 8px OUTSIDE a centred tile was clipped to ~1px —
    // and to nothing at all at `pointer-coarse` size (finding #5).
    expect(screen.getByRole("tab", { name: "Ask" }).className).toContain(
      "after:right-0",
    );
    expect(screen.getByRole("tab", { name: "Ask" }).className).not.toContain(
      "after:-right-2",
    );
    expect(screen.queryByRole("separator")).toBeNull();
    expect(loadDockThreads).not.toHaveBeenCalled();
  });

  it("opens on the tapped agent and starts a new thread on it", async () => {
    mount();
    await userEvent.click(
      await screen.findByRole("tab", { name: "Overdue Chaser" }),
    );
    await settled();
    expect(aside()).toHaveAttribute("data-open", "true");
    expect(screen.getByRole("tablist")).not.toHaveAttribute("aria-orientation");
    expect(chat()).toHaveAttribute("data-agent", "a2");
    expect(screen.getByRole("tab", { name: "Overdue Chaser" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() => expect(loadDockThreads).toHaveBeenCalledTimes(1));
  });

  it("opens on Intelligence from the rail, rendering the cached run", async () => {
    mount({ initialRun: intelRun() });
    await userEvent.click(
      await screen.findByRole("tab", { name: /^intelligence/i }),
    );
    await settled();
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "dock-tab-intelligence",
    );
    expect(screen.getByText("Three items are overdue")).toBeInTheDocument();
    expect(runBoardIntelligence).not.toHaveBeenCalled();
  });

  it("keeps the presence dot on the rail while a turn streams", async () => {
    mount();
    await openDock();
    await userEvent.click(screen.getByRole("tab", { name: "Morning Brief" }));
    await userEvent.click(screen.getByRole("button", { name: /mock busy/i }));
    await userEvent.click(
      screen.getByRole("button", { name: /close agent dock/i }),
    );
    await settled();
    expect(
      screen
        .getByRole("tab", { name: "Morning Brief · running" })
        .querySelector("[data-dock-presence]"),
    ).not.toBeNull();
  });
});

// Spec §5: the width transition exists only while a toggle is in flight, so a
// drag or keyboard resize is instant; the two layers crossfade.
describe("BoardDock — motion", () => {
  it("animates the width only during a toggle, never during a resize", async () => {
    mount();
    await openDock();
    expect(aside()).toHaveAttribute("data-animating");
    expect(aside()!.className).toContain("transition-[width]");
    await settled();
    expect(aside()!.className).not.toContain("transition-[width]");

    const grip = screen.getByRole("separator", { name: /resize agent dock/i });
    grip.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(aside()!.style.width).toBe(`${DOCK_MIN_WIDTH + 16}px`);
    expect(aside()).not.toHaveAttribute("data-animating");

    // Finding #4: the keyboard case alone doesn't exercise
    // pointerdown/pointermove/pointerup — drive the drag path explicitly,
    // since a real drag must stay just as instant.
    fireEvent.pointerDown(grip, { clientX: 400 });
    expect(aside()).not.toHaveAttribute("data-animating");
    fireEvent(
      window,
      new (class extends Event {
        clientX = 350;
        constructor() {
          super("pointermove");
        }
      })(),
    );
    expect(aside()).not.toHaveAttribute("data-animating");
    expect(aside()!.className).not.toContain("transition-[width]");
    fireEvent(window, new Event("pointerup"));
    expect(aside()).not.toHaveAttribute("data-animating");
  });

  it("keeps both layer wrappers mounted and inerts the one that is leaving", async () => {
    mount();
    await waitFor(() => expect(aside()).not.toBeNull());
    const full = () => aside()!.querySelector("[data-layer='full']")!;
    const mini = () => aside()!.querySelector("[data-layer='mini']")!;
    expect(full()).toBeEmptyDOMElement();
    expect(full()).toHaveAttribute("inert");
    expect(mini()).not.toHaveAttribute("inert");

    await openDock();
    // Mid-toggle: the mini layer is still mounted but out of the a11y tree.
    expect(mini()).toHaveAttribute("inert");
    expect(mini()).toHaveAttribute("aria-hidden", "true");
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    await settled();
    expect(mini()).toBeEmptyDOMElement();
    expect(full()).not.toBeEmptyDOMElement();
  });
});
