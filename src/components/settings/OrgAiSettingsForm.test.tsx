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
vi.mock("@/lib/ai/settings-actions", () => ({
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
      screen.getByRole("combobox", { name: /claude sonnet 5/i }),
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
      screen.getByRole("combobox", { name: /claude sonnet 5/i }),
    ).toBeInTheDocument();
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
      screen.getByRole("combobox", { name: /claude sonnet 5/i }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: /no default/i }),
    );
    await waitFor(() => expect(clearOrgDefaultModel).toHaveBeenCalled());
    expect(setOrgDefaultModel).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: /no default/i }),
      ).toBeInTheDocument(),
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
      screen.getByRole("combobox", { name: /claude sonnet 5/i }),
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
      screen.getByRole("combobox", { name: /claude sonnet 5/i }),
    ).toBeInTheDocument();
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

  // The picker's trigger is a combobox whose accessible name is its VALUE, so
  // a `<label htmlFor>` would REPLACE that value in the announcement. The group
  // label is the only thing that names the field — and AgentEditor already
  // renders the identical picker this way.
  it("names the field through a labelled group, not the trigger", () => {
    renderForm();
    const group = screen.getByRole("group", { name: /default model/i });
    expect(within(group).getByRole("combobox")).toBeInTheDocument();
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
