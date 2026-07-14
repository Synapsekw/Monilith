import { describe, expect, it } from "vitest";
import { validateItemAssist } from "@/lib/ai/item-assist/validate";
import {
  DESCRIPTION_MAX,
  SUBTASKS_MAX,
  SUBTASK_NAME_MAX,
} from "@/lib/ai/item-assist/schema";

describe("validateItemAssist", () => {
  it("drops a status proposal whose optionId is not in the known options, with a warning", () => {
    const res = validateItemAssist(
      { status: { columnId: "col-status", optionId: "not-real" } },
      { statusOptionIds: new Set(["opt-1", "opt-2"]) },
    );
    expect(res.proposal.status).toBeUndefined();
    expect(res.warnings.length).toBe(1);
    expect(res.warnings[0]).toContain("not-real");
  });

  it("keeps a status proposal whose optionId is in the known options", () => {
    const res = validateItemAssist(
      { status: { columnId: "col-status", optionId: "opt-1" } },
      { statusOptionIds: new Set(["opt-1", "opt-2"]) },
    );
    expect(res.proposal.status).toEqual({
      columnId: "col-status",
      optionId: "opt-1",
    });
    expect(res.warnings).toHaveLength(0);
  });

  it("drops status when no statusOptionIds are provided at all", () => {
    const res = validateItemAssist(
      { status: { columnId: "col-status", optionId: "opt-1" } },
      {},
    );
    expect(res.proposal.status).toBeUndefined();
    expect(res.warnings.length).toBe(1);
  });

  it("trims an over-long description to DESCRIPTION_MAX", () => {
    const long = "x".repeat(DESCRIPTION_MAX + 500);
    const res = validateItemAssist({ description: long }, {});
    expect(res.proposal.description).toHaveLength(DESCRIPTION_MAX);
    expect(res.warnings).toHaveLength(0);
  });

  it("drops an empty/whitespace-only description", () => {
    const res = validateItemAssist({ description: "   " }, {});
    expect(res.proposal.description).toBeUndefined();
  });

  it("caps subtasks count to SUBTASKS_MAX and each name to SUBTASK_NAME_MAX, dropping empties", () => {
    const tooMany = Array.from({ length: SUBTASKS_MAX + 5 }, (_, i) =>
      i === 0 ? "y".repeat(SUBTASK_NAME_MAX + 50) : `Task ${i}`,
    );
    tooMany.push("   "); // whitespace-only, should be dropped
    const res = validateItemAssist({ subtasks: tooMany }, {});
    expect(res.proposal.subtasks).toHaveLength(SUBTASKS_MAX);
    expect(res.proposal.subtasks![0]).toHaveLength(SUBTASK_NAME_MAX);
    expect(res.warnings).toHaveLength(0);
  });

  it("omits subtasks entirely when the cleaned list is empty", () => {
    const res = validateItemAssist({ subtasks: ["", "   "] }, {});
    expect(res.proposal.subtasks).toBeUndefined();
  });

  it("passes through a proposal with nothing to validate", () => {
    const res = validateItemAssist({}, {});
    expect(res.proposal).toEqual({});
    expect(res.warnings).toHaveLength(0);
  });
});
