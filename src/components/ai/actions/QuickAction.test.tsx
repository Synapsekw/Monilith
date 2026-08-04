import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { proposeActions, executeActions } = vi.hoisted(() => ({
  proposeActions: vi.fn(),
  executeActions: vi.fn(),
}));
vi.mock("@/lib/ai/write/actions", () => ({ proposeActions, executeActions }));
// Mocked so the assertion needs no seeded board cache — what matters here is
// that ⌘K's approve path hands the server's effects to the one hook that folds
// them into ["board", boardId].
const applyEffects = vi.hoisted(() => vi.fn());
vi.mock("@/lib/boards/use-ai-effects", () => ({
  useApplyBoardEffects: () => applyEffects,
}));

import { QuickAction } from "./QuickAction";

beforeEach(() => {
  proposeActions.mockReset();
  executeActions.mockReset();
  applyEffects.mockReset();
});

describe("QuickAction", () => {
  it("proposes, shows a confirm card, and executes on approve", async () => {
    proposeActions.mockResolvedValue({
      ok: true,
      data: {
        actions: [
          {
            kind: "create_item",
            boardId: "b1",
            groupId: "g1",
            name: "Ship v2",
            summary: 'Create task "Ship v2" in Backlog',
            warnings: [],
          },
        ],
      },
    });
    executeActions.mockResolvedValue({
      ok: true,
      data: { results: [{ ok: true, itemId: "i9" }] },
    });

    render(<QuickAction onClose={() => {}} />);
    await userEvent.type(
      screen.getByLabelText(/command/i),
      "create task Ship v2 in Backlog",
    );
    await userEvent.click(screen.getByRole("button", { name: /^run$/i }));
    expect(
      await screen.findByText(/Create task "Ship v2" in Backlog/),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(executeActions).toHaveBeenCalled();
    expect(await screen.findByText(/created/i)).toBeInTheDocument();
  });

  it("renders a clarification when no actions are proposed", async () => {
    proposeActions.mockResolvedValue({
      ok: true,
      data: { actions: [], clarification: "Which board?" },
    });
    render(<QuickAction onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText(/command/i), "do something");
    await userEvent.click(screen.getByRole("button", { name: /^run$/i }));
    expect(await screen.findByText(/Which board\?/)).toBeInTheDocument();
  });

  it("shows a working indicator while a proposal is pending", async () => {
    let resolve: (v: unknown) => void = () => {};
    proposeActions.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render(<QuickAction onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText(/command/i), "create task X");
    await userEvent.click(screen.getByRole("button", { name: /^run$/i }));
    expect(screen.getByRole("status")).toHaveTextContent(/working/i);
    resolve({
      ok: true,
      data: { actions: [], clarification: "Which board?", history: [] },
    });
    expect(await screen.findByText(/Which board\?/)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("threads history on reply and reaches a confirm card, keeping the transcript", async () => {
    const history1 = [
      { role: "user", content: "create task Ship v2" },
      { role: "assistant", content: [{ type: "text", text: "Which board?" }] },
    ];
    proposeActions
      .mockResolvedValueOnce({
        ok: true,
        data: { actions: [], clarification: "Which board?", history: history1 },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          actions: [
            {
              kind: "create_item",
              boardId: "b1",
              groupId: "g1",
              name: "Ship v2",
              summary: 'Create task "Ship v2" in Backlog',
              warnings: [],
            },
          ],
          history: history1,
        },
      });
    render(<QuickAction onClose={() => {}} />);
    await userEvent.type(
      screen.getByLabelText(/command/i),
      "create task Ship v2",
    );
    await userEvent.click(screen.getByRole("button", { name: /^run$/i }));
    expect(await screen.findByText(/Which board\?/)).toBeInTheDocument();

    await userEvent.type(
      screen.getByLabelText(/command/i),
      "the Roadmap board",
    );
    await userEvent.click(screen.getByRole("button", { name: /^run$/i }));
    expect(
      await screen.findByText(/Create task "Ship v2" in Backlog/),
    ).toBeInTheDocument();
    // The reply threaded the transcript returned by the first turn.
    expect(proposeActions.mock.calls[1][0]).toEqual({
      instruction: "the Roadmap board",
      history: history1,
    });
    // The mini-transcript still shows the earlier clarification.
    expect(screen.getByText(/Which board\?/)).toBeInTheDocument();
  });

  it("says Done, not Created, for an approved move", async () => {
    // A move returns { ok: true } with no itemId precisely so this reads
    // "Done." — "Created — open it from the board" would describe a new row.
    proposeActions.mockResolvedValue({
      ok: true,
      data: {
        actions: [
          {
            kind: "move_item",
            boardId: "b1",
            itemId: "i-qysea",
            groupId: "g-software",
            summary: 'Move "QYSEA" from Backlog to Software',
            warnings: [],
          },
        ],
      },
    });
    executeActions.mockResolvedValue({
      ok: true,
      data: { results: [{ ok: true }] },
    });

    render(<QuickAction onClose={() => {}} />);
    await userEvent.type(
      screen.getByLabelText(/command/i),
      "move QYSEA to Software",
    );
    await userEvent.click(screen.getByRole("button", { name: /^run$/i }));
    expect(
      await screen.findByText(/Move "QYSEA" from Backlog to Software/),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(await screen.findByText(/^Done\.$/)).toBeInTheDocument();
    expect(screen.queryByText(/created/i)).not.toBeInTheDocument();
  });

  it("folds the returned board effects into the board cache on approve", async () => {
    proposeActions.mockResolvedValue({
      ok: true,
      data: {
        actions: [
          {
            kind: "move_item",
            boardId: "b1",
            itemId: "i-qysea",
            groupId: "g-software",
            summary: 'Move "QYSEA" from Backlog to Software',
            warnings: [],
          },
        ],
      },
    });
    executeActions.mockResolvedValue({
      ok: true,
      data: {
        results: [{ ok: true }],
        effects: [{ kind: "item_moved", boardId: "b1", subitemIds: [] }],
      },
    });

    render(<QuickAction onClose={() => {}} />);
    await userEvent.type(
      screen.getByLabelText(/command/i),
      "move QYSEA to Software",
    );
    await userEvent.click(screen.getByRole("button", { name: /^run$/i }));
    await userEvent.click(
      await screen.findByRole("button", { name: /approve/i }),
    );

    expect(applyEffects).toHaveBeenCalledWith([
      expect.objectContaining({ kind: "item_moved", boardId: "b1" }),
    ]);
  });

  it("still renders what landed when one action of the batch failed", async () => {
    // A create whose field write failed still created the row — the effect
    // rides along with the error, so the board must show it.
    proposeActions.mockResolvedValue({
      ok: true,
      data: {
        actions: [
          {
            kind: "create_item",
            boardId: "b1",
            groupId: "g1",
            name: "Ship v2",
            summary: 'Create task "Ship v2" in Backlog',
            warnings: [],
          },
        ],
      },
    });
    executeActions.mockResolvedValue({
      ok: true,
      data: {
        results: [{ ok: false, error: "date: No date column." }],
        effects: [
          {
            kind: "item_created",
            boardId: "b1",
            item: { id: "i9" },
            cells: [],
          },
        ],
      },
    });

    render(<QuickAction onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText(/command/i), "create Ship v2");
    await userEvent.click(screen.getByRole("button", { name: /^run$/i }));
    await userEvent.click(
      await screen.findByRole("button", { name: /approve/i }),
    );

    expect(await screen.findByText(/no date column/i)).toBeInTheDocument();
    expect(applyEffects).toHaveBeenCalledWith([
      expect.objectContaining({ kind: "item_created" }),
    ]);
  });

  it("surfaces a failed proposal as an alert", async () => {
    proposeActions.mockResolvedValue({
      ok: false,
      error: "You've used this month's AI allowance.",
    });
    render(<QuickAction onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText(/command/i), "create task X");
    await userEvent.click(screen.getByRole("button", { name: /^run$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/allowance/);
  });
});
