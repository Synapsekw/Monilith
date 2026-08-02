import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AgentRoster, type RosterAgent } from "./AgentRoster";
import { CLAIM_PLACEHOLDER } from "@/lib/agents/run-status";

// The roster now embeds AgentRunHistory, which uses TanStack Query. Nothing
// here expands a row, so the server action is never reached — the mock exists
// only so an accidental fetch fails loudly rather than hitting the network.
const getAgentRuns = vi.fn();
vi.mock("@/lib/agents/actions", () => ({
  getAgentRuns: (...a: unknown[]) => getAgentRuns(...a),
}));

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const base: RosterAgent = {
  id: "a1",
  name: "Morning Brief",
  templateId: "morning-brief",
  cadence: "daily",
  runAtLocalHour: 7,
  enabled: true,
  lastRun: null,
};

const agents: RosterAgent[] = [
  {
    ...base,
    lastRun: {
      status: "ran",
      error: null,
      createdAt: new Date().toISOString(),
    },
  },
];

describe("AgentRoster", () => {
  it("renders each agent with its schedule", () => {
    wrap(<AgentRoster agents={agents} onToggle={vi.fn()} />);
    expect(screen.getByText("Morning Brief")).toBeInTheDocument();
    expect(screen.getByText(/07:00/)).toBeInTheDocument();
  });

  it("shows an empty state when there are no agents", () => {
    wrap(<AgentRoster agents={[]} onToggle={vi.fn()} />);
    expect(screen.getByText(/no agents yet/i)).toBeInTheDocument();
  });

  it("calls onToggle when the switch is flipped", async () => {
    const onToggle = vi.fn();
    wrap(<AgentRoster agents={agents} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("switch"));
    expect(onToggle).toHaveBeenCalledWith("a1", false);
  });

  it("labels the switch accessibly", () => {
    wrap(<AgentRoster agents={agents} onToggle={vi.fn()} />);
    expect(
      screen.getByRole("switch", { name: /morning brief/i }),
    ).toBeInTheDocument();
  });

  it("shows the last run's status on the row", () => {
    wrap(<AgentRoster agents={agents} onToggle={vi.fn()} />);
    expect(screen.getByText("Ran")).toBeInTheDocument();
  });

  it("shows a failed last run as Failed", () => {
    wrap(
      <AgentRoster
        agents={[
          {
            ...base,
            lastRun: {
              status: "error",
              error: "anthropic 401",
              createdAt: new Date().toISOString(),
            },
          },
        ]}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  // The regression that motivates the whole run-status module: a run in flight
  // is STORED as 'error' (the slot is claimed before any spend), and showing
  // that as "Failed" would cry wolf on every healthy agent every morning.
  it("does not show an in-flight run as Failed", () => {
    wrap(
      <AgentRoster
        agents={[
          {
            ...base,
            lastRun: {
              status: "error",
              error: CLAIM_PLACEHOLDER,
              createdAt: new Date().toISOString(),
            },
          },
        ]}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  it("shows no status pill for an agent that has never run", () => {
    wrap(<AgentRoster agents={[base]} onToggle={vi.fn()} />);
    expect(screen.queryByText("Ran")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  // Working agreement #5: the roster's first paint must not pull run history.
  it("does not fetch run history until a row is expanded", () => {
    wrap(<AgentRoster agents={agents} onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: /recent runs/i })).toBeTruthy();
    expect(getAgentRuns).not.toHaveBeenCalled();
  });
});
