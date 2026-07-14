import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { proposeActions, executeActions } = vi.hoisted(() => ({
  proposeActions: vi.fn(),
  executeActions: vi.fn(),
}));
vi.mock("@/lib/ai/write/actions", () => ({ proposeActions, executeActions }));

import { QuickAction } from "./QuickAction";

beforeEach(() => {
  proposeActions.mockReset();
  executeActions.mockReset();
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
