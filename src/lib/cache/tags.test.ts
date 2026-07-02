import { describe, expect, it } from "vitest";
import {
  boardsTag,
  sharedBoardsTag,
  dashboardsTag,
  workspacesTag,
  platformAdminTag,
  orgAdminTag,
  orgMembersTag,
  widgetAggregationTag,
} from "./tags";

describe("cache tag builders", () => {
  it("produce identity-scoped strings", () => {
    expect(boardsTag("u1")).toBe("boards:user:u1");
    expect(sharedBoardsTag("u1")).toBe("shared-boards:user:u1");
    expect(dashboardsTag("o1")).toBe("dashboards:org:o1");
    expect(workspacesTag("o1")).toBe("workspaces:org:o1");
    expect(platformAdminTag("u1")).toBe("platform-admin:user:u1");
    expect(orgAdminTag("u1", "o1")).toBe("org-admin:user:u1:org:o1");
  });

  it("orgMembersTag is org-scoped", () => {
    expect(orgMembersTag("org-1")).toBe("org-members:org:org-1");
    expect(orgMembersTag("org-1")).not.toBe(orgMembersTag("org-2"));
  });

  it("are distinct across identities (no collisions)", () => {
    expect(boardsTag("u1")).not.toBe(boardsTag("u2"));
    expect(orgAdminTag("u1", "o1")).not.toBe(orgAdminTag("u1", "o2"));
  });
});

describe("widgetAggregationTag", () => {
  it("scopes by org AND widget id (cross-tenant isolation)", () => {
    expect(widgetAggregationTag("org-A", "w1")).toBe(
      "widget-agg:org:org-A:widget:w1",
    );
  });

  it("differs across orgs for the same widget id", () => {
    expect(widgetAggregationTag("org-A", "w1")).not.toBe(
      widgetAggregationTag("org-B", "w1"),
    );
  });
});
