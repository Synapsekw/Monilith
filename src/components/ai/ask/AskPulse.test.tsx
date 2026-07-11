import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AskPulse } from "./AskPulse";
import { askPulse } from "@/lib/ai/ask/actions";

vi.mock("@/lib/ai/ask/actions", () => ({
  askPulse: vi.fn(),
}));

const mockAsk = vi.mocked(askPulse);

beforeEach(() => {
  vi.clearAllMocks();
  mockAsk.mockResolvedValue({
    ok: true,
    data: {
      answer: "You have 3 overdue items.",
      boardsConsulted: ["b1", "b2"],
    },
  });
});

function renderPanel() {
  return render(<AskPulse open onOpenChange={() => {}} />);
}

describe("AskPulse", () => {
  it("disables Ask for a too-short question", async () => {
    const user = userEvent.setup();
    renderPanel();
    const ask = screen.getByRole("button", { name: /^ask$/i });
    expect(ask).toBeDisabled();

    await user.type(screen.getByRole("textbox"), "hi");
    expect(ask).toBeDisabled();

    await user.type(screen.getByRole("textbox"), " there");
    expect(ask).toBeEnabled();
  });

  it("submits the question and renders the answer with the boards-consulted count", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(
      screen.getByRole("textbox"),
      "What is overdue across my boards?",
    );
    await user.click(screen.getByRole("button", { name: /^ask$/i }));

    expect(
      await screen.findByText("You have 3 overdue items."),
    ).toBeInTheDocument();
    expect(screen.getByText(/consulted 2 boards/i)).toBeInTheDocument();
    expect(mockAsk).toHaveBeenCalledWith({
      question: "What is overdue across my boards?",
    });
  });

  it("shows a thinking state while the action is pending", async () => {
    let resolve!: (v: Awaited<ReturnType<typeof askPulse>>) => void;
    mockAsk.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByRole("textbox"), "How many tasks are open?");
    await user.click(screen.getByRole("button", { name: /^ask$/i }));

    expect(
      await screen.findByText(/looking across your boards/i),
    ).toBeInTheDocument();

    resolve({
      ok: true,
      data: { answer: "Twelve.", boardsConsulted: ["b1"] },
    });
    expect(await screen.findByText("Twelve.")).toBeInTheDocument();
    expect(screen.getByText(/consulted 1 board\b/i)).toBeInTheDocument();
  });

  it("submits on Cmd+Enter in the textarea", async () => {
    const user = userEvent.setup();
    renderPanel();

    const textbox = screen.getByRole("textbox");
    await user.type(textbox, "What is overdue across my boards?");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(mockAsk).toHaveBeenCalledWith({
      question: "What is overdue across my boards?",
    });
  });

  it("renders a returned error in an alert", async () => {
    mockAsk.mockResolvedValue({
      ok: false,
      error: "AI is turned off for your organization.",
    });
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByRole("textbox"), "Anything overdue?");
    await user.click(screen.getByRole("button", { name: /^ask$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("AI is turned off for your organization.");
  });

  it("replaces the previous answer when asked again", async () => {
    const user = userEvent.setup();
    renderPanel();

    const textbox = screen.getByRole("textbox");
    await user.type(textbox, "First question here?");
    await user.click(screen.getByRole("button", { name: /^ask$/i }));
    expect(
      await screen.findByText("You have 3 overdue items."),
    ).toBeInTheDocument();

    mockAsk.mockResolvedValue({
      ok: true,
      data: { answer: "A brand new answer.", boardsConsulted: ["b1"] },
    });
    await user.clear(textbox);
    await user.type(textbox, "Second question here?");
    await user.click(screen.getByRole("button", { name: /^ask$/i }));

    expect(await screen.findByText("A brand new answer.")).toBeInTheDocument();
    expect(
      screen.queryByText("You have 3 overdue items."),
    ).not.toBeInTheDocument();
  });
});
