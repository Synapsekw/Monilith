import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBoardIntelligenceStore } from "@/stores/board-intelligence";

const ask = vi.fn();
const useIntelligenceAsk = vi.fn();
vi.mock("./use-intelligence-ask", () => ({
  useIntelligenceAsk: (runId: string | null) => useIntelligenceAsk(runId),
}));

import { AskComposer } from "./AskComposer";

beforeEach(() => {
  vi.clearAllMocks();
  useBoardIntelligenceStore.setState({ busy: {} });
  useIntelligenceAsk.mockReturnValue({
    pairs: [],
    streaming: false,
    status: null,
    error: null,
    ask,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AskComposer", () => {
  it("is disabled with no run and says why", () => {
    render(<AskComposer runId={null} boardId="board-1" />);
    expect(
      screen.getByRole("textbox", { name: /ask about this board/i }),
    ).toBeDisabled();
    expect(screen.getByText(/catch me up/i)).toBeInTheDocument();
  });

  it("is enabled with a run and asks on submit", async () => {
    const user = userEvent.setup();
    render(<AskComposer runId="r1" boardId="board-1" />);
    const box = screen.getByRole("textbox", { name: /ask about this board/i });
    expect(box).toBeEnabled();
    await user.type(box, "what slipped?");
    await user.keyboard("{Enter}");
    expect(ask).toHaveBeenCalledWith("what slipped?");
  });

  it("is disabled while a board write is busy for this board", () => {
    useBoardIntelligenceStore.setState({ busy: { "board-1": true } });
    render(<AskComposer runId="r1" boardId="board-1" />);
    expect(
      screen.getByRole("textbox", { name: /ask about this board/i }),
    ).toBeDisabled();
  });

  it("stays enabled when a different board is busy", () => {
    useBoardIntelligenceStore.setState({ busy: { "other-board": true } });
    render(<AskComposer runId="r1" boardId="board-1" />);
    expect(
      screen.getByRole("textbox", { name: /ask about this board/i }),
    ).toBeEnabled();
  });

  it("renders question/answer pairs from the hook", () => {
    useIntelligenceAsk.mockReturnValue({
      pairs: [{ id: "1", question: "what slipped?", answer: "Two items." }],
      streaming: false,
      status: null,
      error: null,
      ask,
    });
    render(<AskComposer runId="r1" boardId="board-1" />);
    expect(screen.getByText("what slipped?")).toBeInTheDocument();
    expect(screen.getByText("Two items.")).toBeInTheDocument();
  });

  it("says nothing came back rather than sitting at Thinking… once the turn settled", () => {
    // The turn ended (`streaming` false) with an empty answer — the zero-token
    // `done` from `use-intelligence-ask`. The bubble must not keep claiming a
    // request is in flight.
    useIntelligenceAsk.mockReturnValue({
      pairs: [{ id: "1", question: "what slipped?", answer: "" }],
      streaming: false,
      status: null,
      error: "The answer didn't finish. Try again.",
      ask,
    });
    render(<AskComposer runId="r1" boardId="board-1" />);
    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
    expect(screen.getByText("No answer came back.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The answer didn't finish. Try again.",
    );
  });

  it("shows the status line while the answer is still streaming", () => {
    useIntelligenceAsk.mockReturnValue({
      pairs: [{ id: "1", question: "what slipped?", answer: "" }],
      streaming: true,
      status: "Reading this board…",
      error: null,
      ask,
    });
    render(<AskComposer runId="r1" boardId="board-1" />);
    expect(screen.getByText("Reading this board…")).toBeInTheDocument();
  });

  it("attributes the in-flight status to the newest pair only", () => {
    // An earlier turn that came back empty must not be re-labelled
    // "Thinking…" just because a LATER question is now streaming — only the
    // newest pair can be in flight.
    useIntelligenceAsk.mockReturnValue({
      pairs: [
        { id: "1", question: "first", answer: "" },
        { id: "2", question: "second", answer: "" },
      ],
      streaming: true,
      status: "Reading this board…",
      error: null,
      ask,
    });
    render(<AskComposer runId="r1" boardId="board-1" />);
    expect(screen.getByText("No answer came back.")).toBeInTheDocument();
    expect(screen.getByText("Reading this board…")).toBeInTheDocument();
  });

  it("surfaces the error from the hook", () => {
    useIntelligenceAsk.mockReturnValue({
      pairs: [],
      streaming: false,
      status: null,
      error: "nope",
      ask,
    });
    render(<AskComposer runId="r1" boardId="board-1" />);
    expect(screen.getByRole("alert")).toHaveTextContent("nope");
  });

  it("shows the Open in Chat action only when onOpenInChat is provided", () => {
    useIntelligenceAsk.mockReturnValue({
      pairs: [{ id: "1", question: "q", answer: "a" }],
      streaming: false,
      status: null,
      error: null,
      ask,
    });
    const { rerender } = render(<AskComposer runId="r1" boardId="board-1" />);
    expect(
      screen.queryByRole("button", { name: /open in chat/i }),
    ).not.toBeInTheDocument();

    const onOpenInChat = vi.fn();
    rerender(
      <AskComposer runId="r1" boardId="board-1" onOpenInChat={onOpenInChat} />,
    );
    expect(
      screen.getByRole("button", { name: /open in chat/i }),
    ).toBeInTheDocument();
  });
});
