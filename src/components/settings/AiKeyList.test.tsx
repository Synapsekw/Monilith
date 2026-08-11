import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import type { ProviderRow } from "@/lib/ai/providers/provider-rows";

const saveAiKey = vi.fn();
const removeAiKey = vi.fn();
vi.mock("@/lib/ai/credentials-actions", () => ({
  saveAiKey: (...a: unknown[]) => saveAiKey(...a),
  removeAiKey: (...a: unknown[]) => removeAiKey(...a),
}));

import { AiKeyList } from "@/components/settings/AiKeyList";

/**
 * Two of the fixtures are deliberately providers the deleted PROVIDER_CATALOG
 * never knew about (mistral, moonshotai). Every label and placeholder assertion
 * below therefore fails loudly if the component ever reaches for a static map
 * again — that lookup is what would have 500'd the settings page (carry-forward
 * 9-b).
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

/** The row for a provider, found by the label the DB row supplied. */
function rowFor(label: string): HTMLElement {
  const row = screen
    .getAllByRole("listitem")
    .find((li) => li.textContent?.includes(label));
  if (!row) throw new Error(`no row for provider "${label}"`);
  return row;
}

beforeEach(() => {
  saveAiKey.mockReset();
  removeAiKey.mockReset();
});

describe("AiKeyList", () => {
  it("renders a row for every enabled provider", () => {
    render(<AiKeyList providers={PROVIDERS} initial={[]} />);
    expect(screen.getByText("Anthropic (Claude)")).toBeInTheDocument();
    expect(screen.getByText("Mistral")).toBeInTheDocument();
    expect(screen.getByText("Kimi (Moonshot AI)")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("shows the masked hint for a configured provider and an add affordance for the rest", () => {
    render(
      <AiKeyList
        providers={PROVIDERS}
        initial={[
          {
            provider: "anthropic",
            hint: "sk-ant-…1234",
            updatedAt: "2026-08-10T00:00:00Z",
          },
        ]}
      />,
    );
    expect(screen.getByText(/sk-ant-…1234/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /add key/i })).toHaveLength(2);
  });

  it("never renders a raw key back to the page", () => {
    const { container } = render(
      <AiKeyList
        providers={PROVIDERS}
        initial={[
          {
            provider: "anthropic",
            hint: "sk-ant-…1234",
            updatedAt: "2026-08-10T00:00:00Z",
          },
        ]}
      />,
    );
    expect(container.textContent).not.toMatch(/sk-ant-api03/);
  });

  // ---- carry-forward 9-a: more than one key is visible and removable ----

  it("shows every configured key, not just the first", () => {
    render(
      <AiKeyList
        providers={PROVIDERS}
        initial={[
          {
            provider: "anthropic",
            hint: "sk-ant-…1234",
            updatedAt: "2026-08-10T00:00:00Z",
          },
          {
            provider: "moonshotai",
            hint: "sk-…WXYZ",
            updatedAt: "2026-08-10T00:00:00Z",
          },
        ]}
      />,
    );
    expect(
      within(rowFor("Anthropic (Claude)")).getByText(/sk-ant-…1234/),
    ).toBeInTheDocument();
    expect(
      within(rowFor("Kimi (Moonshot AI)")).getByText(/sk-…WXYZ/),
    ).toBeInTheDocument();
    // Only the unconfigured provider offers "Add key".
    expect(screen.getAllByRole("button", { name: /add key/i })).toHaveLength(1);
  });

  it("removes the second key without touching the first", async () => {
    removeAiKey.mockResolvedValueOnce({ ok: true, data: {} });
    render(
      <AiKeyList
        providers={PROVIDERS}
        initial={[
          {
            provider: "anthropic",
            hint: "sk-ant-…1234",
            updatedAt: "2026-08-10T00:00:00Z",
          },
          {
            provider: "moonshotai",
            hint: "sk-…WXYZ",
            updatedAt: "2026-08-10T00:00:00Z",
          },
        ]}
      />,
    );

    fireEvent.click(
      within(rowFor("Kimi (Moonshot AI)")).getByRole("button", {
        name: /remove/i,
      }),
    );

    await waitFor(() =>
      expect(removeAiKey).toHaveBeenCalledWith({ provider: "moonshotai" }),
    );
    await waitFor(() =>
      expect(screen.queryByText(/sk-…WXYZ/)).not.toBeInTheDocument(),
    );
    expect(
      within(rowFor("Anthropic (Claude)")).getByText(/sk-ant-…1234/),
    ).toBeInTheDocument();
  });

  it("adds a second key without disturbing the first", async () => {
    saveAiKey.mockResolvedValueOnce({
      ok: true,
      data: { provider: "moonshotai", hint: "sk-…WXYZ" },
    });
    render(
      <AiKeyList
        providers={PROVIDERS}
        initial={[
          {
            provider: "anthropic",
            hint: "sk-ant-…1234",
            updatedAt: "2026-08-10T00:00:00Z",
          },
        ]}
      />,
    );

    const kimi = rowFor("Kimi (Moonshot AI)");
    fireEvent.click(within(kimi).getByRole("button", { name: /add key/i }));
    fireEvent.change(within(kimi).getByLabelText(/api key/i), {
      target: { value: "sk-moonshot-abcdWXYZ" },
    });
    fireEvent.click(within(kimi).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(saveAiKey).toHaveBeenCalledWith({
        provider: "moonshotai",
        key: "sk-moonshot-abcdWXYZ",
      }),
    );
    await waitFor(() =>
      expect(
        within(rowFor("Kimi (Moonshot AI)")).getByText(/sk-…WXYZ/),
      ).toBeInTheDocument(),
    );
    expect(
      within(rowFor("Anthropic (Claude)")).getByText(/sk-ant-…1234/),
    ).toBeInTheDocument();
  });

  // ---- carry-forward 9-b: metadata comes from the row, never a static map ----

  it("takes the key placeholder from the provider row, including providers no static map covers", () => {
    render(<AiKeyList providers={PROVIDERS} initial={[]} />);
    const mistral = rowFor("Mistral");
    fireEvent.click(within(mistral).getByRole("button", { name: /add key/i }));
    expect(within(mistral).getByLabelText(/api key/i)).toHaveAttribute(
      "placeholder",
      "your-mistral-key",
    );
  });

  it("renders a configured provider that no static catalog knows about", () => {
    render(
      <AiKeyList
        providers={PROVIDERS}
        initial={[
          {
            provider: "mistral",
            hint: "abcdefg…7890",
            updatedAt: "2026-08-10T00:00:00Z",
          },
        ]}
      />,
    );
    expect(
      within(rowFor("Mistral")).getByText(/abcdefg…7890/),
    ).toBeInTheDocument();
  });

  // ---- error reporting ----

  it("reports a rejected key on the row it belongs to", async () => {
    saveAiKey.mockResolvedValueOnce({
      ok: false,
      error: "That key was rejected by Mistral.",
    });
    render(<AiKeyList providers={PROVIDERS} initial={[]} />);

    const mistral = rowFor("Mistral");
    fireEvent.click(within(mistral).getByRole("button", { name: /add key/i }));
    fireEvent.change(within(mistral).getByLabelText(/api key/i), {
      target: { value: "definitely-not-a-real-key" },
    });
    fireEvent.click(within(mistral).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(within(rowFor("Mistral")).getByRole("alert")).toHaveTextContent(
        "That key was rejected by Mistral.",
      ),
    );
    expect(
      within(rowFor("Anthropic (Claude)")).queryByRole("alert"),
    ).not.toBeInTheDocument();
  });

  it("tells the user what to do when the registry has no enabled providers", () => {
    render(<AiKeyList providers={[]} initial={[]} />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText(/no ai providers/i)).toBeInTheDocument();
  });
});
