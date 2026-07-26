import { describe, expect, it } from "vitest";
import {
  parseToolTrace,
  resolveProposalStates,
  type AskToolTrace,
} from "./tool-trace";

const ACTION = {
  kind: "create_item" as const,
  boardId: "b1",
  groupId: "g1",
  name: "Ship v2",
  summary: 'Create task "Ship v2" in Backlog',
  warnings: [],
};

describe("parseToolTrace", () => {
  it("parses a legacy boardsConsulted-only row", () => {
    expect(parseToolTrace({ boardsConsulted: ["b1"] })).toEqual({
      boardsConsulted: ["b1"],
    });
  });

  it("parses a proposal trace", () => {
    const t = parseToolTrace({
      boardsConsulted: [],
      proposedActions: [ACTION],
    });
    expect(t?.proposedActions).toHaveLength(1);
    expect(t?.proposedActions?.[0].summary).toBe(ACTION.summary);
  });

  it("parses an applied outcome trace", () => {
    const t = parseToolTrace({
      resolvesProposal: "11111111-1111-4111-8111-111111111111",
      outcome: "applied",
      results: [{ ok: true, itemId: "i1" }],
    });
    expect(t?.outcome).toBe("applied");
    expect(t?.results).toEqual([{ ok: true, itemId: "i1" }]);
  });

  it("returns null for null, a scalar, and a malformed action", () => {
    expect(parseToolTrace(null)).toBeNull();
    expect(parseToolTrace("nope")).toBeNull();
    expect(parseToolTrace({ proposedActions: [{ kind: "nope" }] })).toBeNull();
  });

  it("ignores unknown keys rather than failing the whole row", () => {
    expect(parseToolTrace({ boardsConsulted: [], somethingNew: 1 })).toEqual({
      boardsConsulted: [],
    });
  });
});

describe("resolveProposalStates", () => {
  const proposal = {
    id: "p1",
    trace: { proposedActions: [ACTION] } as AskToolTrace,
  };

  it("reports idle when nothing resolves the proposal", () => {
    expect(resolveProposalStates([proposal]).get("p1")).toEqual({
      state: "idle",
    });
  });

  it("reports done when a later message applied it", () => {
    const states = resolveProposalStates([
      proposal,
      {
        id: "o1",
        trace: {
          resolvesProposal: "p1",
          outcome: "applied",
          results: [{ ok: true, itemId: "i1" }],
        } as AskToolTrace,
      },
    ]);
    expect(states.get("p1")).toEqual({ state: "done", note: "Applied." });
  });

  it("reports error with the joined messages when any result failed", () => {
    const states = resolveProposalStates([
      proposal,
      {
        id: "o1",
        trace: {
          resolvesProposal: "p1",
          outcome: "applied",
          results: [{ ok: false, error: "No date column on this board." }],
        } as AskToolTrace,
      },
    ]);
    expect(states.get("p1")).toEqual({
      state: "error",
      note: "No date column on this board.",
    });
  });

  it("reports the cancelled note", () => {
    const states = resolveProposalStates([
      proposal,
      {
        id: "o1",
        trace: { resolvesProposal: "p1", outcome: "cancelled" } as AskToolTrace,
      },
    ]);
    expect(states.get("p1")).toEqual({
      state: "done",
      note: "Cancelled — nothing was changed.",
    });
  });

  it("has no entry for a message without proposals", () => {
    expect(
      resolveProposalStates([{ id: "m1", trace: { boardsConsulted: [] } }])
        .size,
    ).toBe(0);
  });
});
