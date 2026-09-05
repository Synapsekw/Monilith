import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AutopilotCard } from "./AutopilotCard";
import type { BoardAutopilotState } from "@/lib/boards/autopilot-actions";

const getBoardAutopilot = vi.fn();
const saveBoardAutopilot = vi.fn();
vi.mock("@/lib/boards/autopilot-actions", () => ({
  getBoardAutopilot: (...a: unknown[]) => getBoardAutopilot(...a),
  saveBoardAutopilot: (...a: unknown[]) => saveBoardAutopilot(...a),
}));
vi.mock("@/lib/ui/mutation-toast", () => ({ showMutationError: vi.fn() }));

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const state = (
  over: Partial<BoardAutopilotState> = {},
): BoardAutopilotState => ({
  settings: {
    enabled: false,
    cadence: "daily",
    runAtLocalHour: 8,
    tasks: [],
  },
  isAdmin: true,
  configured: false,
  assistantName: "Monolith Autopilot",
  ...over,
});

beforeEach(() => {
  getBoardAutopilot.mockReset();
  saveBoardAutopilot.mockReset();
  saveBoardAutopilot.mockResolvedValue({ ok: true, data: undefined });
});

describe("AutopilotCard", () => {
  it("saves a task selection through the server action", async () => {
    getBoardAutopilot.mockResolvedValue(state());
    wrap(<AutopilotCard boardId="b1" />);

    const triage = await screen.findByRole("checkbox", {
      name: /triage new items/i,
    });
    expect(triage).toHaveAttribute("aria-checked", "false");
    await userEvent.click(triage);
    expect(triage).toHaveAttribute("aria-checked", "true");

    await userEvent.click(
      screen.getByRole("button", { name: /save changes/i }),
    );
    await waitFor(() =>
      expect(saveBoardAutopilot).toHaveBeenCalledWith({
        boardId: "b1",
        settings: {
          enabled: false,
          cadence: "daily",
          runAtLocalHour: 8,
          tasks: ["triage"],
        },
      }),
    );
  });

  it("persists the kill switch immediately on toggle", async () => {
    getBoardAutopilot.mockResolvedValue(state());
    wrap(<AutopilotCard boardId="b1" />);

    const kill = await screen.findByRole("switch", {
      name: /enable autopilot/i,
    });
    await userEvent.click(kill);
    await waitFor(() =>
      expect(saveBoardAutopilot).toHaveBeenCalledWith({
        boardId: "b1",
        settings: expect.objectContaining({ enabled: true }),
      }),
    );
  });

  it("names the posting identity with the product default when the org has not renamed it", async () => {
    getBoardAutopilot.mockResolvedValue(state());
    wrap(<AutopilotCard boardId="b1" />);

    // The column's default, and the name the bot's updates are stamped with.
    expect(await screen.findByText("Monolith Autopilot")).toBeInTheDocument();
    expect(screen.queryByText(/Pulse Autopilot/)).not.toBeInTheDocument();
  });

  // The name is per-ORG now, so this card must render what the admin chose in
  // Settings → AI rather than the product string it used to hardcode.
  it("names the posting identity with the org's own assistant name", async () => {
    getBoardAutopilot.mockResolvedValue(state({ assistantName: "Ada" }));
    wrap(<AutopilotCard boardId="b1" />);

    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(screen.queryByText("Monolith Autopilot")).not.toBeInTheDocument();
  });

  it("locks the controls and hides Save for a non-admin", async () => {
    getBoardAutopilot.mockResolvedValue(
      state({
        isAdmin: false,
        settings: {
          enabled: true,
          cadence: "daily",
          runAtLocalHour: 8,
          tasks: ["triage"],
        },
      }),
    );
    wrap(<AutopilotCard boardId="b1" />);

    expect(
      await screen.findByText(/only an organization admin can configure/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save changes/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: /disable autopilot/i }),
    ).toBeDisabled();
  });
});
