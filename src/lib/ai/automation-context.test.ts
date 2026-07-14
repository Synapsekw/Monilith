import { describe, it, expect } from "vitest";
import { buildAutomationContext } from "@/lib/ai/automation-context";

const statusSettings = {
  options: [
    { id: "opt-done", label: "Done", color: "green" },
    { id: "opt-stuck", label: "Stuck", color: "red" },
  ],
};

describe("buildAutomationContext", () => {
  it("projects columns/groups/members to labels + ids only", () => {
    const ctx = buildAutomationContext({
      columns: [
        {
          id: "col-status",
          name: "Status",
          kind: "status",
          settings: statusSettings,
        },
        { id: "col-text", name: "Notes", kind: "text", settings: {} },
      ],
      groups: [{ id: "grp-1", name: "Backlog" }],
      members: [
        { userId: "usr-1", fullName: "Ada Lovelace", email: "ada@x.com" },
      ],
    });

    expect(ctx.columns).toEqual([
      {
        id: "col-status",
        name: "Status",
        kind: "status",
        options: [
          { id: "opt-done", label: "Done" },
          { id: "opt-stuck", label: "Stuck" },
        ],
      },
      { id: "col-text", name: "Notes", kind: "text", options: [] },
    ]);
    expect(ctx.groups).toEqual([{ id: "grp-1", name: "Backlog" }]);
    expect(ctx.members).toEqual([{ id: "usr-1", name: "Ada Lovelace" }]);
  });

  it("falls back to email then userId for a member with no full name", () => {
    const ctx = buildAutomationContext({
      columns: [],
      groups: [],
      members: [
        { userId: "usr-2", fullName: null, email: "bob@x.com" },
        { userId: "usr-3", fullName: null, email: null },
      ],
    });
    expect(ctx.members).toEqual([
      { id: "usr-2", name: "bob@x.com" },
      { id: "usr-3", name: "usr-3" },
    ]);
  });

  it("carries NO cell values or extra settings keys (labels + ids only)", () => {
    const ctx = buildAutomationContext({
      columns: [
        {
          id: "col-status",
          name: "Status",
          kind: "status",
          settings: statusSettings,
        },
      ],
      groups: [],
      members: [],
    });
    const json = JSON.stringify(ctx);
    // Option color is a settings-only field; it must be projected out.
    expect(json).not.toContain("green");
    expect(json).not.toContain("color");
    // The context only ever holds the shape below — no `items`/`cells` surface.
    expect(json).not.toContain("cell");
    expect(ctx.columns[0].options[0]).not.toHaveProperty("color");
  });
});
