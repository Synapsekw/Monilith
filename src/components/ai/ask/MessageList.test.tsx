import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MessageList, type UIMessage } from "./MessageList";

const ACTION = {
  kind: "create_item" as const,
  boardId: "b1",
  groupId: "g1",
  name: "Ship v2",
  summary: 'Create task "Ship v2" in Backlog',
  warnings: ['Board has 2 date columns — used "Due".'],
};

const base = { streamingText: null, status: null };

function renderList(messages: UIMessage[], overrides = {}) {
  const onApprove = vi.fn();
  const onCancel = vi.fn();
  const onApplyBatch = vi.fn();
  const onDismissBatch = vi.fn();
  const { container, unmount } = render(
    <MessageList
      {...base}
      messages={messages}
      onApprove={onApprove}
      onCancel={onCancel}
      onApplyBatch={onApplyBatch}
      onDismissBatch={onDismissBatch}
      {...overrides}
    />,
  );
  return {
    onApprove,
    onCancel,
    onApplyBatch,
    onDismissBatch,
    container,
    unmount,
  };
}

describe("MessageList proposals", () => {
  it("renders no card for a plain assistant turn", () => {
    renderList([{ id: "a1", role: "assistant", content: "Two overdue." }]);
    expect(screen.queryByRole("group", { name: "Proposed action" })).toBeNull();
  });

  it("renders a confirm card with the summary and warning", () => {
    renderList([
      {
        id: "p1",
        role: "assistant",
        content: "I'll create that —",
        trace: { proposedActions: [ACTION] },
      },
    ]);
    expect(screen.getByText(ACTION.summary)).toBeInTheDocument();
    expect(screen.getByText(ACTION.warnings[0])).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /approve/i }),
    ).toBeInTheDocument();
  });

  it("calls onApprove / onCancel with the proposal message id", () => {
    const { onApprove, onCancel } = renderList([
      {
        id: "p1",
        role: "assistant",
        content: "I'll create that —",
        trace: { proposedActions: [ACTION] },
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith("p1");
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledWith("p1");
  });

  it("hides the buttons and shows the note once a later turn resolved it", () => {
    renderList([
      {
        id: "p1",
        role: "assistant",
        content: "I'll create that —",
        trace: { proposedActions: [ACTION] },
      },
      {
        id: "o1",
        role: "assistant",
        content: 'Done — Create task "Ship v2" in Backlog.',
        trace: {
          resolvesProposal: "p1",
          outcome: "applied",
          results: [{ ok: true, itemId: "i1" }],
        },
      },
    ]);
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
    expect(screen.getByText("Applied.")).toBeInTheDocument();
  });

  it("shows the running label while that proposal is busy", () => {
    renderList(
      [
        {
          id: "p1",
          role: "assistant",
          content: "I'll create that —",
          trace: { proposedActions: [ACTION] },
        },
      ],
      { busyMessageId: "p1" },
    );
    expect(screen.getByRole("button", { name: /applying/i })).toBeDisabled();
  });
});

const STAGED = [
  {
    id: "a",
    tool: "update_item",
    input: {},
    summary: "Assign Marko to Demo video",
    destructive: false,
    boardId: null,
  },
  {
    id: "b",
    tool: "update_item",
    input: {},
    summary: "Set status of Press kit to Done",
    destructive: false,
    boardId: null,
  },
];

describe("MessageList staged batches", () => {
  it("renders one batch card for a message with staged calls and forwards Apply", async () => {
    const { onApplyBatch } = renderList([
      {
        id: "m-1",
        role: "assistant",
        content: "Lined up two changes.",
        trace: { stagedCalls: STAGED },
      },
    ]);
    expect(
      screen.getAllByRole("region", {
        name: "Changes waiting for your confirmation",
      }),
    ).toHaveLength(1);
    await userEvent.click(
      screen.getByRole("button", { name: /Apply 2 changes/ }),
    );
    expect(onApplyBatch).toHaveBeenCalledWith("m-1", ["a", "b"]);
  });

  it("forwards Dismiss with the message id", async () => {
    const { onDismissBatch } = renderList([
      {
        id: "m-1",
        role: "assistant",
        content: "Lined up two changes.",
        trace: { stagedCalls: STAGED },
      },
    ]);
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismissBatch).toHaveBeenCalledWith("m-1");
  });

  it("locks the card and shows the note once a later turn applied it", () => {
    renderList([
      {
        id: "m-1",
        role: "assistant",
        content: "Lined up two changes.",
        trace: { stagedCalls: STAGED },
      },
      {
        id: "o-1",
        role: "assistant",
        content: "Done.",
        trace: {
          resolvesProposal: "m-1",
          outcome: "applied",
          stagedResults: [
            { id: "a", ok: true },
            { id: "b", ok: true },
          ],
        },
      },
    ]);
    expect(screen.queryByRole("button", { name: /Apply/ })).toBeNull();
    expect(screen.getByText("Applied.")).toBeInTheDocument();
  });

  it("offers a viewer of a shared thread no decision on a batch", () => {
    renderList(
      [
        {
          id: "m-1",
          role: "assistant",
          content: "Lined up two changes.",
          trace: { stagedCalls: STAGED },
        },
      ],
      { readOnly: true },
    );
    expect(screen.getByText("Assign Marko to Demo video")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Apply/ })).toBeNull();
  });
});

const QUESTION: UIMessage = {
  id: "m1",
  role: "user",
  content: "what's overdue?",
};

// gotcha-62: the ONLY pre-token feedback used to be a static "…". Ask Pulse runs
// its read tools with text buffered, so that dead stretch is routinely 25–42s —
// long enough that users conclude it broke and resend.
describe("MessageList — pre-token working state (gotcha-62)", () => {
  it("shows a live indicator, not a static ellipsis, once a turn has opened", () => {
    renderList([QUESTION], { streamingText: "" });
    expect(screen.getByRole("status")).toHaveTextContent("Thinking…");
    expect(screen.queryByText("…")).toBeNull();
  });

  it("carries the turn's status as the indicator's label, without doubling it", () => {
    renderList([QUESTION], {
      streamingText: "",
      status: "Reading your boards…",
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Reading your boards…",
    );
    // One live region, one line — not an indicator plus a separate status line.
    expect(screen.getAllByText("Reading your boards…")).toHaveLength(1);
  });

  it("drops the indicator the instant the first token lands", () => {
    renderList([QUESTION], { streamingText: "Three items are ov" });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Three items are ov")).toBeInTheDocument();
  });

  it("keeps the status line under a partially-streamed answer", () => {
    renderList([QUESTION], {
      streamingText: "Three items",
      status: "Consulting 2 boards…",
    });
    expect(screen.getByText("Consulting 2 boards…")).toBeInTheDocument();
  });

  it("still renders a plain status line for an error with no live turn", () => {
    renderList([QUESTION], {
      streamingText: null,
      status: "The AI assistant hit a snag.",
    });
    expect(
      screen.getByText("The AI assistant hit a snag."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

// A thread shared to a board opens for every member of that board. RLS scopes
// `applyAskProposal` to the owner, so Approve on a viewer's screen can only
// produce a refusal — the card still says WHAT was proposed and that it is
// undecided.
describe("MessageList — a viewer of someone else's shared thread", () => {
  it("shows the proposal but offers no decision", () => {
    renderList(
      [
        {
          id: "p1",
          role: "assistant",
          content: "I'll create that —",
          trace: { proposedActions: [ACTION] },
        },
      ],
      { readOnly: true },
    );
    expect(screen.getByText(ACTION.summary)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
    expect(
      screen.getByText("Only this thread's owner can decide this."),
    ).toBeInTheDocument();
  });

  it("still shows an ALREADY-resolved proposal's real outcome", () => {
    renderList(
      [
        {
          id: "p1",
          role: "assistant",
          content: "I'll create that —",
          trace: { proposedActions: [ACTION] },
        },
        {
          id: "o1",
          role: "assistant",
          content: "Cancelled — nothing was changed.",
          trace: { resolvesProposal: "p1", outcome: "cancelled" },
        },
      ],
      { readOnly: true },
    );
    expect(
      screen.getByText("Cancelled — nothing was changed.", {
        selector: "p",
      }),
    ).toBeInTheDocument();
  });
});

describe("MessageList — attribution", () => {
  it("labels every answer as the Monolith assistant", () => {
    renderList([{ id: "m1", role: "assistant", content: "Hi" }]);
    expect(screen.getByText("Monolith")).toBeInTheDocument();
  });

  it("names Monolith on the live streaming bubble", () => {
    renderList([], { streamingText: "Working on it" });
    expect(screen.getByText("Monolith")).toBeInTheDocument();
  });

  it("uses the generic thinking label while a turn has no tokens yet", () => {
    renderList([], { streamingText: "" });
    expect(screen.getByRole("status")).toHaveTextContent("Thinking…");
  });
});

// Spec §3: the dock's transcript sits on the wash — no card, no centring.
// `/ask` keeps the card, byte-for-byte.
describe("MessageList — surface", () => {
  const TURNS: UIMessage[] = [
    { id: "m1", role: "user", content: "what slipped?" },
    { id: "m2", role: "assistant", content: "Three items." },
    { id: "m3", role: "assistant", content: "Plain answer." },
  ];

  it("keeps the /ask card byte-for-byte by default", () => {
    const { container } = renderList(TURNS);
    const column = container.querySelector("[data-scroll-container] > div")!;
    expect(column.className).toBe(
      "mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6",
    );
    expect(screen.getByText("what slipped?").className).toBe(
      "bg-surface-muted max-w-[85%] rounded-lg border px-3.5 py-2 text-sm whitespace-pre-wrap",
    );
    const turn = container.querySelector("[data-turn]")!;
    expect(turn.className).toBe("flex flex-col gap-3");
    // Both assistant tiles are the Ask AI mark on a raised surface.
    const tiles = [...container.querySelectorAll("[data-turn-tile]")];
    expect(tiles).toHaveLength(2);
    for (const tile of tiles) {
      expect(tile.className).toBe(
        "bg-surface text-brand mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border",
      );
      expect(tile.querySelector("svg")).not.toBeNull();
    }
  });

  it("on the wash: full-width column, chrome-fill user pill, the Ask AI mark on every answer", () => {
    const { container } = renderList(TURNS, { surface: "atmosphere" });
    const column = container.querySelector("[data-scroll-container] > div")!;
    expect(column.className).not.toContain("max-w-3xl");
    expect(column.className).toContain("px-3.5");
    const pill = screen.getByText("what slipped?");
    expect(pill.className).toContain("bg-chrome-fill");
    expect(pill.className).toContain("border-border");
    expect(pill.className).not.toContain("bg-surface-muted");
    const tiles = [...container.querySelectorAll("[data-turn-tile]")];
    expect(tiles).toHaveLength(2);
    for (const tile of tiles) {
      expect(tile.querySelector("svg")).not.toBeNull();
      expect(tile.className).toContain("bg-chrome-fill");
      expect(tile.className).not.toContain("bg-surface");
    }
  });

  it("slides each turn in on the wash, the first three staggered — and never on /ask", () => {
    const { container, unmount } = renderList(TURNS, { surface: "atmosphere" });
    const turns = [...container.querySelectorAll("[data-turn]")];
    expect(turns[0].className).toContain("starting:translate-x-3.5");
    expect(turns[0].className).toContain("transition-[opacity,translate]");
    expect(turns[0].className).toContain("[&:nth-child(1)]:delay-[120ms]");
    expect(turns[0].className).toContain("[&:nth-child(3)]:delay-[240ms]");
    unmount();
    renderList(TURNS);
    expect(document.querySelector("[data-turn]")!.className).not.toContain(
      "starting:",
    );
  });

  // Confirmed gap: the empty state (a fresh, message-less thread in the dock)
  // used to render the /ask hero unconditionally: a bordered `bg-surface` card
  // floating on the wash. It must use the wash grammar, with no card behind it.
  it("keeps the empty-state hero un-carded on the wash", () => {
    const { container } = renderList([], { surface: "atmosphere" });
    const wrapper = container.querySelector(
      "[data-scroll-container] > div > div",
    )!;
    expect(wrapper.className).not.toContain("mt-[12vh]");
    const tile = wrapper.querySelector("span")!;
    expect(tile.className).not.toContain("bg-surface");
    expect(tile.className).not.toContain("border");
    expect(tile.className).toContain("bg-primary/15");
    expect(tile.className).toContain("text-primary");
    expect(tile.className).toContain("rounded-sm");
    // Mono is a page-level mascot — never in the dock.
    expect(container.querySelector("svg[data-mood]")).toBeNull();
    expect(screen.queryByText(/will appear here/i)).toBeNull();
  });

  it("greets an empty /ask thread with Mono and a title", () => {
    const { container } = renderList([]);
    expect(container.querySelector("svg[data-mood]")).toHaveAttribute(
      "data-mood",
      "happy",
    );
    const title = screen.getByText(
      "Your conversation with Monolith will appear here",
    );
    expect(title.className).toContain("text-foreground");
    expect(title.className).toContain("font-semibold");
    expect(container.textContent).not.toMatch(/pulse/i);
  });

  it("the /ask empty state says what a question can be about", () => {
    const { container } = renderList([]);
    expect(container.querySelector("svg[data-mood]")).not.toBeNull();
    expect(
      screen.getByText(/answers are grounded in your real data/i),
    ).toBeInTheDocument();
  });

  it("drops the empty state once the thread has a message", () => {
    const { container } = renderList([
      { id: "a1", role: "assistant", content: "Two overdue." },
    ]);
    expect(container.querySelector("svg[data-mood]")).toBeNull();
  });
});
