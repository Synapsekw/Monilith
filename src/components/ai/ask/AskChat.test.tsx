import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));
const recoverConversation = vi.fn();
// Typed as taking the ids argument (the impl ignores it), matching the
// `applyAskProposal`/`cancelAskProposal` spies below.
type SwitchAgentCall = (
  input: unknown,
) => Promise<{ ok: true; data: { agentId: string | null } }>;
const setConversationAgent = vi.fn<SwitchAgentCall>(async () => ({
  ok: true as const,
  data: { agentId: null },
}));
vi.mock("@/lib/ai/ask/conversation-actions", () => ({
  // Echoes back whichever `agentId` the caller asked to start the thread
  // with (or null) — realistic enough that `AskChat`'s header reflects the
  // real persona after a send, without re-implementing server routing here.
  createConversation: vi.fn(
    async (input: {
      firstMessage: string;
      boardId?: string;
      agentId?: string;
    }) => ({
      ok: true,
      data: { conversationId: "c1", agentId: input.agentId ?? null },
    }),
  ),
  appendUserMessage: vi.fn(async () => ({
    ok: true,
    data: { messageId: "m2", agentId: null },
  })),
  recoverConversation: (i: unknown) => recoverConversation(i),
  setConversationAgent: (i: unknown) => setConversationAgent(i as never),
}));
// Typed as taking the ids argument (the impl ignores it) so the spy can be
// asserted with `toHaveBeenCalledWith` without an unused-parameter binding.
type ProposalCall = (input: unknown) => Promise<{ ok: true; data: unknown }>;
const applyAskProposal = vi.fn<ProposalCall>(async () => ({
  ok: true as const,
  data: {
    messageId: "o1",
    content: 'Done — Create task "Ship v2" in Backlog.',
    trace: {
      resolvesProposal: "a1",
      outcome: "applied" as const,
      results: [{ ok: true as const, itemId: "i1" }],
    },
    // Transient rows the write produced — folded into the board cache, never
    // persisted into tool_trace.
    effects: [{ kind: "item_moved" as const, boardId: "b1" }],
  },
}));
const cancelAskProposal = vi.fn<ProposalCall>(async () => ({
  ok: true as const,
  data: {
    messageId: "o2",
    content: "Cancelled — nothing was changed.",
    trace: { resolvesProposal: "a1", outcome: "cancelled" as const },
    effects: [],
  },
}));
vi.mock("@/lib/ai/ask/proposal-actions", () => ({
  applyAskProposal: (i: unknown) => applyAskProposal(i as never),
  cancelAskProposal: (i: unknown) => cancelAskProposal(i as never),
}));
const send = vi.fn();
vi.mock("./use-ask-stream", () => ({
  useAskStream: () => ({ streaming: false, send }),
}));
// Mocked so the assertion needs no seeded board cache — what matters here is
// that the approve path hands the server's effects to the one hook that folds
// them into ["board", boardId].
const applyEffects = vi.hoisted(() => vi.fn());
vi.mock("@/lib/boards/use-ai-effects", () => ({
  useApplyBoardEffects: () => applyEffects,
}));
// The briefing thread renders the run's queued approvals. Their decide path is
// its own Server Action, mocked here so this file stays about the chat.
const decideProposal = vi.fn(async () => ({
  ok: true as const,
  data: { status: "approved" as const },
}));
vi.mock("@/lib/agents/proposal-actions", () => ({
  decideProposal: () => decideProposal(),
}));

import { AskChat } from "./AskChat";
import {
  appendUserMessage,
  createConversation,
} from "@/lib/ai/ask/conversation-actions";

const ACTION = {
  kind: "create_item" as const,
  boardId: "b1",
  groupId: "g1",
  name: "Ship v2",
  summary: 'Create task "Ship v2" in Backlog',
  warnings: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  send.mockImplementation(
    async (_id: string, onEvent: (e: Record<string, unknown>) => void) => {
      onEvent({ type: "token", text: "Answer" });
      onEvent({
        type: "done",
        conversationId: "c1",
        assistantMessageId: "a1",
        boardsConsulted: [],
      });
      return "ok";
    },
  );
});

/** The gotcha-61 failure mode: some tokens arrive, then the response body is
 *  severed — no `done`, no `error`. The turn keeps running server-side. */
function severedStream() {
  send.mockImplementation(
    async (_id: string, onEvent: (e: Record<string, unknown>) => void) => {
      onEvent({ type: "token", text: "Three items are ov" });
      return "dropped";
    },
  );
}

const USER_ROW = {
  id: "m1",
  role: "user" as const,
  content: "what's overdue?",
  trace: null,
};
const ANSWER_ROW = {
  id: "a1",
  role: "assistant" as const,
  content: "Three items are overdue: Ship v2, Migrate DB, QA pass.",
  trace: { boardsConsulted: ["b1"] },
};

function ask(question = "what's overdue?") {
  fireEvent.change(screen.getByLabelText("Your question"), {
    target: { value: question },
  });
  fireEvent.keyDown(screen.getByLabelText("Your question"), {
    key: "Enter",
    metaKey: true,
  });
}

describe("AskChat", () => {
  it("sends a first message, streams the answer, and persists both turns", async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    render(<AskChat conversationId={null} initialMessages={[]} />);

    fireEvent.change(screen.getByLabelText("Your question"), {
      target: { value: "what's overdue?" },
    });
    fireEvent.keyDown(screen.getByLabelText("Your question"), {
      key: "Enter",
      metaKey: true,
    });

    await waitFor(() =>
      expect(screen.getByText("what's overdue?")).toBeInTheDocument(),
    );
    // The new conversation was created and the URL rewritten via History API.
    expect(createConversation).toHaveBeenCalledWith({
      firstMessage: "what's overdue?",
    });
    expect(pushState).toHaveBeenCalledWith(null, "", "/ask/c1");
    // The streamed assistant answer is committed to the transcript.
    await waitFor(() => expect(screen.getByText("Answer")).toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  it("binds a proposal to the persisted message id and applies it on approve", async () => {
    send.mockImplementation(
      async (_id: string, onEvent: (e: Record<string, unknown>) => void) => {
        onEvent({ type: "token", text: "I'll create that — " });
        onEvent({ type: "proposal", actions: [ACTION] });
        onEvent({
          type: "done",
          conversationId: "c1",
          assistantMessageId: "a1",
          boardsConsulted: ["b1"],
        });
      },
    );
    render(<AskChat conversationId={null} initialMessages={[]} />);

    fireEvent.change(screen.getByLabelText("Your question"), {
      target: { value: "create Ship v2 in Backlog" },
    });
    fireEvent.keyDown(screen.getByLabelText("Your question"), {
      key: "Enter",
      metaKey: true,
    });

    // The card renders once the turn is persisted.
    await waitFor(() =>
      expect(screen.getByText(ACTION.summary)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    // The conversation id created mid-turn is used, not the null prop.
    await waitFor(() =>
      expect(applyAskProposal).toHaveBeenCalledWith({
        conversationId: "c1",
        messageId: "a1",
      }),
    );
    // The outcome turn lands in the transcript and resolves the card.
    await waitFor(() =>
      expect(
        screen.getByText('Done — Create task "Ship v2" in Backlog.'),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
  });

  // Regression, same class as the `done` handler bug: `ProposalOutcome` (the
  // Server Action's return shape) carries no `agentId` at all, so a naive
  // append leaves the outcome turn permanently unattributed. `resolve()` must
  // stamp it with the conversation's known persona instead of leaving it null.
  it("attributes the proposal outcome turn to the thread's agent, not the plain assistant", async () => {
    const RESOLVE_OPS_ID = "55555555-5555-4555-8555-555555555555";
    const RESOLVE_OPS = {
      kind: "agent" as const,
      agentId: RESOLVE_OPS_ID,
      handle: "ops",
      name: "Ops",
    };
    send.mockImplementation(
      async (_id: string, onEvent: (e: Record<string, unknown>) => void) => {
        onEvent({ type: "token", text: "I'll create that — " });
        onEvent({ type: "proposal", actions: [ACTION] });
        onEvent({
          type: "done",
          conversationId: "c1",
          assistantMessageId: "a1",
          boardsConsulted: ["b1"],
        });
      },
    );
    // The thread already belongs to Ops (sticky routing) — this plain
    // follow-up addresses nobody, so the real `appendUserMessage` echoes back
    // the SAME persona rather than resetting it.
    (appendUserMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      data: { messageId: "m2", agentId: RESOLVE_OPS_ID },
    });
    render(
      <AskChat
        conversationId="c1"
        initialMessages={[]}
        agents={[RESOLVE_OPS]}
        initialAgentId={RESOLVE_OPS_ID}
      />,
    );
    ask("create Ship v2 in Backlog");
    await waitFor(() =>
      expect(screen.getByText(ACTION.summary)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() =>
      expect(
        screen.getByText('Done — Create task "Ship v2" in Backlog.'),
      ).toBeInTheDocument(),
    );
    // The outcome turn's label reads "Ops" (same as the header and the
    // proposal turn before it) — never "Monolith".
    expect(screen.getAllByText("Ops").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Monolith")).not.toBeInTheDocument();
  });
});

/** Drive a turn that ends at a confirm card, then hand back the rendered card. */
async function renderProposal() {
  send.mockImplementation(
    async (_id: string, onEvent: (e: Record<string, unknown>) => void) => {
      onEvent({ type: "proposal", actions: [ACTION] });
      onEvent({
        type: "done",
        conversationId: "c1",
        assistantMessageId: "a1",
        boardsConsulted: ["b1"],
      });
    },
  );
  render(<AskChat conversationId={null} initialMessages={[]} />);
  ask("create Ship v2 in Backlog");
  await waitFor(() =>
    expect(screen.getByText(ACTION.summary)).toBeInTheDocument(),
  );
}

// The last mile: an approved write must appear on the board behind the dock
// with no reload, no router.refresh (gotcha-09) and no invalidateQueries.
describe("AskChat — rendering an approved write on the board", () => {
  it("applies the returned board effects when a proposal is approved", async () => {
    await renderProposal();
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() =>
      expect(applyEffects).toHaveBeenCalledWith([
        expect.objectContaining({ kind: "item_moved", boardId: "b1" }),
      ]),
    );
  });

  it("applies nothing when a proposal is cancelled", async () => {
    await renderProposal();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => expect(applyEffects).toHaveBeenCalledWith([]));
  });

  it("applies no effects when the approve itself failed", async () => {
    applyAskProposal.mockResolvedValueOnce({
      ok: false,
      error: "This proposal was already resolved.",
    } as never);
    await renderProposal();
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/this proposal was already resolved/i),
      ).toBeInTheDocument(),
    );
    expect(applyEffects).not.toHaveBeenCalled();
  });
});

// The board dock reuses this exact component. Two of its behaviours belong to
// `/ask` and are wrong inside a panel on someone else's page: rewriting the URL
// to /ask/<id>, and router.refresh() — which on the board page re-runs
// getBoardPayload plus two more reads to redisplay data the client already
// holds (gotcha-09).
describe("AskChat — surface-agnostic (board dock)", () => {
  const BOARD_ID = "11111111-1111-4111-8111-111111111111";
  const AGENT_ID = "22222222-2222-4222-8222-222222222222";

  it("does not rewrite the URL to /ask when a surface supplies onStarted", async () => {
    const onStarted = vi.fn();
    const pushState = vi.spyOn(window.history, "pushState");
    render(
      <AskChat
        conversationId={null}
        initialMessages={[]}
        boardId={BOARD_ID}
        onStarted={onStarted}
      />,
    );
    ask("what is overdue?");

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("c1"));
    expect(pushState).not.toHaveBeenCalled();
  });

  it("does not router.refresh() after a turn when a surface supplies onTurnComplete", async () => {
    const onTurnComplete = vi.fn();
    render(
      <AskChat
        conversationId="c1"
        initialMessages={[]}
        boardId={BOARD_ID}
        onTurnComplete={onTurnComplete}
      />,
    );
    ask();

    await waitFor(() => expect(onTurnComplete).toHaveBeenCalledTimes(1));
    expect(refresh).not.toHaveBeenCalled();
  });

  // The `done` handler is not the only refresh site — drop-recovery has one
  // too, and a dock that substituted only the first would still refetch the
  // whole board every time a flaky stream recovered.
  it("routes a RECOVERED turn through onTurnComplete as well", async () => {
    severedStream();
    recoverConversation.mockResolvedValue({
      ok: true,
      data: { messages: [USER_ROW, ANSWER_ROW] },
    });
    const onTurnComplete = vi.fn();
    render(
      <AskChat
        conversationId="c1"
        initialMessages={[]}
        boardId={BOARD_ID}
        onTurnComplete={onTurnComplete}
      />,
    );
    ask();

    await waitFor(() =>
      expect(screen.getByText(ANSWER_ROW.content)).toBeInTheDocument(),
    );
    expect(onTurnComplete).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("passes boardId and agentId to createConversation", async () => {
    render(
      <AskChat
        conversationId={null}
        initialMessages={[]}
        boardId={BOARD_ID}
        agentId={AGENT_ID}
        onStarted={() => {}}
      />,
    );
    ask("hello");

    await waitFor(() =>
      expect(createConversation).toHaveBeenCalledWith({
        firstMessage: "hello",
        boardId: BOARD_ID,
        agentId: AGENT_ID,
      }),
    );
    // The persona is a CREATE-time argument only: /api/ask reads it off the
    // conversation row, so it must never ride along per turn.
    expect(send).toHaveBeenCalledWith("c1", expect.any(Function));
  });
});

/** Hold the conversation-minting server action open, so the test can inspect the
 *  window BETWEEN "user hit send" and "the stream opened" — the window in which
 *  `streaming` is still false and the composer used to be wide open. */
function holdCreateConversation() {
  let open!: (v: unknown) => void;
  (createConversation as ReturnType<typeof vi.fn>).mockReturnValueOnce(
    new Promise((resolve) => {
      open = resolve;
    }),
  );
  return () => open({ ok: true, data: { conversationId: "c1" } });
}

// gotcha-62: the pre-token stretch is 25–42s of tool calls with text buffered.
// It used to render a static "…", and the composer only locked once the fetch
// started — so users concluded it was broken and resent, abandoning the turn.
describe("AskChat — honest working state (gotcha-62)", () => {
  it("shows the animated indicator the moment you hit send, before the stream opens", async () => {
    const open = holdCreateConversation();
    render(<AskChat conversationId={null} initialMessages={[]} />);
    ask();

    // Nothing has been fetched yet — this is the old dead window.
    expect(send).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Thinking…"),
    );

    await act(async () => {
      open();
    });
    await waitFor(() => expect(screen.getByText("Answer")).toBeInTheDocument());
    // And it is gone once the answer is in the transcript.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("relabels the indicator with the turn's opening status", async () => {
    send.mockImplementation(
      async (_id: string, onEvent: (e: Record<string, unknown>) => void) => {
        onEvent({ type: "status", text: "Reading your boards…" });
        return "ok";
      },
    );
    render(<AskChat conversationId="c1" initialMessages={[]} />);
    ask();

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Reading your boards…",
      ),
    );
  });

  // `useAskStream` is mocked with `streaming: false` throughout this suite, so
  // the ONLY thing that can shut the composer here is the controller's own
  // in-flight flag. That is exactly the guard that was missing.
  it("shuts the composer from submit — not from the first byte", async () => {
    const open = holdCreateConversation();
    render(<AskChat conversationId={null} initialMessages={[]} />);
    ask();

    await waitFor(() =>
      expect(screen.getByLabelText("Your question")).toBeDisabled(),
    );
    expect(send).not.toHaveBeenCalled();

    await act(async () => {
      open();
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Your question")).not.toBeDisabled(),
    );
  });

  it("blocks a resend while a turn is in flight, so nothing is orphaned", async () => {
    const open = holdCreateConversation();
    render(<AskChat conversationId={null} initialMessages={[]} />);
    const box = screen.getByLabelText("Your question");
    ask("what's overdue?");

    // The impatient resend: type again and drive the form directly, bypassing
    // the disabled button. The guard must hold in the controller, not only in
    // the composer's props.
    fireEvent.change(box, { target: { value: "are you broken?" } });
    fireEvent.submit(box.closest("form")!);
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });

    await act(async () => {
      open();
    });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    // Exactly ONE turn was ever started: one conversation, one stream, one
    // user bubble. The second question never became a request. (The textarea
    // itself is excluded — jsdom will set a disabled control's DOM value even
    // though React's controlled state, correctly, never saw the change.)
    expect(createConversation).toHaveBeenCalledTimes(1);
    const bubbles = screen
      .getAllByText(/overdue|broken/i)
      .filter((el) => el.tagName !== "TEXTAREA");
    expect(bubbles.map((b) => b.textContent)).toEqual(["what's overdue?"]);
  });

  it("lets the next question through once the turn has finished", async () => {
    render(<AskChat conversationId="c1" initialMessages={[]} />);
    ask("what's overdue?");
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));

    ask("and what's blocked?");
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  });
});

// gotcha-61: a severed stream used to render ABSOLUTELY NOTHING — no error, no
// spinner change, no notice — while the answer sat persisted in ai_messages.
describe("AskChat — severed stream (gotcha-61)", () => {
  it("recovers the persisted answer automatically instead of going silent", async () => {
    severedStream();
    recoverConversation.mockResolvedValue({
      ok: true,
      data: { messages: [USER_ROW, ANSWER_ROW] },
    });
    render(<AskChat conversationId={null} initialMessages={[]} />);
    ask();

    await waitFor(() =>
      expect(screen.getByText(ANSWER_ROW.content)).toBeInTheDocument(),
    );
    expect(recoverConversation).toHaveBeenCalledWith({ conversationId: "c1" });
    // The truncated partial token bubble is replaced by the real turn.
    expect(screen.queryByText("Three items are ov")).toBeNull();
    // The user is told what happened — silence is the bug.
    expect(screen.getByText(/recovered your answer/i)).toBeInTheDocument();
    // And is never stranded: the composer is usable again.
    expect(screen.getByLabelText("Your question")).not.toBeDisabled();
    expect(refresh).toHaveBeenCalled();
  });

  it("shows a recoverable notice when nothing landed, and recovers on Check again", async () => {
    severedStream();
    // First check: the turn is still finishing, only the user row exists.
    recoverConversation.mockResolvedValueOnce({
      ok: true,
      data: { messages: [USER_ROW] },
    });
    render(<AskChat conversationId={null} initialMessages={[]} />);
    ask();

    await waitFor(() =>
      expect(screen.getByText(/connection lost/i)).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Your question")).not.toBeDisabled();

    // Second check: it landed.
    recoverConversation.mockResolvedValueOnce({
      ok: true,
      data: { messages: [USER_ROW, ANSWER_ROW] },
    });
    fireEvent.click(screen.getByRole("button", { name: /check again/i }));

    await waitFor(() =>
      expect(screen.getByText(ANSWER_ROW.content)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/connection lost/i)).toBeNull();
  });

  it("holds the composer shut only while the recovery check is in flight", async () => {
    severedStream();
    let land!: (v: unknown) => void;
    recoverConversation.mockReturnValue(
      new Promise((resolve) => {
        land = resolve;
      }),
    );
    render(<AskChat conversationId={null} initialMessages={[]} />);
    ask();

    // Mid-check: the user is told what's happening and can't fire a second turn.
    await waitFor(() =>
      expect(
        screen.getByText(/checking whether your answer arrived/i),
      ).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Your question")).toBeDisabled();

    await act(async () => {
      land({ ok: true, data: { messages: [USER_ROW, ANSWER_ROW] } });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Your question")).not.toBeDisabled(),
    );
  });

  it("shows the notice when the recovery read itself fails", async () => {
    severedStream();
    recoverConversation.mockResolvedValue({
      ok: false,
      error: "Couldn't reach the server.",
    });
    render(<AskChat conversationId={null} initialMessages={[]} />);
    ask();

    await waitFor(() =>
      expect(screen.getByText(/connection lost/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /check again/i })).toBeEnabled();
  });

  it("recovers a proposal turn with its confirm card intact and actionable", async () => {
    severedStream();
    recoverConversation.mockResolvedValue({
      ok: true,
      data: {
        messages: [
          { ...USER_ROW, content: "create Ship v2 in Backlog" },
          {
            id: "a1",
            role: "assistant",
            content: "I'll create that — confirm below.",
            trace: { boardsConsulted: ["b1"], proposedActions: [ACTION] },
          },
        ],
      },
    });
    render(<AskChat conversationId={null} initialMessages={[]} />);
    ask("create Ship v2 in Backlog");

    await waitFor(() =>
      expect(screen.getByText(ACTION.summary)).toBeInTheDocument(),
    );

    // Still actionable: Approve addresses the RECOVERED message id.
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() =>
      expect(applyAskProposal).toHaveBeenCalledWith({
        conversationId: "c1",
        messageId: "a1",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByText('Done — Create task "Ship v2" in Backlog.'),
      ).toBeInTheDocument(),
    );
  });
});

describe("AskChat — an agent briefing thread", () => {
  const PROPOSAL = {
    id: "p1",
    runId: "run-1",
    userAgentId: "agent-1",
    toolName: "create_item",
    capability: "board.write",
    summary: 'Add "Draft proposal" to a board group.',
    status: "pending" as const,
    expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
    createdAt: new Date().toISOString(),
    target: null,
  };

  it("renders the run's queued approvals under the report", () => {
    render(
      <AskChat
        conversationId="c1"
        initialMessages={[ANSWER_ROW]}
        agentProposals={[PROPOSAL]}
      />,
    );
    expect(screen.getByText(/Add "Draft proposal"/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /approve/i }),
    ).toBeInTheDocument();
  });

  it("renders nothing extra for an ordinary chat", () => {
    render(<AskChat conversationId="c1" initialMessages={[ANSWER_ROW]} />);
    expect(
      screen.queryByRole("group", { name: /awaiting approval/i }),
    ).not.toBeInTheDocument();
  });
});

// Spec 3 addressing: a LEADING `@handle` in the composer chooses which of the
// owner's agents answers. The persona is a property of the CONVERSATION ROW —
// `/api/ask` reads it from there — so it can only be set as the thread is
// minted, never bolted onto one that already exists.
describe("AskChat — @handle picks the persona", () => {
  const OPS_ID = "33333333-3333-4333-8333-333333333333";
  const OPS = {
    kind: "agent" as const,
    agentId: OPS_ID,
    handle: "ops",
    name: "Ops Chaser",
  };

  it("passes the addressed agent to createConversation for a new thread", async () => {
    render(
      <AskChat conversationId={null} initialMessages={[]} agents={[OPS]} />,
    );
    ask("@ops what is late?");

    await waitFor(() =>
      expect(createConversation).toHaveBeenCalledWith({
        firstMessage: "@ops what is late?",
        agentId: OPS_ID,
      }),
    );
  });

  it("still starts an ordinary thread when no handle leads the message", async () => {
    render(
      <AskChat conversationId={null} initialMessages={[]} agents={[OPS]} />,
    );
    ask("what is late?");

    await waitFor(() =>
      expect(createConversation).toHaveBeenCalledWith({
        firstMessage: "what is late?",
      }),
    );
  });

  // Plan removal: a handle addressed inside an EXISTING thread used to be
  // refused outright ("Start a new chat to ask a different agent."), because
  // the thread could not be re-personified. Now it just answers as the
  // addressed agent (the server resolves and persists the switch — see
  // `resolveAddressedAgent`/`appendUserMessage`) and the header names them.
  it("answers as the addressed agent in an existing thread, with no refusal notice", async () => {
    (appendUserMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      data: { messageId: "m2", agentId: OPS_ID },
    });
    render(<AskChat conversationId="c1" initialMessages={[]} agents={[OPS]} />);
    ask("@ops what is late?");

    await waitFor(() =>
      expect(appendUserMessage).toHaveBeenCalledWith({
        conversationId: "c1",
        content: "@ops what is late?",
      }),
    );
    // Never minted a second thread — the existing one is re-personified.
    expect(createConversation).not.toHaveBeenCalled();
    // The old refusal is gone…
    expect(
      screen.queryByText(/start a new chat to ask a different agent/i),
    ).not.toBeInTheDocument();
    // …and the header chip names who actually answered.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /ops/i })).toBeInTheDocument(),
    );
  });

  // Regression: the streaming bubble named the addressed agent correctly, but
  // the row pushed on `done` carried no `agentId`, so the transcript flipped
  // to "Monolith" the instant the answer landed and stayed wrong for the rest
  // of the session (`messages` never resyncs from the server). This drives
  // AskChat's REAL send → done path — not a MessageList render with
  // hand-built props — because that gap is exactly why the bug shipped.
  it("keeps the landed turn attributed to the agent once the turn is done, not the plain assistant", async () => {
    render(
      <AskChat conversationId={null} initialMessages={[]} agents={[OPS]} />,
    );
    ask("@ops what is late?");

    // The turn lands (persisted assistant content from the `done` event).
    await waitFor(() => expect(screen.getByText("Answer")).toBeInTheDocument());

    // Both the header chip and the transcript's per-turn label read "Ops
    // Chaser" — neither one has fallen back to "Monolith".
    expect(screen.getAllByText("Ops Chaser").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Monolith")).not.toBeInTheDocument();
  });

  it("keeps naming the addressed agent across a follow-up that addresses nobody (sticky routing)", async () => {
    (appendUserMessage as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        data: { messageId: "m2", agentId: OPS_ID },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { messageId: "m3", agentId: OPS_ID },
      });
    render(<AskChat conversationId="c1" initialMessages={[]} agents={[OPS]} />);
    ask("@ops what is late?");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /ops/i })).toBeInTheDocument(),
    );

    ask("what about tomorrow?");

    await waitFor(() => expect(appendUserMessage).toHaveBeenCalledTimes(2));
    // Still Ops: a plain follow-up inherits the thread's persona — the header
    // reflects what the server resolved, not a client guess.
    expect(screen.getByRole("button", { name: /ops/i })).toBeInTheDocument();
  });
});

// The header switcher itself: AskChat owns the live persona state and is the
// only thing that ever calls `setConversationAgent` — the ONE targeted
// Server Action working agreement #5 requires, never a navigation.
describe("AskChat — the header agent switcher", () => {
  const SWITCH_OPS_ID = "44444444-4444-4444-8444-444444444444";
  const SWITCH_AGENTS = [
    {
      kind: "agent" as const,
      agentId: SWITCH_OPS_ID,
      handle: "ops",
      name: "Ops",
    },
  ];

  it("switches an existing thread's persona with one Server Action and no navigation", async () => {
    const user = userEvent.setup();
    render(
      <AskChat
        conversationId="c1"
        initialMessages={[]}
        agents={SWITCH_AGENTS}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /monolith assistant/i }),
    );
    await user.click(screen.getByRole("menuitem", { name: /^ops$/i }));

    expect(setConversationAgent).toHaveBeenCalledWith({
      conversationId: "c1",
      agentId: SWITCH_OPS_ID,
    });
    // Reads as instant — the chip updates without waiting on the action.
    expect(screen.getByRole("button", { name: /ops/i })).toBeInTheDocument();
    // No RSC navigation for an in-page switch (working agreement #5).
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reverts the chip when the switch fails, after showing the optimistic pick", async () => {
    // Held open deliberately (not `mockResolvedValueOnce`): a promise that
    // resolves before the assertions run would make "the chip ends up back
    // at Monolith assistant" indistinguishable from an entirely unwired
    // `onSelect` — the initial render already reads "Monolith assistant", so
    // that alone proves nothing changed, let alone reverted.
    let settle!: (v: { ok: false; error: string }) => void;
    setConversationAgent.mockReturnValueOnce(
      new Promise((resolve) => {
        settle = resolve;
      }) as never,
    );
    const user = userEvent.setup();
    render(
      <AskChat
        conversationId="c1"
        initialMessages={[]}
        agents={SWITCH_AGENTS}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /monolith assistant/i }),
    );
    await user.click(screen.getByRole("menuitem", { name: /^ops$/i }));

    // The Server Action really was called, with the picked agent...
    expect(setConversationAgent).toHaveBeenCalledWith({
      conversationId: "c1",
      agentId: SWITCH_OPS_ID,
    });
    // ...and the chip already reads "Ops" while that call is still in
    // flight — the optimistic update this test exists to prove happened.
    expect(screen.getByRole("button", { name: /ops/i })).toBeInTheDocument();

    await act(async () => {
      settle({ ok: false, error: "Couldn't switch agent." });
    });

    // Only NOW, after the failure lands, does it revert.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /monolith assistant/i }),
      ).toBeInTheDocument(),
    );
  });

  it("on a not-yet-minted chat, hands the chosen agent to createConversation instead of writing anywhere", async () => {
    const user = userEvent.setup();
    render(
      <AskChat
        conversationId={null}
        initialMessages={[]}
        agents={SWITCH_AGENTS}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /monolith assistant/i }),
    );
    await user.click(screen.getByRole("menuitem", { name: /^ops$/i }));

    // Nothing to write to yet — the choice is client state only.
    expect(setConversationAgent).not.toHaveBeenCalled();

    ask("what is late?");

    await waitFor(() =>
      expect(createConversation).toHaveBeenCalledWith({
        firstMessage: "what is late?",
        agentId: SWITCH_OPS_ID,
      }),
    );
  });
});
