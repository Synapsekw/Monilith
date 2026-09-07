import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AgentsSection } from "./AgentsSection";
import type { AgentRecord } from "./AgentEditor";

// The roster embeds AgentRunHistory, which uses TanStack Query. Nothing here
// expands a row, so the server action is never reached — the mock exists only
// so an accidental fetch fails loudly rather than hitting the network.
vi.mock("@/lib/agents/actions", () => ({
  getAgentRuns: vi.fn(),
  // Imported by AgentRunHistory (Spec 3). Never called here — the disclosure is
  // collapsed — but a mocked module must still carry the export.
  getChildRuns: vi.fn(),
  setAgentEnabled: vi.fn(),
}));

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const agent: AgentRecord = {
  id: "a1",
  name: "Morning Brief",
  handle: "morning-brief",
  kind: "user",
  templateId: "morning-brief",
  instructions: "Summarise what is pending.",
  boardScope: { mode: "all" },
  cadence: "daily",
  runAtLocalHour: 7,
  runOnWeekday: null,
  runOnDayOfMonth: null,
  enabled: true,
  provider: null,
  modelId: null,
  capabilities: [],
};

function renderSection(agents: AgentRecord[], maxAgents = 3) {
  return wrap(
    <AgentsSection
      agents={agents}
      maxAgents={maxAgents}
      modelOptions={[]}
      providers={[]}
      capabilityCeiling={[]}
      documents={[]}
      documentTotal={0}
      attachmentsByAgent={{}}
      memoryTotals={{}}
      orgDefaultContextLength={null}
    />,
  );
}

describe("AgentsSection · the cap label", () => {
  it("counts the agents its owner made", () => {
    renderSection([agent, { ...agent, id: "a2", handle: "chaser" }]);
    expect(screen.getByText("2 of 3 agents")).toBeInTheDocument();
  });

  // `countAgentsForOwner` excludes `kind = 'builtin'`, so a label that counted
  // it would read "4 of 3" for someone the server would happily let create a
  // fourth — the exact mismatch the `maxAgents` prop was introduced to end.
  it("does not count the built-in assistant against the cap", () => {
    renderSection([
      agent,
      {
        ...agent,
        id: "b1",
        name: "Assistant",
        handle: "assistant",
        kind: "builtin",
      },
    ]);
    expect(screen.getByText("1 of 3 agents")).toBeInTheDocument();
  });

  // Excluded from the COUNT, never from the LIST: it is still an agent the
  // owner edits, renames and switches off.
  it("still lists the built-in assistant", () => {
    renderSection([
      {
        ...agent,
        id: "b1",
        name: "Assistant",
        handle: "assistant",
        kind: "builtin",
      },
    ]);
    expect(screen.getByText("Assistant")).toBeInTheDocument();
    expect(screen.getByText("@assistant")).toBeInTheDocument();
  });
});
