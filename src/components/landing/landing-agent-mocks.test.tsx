import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  AgentRoster,
  AgentThreadMock,
  BoardWithAgentDock,
  LANDING_AGENTS,
  MorningBriefMock,
  RollingOut,
} from "./landing-agent-mocks";

describe("AgentRoster", () => {
  it("renders every named agent with its job and an AGENT badge", () => {
    render(<AgentRoster />);
    for (const agent of LANDING_AGENTS) {
      expect(screen.getByText(agent.name)).toBeInTheDocument();
      expect(screen.getByText(agent.role)).toBeInTheDocument();
    }
    expect(screen.getAllByText("AGENT")).toHaveLength(LANDING_AGENTS.length);
  });

  it("is a list, so the roster reads as a set to assistive tech", () => {
    render(<AgentRoster />);
    expect(screen.getAllByRole("listitem")).toHaveLength(LANDING_AGENTS.length);
  });
});

describe("AgentThreadMock", () => {
  it("shows a human mention answered by a badged agent", () => {
    render(<AgentThreadMock />);
    expect(screen.getByText("Sofia R.")).toBeInTheDocument();
    expect(screen.getByText("@Triage")).toBeInTheDocument();
    expect(screen.getByText("Triage")).toBeInTheDocument();
    // Agent authorship is never conveyed by the periwinkle ring alone.
    expect(screen.getAllByText("AGENT").length).toBeGreaterThan(0);
  });

  it("shows the agent's document attached to the task", () => {
    render(<AgentThreadMock />);
    expect(screen.getByText("Billing-unblock-plan.pdf")).toBeInTheDocument();
    expect(screen.getByText("ATTACHED TO THIS TASK")).toBeInTheDocument();
  });

  it("compact drops the second agent reply but keeps the first", () => {
    const { rerender } = render(<AgentThreadMock />);
    expect(screen.getByText("Morning Brief")).toBeInTheDocument();
    rerender(<AgentThreadMock compact />);
    expect(screen.queryByText("Morning Brief")).not.toBeInTheDocument();
    expect(screen.getByText("Triage")).toBeInTheDocument();
  });
});

describe("BoardWithAgentDock", () => {
  it("renders the board and the thread inside one window frame", () => {
    render(<BoardWithAgentDock />);
    expect(screen.getByText("Q3 launch plan")).toBeInTheDocument();
    expect(screen.getByText("THREAD")).toBeInTheDocument();
    // Once as a board row, once as the docked thread's subject.
    expect(screen.getAllByText("Redesign billing flow")).toHaveLength(2);
  });
});

describe("MorningBriefMock", () => {
  it("is addressed by the agent, to a person, at its cadence", () => {
    render(<MorningBriefMock />);
    expect(screen.getByText("Morning Brief")).toBeInTheDocument();
    expect(screen.getByText("AGENT")).toBeInTheDocument();
    expect(screen.getByText("to Dana K. · 7:00")).toBeInTheDocument();
  });

  it("lists the items that need the owner, each with a status label", () => {
    render(<MorningBriefMock />);
    for (const task of [
      "Redesign billing flow",
      "Ship realtime presence",
      "Draft Q4 roadmap",
    ]) {
      expect(screen.getByText(task)).toBeInTheDocument();
    }
    // Status is never conveyed by colour alone.
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("Due today")).toBeInTheDocument();
    expect(screen.getByText("Not started")).toBeInTheDocument();
  });
});

describe("RollingOut", () => {
  it("renders its label", () => {
    render(<RollingOut>Named agents · rolling out</RollingOut>);
    expect(screen.getByText("Named agents · rolling out")).toBeInTheDocument();
  });
});
