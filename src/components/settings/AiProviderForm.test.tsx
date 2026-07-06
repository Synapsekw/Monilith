import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const saveAiKey = vi.fn();
const removeAiKey = vi.fn();
vi.mock("@/lib/ai/credentials-actions", () => ({
  saveAiKey: (...a: unknown[]) => saveAiKey(...a),
  removeAiKey: (...a: unknown[]) => removeAiKey(...a),
}));

import { AiProviderForm } from "@/components/settings/AiProviderForm";

beforeEach(() => {
  saveAiKey.mockReset();
  removeAiKey.mockReset();
});

describe("AiProviderForm", () => {
  it("shows a 'not configured' state and can save a key", async () => {
    saveAiKey.mockResolvedValueOnce({
      ok: true,
      data: { provider: "anthropic", hint: "sk-ant-…AB12" },
    });
    render(<AiProviderForm initial={null} />);
    expect(screen.getByText(/not configured/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: "sk-ant-abcdefAB12" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(saveAiKey).toHaveBeenCalledWith({
        provider: "anthropic",
        key: "sk-ant-abcdefAB12",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(/sk-ant-…AB12/)).toBeInTheDocument(),
    );
  });

  it("surfaces a rejected-key error inline", async () => {
    saveAiKey.mockResolvedValueOnce({
      ok: false,
      error: "That key was rejected by Anthropic (Claude).",
    });
    render(<AiProviderForm initial={null} />);
    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: "sk-ant-bad" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(screen.getByText(/rejected by anthropic/i)).toBeInTheDocument(),
    );
  });

  it("renders the configured state from initial props", () => {
    render(
      <AiProviderForm
        initial={{
          provider: "openai",
          hint: "sk-…WXYZ",
          updatedAt: "2026-07-06T00:00:00Z",
        }}
      />,
    );
    expect(screen.getByText(/OpenAI/)).toBeInTheDocument();
    expect(screen.getByText(/sk-…WXYZ/)).toBeInTheDocument();
  });
});
