import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentMemoryNote } from "@/lib/agents/memory-db";

// The panel's three Server Actions. Mocked here for the same reason
// `AgentRoster.test.tsx` mocks `getAgentRuns`: an unmocked call would leave
// the component talking to a real Server Action from jsdom, and the whole
// point of most of these tests is asserting exactly WHEN it is called.
const listAgentMemory = vi.fn();
const saveOwnerNote = vi.fn();
const deleteMemoryNote = vi.fn();
vi.mock("@/lib/agents/memory-actions", () => ({
  listAgentMemory: (...a: unknown[]) => listAgentMemory(...a),
  saveOwnerNote: (...a: unknown[]) => saveOwnerNote(...a),
  deleteMemoryNote: (...a: unknown[]) => deleteMemoryNote(...a),
}));

import { MemoryPanel } from "@/components/agents/MemoryPanel";

const AGENT_NOTE: AgentMemoryNote = {
  id: "11111111-1111-4111-8111-111111111111",
  key: "dana-group",
  value: "Dana's group owns the billing board and reviews on Fridays.",
  origin: "agent",
  tokenEstimate: 15,
  lastRunId: "22222222-2222-4222-8222-222222222222",
  updatedAt: "2026-08-24T09:00:00Z",
};

const OWNER_NOTE: AgentMemoryNote = {
  id: "33333333-3333-4333-8333-333333333333",
  key: "frozen-board",
  value: "The Q3 planning board is frozen until October.",
  origin: "owner",
  tokenEstimate: 12,
  lastRunId: null,
  updatedAt: "2026-08-25T09:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

async function expand() {
  await userEvent.click(
    screen.getByRole("button", { name: /what this agent remembers/i }),
  );
}

describe("MemoryPanel", () => {
  it("shows the note count against the cap without fetching on mount", () => {
    render(
      <MemoryPanel agentId="a1" totals={{ noteCount: 7, tokenTotal: 210 }} />,
    );
    expect(screen.getByText(/7 of 50/)).toBeInTheDocument();
    // The whole first-paint bargain: the settings page already read the
    // aggregate, so the collapsed panel is rendering data it was handed
    // (working agreement #5). A fetch here would be a per-agent round trip on
    // every paint of the editor.
    expect(listAgentMemory).not.toHaveBeenCalled();
  });

  it("loads the notes only when the owner opens it", async () => {
    listAgentMemory.mockResolvedValue({
      ok: true,
      data: { notes: [AGENT_NOTE, OWNER_NOTE] },
    });
    render(
      <MemoryPanel agentId="a1" totals={{ noteCount: 2, tokenTotal: 20 }} />,
    );
    await expand();
    expect(listAgentMemory).toHaveBeenCalledWith("a1");
    expect(await screen.findByText("dana-group")).toBeInTheDocument();
  });

  it("does not refetch when the owner closes and reopens it", async () => {
    listAgentMemory.mockResolvedValue({
      ok: true,
      data: { notes: [AGENT_NOTE, OWNER_NOTE] },
    });
    render(
      <MemoryPanel agentId="a1" totals={{ noteCount: 2, tokenTotal: 20 }} />,
    );
    await expand();
    expect(await screen.findByText("dana-group")).toBeInTheDocument();
    await expand(); // collapse
    await expand(); // reopen
    expect(await screen.findByText("dana-group")).toBeInTheDocument();
    // Cached in component state: reopening is an in-page toggle over data
    // already in hand, which is 0 new server round-trips.
    expect(listAgentMemory).toHaveBeenCalledTimes(1);
  });

  // The audit requirement from the spec: an unauditable memory is an
  // unfalsifiable one.
  it("marks which notes the agent wrote and which the owner wrote", async () => {
    listAgentMemory.mockResolvedValue({
      ok: true,
      data: { notes: [AGENT_NOTE, OWNER_NOTE] },
    });
    render(
      <MemoryPanel agentId="a1" totals={{ noteCount: 2, tokenTotal: 20 }} />,
    );
    await expand();
    expect(
      await screen.findByText(/written by this agent/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/written by you/i)).toBeInTheDocument();
  });

  it("tells the owner when the notes could not be loaded", async () => {
    listAgentMemory.mockResolvedValue({
      ok: false,
      error: "Couldn't load this agent's memory.",
    });
    render(
      <MemoryPanel agentId="a1" totals={{ noteCount: 2, tokenTotal: 20 }} />,
    );
    await expand();
    // A failed read and an empty memory must never look the same — the same
    // rule `AgentRunHistory` documents for run history.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't load this agent's memory/i,
    );
    expect(
      screen.queryByText(/nothing remembered yet/i),
    ).not.toBeInTheDocument();
  });

  it("refuses a multi-line note in the form, before any round trip", async () => {
    render(
      <MemoryPanel agentId="a1" totals={{ noteCount: 0, tokenTotal: 0 }} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /add a note/i }));
    await userEvent.type(screen.getByLabelText(/key/i), "frozen-board");
    await userEvent.type(screen.getByLabelText(/note/i), "one{Enter}two");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(saveOwnerNote).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/single line/i);
  });

  it("refuses a key that isn't slug-shaped, in the schema's own words", async () => {
    render(
      <MemoryPanel agentId="a1" totals={{ noteCount: 0, tokenTotal: 0 }} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /add a note/i }));
    await userEvent.type(screen.getByLabelText(/key/i), "Frozen Board");
    await userEvent.type(
      screen.getByLabelText(/note/i),
      "Frozen until October.",
    );
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(saveOwnerNote).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /lowercase letters, numbers and hyphens/i,
    );
  });

  it("saves a valid note through the Server Action and reloads the list", async () => {
    saveOwnerNote.mockResolvedValue({ ok: true, data: undefined });
    listAgentMemory.mockResolvedValue({
      ok: true,
      data: { notes: [OWNER_NOTE] },
    });
    render(
      <MemoryPanel agentId="a1" totals={{ noteCount: 0, tokenTotal: 0 }} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /add a note/i }));
    await userEvent.type(screen.getByLabelText(/key/i), "frozen-board");
    await userEvent.type(
      screen.getByLabelText(/note/i),
      "The Q3 planning board is frozen until October.",
    );
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(saveOwnerNote).toHaveBeenCalledWith({
        userAgentId: "a1",
        key: "frozen-board",
        value: "The Q3 planning board is frozen until October.",
      }),
    );
    expect(await screen.findByText("frozen-board")).toBeInTheDocument();
  });

  it("surfaces a save the server refused, and keeps the form open", async () => {
    saveOwnerNote.mockResolvedValue({
      ok: false,
      error: "This agent already has 50 notes, the maximum.",
    });
    render(
      <MemoryPanel agentId="a1" totals={{ noteCount: 0, tokenTotal: 0 }} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /add a note/i }));
    await userEvent.type(screen.getByLabelText(/key/i), "frozen-board");
    await userEvent.type(
      screen.getByLabelText(/note/i),
      "Frozen until October.",
    );
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/50 notes/i);
    expect(screen.getByLabelText(/key/i)).toBeInTheDocument();
  });

  it("names the note in the delete confirmation before deleting it", async () => {
    listAgentMemory.mockResolvedValue({
      ok: true,
      data: { notes: [AGENT_NOTE] },
    });
    deleteMemoryNote.mockResolvedValue({ ok: true, data: undefined });
    render(
      <MemoryPanel agentId="a1" totals={{ noteCount: 1, tokenTotal: 15 }} />,
    );
    await expand();
    await userEvent.click(
      await screen.findByRole("button", { name: /delete dana-group/i }),
    );
    // The same confirmation shape `DocumentLibrary` uses: the dialog names
    // exactly what is about to go.
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      /dana-group/,
    );
    expect(deleteMemoryNote).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /delete note/i }));
    await waitFor(() =>
      expect(deleteMemoryNote).toHaveBeenCalledWith(AGENT_NOTE.id),
    );
  });

  it("disables adding at the cap and says why", () => {
    render(
      <MemoryPanel agentId="a1" totals={{ noteCount: 50, tokenTotal: 5000 }} />,
    );
    expect(screen.getByRole("button", { name: /add a note/i })).toBeDisabled();
    expect(screen.getByText(/maximum/i)).toBeInTheDocument();
  });

  it("tells the owner an edit takes effect on the next run", () => {
    render(
      <MemoryPanel agentId="a1" totals={{ noteCount: 1, tokenTotal: 10 }} />,
    );
    expect(screen.getByText(/next run/i)).toBeInTheDocument();
  });

  it("says revoking the write permission does not erase what is here", () => {
    // Spec §6, last row: reads were never gated, so notes keep injecting
    // after the grant is turned off. A panel that doesn't say so lets an
    // owner believe they revoked something they didn't.
    render(
      <MemoryPanel agentId="a1" totals={{ noteCount: 1, tokenTotal: 10 }} />,
    );
    expect(
      screen.getByText(/doesn't erase|does not erase/i),
    ).toBeInTheDocument();
  });

  it("says nothing is remembered yet for a brand-new agent", () => {
    render(
      <MemoryPanel agentId={null} totals={{ noteCount: 0, tokenTotal: 0 }} />,
    );
    expect(screen.getByText(/save this agent first/i)).toBeInTheDocument();
    expect(listAgentMemory).not.toHaveBeenCalled();
  });

  it("never navigates — the panel contains no links", async () => {
    listAgentMemory.mockResolvedValue({
      ok: true,
      data: { notes: [AGENT_NOTE, OWNER_NOTE] },
    });
    const { container } = render(
      <MemoryPanel agentId="a1" totals={{ noteCount: 2, tokenTotal: 20 }} />,
    );
    await expand();
    expect(await screen.findByText("dana-group")).toBeInTheDocument();
    // gotcha-09: a `<Link>`/`router.push` in here would re-run every query on
    // the settings page to show data this component already holds.
    expect(container.querySelector("a")).toBeNull();
  });
});
