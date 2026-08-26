import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ModelPicker,
  type ModelOption,
} from "@/components/settings/ModelPicker";

/**
 * Two of the three fixtures are providers the deleted PROVIDER_CATALOG never
 * knew about (mistral, moonshotai), and every label assertion below reads the
 * label the DB row supplied. A picker that reached for a static three-entry map
 * would fail here rather than in production.
 *
 * The list renders into a portal only while the popover is OPEN, so grouping and
 * option assertions open the trigger first. The empty and retired states render
 * unconditionally and are asserted directly.
 */
const OPTIONS: ModelOption[] = [
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
    provider: "moonshotai",
    providerLabel: "Kimi (Moonshot AI)",
    modelId: "kimi-k2",
    label: "Kimi K2 Instruct",
    tier: "cheap",
    supportsTools: true,
    contextLength: 128_000,
  },
  {
    provider: "mistral",
    providerLabel: "Mistral",
    modelId: "mistral-small-latest",
    label: "Mistral Small",
    tier: "cheap",
    supportsTools: false,
    contextLength: 32_000,
  },
];

describe("ModelPicker", () => {
  it("renders an empty state rather than an empty select when no keys exist", () => {
    render(<ModelPicker options={[]} value={null} onChange={vi.fn()} />);
    expect(
      screen.getByText(/add an api key to see models/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("keeps a stored value clearable even when the catalog is empty", async () => {
    // The empty state replaces the control, so a stored default would become
    // unremovable if it fired here too.
    const onChange = vi.fn();
    render(
      <ModelPicker
        options={[]}
        value={{ provider: "anthropic", modelId: "claude-sonnet-5" }}
        onChange={onChange}
        allowInherit
        inheritLabel="No default"
      />,
    );
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(
      await screen.findByRole("option", { name: /no default/i }),
    );
    expect(onChange).toHaveBeenCalledWith(null);
  }, 30_000);

  it("flags a value that is no longer in the options as retired", () => {
    render(
      <ModelPicker
        options={OPTIONS}
        value={{ provider: "anthropic", modelId: "claude-retired-9" }}
        onChange={vi.fn()}
      />,
    );
    // The stale value stays visible — a silent reset would hide why an agent's
    // output changed.
    expect(screen.getByText(/claude-retired-9/)).toBeInTheDocument();
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
  });

  it("does NOT flag a value that is present in the options", () => {
    render(
      <ModelPicker
        options={OPTIONS}
        value={{ provider: "moonshotai", modelId: "kimi-k2" }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText(/no longer available/i)).not.toBeInTheDocument();
    // The trigger's accessible NAME is the static field label; the catalog
    // label taken from the matched option is the accessible DESCRIPTION.
    expect(
      screen.getByRole("combobox", { name: "Model" }),
    ).toHaveAccessibleDescription(/kimi k2 instruct/i);
  });

  it("groups options by provider once opened", async () => {
    render(<ModelPicker options={OPTIONS} value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("combobox"));
    expect(await screen.findByText("Anthropic (Claude)")).toBeInTheDocument();
    expect(screen.getByText("Kimi (Moonshot AI)")).toBeInTheDocument();
    expect(screen.getByText("Mistral")).toBeInTheDocument();
  }, 30_000);

  it("reports the chosen provider AND model id", async () => {
    const onChange = vi.fn();
    render(<ModelPicker options={OPTIONS} value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(
      await screen.findByRole("option", { name: /kimi k2 instruct/i }),
    );
    expect(onChange).toHaveBeenCalledWith({
      provider: "moonshotai",
      modelId: "kimi-k2",
    });
  }, 30_000);

  it("offers an inherit option when allowInherit is set, and reports null for it", async () => {
    const onChange = vi.fn();
    render(
      <ModelPicker
        options={OPTIONS}
        value={{ provider: "moonshotai", modelId: "kimi-k2" }}
        onChange={onChange}
        allowInherit
        inheritLabel="Use org default"
      />,
    );
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(
      await screen.findByRole("option", { name: /use org default/i }),
    );
    expect(onChange).toHaveBeenCalledWith(null);
  }, 30_000);

  it("has no inherit option unless allowInherit is set", async () => {
    render(<ModelPicker options={OPTIONS} value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("combobox"));
    await screen.findByRole("option", { name: /claude sonnet 5/i });
    expect(
      screen.queryByRole("option", { name: /org default/i }),
    ).not.toBeInTheDocument();
  }, 30_000);

  it("lists a provider that has no models yet, and says what unlocks them", async () => {
    render(
      <ModelPicker
        options={OPTIONS}
        value={null}
        onChange={vi.fn()}
        emptyProviders={[
          { provider: "google", providerLabel: "Google Gemini" },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("combobox"));
    expect(await screen.findByText("Google Gemini")).toBeInTheDocument();
    const row = screen.getByRole("option", {
      name: /add an api key to see models/i,
    });
    expect(row).toHaveAttribute("aria-disabled", "true");
  }, 30_000);

  it("names the combobox from a caller-supplied label, not the selection", () => {
    render(
      <ModelPicker
        options={OPTIONS}
        value={{ provider: "anthropic", modelId: "claude-sonnet-5" }}
        onChange={vi.fn()}
        label="Default model"
      />,
    );
    expect(
      screen.getByRole("combobox", { name: "Default model" }),
    ).toHaveAccessibleDescription(/claude sonnet 5/i);
    expect(
      screen.queryByRole("combobox", { name: /claude sonnet 5/i }),
    ).not.toBeInTheDocument();
  });

  it("defaults the accessible name to 'Model' when no label is given", () => {
    render(<ModelPicker options={OPTIONS} value={null} onChange={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Model" })).toBeInTheDocument();
  });

  // Radix Popover's default `onCloseAutoFocus` returns focus to the trigger
  // when the popover closes — nothing here overrides it — so picking a model
  // (which calls `setOpen(false)`) must land focus back on the trigger, not
  // `<body>`.
  it("returns focus to the trigger after picking a model closes the popover", async () => {
    const user = userEvent.setup();
    render(<ModelPicker options={OPTIONS} value={null} onChange={vi.fn()} />);
    const trigger = screen.getByRole("combobox", { name: "Model" });
    await user.click(trigger);
    await user.click(
      await screen.findByRole("option", { name: /kimi k2 instruct/i }),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.body).not.toHaveFocus();
  }, 30_000);

  it("says which models cannot run tools", async () => {
    render(<ModelPicker options={OPTIONS} value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("combobox"));
    expect(
      await screen.findByRole("option", { name: /mistral small.*no tools/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /claude sonnet 5.*no tools/i }),
    ).not.toBeInTheDocument();
  }, 30_000);
});
