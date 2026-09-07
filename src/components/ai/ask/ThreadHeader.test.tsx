import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThreadHeader } from "./ThreadHeader";
import type { MentionTarget } from "@/lib/collaboration/mentions";

const agents: MentionTarget[] = [
  { kind: "agent", agentId: "a-ops", handle: "ops", name: "Ops" },
  { kind: "agent", agentId: "a-fin", handle: "finance", name: "Finance" },
];

describe("ThreadHeader", () => {
  it("names who is answering", () => {
    render(
      <ThreadHeader
        title="Q3 slippage"
        agents={agents}
        agentId="a-ops"
        onAgentChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Q3 slippage")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ops/i })).toBeInTheDocument();
  });

  it("falls back to the plain assistant when no agent is on duty", () => {
    render(
      <ThreadHeader
        title="New chat"
        agents={agents}
        agentId={null}
        onAgentChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /monolith assistant/i }),
    ).toBeInTheDocument();
  });

  it("switches to another agent", async () => {
    const onAgentChange = vi.fn();
    render(
      <ThreadHeader
        title="Q3"
        agents={agents}
        agentId="a-ops"
        onAgentChange={onAgentChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /ops/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /finance/i }));
    expect(onAgentChange).toHaveBeenCalledWith("a-fin");
  });

  it("hands back the plain assistant", async () => {
    const onAgentChange = vi.fn();
    render(
      <ThreadHeader
        title="Q3"
        agents={agents}
        agentId="a-ops"
        onAgentChange={onAgentChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /ops/i }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: /monolith assistant/i }),
    );
    expect(onAgentChange).toHaveBeenCalledWith(null);
  });
});
