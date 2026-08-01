import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentRoster } from "./AgentRoster";

const agents = [
  {
    id: "a1",
    name: "Morning Brief",
    templateId: "morning-brief",
    cadence: "daily" as const,
    runAtLocalHour: 7,
    enabled: true,
    lastRunStatus: "ran" as const,
  },
];

describe("AgentRoster", () => {
  it("renders each agent with its schedule", () => {
    render(<AgentRoster agents={agents} onToggle={vi.fn()} />);
    expect(screen.getByText("Morning Brief")).toBeInTheDocument();
    expect(screen.getByText(/07:00/)).toBeInTheDocument();
  });

  it("shows an empty state when there are no agents", () => {
    render(<AgentRoster agents={[]} onToggle={vi.fn()} />);
    expect(screen.getByText(/no agents yet/i)).toBeInTheDocument();
  });

  it("calls onToggle when the switch is flipped", async () => {
    const onToggle = vi.fn();
    render(<AgentRoster agents={agents} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("switch"));
    expect(onToggle).toHaveBeenCalledWith("a1", false);
  });

  it("labels the switch accessibly", () => {
    render(<AgentRoster agents={agents} onToggle={vi.fn()} />);
    expect(
      screen.getByRole("switch", { name: /morning brief/i }),
    ).toBeInTheDocument();
  });
});
