import { describe, it, expect } from "vitest";
import { ASSISTANT_COMMENT_MAX_CHARS, unsupportedReason } from "./unsupported";

describe("unsupportedReason", () => {
  it("refuses a comment too long for the confirm card to show whole", () => {
    const ok = "x".repeat(ASSISTANT_COMMENT_MAX_CHARS);
    expect(unsupportedReason("add_comment", { itemId: "i", text: ok })).toBe(
      null,
    );
    // Surrounding space is trimmed by the tool, so it does not count.
    expect(
      unsupportedReason("add_comment", { itemId: "i", text: ` ${ok}  ` }),
    ).toBe(null);
    expect(
      unsupportedReason("add_comment", { itemId: "i", text: `${ok}x` }),
    ).toBe(
      `Keep a comment to ${ASSISTANT_COMMENT_MAX_CHARS} characters or fewer, so the user can read all of it before confirming.`,
    );
  });

  it("refuses a board create without a workspace", () => {
    expect(
      unsupportedReason("manage_board", { action: "create", name: "X" }),
    ).toBe(
      "Pass workspaceId: list_boards and get_board return each board's workspaceId. Use the workspace of the board the user is on unless they name another.",
    );
    expect(
      unsupportedReason("manage_board", {
        action: "create",
        name: "X",
        workspaceId: "w-1",
      }),
    ).toBe(null);
  });

  it("refuses creating a goal", () => {
    expect(unsupportedReason("manage_goal", { action: "create" })).toBe(
      "Creating goals from the assistant isn't available yet. Create it from the Goals page.",
    );
  });

  it("refuses creating a portfolio", () => {
    expect(unsupportedReason("manage_portfolio", { action: "create" })).toBe(
      "Creating portfolios from the assistant isn't available yet. Create it from the Portfolios page.",
    );
  });

  it("refuses a dashboard create that names a workspace", () => {
    expect(
      unsupportedReason("manage_dashboard", {
        action: "create",
        workspaceId: "w-1",
      }),
    ).toBe(
      "Leave out the workspace: a dashboard is created in the current organisation's workspace.",
    );
  });

  it("allows a dashboard create without a workspace", () => {
    expect(unsupportedReason("manage_dashboard", { action: "create" })).toBe(
      null,
    );
    expect(
      unsupportedReason("manage_dashboard", {
        action: "create",
        workspaceId: null,
      }),
    ).toBe(null);
    expect(
      unsupportedReason("manage_dashboard", {
        action: "create",
        workspaceId: undefined,
      }),
    ).toBe(null);
  });

  it("allows other actions of the same tools", () => {
    expect(unsupportedReason("manage_goal", { action: "update" })).toBe(null);
    expect(unsupportedReason("manage_goal", { action: "delete" })).toBe(null);
    expect(unsupportedReason("manage_portfolio", { action: "add_board" })).toBe(
      null,
    );
    expect(
      unsupportedReason("manage_dashboard", {
        action: "rename",
        workspaceId: "w-1",
      }),
    ).toBe(null);
  });

  it("allows unrelated tools", () => {
    expect(unsupportedReason("update_item", { action: "create" })).toBe(null);
    expect(unsupportedReason("list_boards", {})).toBe(null);
  });
});
