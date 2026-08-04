import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

/**
 * AskChat is exercised by its own suite; here it stands in as a probe for what
 * the dock does TO it.
 *
 * Two things it deliberately reproduces from the real component: a per-mount
 * identity, and internal state only a remount can destroy. The earlier version
 * of this mock had neither, which is why it could not see that adopting a new
 * conversation id was unmounting a live turn.
 */
vi.mock("@/components/ai/ask/AskChat", async () => {
  const { useRef, useState } = await import("react");
  let seq = 0;
  return {
    AskChat: (p: {
      conversationId: string | null;
      initialMessages: unknown[];
      boardId?: string;
      agentId?: string;
      onStarted?: (id: string) => void;
      onTurnComplete?: () => void;
    }) => {
      const instance = useRef(0);
      if (instance.current === 0) instance.current = ++seq;
      const [draft, setDraft] = useState("");
      return (
        <div
          data-testid="ask-chat"
          data-instance={String(instance.current)}
          data-conversation={p.conversationId ?? ""}
          data-board={p.boardId ?? ""}
          data-agent={p.agentId ?? ""}
          data-messages={String(p.initialMessages.length)}
        >
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
        </div>
      );
    },
  };
});

import { BoardDock } from "./BoardDock";

const AGENTS = [
  { id: "a1", name: "Morning Brief" },
  { id: "a2", name: "Overdue Chaser" },
];

const thread = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  title: "About the roadmap",
  updated_at: "2026-08-03T10:00:00Z",
  agent_id: null,
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

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/boards/b1");
  loadDockThreads.mockResolvedValue(EMPTY);
  setThreadVisibility.mockResolvedValue({ ok: true, data: {} });
});

const mount = () =>
  render(<BoardDock boardId="b1" agents={AGENTS} currentUserId="me" />);

const openDock = () =>
  userEvent.click(screen.getByRole("button", { name: /open agent dock/i }));

const chat = () => screen.getByTestId("ask-chat");

/** The row's SELECT target. Queried through its title text because the row's
 *  share toggle is labelled with that same title, so a role+name lookup is
 *  ambiguous by construction. */
const threadRow = async (title: string) =>
  (await screen.findByText(title)).closest("button")!;

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

  it("offers Ask as the first switcher entry, with no persona", async () => {
    mount();
    await openDock();
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("Ask");
    expect(options.map((o) => o.textContent)).toEqual([
      "Ask",
      "Morning Brief",
      "Overdue Chaser",
    ]);
    expect(chat()).toHaveAttribute("data-agent", "");
    expect(chat()).toHaveAttribute("data-board", "b1");
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
    await userEvent.click(screen.getByRole("button", { name: /^new$/i }));
    expect(window.location.search).toBe("?view=kanban");
  });

  it("refuses a turn on a thread someone else shared", async () => {
    loadDockThreads.mockResolvedValue(
      withThread({ user_id: "someone-else", visibility: "board" }),
    );
    loadThreadMessages.mockResolvedValue({ ok: true, data: { messages: [] } });
    mount();
    await openDock();
    await userEvent.click(await threadRow("About the roadmap"));
    expect(
      await screen.findByText(/only its owner can reply/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("ask-chat")).toBeNull();
  });

  it("carries the chosen persona into a new thread", async () => {
    mount();
    await openDock();
    await userEvent.selectOptions(screen.getByRole("combobox"), "a2");
    expect(chat()).toHaveAttribute("data-agent", "a2");
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
    // a re-read of the bounded list — and the new thread appears in it.
    await waitFor(() => expect(loadDockThreads).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Roadmap risks")).toBeInTheDocument();
  });

  it("DOES remount when the user genuinely starts over", async () => {
    mount();
    await openDock();
    await userEvent.click(
      screen.getByRole("button", { name: /mock started/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /mock type/i }));
    const before = chat().getAttribute("data-instance");

    await userEvent.click(screen.getByRole("button", { name: /^new$/i }));

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
