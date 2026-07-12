import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiBoardWizard } from "./AiBoardWizard";
import {
  generateBoardProposal,
  createBoardFromProposal,
} from "@/lib/ai/board-actions";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/ai/board-actions", () => ({
  generateBoardProposal: vi.fn(),
  createBoardFromProposal: vi.fn(),
}));

const mockGenerate = vi.mocked(generateBoardProposal);
const mockCreate = vi.mocked(createBoardFromProposal);

const PROPOSAL = {
  name: "CRM",
  templatePayload: { groups: [], columns: [], items: [] },
  summary: {
    groups: 2,
    columns: [
      { name: "Status", kind: "status" },
      { name: "Owner", kind: "people" },
    ],
    items: 6,
  },
  warnings: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerate.mockResolvedValue({ ok: true, data: { proposal: PROPOSAL } });
  mockCreate.mockResolvedValue({ ok: true, data: { boardId: "b1" } });
});

function renderWizard() {
  return render(
    <AiBoardWizard workspaceId="ws1" open onOpenChange={() => {}} />,
  );
}

describe("AiBoardWizard", () => {
  it("renders a bounded textarea on the describe step", () => {
    renderWizard();
    const textarea = screen.getByRole("textbox");
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveAttribute("maxlength", "2000");
  });

  it("does not expose Create until the review step (generate must succeed first)", async () => {
    const user = userEvent.setup();
    renderWizard();

    // No Create button before a successful generate.
    expect(
      screen.queryByRole("button", { name: /create board/i }),
    ).not.toBeInTheDocument();

    await user.type(screen.getByRole("textbox"), "Build me a CRM board");
    await user.click(screen.getByRole("button", { name: /generate/i }));

    // Review step: summary + Create board.
    expect(
      await screen.findByRole("button", { name: /create board/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("CRM")).toBeInTheDocument();
    expect(screen.getByText(/Status/)).toBeInTheDocument();
  });

  it("shows a generate error in an alert", async () => {
    mockGenerate.mockResolvedValue({
      ok: false,
      error: "AI is turned off for your organization.",
    });
    const user = userEvent.setup();
    renderWizard();

    await user.type(screen.getByRole("textbox"), "Build me a CRM board");
    await user.click(screen.getByRole("button", { name: /generate/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("AI is turned off for your organization.");
  });

  it("Create calls createBoardFromProposal with the returned proposal and routes to review", async () => {
    const user = userEvent.setup();
    renderWizard();

    await user.type(screen.getByRole("textbox"), "Build me a CRM board");
    await user.click(screen.getByRole("button", { name: /generate/i }));
    await user.click(
      await screen.findByRole("button", { name: /create board/i }),
    );

    expect(mockCreate).toHaveBeenCalledWith({
      workspaceId: "ws1",
      proposal: {
        name: PROPOSAL.name,
        templatePayload: PROPOSAL.templatePayload,
      },
    });
    expect(push).toHaveBeenCalledWith("/boards/b1?review=1");
  });
});
