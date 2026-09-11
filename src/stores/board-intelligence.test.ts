import { beforeEach, describe, expect, it } from "vitest";
import {
  unresolvedCount,
  useBoardIntelligenceStore,
} from "./board-intelligence";
import type { BoardIntelligenceRun } from "@/lib/ai/board-intelligence/runs";

const run = (
  over: Partial<BoardIntelligenceRun> = {},
): BoardIntelligenceRun => ({
  id: "r1",
  boardId: "b1",
  generatedAt: "2026-09-11T10:00:00.000Z",
  inputHash: "h",
  payload: {
    brief: "Quiet week.",
    suggestions: [
      {
        id: "s1",
        kind: "overdue",
        title: "t",
        evidence: "e",
        body: "b",
        evidenceRows: [],
        actions: [{ type: "filter", signalKind: "overdue", label: "Show" }],
      },
      {
        id: "s2",
        kind: "stalled",
        title: "t",
        evidence: "e",
        body: "b",
        evidenceRows: [],
        actions: [{ type: "filter", signalKind: "stalled", label: "Show" }],
      },
    ],
    signals: [],
  },
  dismissed: [],
  applied: [],
  model: null,
  tokensIn: 0,
  tokensOut: 0,
  ...over,
});

beforeEach(() =>
  useBoardIntelligenceStore.setState({
    runs: {},
    openRequest: null,
    filterRequest: null,
  }),
);

describe("board intelligence bridge store", () => {
  it("counts unresolved suggestions", () => {
    expect(unresolvedCount(null)).toBe(0);
    expect(unresolvedCount(run())).toBe(2);
    expect(unresolvedCount(run({ dismissed: ["s1"] }))).toBe(1);
    expect(unresolvedCount(run({ dismissed: ["s1"], applied: ["s2"] }))).toBe(
      0,
    );
  });

  it("keeps one run per board", () => {
    useBoardIntelligenceStore.getState().setRun("b1", run());
    useBoardIntelligenceStore.getState().setRun("b2", null);
    expect(useBoardIntelligenceStore.getState().runs.b1?.id).toBe("r1");
    expect(useBoardIntelligenceStore.getState().runs.b2).toBeNull();
  });

  it("open requests carry a fresh nonce and are consumed by nonce", () => {
    const s = useBoardIntelligenceStore.getState();
    s.requestOpen("b1", { run: true });
    const first = useBoardIntelligenceStore.getState().openRequest!;
    expect(first).toMatchObject({ boardId: "b1", run: true });
    s.requestOpen("b1");
    const second = useBoardIntelligenceStore.getState().openRequest!;
    expect(second.nonce).not.toBe(first.nonce);
    expect(second.run).toBe(false);
    s.consumeOpen(first.nonce); // stale consume is a no-op
    expect(useBoardIntelligenceStore.getState().openRequest).toBe(second);
    s.consumeOpen(second.nonce);
    expect(useBoardIntelligenceStore.getState().openRequest).toBeNull();
  });

  it("filter requests behave the same way", () => {
    const s = useBoardIntelligenceStore.getState();
    s.requestFilter("b1", { kind: "overdue" });
    const req = useBoardIntelligenceStore.getState().filterRequest!;
    expect(req.selection).toEqual({ kind: "overdue" });
    s.consumeFilter(req.nonce);
    expect(useBoardIntelligenceStore.getState().filterRequest).toBeNull();
  });
});
