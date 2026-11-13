import { describe, it, expect } from "vitest";
import { parseToolTrace, resolveProposalStates } from "@/lib/ai/ask/tool-trace";

const staged = {
  id: "c1",
  tool: "update_item",
  input: {},
  summary: "Update an item.",
  destructive: false,
  boardId: null,
};
const P = "11111111-1111-4111-8111-111111111111";

describe("tool trace with staged calls", () => {
  it("round-trips stagedCalls", () => {
    expect(parseToolTrace({ stagedCalls: [staged] })?.stagedCalls).toHaveLength(
      1,
    );
  });
  it("reports an unresolved batch as idle", () => {
    const states = resolveProposalStates([
      { id: P, trace: { stagedCalls: [staged] } },
    ]);
    expect(states.get(P)).toEqual({ state: "idle" });
  });
  it("reports a batch with a failed row as error, ignoring skipped rows", () => {
    const states = resolveProposalStates([
      { id: P, trace: { stagedCalls: [staged] } },
      {
        id: "o",
        trace: {
          resolvesProposal: P,
          outcome: "applied",
          stagedResults: [
            { id: "c1", ok: false, error: "Item not found." },
            { id: "c2", ok: false, skipped: true },
          ],
        },
      },
    ]);
    expect(states.get(P)).toEqual({ state: "error", note: "Item not found." });
  });
  it("reports a fully applied batch as done", () => {
    const states = resolveProposalStates([
      { id: P, trace: { stagedCalls: [staged] } },
      {
        id: "o",
        trace: {
          resolvesProposal: P,
          outcome: "applied",
          stagedResults: [{ id: "c1", ok: true }],
        },
      },
    ]);
    expect(states.get(P)).toEqual({ state: "done", note: "Applied." });
  });
});
