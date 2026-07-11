import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const setAiMode = vi.fn();
const setOrgByoKey = vi.fn();
const removeOrgByoKey = vi.fn();
vi.mock("@/lib/ai/settings-actions", () => ({
  setAiMode: (...a: unknown[]) => setAiMode(...a),
  setOrgByoKey: (...a: unknown[]) => setOrgByoKey(...a),
  removeOrgByoKey: (...a: unknown[]) => removeOrgByoKey(...a),
}));

import { OrgAiSettingsForm } from "@/components/settings/OrgAiSettingsForm";

type Initial = React.ComponentProps<typeof OrgAiSettingsForm>["initial"];

const base: Initial = {
  mode: "per_user",
  tier: "free",
  creditsLimit: 500,
  creditsUsed: 100,
  byoProvider: null,
  byoKeyLast4: null,
};

beforeEach(() => {
  setAiMode.mockReset();
  setOrgByoKey.mockReset();
  removeOrgByoKey.mockReset();
});

describe("OrgAiSettingsForm", () => {
  it("renders four mode options with the current one selected", () => {
    render(<OrgAiSettingsForm initial={base} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
    const selected = screen.getByRole("radio", {
      name: /members'? own keys/i,
    }) as HTMLInputElement;
    expect(selected.checked).toBe(true);
  });

  it("shows the credit meter when the mode is managed", () => {
    render(<OrgAiSettingsForm initial={{ ...base, mode: "managed" }} />);
    expect(
      screen.getByText(/100 \/ 500 credits this month/i),
    ).toBeInTheDocument();
  });

  it("calls setAiMode with the chosen mode when a different one is picked", async () => {
    setAiMode.mockResolvedValueOnce({ ok: true, data: { mode: "off" } });
    render(<OrgAiSettingsForm initial={base} />);
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
    render(<OrgAiSettingsForm initial={base} />);
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
    render(
      <OrgAiSettingsForm
        initial={{
          ...base,
          mode: "org_byo",
          byoProvider: "openai",
          byoKeyLast4: "WXYZ",
        }}
      />,
    );
    expect(screen.getByText(/OpenAI/)).toBeInTheDocument();
    expect(screen.getByText(/WXYZ/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    await waitFor(() => expect(removeOrgByoKey).toHaveBeenCalled());
  });

  it("disables save until a 10+ char key is typed, then saves it", async () => {
    setOrgByoKey.mockResolvedValueOnce({
      ok: true,
      data: { provider: "anthropic", hint: "sk-ant-…AB12" },
    });
    render(<OrgAiSettingsForm initial={base} />);
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
