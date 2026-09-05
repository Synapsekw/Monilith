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
  // Imported by AgentRunHistory (Spec 3). Never called here — the disclosure is
  // collapsed — but a mocked module must still carry the export.
  getChildRuns: vi.fn(),
}));

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const base: RosterAgent = {
  id: "a1",
  name: "Morning Brief",
  handle: "morning-brief",
  templateId: "morning-brief",
  cadence: "daily",
  runAtLocalHour: 7,
  runOnWeekday: null,
  runOnDayOfMonth: null,
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

  // The badge is the ONLY place a queued approval is discoverable without
  // opening the run that produced it.
  it("badges an agent that has proposals waiting", () => {
    wrap(
      <AgentRoster
        agents={[{ ...base, pendingProposals: 3 }]}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText(/3 awaiting approval/i)).toBeInTheDocument();
  });

  it("shows no badge when nothing is waiting", () => {
    wrap(
      <AgentRoster
        agents={[{ ...base, pendingProposals: 0 }]}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.queryByText(/awaiting approval/i)).not.toBeInTheDocument();
  });

  // The handle is the ONLY thing a person can type to summon an agent, and
  // it is not the display name. A roster that never showed it left the answer
  // to "what do I type?" nowhere in the product.
  it("shows the handle the agent answers to", () => {
    wrap(<AgentRoster agents={agents} onToggle={vi.fn()} />);
    expect(screen.getByText("@morning-brief")).toBeInTheDocument();
  });

  // The regression this replaces: the row rendered "Daily at HH:00" for every
  // agent regardless of cadence, so a weekly agent claimed to run every day
  // and a manual one claimed a schedule it does not have at all.
  it("does not claim a manual agent runs daily", () => {
    wrap(
      <AgentRoster
        agents={[{ ...base, cadence: "manual" }]}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText(/only when you ask/i)).toBeInTheDocument();
    expect(screen.queryByText(/daily/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/07:00/)).not.toBeInTheDocument();
  });

  it("names the weekday a weekly agent runs on", () => {
    wrap(
      <AgentRoster
        agents={[{ ...base, cadence: "weekly", runOnWeekday: 1 }]}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("Mondays at 07:00")).toBeInTheDocument();
  });

  it("names the day of the month a monthly agent runs on", () => {
    wrap(
      <AgentRoster
        agents={[{ ...base, cadence: "monthly", runOnDayOfMonth: 28 }]}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("Day 28 at 07:00")).toBeInTheDocument();
  });

  it("says weekdays, not daily, for a weekdays agent", () => {
    wrap(
      <AgentRoster
        agents={[{ ...base, cadence: "weekdays" }]}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("Weekdays at 07:00")).toBeInTheDocument();
  });

  // Working agreement #5: the roster's first paint must not pull run history.
  it("does not fetch run history until a row is expanded", () => {
    wrap(<AgentRoster agents={agents} onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: /recent runs/i })).toBeTruthy();
    expect(getAgentRuns).not.toHaveBeenCalled();
  });
});
