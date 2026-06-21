import { describe, it, expect } from "vitest";
import {
  createWorkspaceSchema,
  renameWorkspaceSchema,
  deleteWorkspaceSchema,
} from "@/lib/validations/workspace-actions";

describe("workspace schemas", () => {
  it("createWorkspaceSchema trims and accepts a valid name", () => {
    expect(createWorkspaceSchema.parse({ name: "  Marketing  " })).toEqual({
      name: "Marketing",
    });
  });

  it("createWorkspaceSchema rejects empty name", () => {
    expect(createWorkspaceSchema.safeParse({ name: "   " }).success).toBe(
      false,
    );
  });

  it("createWorkspaceSchema rejects names longer than 100 chars", () => {
    expect(
      createWorkspaceSchema.safeParse({ name: "x".repeat(101) }).success,
    ).toBe(false);
  });

  it("renameWorkspaceSchema requires a uuid workspaceId", () => {
    expect(
      renameWorkspaceSchema.safeParse({ workspaceId: "not-a-uuid", name: "A" })
        .success,
    ).toBe(false);
    expect(
      renameWorkspaceSchema.safeParse({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        name: "A",
      }).success,
    ).toBe(true);
  });

  it("deleteWorkspaceSchema requires a uuid workspaceId", () => {
    expect(
      deleteWorkspaceSchema.safeParse({ workspaceId: "nope" }).success,
    ).toBe(false);
  });
});
