import { useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardIntelligenceRun } from "@/lib/ai/board-intelligence/runs";
import { useBoardIntelligenceStore } from "@/stores/board-intelligence";

const runBoardIntelligence = vi.fn();
const dismissSuggestion = vi.fn();
vi.mock("@/lib/ai/board-intelligence/run", () => ({
  runBoardIntelligence: (i: unknown) => runBoardIntelligence(i),
  dismissSuggestion: (i: unknown) => dismissSuggestion(i),
}));

const applySuggestion = vi.fn();
const revertSuggestion = vi.fn();
vi.mock("@/lib/ai/board-intelligence/apply", () => ({
  applySuggestion: (i: unknown) => applySuggestion(i),
  revertSuggestion: (i: unknown) => revertSuggestion(i),
}));

const showUndoToast = vi.fn();
vi.mock("@/lib/ui/mutation-toast", () => ({
  showUndoToast: (m: string, f: () => void) => showUndoToast(m, f),
  showMutationError: vi.fn(),
}));

const applyBoardEffects = vi.fn();
vi.mock("@/lib/boards/use-ai-effects", () => ({
  useApplyBoardEffects: () => applyBoardEffects,
}));

import { IntelligenceTab } from "./IntelligenceTab";

const NOW = Date.parse("2026-09-11T12:00:00.000Z");

const makeRun = (
  over: Partial<BoardIntelligenceRun> = {},
): BoardIntelligenceRun => ({
  id: "r1",
  boardId: "b1",
  generatedAt: new Date(NOW - 60_000).toISOString(),
  inputHash: "h1",
  model: "gemini-2.5-flash",
  tokensIn: 900,
  tokensOut: 340,
  dismissed: [],
  applied: [],
  payload: {
    brief:
      "Delivery slipped on two items and Design has not moved since Friday.",
    signals: [],
    suggestions: [
      {
        id: "s1",
        kind: "overdue",
        title: "Three items are overdue",
        evidence: "3 items",
        body: "Push the dates or hand them to someone with room.",
        evidenceRows: [
          { itemId: "i1", name: "Ship the API", detail: "2 days late" },
          { itemId: "i2", name: "Write the docs", detail: "" },
        ],
        actions: [
          {
            type: "set_due",
            itemId: "i1",
            columnId: "c1",
            date: "2026-09-18",
            label: "Push to Friday",
          },
          {
            type: "reassign",
            itemIds: ["i2"],
            columnId: "c2",
            toUserId: "u2",
            label: "Give to Mia",
          },
        ],
      },
      {
        id: "s2",
        kind: "stalled",
        title: "Design is stalled",
        evidence: "5 days",
        body: "Nothing in Design changed since Friday.",
        evidenceRows: [],
        actions: [
          { type: "filter", signalKind: "stalled", label: "Show stalled" },
        ],
      },
    ],
  },
  ...over,
});

const seed = (run: BoardIntelligenceRun | null) =>
  useBoardIntelligenceStore.setState({ runs: run ? { b1: run } : {} });

const onRanOnMount = vi.fn();
const mount = (props: { canApply?: boolean; runOnMount?: boolean } = {}) =>
  render(
    <IntelligenceTab
      boardId="b1"
      canApply={props.canApply ?? true}
      runOnMount={props.runOnMount ?? false}
      onRanOnMount={onRanOnMount}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  useBoardIntelligenceStore.setState({
    runs: {},
    openRequest: null,
    filterRequest: null,
    busy: {},
  });
  runBoardIntelligence.mockResolvedValue({ ok: true, data: makeRun() });
});

describe("IntelligenceTab — nothing read yet", () => {
  it("offers the brief rather than describing itself", async () => {
    seed(null);
    mount();
    expect(
      screen.getByText(
        "Nothing yet — a brief of the last 7 days and what to do next.",
      ),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Catch me up" }));
    expect(runBoardIntelligence).toHaveBeenCalledWith({
      boardId: "b1",
      force: false,
    });
  });

  it("reads the board once when the tab is opened for it", async () => {
    seed(null);
    const { rerender } = mount({ runOnMount: true });
    await waitFor(() => expect(runBoardIntelligence).toHaveBeenCalledTimes(1));
    expect(onRanOnMount).toHaveBeenCalled();

    rerender(
      <IntelligenceTab
        boardId="b1"
        canApply
        runOnMount
        onRanOnMount={onRanOnMount}
      />,
    );
    expect(runBoardIntelligence).toHaveBeenCalledTimes(1);
  });

  it("does not re-read when the tab REMOUNTS while the first read is in flight", async () => {
    // Switching to Chat (or closing the dock) unmounts this panel, so the
    // mount-scoped `kicked` ref is gone by the time the reader comes back. The
    // flag is lowered at KICK time rather than when the read resolves, so the
    // parent has already recorded the ask — otherwise one ask costs two
    // metered model calls.
    seed(null);
    runBoardIntelligence.mockReturnValue(new Promise(() => {}));
    function Parent({ instance }: { instance: number }) {
      const [runOnMount, setRunOnMount] = useState(true);
      return (
        <IntelligenceTab
          key={instance}
          boardId="b1"
          canApply
          runOnMount={runOnMount}
          onRanOnMount={() => setRunOnMount(false)}
        />
      );
    }
    const { rerender } = render(<Parent instance={1} />);
    await waitFor(() => expect(runBoardIntelligence).toHaveBeenCalledTimes(1));

    // A new `key` is a real unmount + mount, not a re-render.
    rerender(<Parent instance={2} />);
    await act(async () => {});
    expect(runBoardIntelligence).toHaveBeenCalledTimes(1);
  });

  it("reads again when the board is asked a SECOND time", async () => {
    seed(null);
    const props = { boardId: "b1", canApply: true, onRanOnMount };
    const { rerender } = render(
      <IntelligenceTab {...props} runOnMount={true} />,
    );
    await waitFor(() => expect(runBoardIntelligence).toHaveBeenCalledTimes(1));

    // The parent lowers the flag once the read resolves...
    rerender(<IntelligenceTab {...props} runOnMount={false} />);
    expect(runBoardIntelligence).toHaveBeenCalledTimes(1);

    // ...and raising it again is a new request, not a repeat of the old one.
    rerender(<IntelligenceTab {...props} runOnMount={true} />);
    await waitFor(() => expect(runBoardIntelligence).toHaveBeenCalledTimes(2));
  });
});

describe("IntelligenceTab — while it is reading", () => {
  it("shows the shape of the answer, not a spinner", async () => {
    seed(null);
    runBoardIntelligence.mockReturnValue(new Promise(() => {}));
    const { container } = mount();
    await userEvent.click(screen.getByRole("button", { name: "Catch me up" }));

    const region = await screen.findByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region).toHaveAttribute("aria-label", "Reading the board");
    // Three brief lines and two suggestion cards.
    expect(region.querySelectorAll(".animate-pulse")).toHaveLength(5);
    expect(container.querySelector("svg.animate-spin")).toBeNull();
  });

  it("keeps the brief on screen while a refresh runs", async () => {
    seed(makeRun({ generatedAt: new Date(NOW - 31 * 60_000).toISOString() }));
    runBoardIntelligence.mockReturnValue(new Promise(() => {}));
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

    // The answer the reader came for stays put; the disabled control is what
    // says a new one is on its way.
    expect(
      screen.getByText(
        "Delivery slipped on two items and Design has not moved since Friday.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Three items are overdue")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled(),
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("IntelligenceTab — the brief", () => {
  it("labels the window, dates it, and says it in one paragraph", () => {
    seed(makeRun());
    const { container } = mount();
    expect(screen.getByText("Last 7 days")).toBeInTheDocument();
    expect(screen.getByText("1 minute ago")).toBeInTheDocument();
    const brief = screen.getByText(
      "Delivery slipped on two items and Design has not moved since Friday.",
    );
    expect(brief.tagName).toBe("P");
    expect(container.querySelectorAll("h1,h2,h3,h4,h5,h6")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  });

  it("dates a refreshed brief from now, not from when the tab opened", async () => {
    seed(makeRun({ generatedAt: new Date(NOW - 31 * 60_000).toISOString() }));
    mount();
    expect(screen.getByText("31 minutes ago")).toBeInTheDocument();

    const later = NOW + 40 * 60_000;
    vi.setSystemTime(later);
    runBoardIntelligence.mockResolvedValue({
      ok: true,
      data: makeRun({ generatedAt: new Date(later).toISOString() }),
    });
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("just now")).toBeInTheDocument();
  });

  it("offers a refresh once the brief is half an hour old", async () => {
    seed(makeRun({ generatedAt: new Date(NOW - 31 * 60_000).toISOString() }));
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(runBoardIntelligence).toHaveBeenCalledWith({
      boardId: "b1",
      force: true,
    });
  });
});

describe("IntelligenceTab — the suggestions", () => {
  it("counts them, and gives each one its evidence and its actions", async () => {
    seed(makeRun());
    mount();
    expect(screen.getByText("Suggested · 2")).toBeInTheDocument();

    const card = screen.getByRole("listitem", {
      name: /three items are overdue/i,
    });
    expect(
      within(card).getByText("Three items are overdue"),
    ).toBeInTheDocument();
    expect(within(card).getByText("3 items")).toBeInTheDocument();
    expect(
      within(card).getByText(
        "Push the dates or hand them to someone with room.",
      ),
    ).toBeInTheDocument();

    const primary = within(card).getByRole("button", {
      name: "Push to Friday",
    });
    expect(primary).toHaveAttribute("data-variant", "default");
    expect(
      within(card).getByRole("button", { name: "Give to Mia" }),
    ).toHaveAttribute("data-variant", "ghost");
    expect(within(card).getByRole("button", { name: "Dismiss" })).toBeTruthy();

    await userEvent.click(within(card).getByRole("button", { name: "why?" }));
    const rows = await screen.findAllByRole("listitem");
    const evidence = rows.map((r) => r.textContent);
    expect(evidence).toContain("Ship the API · 2 days late");
    expect(evidence).toContain("Write the docs");
  });

  it("applies through the server and dismisses through the store", async () => {
    seed(makeRun());
    applySuggestion.mockResolvedValue({
      ok: true,
      data: {
        before: [],
        updateIds: [],
        effects: [],
        run: makeRun({ applied: ["s1"] }),
      },
    });
    dismissSuggestion.mockResolvedValue({
      ok: true,
      data: makeRun({ dismissed: ["s2"] }),
    });
    mount();

    await userEvent.click(
      screen.getByRole("button", { name: "Push to Friday" }),
    );
    await waitFor(() =>
      expect(applySuggestion).toHaveBeenCalledWith({
        runId: "r1",
        suggestionId: "s1",
        actionIndex: 0,
      }),
    );
    expect(showUndoToast).toHaveBeenCalledWith("Applied", expect.any(Function));
    await waitFor(() =>
      expect(screen.queryByText("Three items are overdue")).toBeNull(),
    );

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(dismissSuggestion).toHaveBeenCalledWith({
      runId: "r1",
      suggestionId: "s2",
    });
  });

  it("goes inert while a write is in flight", async () => {
    seed(makeRun());
    applySuggestion.mockReturnValue(new Promise(() => {}));
    mount();

    const card = screen.getByRole("listitem", {
      name: /three items are overdue/i,
    });
    await userEvent.click(
      within(card).getByRole("button", { name: "Push to Friday" }),
    );

    await waitFor(() =>
      expect(
        within(card).getByRole("button", { name: "Push to Friday" }),
      ).toBeDisabled(),
    );
    expect(
      within(card).getByRole("button", { name: "Give to Mia" }),
    ).toBeDisabled();
    expect(
      within(card).getByRole("button", { name: "Dismiss" }),
    ).toBeDisabled();

    // A second click cannot start a second write.
    await userEvent.click(
      within(card).getByRole("button", { name: "Push to Friday" }),
    );
    expect(applySuggestion).toHaveBeenCalledTimes(1);

    // Every WRITE on the board waits, not just this card's: `applied` and
    // `dismissed` are one array each on the run, so two writes at once means
    // one of the two marks is read-modify-written away.
    const other = screen.getByRole("listitem", { name: /design is stalled/i });
    expect(
      within(other).getByRole("button", { name: "Dismiss" }),
    ).toBeDisabled();
    // A filter writes nothing, so it stays available.
    expect(screen.getByRole("button", { name: "Show stalled" })).toBeEnabled();
  });

  it("runs a filter action in the browser", async () => {
    seed(makeRun());
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Show stalled" }));
    expect(useBoardIntelligenceStore.getState().filterRequest).toMatchObject({
      boardId: "b1",
      selection: { kind: "stalled" },
    });
    expect(applySuggestion).not.toHaveBeenCalled();
  });

  it("says when a suggestion could not be applied", async () => {
    seed(makeRun());
    applySuggestion.mockResolvedValue({
      ok: false,
      error: "This suggestion no longer matches the board.",
    });
    mount();
    await userEvent.click(
      screen.getByRole("button", { name: "Push to Friday" }),
    );
    expect(
      await screen.findByText("This suggestion no longer matches the board."),
    ).toBeInTheDocument();
  });
});

describe("IntelligenceTab — a viewer", () => {
  it("can read and filter and dismiss, but never write", () => {
    seed(makeRun());
    mount({ canApply: false });

    expect(screen.getByText("Three items are overdue")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Push to Friday" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Give to Mia" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show stalled" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(2);
  });
});

describe("IntelligenceTab — where the brief came from", () => {
  it("names the model and what it cost, and promises not to write", () => {
    seed(makeRun());
    mount();
    expect(
      screen.getByText(/Read-only until you apply · .+ · \d+ tokens/),
    ).toHaveTextContent(
      "Read-only until you apply · gemini-2.5-flash · 1240 tokens",
    );
  });

  it("drops the 'until you apply' for someone who cannot", () => {
    seed(makeRun());
    mount({ canApply: false });
    expect(
      screen.getByText("Read-only · gemini-2.5-flash · 1240 tokens"),
    ).toBeInTheDocument();
  });

  it("never calls itself Pulse or AI", () => {
    seed(makeRun());
    mount();
    expect(screen.queryByText(/pulse/i)).toBeNull();
  });
});
