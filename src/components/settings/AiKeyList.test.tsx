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

  /**
   * A key the user actually typed must never end up in the page's TEXT.
   *
   * The predecessor asserted `container.textContent` did not contain a string
   * that was never supplied to the render — it passed against literally any
   * component, including one that printed every key it was given, and
   * `textContent` excludes input VALUES anyway, so it could not have observed
   * the field even in principle. A green test with a security claim in its
   * title is worse than none.
   *
   * So: type a real key into the field and assert (a) it never reaches
   * `textContent` — no echo into a label, a hint, an error, or a preview —
   * and (b) the field it does live in is masked, which is the only reason a
   * shoulder-surfer cannot read it back.
   */
  it("never renders a typed key back to the page as text", () => {
    const RAW_KEY = "sk-ant-api03-secret-value-9f3a";
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

    const mistral = rowFor("Mistral");
    fireEvent.click(within(mistral).getByRole("button", { name: /add key/i }));
    const field = within(mistral).getByLabelText(/api key/i);
    fireEvent.change(field, { target: { value: RAW_KEY } });

    // The value IS in the field — otherwise the assertion below is vacuous
    // for the same reason the old one was.
    expect(field).toHaveValue(RAW_KEY);
    expect(container.textContent).not.toContain(RAW_KEY);
    // …and the field itself is masked, which `textContent` cannot tell us.
    expect(field).toHaveAttribute("type", "password");
  });

  it("does not echo a rejected key into the error it renders", async () => {
    // The other way a raw key leaks: a failure path that quotes what was sent.
    const RAW_KEY = "sk-ant-api03-secret-value-9f3a";
    saveAiKey.mockResolvedValueOnce({
      ok: false,
      error: "That key was rejected by Mistral.",
    });
    const { container } = render(
      <AiKeyList providers={PROVIDERS} initial={[]} />,
    );

    const mistral = rowFor("Mistral");
    fireEvent.click(within(mistral).getByRole("button", { name: /add key/i }));
    fireEvent.change(within(mistral).getByLabelText(/api key/i), {
      target: { value: RAW_KEY },
    });
    fireEvent.click(within(mistral).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(within(rowFor("Mistral")).getByRole("alert")).toBeInTheDocument(),
    );
    expect(container.textContent).not.toContain(RAW_KEY);
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

  // ---- consent: the daily catalog sweep borrows this key ----

  /**
   * The sweep in `verifyAllProviders` uses ONE stored key per provider for a
   * daily read-only GET /v1/models. The user is told that where they hand the
   * key over — not in a doc they will never open — so this assertion is on the
   * exact sentence, and it lives in the OPEN key field.
   */
  it("discloses the daily model-list use under the key field", () => {
    render(<AiKeyList providers={PROVIDERS} initial={[]} />);
    const mistral = rowFor("Mistral");
    // Not shown until the field is open — this is entry-time disclosure.
    expect(within(mistral).queryByText(/once a day/i)).not.toBeInTheDocument();

    fireEvent.click(within(mistral).getByRole("button", { name: /add key/i }));
    expect(
      within(mistral).getByText(
        "This key is also used once a day to keep this provider's model list up to date. It is never used to generate anything you did not ask for.",
      ),
    ).toBeInTheDocument();
    // Only the row being edited shows it — one field, one disclosure.
    expect(
      within(rowFor("Anthropic (Claude)")).queryByText(/once a day/i),
    ).not.toBeInTheDocument();
  });

  it("no longer claims the key is used ONLY for the user's own AI features", () => {
    // That sentence predates the sweep and is now false; the disclosure above
    // replaces the "only" with the truth.
    render(<AiKeyList providers={PROVIDERS} initial={[]} />);
    const mistral = rowFor("Mistral");
    fireEvent.click(within(mistral).getByRole("button", { name: /add key/i }));
    expect(mistral.textContent).not.toContain("used only to run AI features");
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

  /**
   * Sweep health, per row. The point of putting it HERE rather than on some
   * ops dashboard: the thing that fixes a failing provider — its key — is on
   * this exact row, and an unverified provider's models are silently missing
   * from every picker until someone knows to look.
   */
  describe("sweep-health badge", () => {
    const NOW = Date.parse("2026-08-26T12:00:00.000Z");
    const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

    it("puts each provider's verification state on its own row", () => {
      render(
        <AiKeyList
          providers={PROVIDERS}
          initial={[]}
          health={{
            nowMs: NOW,
            verification: {
              anthropic: {
                lastVerifiedAt: daysAgo(1),
                lastAttemptAt: daysAgo(1),
                status: "ok",
                error: null,
              },
              mistral: {
                lastVerifiedAt: daysAgo(7),
                lastAttemptAt: daysAgo(0),
                status: "failed",
                error: "mistral model list returned HTTP 401",
              },
            },
          }}
        />,
      );
      expect(
        within(rowFor("Anthropic (Claude)")).getByRole("status"),
      ).toHaveTextContent("Verified");
      const mistral = within(rowFor("Mistral")).getByRole("status");
      expect(mistral).toHaveTextContent("Check failed");
      expect(mistral).toHaveTextContent("last verified 7 days ago");
      // Each badge belongs to ITS row — a shared/global badge would be worse
      // than none, since the whole question is WHICH provider is broken.
      expect(
        within(rowFor("Kimi (Moonshot AI)")).queryByRole("status"),
      ).not.toBeInTheDocument();
    });

    it("renders no badge at all when the page passes no health data", () => {
      render(<AiKeyList providers={PROVIDERS} initial={[]} />);
      expect(screen.queryAllByRole("status")).toHaveLength(0);
    });
  });
});
