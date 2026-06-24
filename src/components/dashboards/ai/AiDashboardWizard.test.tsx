import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiDashboardWizard } from "./AiDashboardWizard";
import {
  listAiBoards,
  getBoardSnapshotSummary,
  generateDashboardProposal,
  createDashboardFromProposal,
} from "@/lib/ai/actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/ai/actions", () => ({
  listAiBoards: vi.fn(),
  getBoardSnapshotSummary: vi.fn(),
  generateDashboardProposal: vi.fn(),
  createDashboardFromProposal: vi.fn(),
}));

const mockListAiBoards = vi.mocked(listAiBoards);
const mockGetSummary = vi.mocked(getBoardSnapshotSummary);
const mockGenerate = vi.mocked(generateDashboardProposal);
const mockCreate = vi.mocked(createDashboardFromProposal);

beforeEach(() => {
  vi.clearAllMocks();
  mockListAiBoards.mockResolvedValue({
    ok: true,
    data: {
      boards: [
        { id: "b1", name: "Sales Pipeline", workspaceId: "ws1" },
        { id: "b2", name: "Bug Tracker", workspaceId: "ws1" },
      ],
    },
  });
  mockGetSummary.mockResolvedValue({
    ok: true,
    data: {
      boardName: "Sales Pipeline",
      rowCount: 42,
      columns: [
        { name: "Status", kind: "status" },
        { name: "Owner", kind: "people" },
      ],
      estimatedTokens: 1200,
    },
  });
  mockGenerate.mockResolvedValue({
    ok: true,
    data: { proposal: { name: "Sales overview", widgets: [], warnings: [] } },
  });
  mockCreate.mockResolvedValue({ ok: true, data: { dashboardId: "d1" } });
});

function renderWizard() {
  return render(
    <AiDashboardWizard workspaceId="ws1" open onOpenChange={() => {}} />,
  );
}

describe("AiDashboardWizard", () => {
  it("renders the board list from listAiBoards", async () => {
    renderWizard();
    expect(await screen.findByText("Sales Pipeline")).toBeInTheDocument();
    expect(screen.getByText("Bug Tracker")).toBeInTheDocument();
    expect(mockListAiBoards).toHaveBeenCalled();
  });

  it("gates Generate behind board selection and the approval step", async () => {
    const user = userEvent.setup();
    renderWizard();

    // No Generate button on the pick step.
    await screen.findByText("Sales Pipeline");
    expect(
      screen.queryByRole("button", { name: /generate/i }),
    ).not.toBeInTheDocument();

    // Next is disabled until a board is chosen.
    const next = screen.getByRole("button", { name: /next/i });
    expect(next).toBeDisabled();

    await user.click(screen.getByText("Sales Pipeline"));
    expect(next).toBeEnabled();

    await user.click(next);

    // Approval step shows the reassurance line and the Generate button.
    expect(
      await screen.findByText(
        "Only column names, types, option labels, and summary counts are sent — no cell contents leave your workspace.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /generate/i }),
    ).toBeInTheDocument();
  });

  it("shows the error in an alert when generation fails", async () => {
    mockGenerate.mockResolvedValue({
      ok: false,
      error: "AI generation isn't configured.",
    });
    const user = userEvent.setup();
    renderWizard();

    await user.click(await screen.findByText("Sales Pipeline"));
    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(await screen.findByRole("button", { name: /generate/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("AI generation isn't configured.");
  });
});
