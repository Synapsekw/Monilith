import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const loadDockThreads = vi.fn();
const loadThreadMessages = vi.fn();
vi.mock("./dock-actions", () => ({
  loadDockThreads: (i: unknown) => loadDockThreads(i),
  loadThreadMessages: (i: unknown) => loadThreadMessages(i),
}));

// AskChat is exercised by its own suite; here it stands in as a probe for the
// props the dock hands it, so this file tests the DOCK, not the chat.
vi.mock("@/components/ai/ask/AskChat", () => ({
  AskChat: (p: {
    conversationId: string | null;
    initialMessages: unknown[];
    boardId?: string;
    agentId?: string;
  }) => (
    <div
      data-testid="ask-chat"
      data-conversation={p.conversationId ?? ""}
      data-board={p.boardId ?? ""}
      data-agent={p.agentId ?? ""}
      data-messages={p.initialMessages.length}
    />
  ),
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/boards/b1");
  loadDockThreads.mockResolvedValue(EMPTY);
});

const openDock = () =>
  userEvent.click(screen.getByRole("button", { name: /open agent dock/i }));

describe("BoardDock", () => {
  it("fetches NOTHING while collapsed", () => {
    render(<BoardDock boardId="b1" agents={AGENTS} currentUserId="me" />);
    expect(loadDockThreads).not.toHaveBeenCalled();
    expect(loadThreadMessages).not.toHaveBeenCalled();
  });

  it("loads threads once, on first open", async () => {
    render(<BoardDock boardId="b1" agents={AGENTS} currentUserId="me" />);
    await openDock();
    expect(loadDockThreads).toHaveBeenCalledTimes(1);
    await userEvent.click(
      screen.getByRole("button", { name: /close agent dock/i }),
    );
    await openDock();
    expect(loadDockThreads).toHaveBeenCalledTimes(1);
  });

  it("offers Ask as the first switcher entry, with no persona", async () => {
    render(<BoardDock boardId="b1" agents={AGENTS} currentUserId="me" />);
    await openDock();
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("Ask");
    expect(options.map((o) => o.textContent)).toEqual([
      "Ask",
      "Morning Brief",
      "Overdue Chaser",
    ]);
    expect(screen.getByTestId("ask-chat")).toHaveAttribute("data-agent", "");
    expect(screen.getByTestId("ask-chat")).toHaveAttribute("data-board", "b1");
  });

  it("lets a failed load be retried instead of stranding an empty dock", async () => {
    loadDockThreads.mockResolvedValueOnce({
      ok: false,
      error: "Couldn't load threads.",
    });
    render(<BoardDock boardId="b1" agents={AGENTS} currentUserId="me" />);
    await openDock();
    await screen.findByText("Couldn't load threads.");

    loadDockThreads.mockResolvedValueOnce({
      ok: true,
      data: { board: [thread()], agent: [] },
    });
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByText("About the roadmap")).toBeInTheDocument();
    expect(loadDockThreads).toHaveBeenCalledTimes(2);
  });

  it("mounts the chat on a selected thread only once its messages are in hand", async () => {
    loadDockThreads.mockResolvedValue({
      ok: true,
      data: { board: [thread()], agent: [] },
    });
    loadThreadMessages.mockResolvedValue({
      ok: true,
      data: {
        messages: [
          { id: "m1", role: "user", content: "hi" },
          { id: "m2", role: "assistant", content: "hello" },
        ],
      },
    });
    render(<BoardDock boardId="b1" agents={AGENTS} currentUserId="me" />);
    await openDock();
    await userEvent.click(
      await screen.findByRole("button", { name: /about the roadmap/i }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("ask-chat")).toHaveAttribute(
        "data-conversation",
        "c1",
      ),
    );
    // `initialMessages` is read at mount and never again, so a chat mounted
    // before the read returned would show an empty thread forever.
    expect(screen.getByTestId("ask-chat")).toHaveAttribute(
      "data-messages",
      "2",
    );
    expect(loadThreadMessages).toHaveBeenCalledWith({ conversationId: "c1" });
  });

  it("syncs the selected thread into the URL without disturbing ?view=", async () => {
    // The board's active view lives in the same query string and is read
    // through useSearchParams(). Overwriting it here would throw the user back
    // to the default view every time they opened a thread.
    window.history.replaceState(null, "", "/boards/b1?view=kanban");
    loadDockThreads.mockResolvedValue({
      ok: true,
      data: { board: [thread()], agent: [] },
    });
    loadThreadMessages.mockResolvedValue({ ok: true, data: { messages: [] } });
    render(<BoardDock boardId="b1" agents={AGENTS} currentUserId="me" />);
    await openDock();
    await userEvent.click(
      await screen.findByRole("button", { name: /about the roadmap/i }),
    );
    await waitFor(() =>
      expect(window.location.search).toBe("?view=kanban&thread=c1"),
    );

    // And starting a new thread drops only `thread`.
    await userEvent.click(screen.getByRole("button", { name: /new/i }));
    expect(window.location.search).toBe("?view=kanban");
  });

  it("opens the thread named by a ?thread= deep link", async () => {
    window.history.replaceState(null, "", "/boards/b1?thread=c1");
    loadDockThreads.mockResolvedValue({
      ok: true,
      data: { board: [thread()], agent: [] },
    });
    loadThreadMessages.mockResolvedValue({ ok: true, data: { messages: [] } });
    render(<BoardDock boardId="b1" agents={AGENTS} currentUserId="me" />);
    await openDock();
    await waitFor(() =>
      expect(loadThreadMessages).toHaveBeenCalledWith({ conversationId: "c1" }),
    );
  });

  it("refuses a turn on a thread someone else shared", async () => {
    loadDockThreads.mockResolvedValue({
      ok: true,
      data: {
        board: [thread({ user_id: "someone-else", visibility: "board" })],
        agent: [],
      },
    });
    loadThreadMessages.mockResolvedValue({ ok: true, data: { messages: [] } });
    render(<BoardDock boardId="b1" agents={AGENTS} currentUserId="me" />);
    await openDock();
    await userEvent.click(
      await screen.findByRole("button", { name: /about the roadmap/i }),
    );
    expect(
      await screen.findByText(/only its owner can reply/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("ask-chat")).toBeNull();
  });

  it("carries the chosen persona into a new thread", async () => {
    render(<BoardDock boardId="b1" agents={AGENTS} currentUserId="me" />);
    await openDock();
    await userEvent.selectOptions(screen.getByRole("combobox"), "a2");
    expect(screen.getByTestId("ask-chat")).toHaveAttribute("data-agent", "a2");
  });
});
