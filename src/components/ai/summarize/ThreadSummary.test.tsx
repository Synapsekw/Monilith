import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThreadSummary } from "./ThreadSummary";
import { summarizeThread } from "@/lib/ai/summarize/actions";

vi.mock("@/lib/ai/summarize/actions", () => ({
  summarizeThread: vi.fn(),
}));

const mockSummarize = vi.mocked(summarizeThread);

beforeEach(() => {
  vi.clearAllMocks();
  mockSummarize.mockResolvedValue({
    ok: true,
    data: { summary: "Ada shipped the export flow; QA is still pending." },
  });
});

describe("ThreadSummary", () => {
  it("disables the button when the thread is empty", () => {
    render(<ThreadSummary itemId="item-1" disabled />);
    expect(screen.getByRole("button", { name: /catch me up/i })).toBeDisabled();
  });

  it("disables the button when itemId is empty, even if not explicitly disabled", () => {
    render(<ThreadSummary itemId="" />);
    expect(screen.getByRole("button", { name: /catch me up/i })).toBeDisabled();
  });

  it("shows a thinking state then renders the summary card", async () => {
    let resolve!: (v: Awaited<ReturnType<typeof summarizeThread>>) => void;
    mockSummarize.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const user = userEvent.setup();
    render(<ThreadSummary itemId="item-1" />);

    await user.click(screen.getByRole("button", { name: /catch me up/i }));

    expect(await screen.findByText(/thinking/i)).toBeInTheDocument();
    expect(mockSummarize).toHaveBeenCalledWith({ itemId: "item-1" });

    resolve({
      ok: true,
      data: { summary: "Ada shipped the export flow; QA is still pending." },
    });

    expect(
      await screen.findByText(/ada shipped the export flow/i),
    ).toBeInTheDocument();
  });

  it("dismisses the summary card", async () => {
    const user = userEvent.setup();
    render(<ThreadSummary itemId="item-1" />);

    await user.click(screen.getByRole("button", { name: /catch me up/i }));
    expect(
      await screen.findByText(/ada shipped the export flow/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(
      screen.queryByText(/ada shipped the export flow/i),
    ).not.toBeInTheDocument();
  });

  it("renders a returned error in an alert without crashing", async () => {
    mockSummarize.mockResolvedValue({
      ok: false,
      error: "AI is turned off for your organization.",
    });
    const user = userEvent.setup();
    render(<ThreadSummary itemId="item-1" />);

    await user.click(screen.getByRole("button", { name: /catch me up/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("AI is turned off for your organization.");
  });
});
