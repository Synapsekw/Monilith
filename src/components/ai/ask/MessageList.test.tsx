import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MessageList, type UIMessage } from "./MessageList";
import type { MentionTarget } from "@/lib/collaboration/mentions";

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
  const { container, unmount } = render(
    <MessageList
      {...base}
      messages={messages}
      onApprove={onApprove}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onApprove, onCancel, container, unmount };
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

const agents: MentionTarget[] = [
  { kind: "agent", agentId: "a-ops", handle: "ops", name: "Ops" },
];

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

describe("MessageList — per-turn attribution", () => {
  it("names the agent that answered a turn", () => {
    render(
      <MessageList
        messages={[
          {
            id: "m1",
            role: "user",
            content: "@ops what slipped?",
            agentId: "a-ops",
          },
          {
            id: "m2",
            role: "assistant",
            content: "Three items.",
            agentId: "a-ops",
          },
        ]}
        agents={agents}
        streamingText={null}
        status={null}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Ops")).toBeInTheDocument();
  });

  it("labels an unattributed answer as the plain assistant", () => {
    render(
      <MessageList
        messages={[
          { id: "m1", role: "assistant", content: "Hi", agentId: null },
        ]}
        agents={agents}
        streamingText={null}
        status={null}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Monolith")).toBeInTheDocument();
  });

  // Disabling an agent stops it answering (spec §1 — routing now agrees with
  // the enabled-only roster), but it must not rewrite what it already said:
  // the roster no longer contains it, so without the historical name map every
  // answer it ever gave would silently become "Monolith".
  it("keeps naming a turn answered by an agent that has since been disabled", () => {
    render(
      <MessageList
        messages={[
          {
            id: "m1",
            role: "assistant",
            content: "Three items.",
            agentId: "a-gone",
          },
        ]}
        agents={agents}
        agentNames={{ "a-gone": "Retired Ops" }}
        streamingText={null}
        status={null}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Retired Ops")).toBeInTheDocument();
    expect(screen.queryByText("Monolith")).toBeNull();
  });

  it("still says Monolith for a turn no name can be found for", () => {
    render(
      <MessageList
        messages={[
          {
            id: "m1",
            role: "assistant",
            content: "Three items.",
            agentId: "a-gone",
          },
        ]}
        agents={agents}
        agentNames={{}}
        streamingText={null}
        status={null}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Monolith")).toBeInTheDocument();
  });

  it("greets an owner with agents by offering them", () => {
    render(
      <MessageList
        messages={[]}
        agents={agents}
        streamingText={null}
        status={null}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/@ops/)).toBeInTheDocument();
  });

  it("names the answering agent on the live streaming bubble", () => {
    render(
      <MessageList
        messages={[]}
        agents={agents}
        streamingText="Working on it"
        streamingAgentId="a-ops"
        status={null}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Ops")).toBeInTheDocument();
  });

  it("names the agent in the thinking indicator once one is known", () => {
    render(
      <MessageList
        messages={[]}
        agents={agents}
        streamingText=""
        streamingAgentId="a-ops"
        status={null}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Ops is working…");
  });

  it("falls back to the generic thinking label with no agent on the turn", () => {
    render(
      <MessageList
        messages={[]}
        agents={agents}
        streamingText=""
        streamingAgentId={null}
        status={null}
        onApprove={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Thinking…");
  });
});

// Spec §3: the dock's transcript sits on the wash — no card, no centring —
// and an agent's turn carries the same initial tile as its band tile. `/ask`
// keeps the card, byte-for-byte.
describe("MessageList — surface", () => {
  const TURNS: UIMessage[] = [
    { id: "m1", role: "user", content: "what slipped?" },
    { id: "m2", role: "assistant", content: "Three items.", agentId: "a-ops" },
    { id: "m3", role: "assistant", content: "Plain answer.", agentId: null },
  ];

  it("keeps the /ask card byte-for-byte by default", () => {
    const { container } = renderList(TURNS, { agents });
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

  it("on the wash: full-width column, chrome-fill user pill, initial tile for a persona, mark for plain Ask", () => {
    const { container } = renderList(TURNS, { agents, surface: "atmosphere" });
    const column = container.querySelector("[data-scroll-container] > div")!;
    expect(column.className).not.toContain("max-w-3xl");
    expect(column.className).toContain("px-3.5");
    const pill = screen.getByText("what slipped?");
    expect(pill.className).toContain("bg-chrome-fill");
    expect(pill.className).toContain("border-border");
    expect(pill.className).not.toContain("bg-surface-muted");
    // Ops answered → its initial on the brand tint, like the band tile.
    const opsTile = screen
      .getByText("Three items.")
      .closest("[data-turn]")!
      .querySelector("[data-turn-tile]")!;
    expect(opsTile).toHaveTextContent("O");
    expect(opsTile.className).toContain("bg-primary/15");
    expect(opsTile.querySelector("svg")).toBeNull();
    // Nobody on record → the Ask AI mark, on the chrome fill (no card).
    const plainTile = screen
      .getByText("Plain answer.")
      .closest("[data-turn]")!
      .querySelector("[data-turn-tile]")!;
    expect(plainTile.querySelector("svg")).not.toBeNull();
    expect(plainTile.className).toContain("bg-chrome-fill");
    expect(plainTile.className).not.toContain("bg-surface");
  });

  it("uses the initial tile for the live streaming bubble too, when its agent is known", () => {
    const { container } = renderList([], {
      agents,
      streamingText: "Working on it",
      streamingAgentId: "a-ops",
      surface: "atmosphere",
    });
    expect(container.querySelector("[data-turn-tile]")).toHaveTextContent("O");
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

  // Confirmed gap: the empty state (a fresh, message-less thread — the first
  // thing a viewer sees on tapping an agent tile in the dock) used to render
  // the /ask hero unconditionally: a bordered `bg-surface` card floating on
  // the wash. It must use the same wash grammar as an assistant's persona
  // tile, with no card behind it.
  it("keeps the empty-state hero un-carded on the wash", () => {
    const { container } = renderList([], { agents, surface: "atmosphere" });
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
  });
});
