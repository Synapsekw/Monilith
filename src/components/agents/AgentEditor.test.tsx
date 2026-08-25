import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PersonalAgentSettings } from "@/lib/agents/agent-config";
import type { ModelOption } from "@/components/settings/ModelPicker";
import {
  AGENT_CAPABILITIES,
  type AgentCapability,
} from "@/lib/agents/capabilities";

const createAgent = vi.fn();
const updateAgent = vi.fn();
const deleteAgent = vi.fn();
vi.mock("@/lib/agents/actions", () => ({
  createAgent: (...a: unknown[]) => createAgent(...a),
  updateAgent: (...a: unknown[]) => updateAgent(...a),
  deleteAgent: (...a: unknown[]) => deleteAgent(...a),
}));

// `DocumentPicker` itself never calls this (proven in its own test file) —
// these mocks are for the ONE call site that does: `AgentEditor.save`, after
// the agent itself is created/updated.
const setAgentDocuments = vi.fn();
vi.mock("@/lib/agents/document-actions", () => ({
  setAgentDocuments: (...a: unknown[]) => setAgentDocuments(...a),
}));

import { AgentEditor } from "@/components/agents/AgentEditor";
import type { AgentDocumentRow } from "@/lib/agents/documents-db";

/**
 * The agent editor's model pin.
 *
 * Every fixture id below is a CATALOG key (`ai_models.model_id`). The wire id
 * (`native_model_id`) is deliberately absent from `ModelOption` altogether, so
 * a picker cannot store one — the assertions here are about the other half of
 * that split: what the pin SAVES must be the catalog key, because that is what
 * `resolveModel` looks up and what the usage ledger records.
 *
 * The picker's list renders into a portal only while the popover is open, so
 * every option assertion opens the trigger first (same shape as
 * `ModelPicker.test.tsx`).
 */
const OPTIONS: ModelOption[] = [
  {
    provider: "anthropic",
    providerLabel: "Anthropic (Claude)",
    modelId: "claude-haiku-4.5",
    label: "Claude Haiku 4.5",
    tier: "cheap",
    supportsTools: true,
    contextLength: 200_000,
  },
  {
    provider: "moonshotai",
    providerLabel: "Kimi (Moonshot AI)",
    modelId: "kimi-k2",
    label: "Kimi K2 Instruct",
    tier: "cheap",
    supportsTools: true,
    contextLength: 128_000,
  },
  // The one model in the fixture catalog that cannot run a tool loop — the
  // fixture the tool-capability warning tests pin to.
  {
    provider: "moonshotai",
    providerLabel: "Kimi (Moonshot AI)",
    modelId: "kimi-k1-legacy",
    label: "Kimi K1 (legacy)",
    tier: "cheap",
    supportsTools: false,
    contextLength: 16_385,
  },
];

const FULL_CEILING: AgentCapability[] = [...AGENT_CAPABILITIES];

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "moonshotai", label: "Kimi (Moonshot AI)" },
  { id: "google", label: "Google Gemini" },
];

const initial: PersonalAgentSettings = {
  name: "Morning Brief",
  templateId: "morning-brief",
  instructions: "Summarise what is pending.",
  boardScope: { mode: "all" },
  cadence: "daily",
  runAtLocalHour: 7,
  enabled: true,
  provider: null,
  modelId: null,
  capabilities: [],
  runOnWeekday: null,
  runOnDayOfMonth: null,
};

function renderEditor(over: Partial<Parameters<typeof AgentEditor>[0]> = {}) {
  const onSaved = vi.fn();
  render(
    <AgentEditor
      mode="create"
      initial={initial}
      modelOptions={OPTIONS}
      providers={PROVIDERS}
      capabilityCeiling={FULL_CEILING}
      documents={[]}
      // Most tests don't care about the org-default fallback specifically —
      // `null` here is the "genuinely unresolvable" case, which keeps every
      // OTHER test's meter on the conservative/assumed path rather than
      // silently depending on a org-default fixture they never mention.
      orgDefaultContextLength={null}
      onSaved={onSaved}
      onCancel={vi.fn()}
      {...over}
    />,
  );
  return { onSaved };
}

/**
 * The model combobox. The editor renders a second combobox — the "Runs daily
 * at" `<select>` — so a bare `getByRole("combobox")` is ambiguous. Going
 * through the labelled group is also the assertion that the field IS named:
 * the trigger's own accessible name is its current VALUE, so the group's
 * label is the only thing that says "Model".
 */
function modelField(): HTMLElement {
  return within(screen.getByRole("group", { name: "Model" })).getByRole(
    "combobox",
  );
}

const DOCS: AgentDocumentRow[] = [
  {
    id: "doc-1",
    title: "Runbook",
    tokenEstimate: 500,
    sourceFormat: "pasted",
    sourceFileName: null,
    updatedAt: "2026-08-24T10:00:00Z",
  },
];

beforeEach(() => {
  createAgent.mockReset();
  updateAgent.mockReset();
  deleteAgent.mockReset();
  setAgentDocuments.mockReset();
  createAgent.mockResolvedValue({ ok: true, data: { id: "agent-1" } });
  updateAgent.mockResolvedValue({ ok: true, data: undefined });
  setAgentDocuments.mockResolvedValue({ ok: true, data: undefined });
});

describe("AgentEditor · model pin", () => {
  it("starts on the org default when the agent has no pin", () => {
    renderEditor();
    expect(modelField()).toHaveAccessibleName(/organization's default/i);
  });

  it("saves an unpinned agent as null on both halves", async () => {
    renderEditor();
    await userEvent.click(
      screen.getByRole("button", { name: /create agent/i }),
    );
    await waitFor(() => expect(createAgent).toHaveBeenCalled());
    expect(createAgent.mock.calls[0][0]).toMatchObject({
      provider: null,
      modelId: null,
    });
  });

  it("saves the CATALOG key of the model that was picked, with its provider", async () => {
    renderEditor();
    await userEvent.click(modelField());
    await userEvent.click(
      await screen.findByRole("option", { name: /kimi k2 instruct/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /create agent/i }),
    );
    await waitFor(() => expect(createAgent).toHaveBeenCalled());
    expect(createAgent.mock.calls[0][0]).toMatchObject({
      provider: "moonshotai",
      modelId: "kimi-k2",
    });
  }, 30_000);

  it("shows an existing pin and saves it back unchanged", async () => {
    renderEditor({
      mode: "edit",
      agentId: "11111111-1111-4111-8111-111111111111",
      initial: { ...initial, provider: "moonshotai", modelId: "kimi-k2" },
    });
    // The stored pin reads back as its human LABEL, from the catalog option it
    // matched — not as the raw id, and never as a wire id.
    expect(modelField()).toHaveAccessibleName(/kimi k2 instruct/i);

    await userEvent.click(
      screen.getByRole("button", { name: /save changes/i }),
    );
    await waitFor(() => expect(updateAgent).toHaveBeenCalled());
    expect(updateAgent.mock.calls[0][1]).toMatchObject({
      provider: "moonshotai",
      modelId: "kimi-k2",
    });
  }, 30_000);

  // Going back to the org default has to be reachable, and it has to SAVE as
  // null — anything else leaves the old pin in the row.
  it("clears a pin back to the org default", async () => {
    renderEditor({
      mode: "edit",
      agentId: "11111111-1111-4111-8111-111111111111",
      initial: { ...initial, provider: "moonshotai", modelId: "kimi-k2" },
    });
    await userEvent.click(modelField());
    await userEvent.click(
      await screen.findByRole("option", { name: /organization's default/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /save changes/i }),
    );
    await waitFor(() => expect(updateAgent).toHaveBeenCalled());
    expect(updateAgent.mock.calls[0][1]).toMatchObject({
      provider: null,
      modelId: null,
    });
  }, 30_000);

  // Three of the five seeded providers have zero verified models until someone
  // saves a key for them. That gap must read as configuration, not breakage.
  it("lists a provider with no models yet and says what unlocks it", async () => {
    renderEditor();
    await userEvent.click(modelField());
    expect(await screen.findByText("Google Gemini")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /add an api key to see models/i }),
    ).toHaveAttribute("aria-disabled", "true");
  }, 30_000);

  it("explains an entirely empty catalog as a missing key, not a missing feature", () => {
    renderEditor({ modelOptions: [], providers: [] });
    expect(screen.getByText(/add an api key/i)).toBeInTheDocument();
    expect(screen.queryByText(/no models available/i)).not.toBeInTheDocument();
  });

  // The pin is the top of the ladder: it beats the org default. Saying so is
  // the difference between a control the owner trusts and one they re-check.
  it("says what a pin overrides once one is set", async () => {
    renderEditor({
      initial: { ...initial, provider: "moonshotai", modelId: "kimi-k2" },
    });
    expect(screen.getByText(/organization's default/i)).toBeInTheDocument();
  });

  /**
   * The run loop is provider-agnostic (Task 7) — what actually determines
   * whether a pinned agent can act is the selected model's OWN
   * `supportsTools` flag, not which provider it belongs to. A model that
   * can't call tools still runs, but degrades to writing a summary, so the
   * warning has to name that consequence rather than "skipped".
   */
  it("warns when the pinned model can't use tools", async () => {
    renderEditor({
      initial: {
        ...initial,
        provider: "moonshotai",
        modelId: "kimi-k1-legacy",
      },
    });
    const warning = screen.getByRole("status");
    expect(warning).toHaveTextContent(
      "This model can't use tools, so this agent can only write a summary. Pick a tool-capable model to let it act.",
    );
  });

  it("says nothing of the sort for a tool-capable pin, Anthropic or otherwise", () => {
    renderEditor({
      initial: {
        ...initial,
        provider: "moonshotai",
        modelId: "kimi-k2",
      },
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("says nothing of the sort for an unpinned agent", () => {
    // Unpinned follows the org default, which the org's own settings page owns
    // — warning here would flag a choice this owner has not made, and this
    // form has no way to know whether the org default supports tools.
    renderEditor();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps saving the rest of the form working", async () => {
    const { onSaved } = renderEditor();
    await userEvent.clear(screen.getByLabelText(/name/i));
    await userEvent.type(screen.getByLabelText(/name/i), "Renamed");
    await userEvent.click(
      screen.getByRole("button", { name: /create agent/i }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(createAgent.mock.calls[0][0]).toMatchObject({ name: "Renamed" });
  }, 30_000);

  it("renders a server failure inline instead of swallowing it", async () => {
    createAgent.mockResolvedValue({ ok: false, error: "at most 3 agents" });
    renderEditor();
    await userEvent.click(
      screen.getByRole("button", { name: /create agent/i }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "at most 3 agents",
    );
  }, 30_000);
});

describe("AgentEditor · capabilities", () => {
  it("renders the capability toggles the agent already has, and saves a change", async () => {
    renderEditor({
      initial: { ...initial, capabilities: ["board.write"] },
    });

    const boardToggle = screen.getByRole("switch", {
      name: /create and update items/i,
    });
    expect(boardToggle).toBeChecked();

    await userEvent.click(screen.getByRole("switch", { name: /log time/i }));
    await userEvent.click(
      screen.getByRole("button", { name: /create agent/i }),
    );
    await waitFor(() => expect(createAgent).toHaveBeenCalled());
    expect(createAgent.mock.calls[0][0].capabilities).toEqual(
      expect.arrayContaining(["board.write", "time.log"]),
    );
    expect(createAgent.mock.calls[0][0].capabilities).toHaveLength(2);
  }, 30_000);

  // Grants intersect the org's ceiling again at RUN time — this is only about
  // not letting the owner set a grant that would be silently dropped.
  it("disables a capability outside the org's capability ceiling", () => {
    renderEditor({
      capabilityCeiling: FULL_CEILING.filter((c) => c !== "automation.create"),
    });
    const automationToggle = screen.getByRole("switch", {
      name: /create board automations/i,
    });
    expect(automationToggle).toBeDisabled();
    expect(
      screen.getByText("Disabled for this organization by an admin."),
    ).toBeInTheDocument();
  });
});

describe("AgentEditor · cadence", () => {
  function cadenceField(): HTMLElement {
    return screen.getByLabelText(/^runs$/i);
  }

  it("reveals neither a weekday nor a day-of-month select for daily", () => {
    renderEditor({ initial: { ...initial, cadence: "daily" } });
    expect(screen.queryByLabelText(/weekday/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/day of month/i)).not.toBeInTheDocument();
  });

  it("reveals neither a weekday nor a day-of-month select for weekdays", () => {
    renderEditor({
      initial: { ...initial, cadence: "weekdays" },
    });
    expect(screen.queryByLabelText(/weekday/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/day of month/i)).not.toBeInTheDocument();
  });

  it("reveals a weekday select for weekly, and no day-of-month select", () => {
    renderEditor({
      initial: { ...initial, cadence: "weekly", runOnWeekday: 2 },
    });
    expect(screen.getByLabelText(/weekday/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/day of month/i)).not.toBeInTheDocument();
  });

  it("reveals a day-of-month select for monthly, and no weekday select", () => {
    renderEditor({
      initial: { ...initial, cadence: "monthly", runOnDayOfMonth: 15 },
    });
    expect(screen.getByLabelText(/day of month/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/weekday/i)).not.toBeInTheDocument();
  });

  it("switches which select is revealed live as the cadence changes", async () => {
    renderEditor({ initial: { ...initial, cadence: "daily" } });
    expect(screen.queryByLabelText(/weekday/i)).not.toBeInTheDocument();

    await userEvent.selectOptions(cadenceField(), "weekly");
    expect(screen.getByLabelText(/weekday/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/day of month/i)).not.toBeInTheDocument();

    await userEvent.selectOptions(cadenceField(), "monthly");
    expect(screen.getByLabelText(/day of month/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/weekday/i)).not.toBeInTheDocument();
  });

  it("saves the cadence and day operand chosen through the controls", async () => {
    const { onSaved } = renderEditor({
      initial: { ...initial, cadence: "daily" },
    });
    await userEvent.selectOptions(cadenceField(), "weekly");
    await userEvent.selectOptions(screen.getByLabelText(/weekday/i), "3");
    await userEvent.click(
      screen.getByRole("button", { name: /create agent/i }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(createAgent.mock.calls[0][0]).toMatchObject({
      cadence: "weekly",
      runOnWeekday: 3,
      runOnDayOfMonth: null,
    });
  }, 30_000);
});

describe("AgentEditor · reference documents", () => {
  it("does not call setAgentDocuments when nothing is attached and nothing was picked", async () => {
    renderEditor();
    await userEvent.click(
      screen.getByRole("button", { name: /create agent/i }),
    );
    await waitFor(() => expect(createAgent).toHaveBeenCalled());
    expect(setAgentDocuments).not.toHaveBeenCalled();
  }, 30_000);

  it("attaches a picked document, after the agent itself is created", async () => {
    renderEditor({ documents: DOCS });
    await userEvent.click(screen.getByRole("checkbox", { name: /runbook/i }));
    await userEvent.click(
      screen.getByRole("button", { name: /create agent/i }),
    );
    await waitFor(() => expect(setAgentDocuments).toHaveBeenCalled());
    expect(setAgentDocuments).toHaveBeenCalledWith({
      userAgentId: "agent-1",
      documentIds: ["doc-1"],
    });
    // The agent was created BEFORE its attachments were saved — a new agent
    // has no `user_agent_id` for `setAgentDocuments` until `createAgent`
    // returns one.
    expect(createAgent.mock.invocationCallOrder[0]).toBeLessThan(
      setAgentDocuments.mock.invocationCallOrder[0],
    );
  }, 30_000);

  // The skip in `saveDocuments` (AgentEditor.tsx) is what keeps an unrelated
  // rename from costing the owner an extra server round trip.
  it("skips the call when the attachment set was not touched", async () => {
    renderEditor({
      mode: "edit",
      agentId: "11111111-1111-4111-8111-111111111111",
      documents: DOCS,
      initialDocumentIds: ["doc-1"],
    });
    await userEvent.click(
      screen.getByRole("button", { name: /save changes/i }),
    );
    await waitFor(() => expect(updateAgent).toHaveBeenCalled());
    expect(setAgentDocuments).not.toHaveBeenCalled();
  }, 30_000);

  it("surfaces a setAgentDocuments failure inline instead of reporting a clean save", async () => {
    setAgentDocuments.mockResolvedValue({
      ok: false,
      error: "Couldn't update the attached documents.",
    });
    const { onSaved } = renderEditor({ documents: DOCS });
    await userEvent.click(screen.getByRole("checkbox", { name: /runbook/i }));
    await userEvent.click(
      screen.getByRole("button", { name: /create agent/i }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't update the attached documents.",
    );
    expect(onSaved).not.toHaveBeenCalled();
  }, 30_000);

  // `initial` is unpinned (`provider`/`modelId` both null) — the default
  // state of every new agent, and the case the meter got wrong: it used to
  // pass `null` straight through whenever there was no PIN-derived option,
  // which made the meter assume `NULL_CONTEXT_FALLBACK` (32,000) even though
  // the org default the run loop actually resolves to might be much smaller.
  it("computes an unpinned agent's budget from the org default, not the 32,000 fallback", () => {
    // 16,385 is document-budget.ts's own documented minimum among active
    // tool-capable models — a real org default can legitimately be this
    // small. Its true budget (2,461) is BELOW MIN_USEFUL_BUDGET, so the
    // picker must say so. Under the bug, this same setup fell back to
    // 32,000's budget (9,098) instead, which IS usable — so this assertion
    // is exactly the one the regression would have failed.
    renderEditor({ documents: DOCS, orgDefaultContextLength: 16_385 });
    expect(
      screen.getByText(/context is too small for reference documents/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/assuming a 32,000-token context/i),
    ).not.toBeInTheDocument();
  });

  it("falls back to the assumed context and discloses it when the org default can't be resolved", () => {
    renderEditor({ documents: DOCS, orgDefaultContextLength: null });
    expect(
      screen.getByText(/assuming a 32,000-token context/i),
    ).toBeInTheDocument();
  });
});
