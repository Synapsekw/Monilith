import { act, renderHook, waitFor } from "@testing-library/react";
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
const showMutationError = vi.fn();
vi.mock("@/lib/ui/mutation-toast", () => ({
  showUndoToast: (m: string, f: () => void) => showUndoToast(m, f),
  showMutationError: (a: string, e: Error) => showMutationError(a, e),
}));

/** One stable spy: the hook memoizes on this identity, so a fresh function per
 *  render would silently rebuild every callback that depends on it. */
const applyBoardEffects = vi.fn();
vi.mock("@/lib/boards/use-ai-effects", () => ({
  useApplyBoardEffects: () => applyBoardEffects,
}));

import { useIntelligenceRun } from "./use-intelligence-run";

const NOW = Date.parse("2026-09-11T12:00:00.000Z");

const makeRun = (
  over: Partial<BoardIntelligenceRun> = {},
): BoardIntelligenceRun => ({
  id: "r1",
  boardId: "b1",
  generatedAt: new Date(NOW - 60_000).toISOString(),
  inputHash: "h1",
  model: "test-model",
  tokensIn: 100,
  tokensOut: 50,
  dismissed: [],
  applied: [],
  payload: {
    brief: "Two things slipped this week.",
    signals: [],
    suggestions: [
      {
        id: "s1",
        kind: "overdue",
        title: "Three items are overdue",
        evidence: "3 items",
        body: "Move them or push the dates.",
        evidenceRows: [
          { itemId: "i1", name: "Ship the API", detail: "2d late" },
        ],
        actions: [
          {
            type: "set_due",
            itemId: "i1",
            columnId: "c1",
            date: "2026-09-18",
            label: "Push to Friday",
          },
        ],
      },
      {
        id: "s2",
        kind: "stalled",
        title: "Design is stalled",
        evidence: "5 days",
        body: "Nothing moved in Design since Friday.",
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

const mount = (canApply = true) =>
  renderHook(() => useIntelligenceRun("b1", { canApply }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  useBoardIntelligenceStore.setState({
    runs: {},
    openRequest: null,
    filterRequest: null,
  });
});

describe("useIntelligenceRun", () => {
  it("shows only the suggestions that are still open", () => {
    seed(makeRun({ dismissed: ["s2"] }));
    expect(mount().result.current.visible.map((s) => s.id)).toEqual(["s1"]);

    seed(makeRun({ applied: ["s1"] }));
    expect(mount().result.current.visible.map((s) => s.id)).toEqual(["s2"]);

    seed(makeRun({ dismissed: ["s1"], applied: ["s2"] }));
    expect(mount().result.current.visible).toEqual([]);
  });

  it("calls a run older than 30 minutes stale", () => {
    seed(makeRun());
    expect(mount().result.current.staleByAge).toBe(false);

    seed(makeRun({ generatedAt: new Date(NOW - 31 * 60_000).toISOString() }));
    expect(mount().result.current.staleByAge).toBe(true);
  });

  it("reports no staleness with no run at all", () => {
    seed(null);
    const { result } = mount();
    expect(result.current.run).toBeNull();
    expect(result.current.staleByAge).toBe(false);
    expect(result.current.visible).toEqual([]);
  });

  it("runs the board, flags itself busy, and stores the result", async () => {
    seed(null);
    let resolve!: (v: unknown) => void;
    runBoardIntelligence.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { result } = mount();

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.catchMeUp();
    });
    expect(runBoardIntelligence).toHaveBeenCalledWith({
      boardId: "b1",
      force: false,
    });
    await waitFor(() => expect(result.current.running).toBe(true));

    const fresh = makeRun({ id: "r2" });
    await act(async () => {
      resolve({ ok: true, data: fresh });
      await pending;
    });
    expect(result.current.running).toBe(false);
    expect(useBoardIntelligenceStore.getState().runs.b1).toEqual(fresh);
    expect(result.current.run).toEqual(fresh);
  });

  it("re-reads its clock whenever the brief is regenerated", async () => {
    seed(makeRun());
    const { result } = mount();
    expect(result.current.nowMs).toBe(NOW);

    // Forty minutes pass with the tab still open, then the user refreshes.
    // Measuring the brand-new brief against the OLD clock reports it as
    // arriving in the future.
    const later = NOW + 40 * 60_000;
    vi.setSystemTime(later);
    runBoardIntelligence.mockResolvedValue({
      ok: true,
      data: makeRun({ generatedAt: new Date(later).toISOString() }),
    });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.nowMs).toBe(later);
    expect(result.current.staleByAge).toBe(false);
  });

  it("forces a fresh run from refresh", async () => {
    seed(makeRun());
    runBoardIntelligence.mockResolvedValue({ ok: true, data: makeRun() });
    const { result } = mount();
    await act(async () => {
      await result.current.refresh();
    });
    expect(runBoardIntelligence).toHaveBeenCalledWith({
      boardId: "b1",
      force: true,
    });
  });

  it("surfaces a refused run and a rejected one", async () => {
    seed(null);
    runBoardIntelligence.mockResolvedValue({
      ok: false,
      error: "Board not found.",
    });
    const { result } = mount();
    await act(async () => {
      await result.current.catchMeUp();
    });
    expect(result.current.error).toBe("Board not found.");
    expect(result.current.running).toBe(false);

    runBoardIntelligence.mockRejectedValue(new Error("network"));
    await act(async () => {
      await result.current.catchMeUp();
    });
    expect(result.current.error).toBe(
      "Couldn't read this board. Please try again.",
    );
    expect(result.current.running).toBe(false);
  });

  it("dismisses optimistically and keeps the server's answer", async () => {
    seed(makeRun());
    const server = makeRun({ dismissed: ["s1"] });
    let resolve!: (v: unknown) => void;
    dismissSuggestion.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { result } = mount();

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.dismiss("s1");
    });
    // Gone before the action resolves.
    expect(result.current.visible.map((s) => s.id)).toEqual(["s2"]);
    expect(dismissSuggestion).toHaveBeenCalledWith({
      runId: "r1",
      suggestionId: "s1",
    });

    await act(async () => {
      resolve({ ok: true, data: server });
      await pending;
    });
    expect(useBoardIntelligenceStore.getState().runs.b1).toEqual(server);
  });

  it("puts a dismissed suggestion back when the server refuses", async () => {
    const before = makeRun();
    seed(before);
    dismissSuggestion.mockResolvedValue({
      ok: false,
      error: "Brief not found.",
    });
    const { result } = mount();
    await act(async () => {
      await result.current.dismiss("s1");
    });
    expect(result.current.visible.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(result.current.error).toBe("Brief not found.");
    expect(useBoardIntelligenceStore.getState().runs.b1).toEqual(before);
  });

  it("puts it back when the dismiss throws", async () => {
    const before = makeRun();
    seed(before);
    dismissSuggestion.mockRejectedValue(new Error("network"));
    const { result } = mount();
    await act(async () => {
      await result.current.dismiss("s1");
    });
    expect(result.current.visible.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(result.current.error).toBe("Couldn't dismiss.");
  });

  it("runs a filter action in the browser, never on the server", async () => {
    seed(makeRun());
    const { result } = mount();
    await act(async () => {
      await result.current.apply("s2", 0);
    });
    expect(useBoardIntelligenceStore.getState().filterRequest).toMatchObject({
      boardId: "b1",
      selection: { kind: "stalled" },
    });
    expect(applySuggestion).not.toHaveBeenCalled();
    expect(runBoardIntelligence).not.toHaveBeenCalled();
  });

  it("applies a cell action, folds its effects and offers an undo", async () => {
    seed(makeRun());
    const applied = makeRun({ applied: ["s1"] });
    const reverted = makeRun();
    const before = [{ itemId: "i1", columnId: "c1", value: null }];
    const effects = [{ kind: "item_fields_set", boardId: "b1", cells: [] }];
    const undoEffects = [{ kind: "item_fields_set", boardId: "b1", cells: [] }];
    applySuggestion.mockResolvedValue({
      ok: true,
      data: { before, updateIds: ["u1"], effects, run: applied },
    });
    revertSuggestion.mockResolvedValue({
      ok: true,
      data: { effects: undoEffects, run: reverted },
    });
    const { result } = mount();

    await act(async () => {
      await result.current.apply("s1", 0);
    });
    expect(applySuggestion).toHaveBeenCalledWith({
      runId: "r1",
      suggestionId: "s1",
      actionIndex: 0,
    });
    expect(applyBoardEffects).toHaveBeenCalledWith(effects);
    expect(useBoardIntelligenceStore.getState().runs.b1).toEqual(applied);
    expect(showUndoToast).toHaveBeenCalledWith("Applied", expect.any(Function));

    const undo = showUndoToast.mock.calls[0][1] as () => void;
    await act(async () => {
      undo();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(revertSuggestion).toHaveBeenCalledWith({
      runId: "r1",
      suggestionId: "s1",
      before,
      updateIds: ["u1"],
    });
    await waitFor(() =>
      expect(useBoardIntelligenceStore.getState().runs.b1).toEqual(reverted),
    );
    expect(applyBoardEffects).toHaveBeenCalledWith(undoEffects);
  });

  it("refuses a second apply while the first is still in flight", async () => {
    seed(makeRun());
    let resolve!: (v: unknown) => void;
    applySuggestion.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { result } = mount();

    let first!: Promise<void>;
    act(() => {
      first = result.current.apply("s1", 0);
    });
    expect(applySuggestion).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.pending.has("s1")).toBe(true));

    // The second click of a double-click. Letting it through sends a second
    // write whose `before` values were read AFTER the first one landed, so its
    // undo would restore what the first write had just written.
    await act(async () => {
      await result.current.apply("s1", 0);
    });
    expect(applySuggestion).toHaveBeenCalledTimes(1);
    // ...and a DIFFERENT suggestion is not blocked by it.
    await act(async () => {
      await result.current.dismiss("s2");
    });
    expect(dismissSuggestion).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({
        ok: true,
        data: {
          before: [],
          updateIds: [],
          effects: [],
          run: makeRun({ applied: ["s1"] }),
        },
      });
      await first;
    });
    expect(result.current.pending.has("s1")).toBe(false);
  });

  it("refuses a second dismiss of the same suggestion", async () => {
    seed(makeRun());
    let resolve!: (v: unknown) => void;
    dismissSuggestion.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { result } = mount();

    let first!: Promise<void>;
    act(() => {
      first = result.current.dismiss("s1");
    });
    await waitFor(() => expect(result.current.pending.has("s1")).toBe(true));
    await act(async () => {
      await result.current.dismiss("s1");
    });
    expect(dismissSuggestion).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({ ok: true, data: makeRun({ dismissed: ["s1"] }) });
      await first;
    });
    expect(result.current.pending.has("s1")).toBe(false);
  });

  it("leaves a NEWER brief alone when a late undo lands", async () => {
    seed(makeRun());
    applySuggestion.mockResolvedValue({
      ok: true,
      data: {
        before: [],
        updateIds: ["u1"],
        effects: [],
        run: makeRun({ applied: ["s1"] }),
      },
    });
    const undoEffects = [{ kind: "item_fields_set", boardId: "b1", cells: [] }];
    revertSuggestion.mockResolvedValue({
      ok: true,
      data: { effects: undoEffects, run: makeRun({ id: "r1" }) },
    });
    const { result } = mount();
    await act(async () => {
      await result.current.apply("s1", 0);
    });

    // A Refresh lands inside the 8s undo window: the brief on screen is now a
    // different run entirely.
    const newer = makeRun({ id: "r2", payload: makeRun().payload });
    act(() => {
      useBoardIntelligenceStore.getState().setRun("b1", newer);
    });

    const undo = showUndoToast.mock.calls[0][1] as () => void;
    await act(async () => {
      undo();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The cells are reverted either way...
    await waitFor(() =>
      expect(revertSuggestion).toHaveBeenCalledWith({
        runId: "r1",
        suggestionId: "s1",
        before: [],
        updateIds: ["u1"],
      }),
    );
    expect(applyBoardEffects).toHaveBeenCalledWith(undoEffects);
    // ...but the brief the user is reading is NOT replaced by the old one.
    expect(useBoardIntelligenceStore.getState().runs.b1).toEqual(newer);
  });

  it("says so when the apply is refused and when the undo is", async () => {
    seed(makeRun());
    applySuggestion.mockResolvedValue({
      ok: false,
      error: "This suggestion no longer matches the board.",
    });
    const { result } = mount();
    await act(async () => {
      await result.current.apply("s1", 0);
    });
    expect(result.current.error).toBe(
      "This suggestion no longer matches the board.",
    );
    expect(showUndoToast).not.toHaveBeenCalled();

    applySuggestion.mockResolvedValue({
      ok: true,
      data: {
        before: [],
        updateIds: [],
        effects: [],
        run: makeRun({ applied: ["s1"] }),
      },
    });
    revertSuggestion.mockResolvedValue({
      ok: false,
      error: "Brief not found.",
    });
    await act(async () => {
      await result.current.apply("s1", 0);
    });
    const undo = showUndoToast.mock.calls[0][1] as () => void;
    await act(async () => {
      undo();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(showMutationError).toHaveBeenCalledWith(
        "Couldn't undo.",
        expect.any(Error),
      ),
    );
  });

  it("says so when the apply throws", async () => {
    seed(makeRun());
    applySuggestion.mockRejectedValue(new Error("network"));
    const { result } = mount();
    await act(async () => {
      await result.current.apply("s1", 0);
    });
    expect(result.current.error).toBe("Couldn't apply the suggestion.");
  });

  it("refuses a write for a viewer, but still runs a filter", async () => {
    seed(makeRun());
    const { result } = mount(false);
    await act(async () => {
      await result.current.apply("s1", 0);
    });
    expect(applySuggestion).not.toHaveBeenCalled();
    expect(showUndoToast).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.apply("s2", 0);
    });
    expect(useBoardIntelligenceStore.getState().filterRequest).toMatchObject({
      selection: { kind: "stalled" },
    });
  });

  it("ignores an unknown suggestion or action index", async () => {
    seed(makeRun());
    const { result } = mount();
    await act(async () => {
      await result.current.apply("nope", 0);
      await result.current.apply("s1", 7);
      await result.current.dismiss("s1");
    });
    expect(applySuggestion).not.toHaveBeenCalled();
    expect(dismissSuggestion).toHaveBeenCalledTimes(1);
  });
});
