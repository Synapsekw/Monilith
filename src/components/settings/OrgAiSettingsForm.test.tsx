import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProviderRow } from "@/lib/ai/providers/provider-rows";
import type { ModelOption } from "@/components/settings/ModelPicker";

const setAiMode = vi.fn();
const setOrgByoKey = vi.fn();
const removeOrgByoKey = vi.fn();
const setOrgDefaultModel = vi.fn();
const clearOrgDefaultModel = vi.fn();
const setAssistantName = vi.fn();
vi.mock("@/lib/ai/settings-actions", () => ({
  setAssistantName: (...a: unknown[]) => setAssistantName(...a),
  setAiMode: (...a: unknown[]) => setAiMode(...a),
  setOrgByoKey: (...a: unknown[]) => setOrgByoKey(...a),
  removeOrgByoKey: (...a: unknown[]) => removeOrgByoKey(...a),
  setOrgDefaultModel: (...a: unknown[]) => setOrgDefaultModel(...a),
  clearOrgDefaultModel: (...a: unknown[]) => clearOrgDefaultModel(...a),
}));

import { OrgAiSettingsForm } from "@/components/settings/OrgAiSettingsForm";

type Initial = React.ComponentProps<typeof OrgAiSettingsForm>["initial"];

/**
 * Two fixtures are providers the deleted PROVIDER_CATALOG never covered. The
 * form used to index that three-entry map with `byo_provider`, so a stored
 * `mistral` threw and took the whole settings page down for every admin in the
 * org — the tests below render exactly that state.
 */
const PROVIDERS: ProviderRow[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    adapterKind: "anthropic",
    baseUrl: null,
    keyPlaceholder: "sk-ant-…",
    keyFormat: "^sk-ant-",
    enabled: true,
  },
  {
    id: "mistral",
    label: "Mistral",
    adapterKind: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    keyPlaceholder: "your-mistral-key",
    keyFormat: "^.{16,}$",
    enabled: true,
  },
  {
    id: "moonshotai",
    label: "Kimi (Moonshot AI)",
    adapterKind: "openai-compatible",
    baseUrl: "https://api.moonshot.ai/v1",
    keyPlaceholder: "sk-…",
    keyFormat: "^sk-",
    enabled: true,
  },
];

const MODELS: ModelOption[] = [
  {
    provider: "anthropic",
    providerLabel: "Anthropic (Claude)",
    modelId: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    tier: "standard",
    supportsTools: true,
    contextLength: 200_000,
  },
  {
    provider: "mistral",
    providerLabel: "Mistral",
    modelId: "mistral-small-latest",
    label: "Mistral Small",
    tier: "cheap",
    supportsTools: true,
    contextLength: 32_000,
  },
];

const base: Initial = {
  mode: "per_user",
  tier: "free",
  creditsLimit: 500,
  creditsUsed: 100,
  byoProvider: null,
  byoKeyLast4: null,
  defaultProvider: null,
  defaultModelId: null,
  assistantName: "Monolith Autopilot",
};

function renderForm(initial: Initial = base, modelOptions = MODELS) {
  return render(
    <OrgAiSettingsForm
      initial={initial}
      providers={PROVIDERS}
      modelOptions={modelOptions}
    />,
  );
}

beforeEach(() => {
  setAiMode.mockReset();
  setOrgByoKey.mockReset();
  removeOrgByoKey.mockReset();
  setOrgDefaultModel.mockReset();
  clearOrgDefaultModel.mockReset();
  setAssistantName.mockReset();
});

describe("OrgAiSettingsForm · assistant name", () => {
  const field = () => screen.getByLabelText(/assistant name/i);
  const renameButton = () => screen.getByRole("button", { name: /^rename$/i });

  it("shows the org's current assistant name", () => {
    renderForm({ ...base, assistantName: "Ada" });
    expect(field()).toHaveValue("Ada");
  });

  // Working agreement #5: typing is client state. A rename is ONE round-trip,
  // on Save — not one per keystroke, and not a `router.refresh()` per field.
  it("does not touch the server while the admin types", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.clear(field());
    await user.type(field(), "Ada");
    expect(setAssistantName).not.toHaveBeenCalled();
  });

  it("saves the trimmed name once, and confirms it", async () => {
    const user = userEvent.setup();
    setAssistantName.mockResolvedValue({ ok: true, data: { name: "Ada" } });
    renderForm();
    await user.clear(field());
    await user.type(field(), "  Ada  ");
    await user.click(renameButton());
    await waitFor(() =>
      expect(setAssistantName).toHaveBeenCalledExactlyOnceWith({ name: "Ada" }),
    );
    expect(await screen.findByText(/renamed/i)).toBeInTheDocument();
  });

  it("keeps Rename unavailable for an unchanged or empty name", async () => {
    const user = userEvent.setup();
    renderForm({ ...base, assistantName: "Ada" });
    expect(renameButton()).toBeDisabled();
    await user.clear(field());
    expect(renameButton()).toBeDisabled();
    await user.type(field(), "   ");
    expect(renameButton()).toBeDisabled();
  });

  // The name is admin-editable content behind a server-side `has_org_role`
  // check. A refusal has to reach the admin on the field that caused it —
  // and the typed name has to survive it, or a rejected save silently
  // discards what they wrote.
  it("shows a refused rename on the field, keeping what was typed", async () => {
    const user = userEvent.setup();
    setAssistantName.mockResolvedValue({
      ok: false,
      error: "Only organization admins can change AI settings.",
    });
    renderForm();
    await user.clear(field());
    await user.type(field(), "Ada");
    await user.click(renameButton());
    expect(
      await screen.findByText(/only organization admins/i),
    ).toBeInTheDocument();
    expect(field()).toHaveValue("Ada");
    expect(field()).toHaveAttribute("aria-invalid", "true");
  });
});

describe("OrgAiSettingsForm", () => {
  it("renders four mode options with the current one selected", () => {
    renderForm();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
    const selected = screen.getByRole("radio", {
      name: /members'? own keys/i,
    }) as HTMLInputElement;
    expect(selected.checked).toBe(true);
  });

  it("shows the credit meter when the mode is managed", () => {
    renderForm({ ...base, mode: "managed" });
    expect(
      screen.getByText(/100 \/ 500 credits this month/i),
    ).toBeInTheDocument();
  });

  it("calls setAiMode with the chosen mode when a different one is picked", async () => {
    setAiMode.mockResolvedValueOnce({ ok: true, data: { mode: "off" } });
    renderForm();
    fireEvent.click(screen.getByRole("radio", { name: /^off/i }));
    await waitFor(() =>
      expect(setAiMode).toHaveBeenCalledWith({ mode: "off" }),
    );
  });

  it("surfaces a failed mode change inline and reverts the selection", async () => {
    setAiMode.mockResolvedValueOnce({
      ok: false,
      error: "Add an organization key before switching to it.",
    });
    renderForm();
    fireEvent.click(screen.getByRole("radio", { name: /organization key/i }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /add an organization key before switching to it/i,
      ),
    );
    // reverted to the last confirmed mode
    const selected = screen.getByRole("radio", {
      name: /members'? own keys/i,
    }) as HTMLInputElement;
    expect(selected.checked).toBe(true);
  });

  it("shows the configured org key and removes it", async () => {
    removeOrgByoKey.mockResolvedValueOnce({ ok: true, data: {} });
    renderForm({
      ...base,
      mode: "org_byo",
      byoProvider: "anthropic",
      byoKeyLast4: "sk-ant-…WXYZ",
    });
    expect(screen.getByText("Anthropic (Claude)")).toBeInTheDocument();
    expect(screen.getByText(/WXYZ/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    await waitFor(() => expect(removeOrgByoKey).toHaveBeenCalled());
  });

  it("disables save until a 10+ char key is typed, then saves it", async () => {
    setOrgByoKey.mockResolvedValueOnce({
      ok: true,
      data: { provider: "anthropic", hint: "sk-ant-…AB12" },
    });
    renderForm();
    const save = screen.getByRole("button", { name: /validate & save/i });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/organization api key/i), {
      target: { value: "sk-ant-abcdefAB12" },
    });
    expect(save).not.toBeDisabled();

    fireEvent.click(save);
    await waitFor(() =>
      expect(setOrgByoKey).toHaveBeenCalledWith({
        provider: "anthropic",
        key: "sk-ant-abcdefAB12",
      }),
    );
  });
});

// ---- carry-forward 9-b/10: provider metadata comes from the row, never a map ----

describe("OrgAiSettingsForm — providers come from the registry", () => {
  it("renders a stored org key for a provider no static catalog knew about", () => {
    // This is the page-500: PROVIDER_CATALOG had three entries and this value
    // is a fourth, so the old form read `.label` off `undefined` and threw.
    renderForm({
      ...base,
      mode: "org_byo",
      byoProvider: "mistral",
      byoKeyLast4: "abcdefg…7890",
    });
    expect(screen.getByText("Mistral")).toBeInTheDocument();
    expect(screen.getByText(/abcdefg…7890/)).toBeInTheDocument();
  });

  it("offers every enabled provider, not just the native three", () => {
    renderForm();
    for (const label of ["Anthropic (Claude)", "Mistral", "Kimi (Moonshot AI)"])
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  });

  it("takes the key placeholder from the chosen provider's row", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Mistral" }));
    expect(screen.getByLabelText(/organization api key/i)).toHaveAttribute(
      "placeholder",
      "your-mistral-key",
    );
  });

  it("still renders when the registry has no enabled providers", () => {
    render(
      <OrgAiSettingsForm initial={base} providers={[]} modelOptions={[]} />,
    );
    expect(
      screen.getByText(/no ai providers are enabled/i),
    ).toBeInTheDocument();
  });
});

describe("OrgAiSettingsForm — default model", () => {
  it("saves the chosen provider and model", async () => {
    setOrgDefaultModel.mockResolvedValueOnce({
      ok: true,
      data: { provider: "mistral", modelId: "mistral-small-latest" },
    });
    renderForm();
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(
      await screen.findByRole("option", { name: /mistral small/i }),
    );
    await waitFor(() =>
      expect(setOrgDefaultModel).toHaveBeenCalledWith({
        provider: "mistral",
        modelId: "mistral-small-latest",
      }),
    );
  }, 30_000);

  it("reverts and explains when the save is rejected", async () => {
    setOrgDefaultModel.mockResolvedValueOnce({
      ok: false,
      error: "That model isn't available.",
    });
    renderForm({
      ...base,
      defaultProvider: "anthropic",
      defaultModelId: "claude-sonnet-5",
    });
    await userEvent.click(
      screen.getByRole("combobox", { name: "Default model" }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: /mistral small/i }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "That model isn't available.",
      ),
    );
    // reverted to the last confirmed model
    expect(
      screen.getByRole("combobox", { name: "Default model" }),
    ).toHaveAccessibleDescription(/claude sonnet 5/i);
  }, 30_000);

  it("tells the admin when the default cannot apply in the current mode", () => {
    renderForm({
      ...base,
      mode: "org_byo",
      byoProvider: "anthropic",
      byoKeyLast4: "sk-ant-…WXYZ",
      defaultProvider: "mistral",
      defaultModelId: "mistral-small-latest",
    });
    expect(
      screen.getByText(/organization key is a Anthropic \(Claude\) key/i),
    ).toBeInTheDocument();
  });

  it("says nothing about reach when the default matches the org key", () => {
    renderForm({
      ...base,
      mode: "org_byo",
      byoProvider: "mistral",
      byoKeyLast4: "abcdefg…7890",
      defaultProvider: "mistral",
      defaultModelId: "mistral-small-latest",
    });
    expect(screen.queryByText(/applies only/i)).not.toBeInTheDocument();
  });

  // Setting a default overrides every per-feature tier request, so "undo that"
  // has to be reachable — otherwise the only way back is a support ticket.
  it("clears the default back to per-feature tiers", async () => {
    clearOrgDefaultModel.mockResolvedValueOnce({ ok: true, data: {} });
    renderForm({
      ...base,
      defaultProvider: "anthropic",
      defaultModelId: "claude-sonnet-5",
    });
    await userEvent.click(
      screen.getByRole("combobox", { name: "Default model" }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: /no default/i }),
    );
    await waitFor(() => expect(clearOrgDefaultModel).toHaveBeenCalled());
    expect(setOrgDefaultModel).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Default model" }),
      ).toHaveAccessibleDescription(/no default/i),
    );
  }, 30_000);

  it("restores the previous default when clearing is rejected", async () => {
    clearOrgDefaultModel.mockResolvedValueOnce({
      ok: false,
      error: "Couldn't clear the default model.",
    });
    renderForm({
      ...base,
      defaultProvider: "anthropic",
      defaultModelId: "claude-sonnet-5",
    });
    await userEvent.click(
      screen.getByRole("combobox", { name: "Default model" }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: /no default/i }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Couldn't clear the default model.",
      ),
    );
    expect(
      screen.getByRole("combobox", { name: "Default model" }),
    ).toHaveAccessibleDescription(/claude sonnet 5/i);
  }, 30_000);

  it("points at the keys section when no provider has models yet", () => {
    renderForm(base, []);
    expect(
      screen.getByText(/add an api key to see models/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  /**
   * The default writes `default_provider`, and gateway.ts uses that as the
   * routing fallback for EVERY `per_user` call. So this control does not only
   * pick a model — it decides which provider key each member has to have on
   * file, and a member without that one gets `PersonalAiKeyMissingError`
   * instead of a cheaper model. The behaviour is defensible; being silent
   * about it is not.
   */
  it("says that choosing a default also chooses the provider members need a key for", () => {
    renderForm();
    expect(screen.getByText(/also chooses its provider/i)).toBeInTheDocument();
    expect(screen.getByText(/needs a key for that provider/i)).toBeVisible();
  });

  // The picker's own trigger is independently named "Default model" (its
  // `label` prop — see ModelPicker.tsx), with the live selection as its
  // accessible DESCRIPTION, not its name. The enclosing `role="group"` +
  // `aria-labelledby` is a second, redundant path to the same name, for a
  // screen reader that navigates by landmark/group rather than landing
  // directly on the combobox — AgentEditor renders the identical picker the
  // same way.
  it("names the field through both the trigger's own label and the group", () => {
    renderForm();
    const group = screen.getByRole("group", { name: /default model/i });
    const trigger = within(group).getByRole("combobox", {
      name: "Default model",
    });
    expect(trigger).toBeInTheDocument();
  });

  /**
   * `disabled` on the trigger mid-save takes the focused element out of the tab
   * order and the browser drops focus to `<body>` — on THIS consumer of the
   * shared picker and not on AgentEditor's, which never disables it. The busy
   * state is announced instead, and the double-submit guard lives in
   * `chooseDefaultModel`.
   */
  it("stays focusable while the save is in flight, announcing busy instead", async () => {
    let release: (v: { ok: true; data: unknown }) => void = () => {};
    setOrgDefaultModel.mockImplementation(
      () =>
        new Promise<{ ok: true; data: unknown }>((resolve) => {
          release = resolve;
        }),
    );
    renderForm();
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(
      await screen.findByRole("option", { name: /mistral small/i }),
    );

    const trigger = screen.getByRole("combobox");
    expect(trigger).not.toBeDisabled();
    expect(document.body).not.toHaveFocus();
    expect(
      screen.getByRole("group", { name: /default model/i }),
    ).toHaveAttribute("aria-busy", "true");

    release({ ok: true, data: {} });
    await waitFor(() =>
      expect(
        screen.getByRole("group", { name: /default model/i }),
      ).toHaveAttribute("aria-busy", "false"),
    );
  }, 30_000);
});
