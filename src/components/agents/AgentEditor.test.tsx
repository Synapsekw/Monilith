import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PersonalAgentSettings } from "@/lib/agents/agent-config";
import type { ModelOption } from "@/components/settings/ModelPicker";

const createAgent = vi.fn();
const updateAgent = vi.fn();
const deleteAgent = vi.fn();
vi.mock("@/lib/agents/actions", () => ({
  createAgent: (...a: unknown[]) => createAgent(...a),
  updateAgent: (...a: unknown[]) => updateAgent(...a),
  deleteAgent: (...a: unknown[]) => deleteAgent(...a),
}));

import { AgentEditor } from "@/components/agents/AgentEditor";

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
  },
  {
    provider: "moonshotai",
    providerLabel: "Kimi (Moonshot AI)",
    modelId: "kimi-k2",
    label: "Kimi K2 Instruct",
    tier: "cheap",
    supportsTools: true,
  },
];

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
};

function renderEditor(over: Partial<Parameters<typeof AgentEditor>[0]> = {}) {
  const onSaved = vi.fn();
  render(
    <AgentEditor
      mode="create"
      initial={initial}
      modelOptions={OPTIONS}
      providers={PROVIDERS}
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

beforeEach(() => {
  createAgent.mockReset();
  updateAgent.mockReset();
  deleteAgent.mockReset();
  createAgent.mockResolvedValue({ ok: true, data: { id: "agent-1" } });
  updateAgent.mockResolvedValue({ ok: true, data: undefined });
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
   * The pin beating the org default is exactly what makes it dangerous: the
   * briefing loop runs only on Anthropic (`assertToolLoopCapable`), so pinning
   * an agent to any other provider makes EVERY run finalize as `skipped` —
   * with the owner's Settings → AI page looking perfectly correct. The picker
   * offers those models (33 verified OpenAI models today) and, without this
   * line, says nothing at the moment of the choice.
   */
  it("warns that a non-Anthropic pin makes every run skip", async () => {
    renderEditor({
      initial: { ...initial, provider: "moonshotai", modelId: "kimi-k2" },
    });
    const warning = screen.getByRole("status");
    expect(warning).toHaveTextContent(/every run of this agent is skipped/i);
    // Named from the provider ROW, never a hardcoded map — the registry is open.
    expect(warning).toHaveTextContent(/Kimi \(Moonshot AI\)/);
    expect(warning).toHaveTextContent(/Anthropic \(Claude\)/);
  });

  it("says nothing of the sort for an Anthropic pin", () => {
    renderEditor({
      initial: {
        ...initial,
        provider: "anthropic",
        modelId: "claude-haiku-4.5",
      },
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("says nothing of the sort for an unpinned agent", () => {
    // Unpinned follows the org default, which the org's own settings page owns
    // — warning here would flag a choice this owner has not made.
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
