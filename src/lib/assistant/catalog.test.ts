import { describe, it, expect } from "vitest";
import { assistantDescriptors, findDescriptor, effectOf } from "./catalog";

describe("assistant catalog", () => {
  it("offers catalog tools but not agent-excluded ones", () => {
    expect(findDescriptor("list_items")).toBeDefined();
    expect(findDescriptor("create_attachment_upload")).toBeUndefined();
    expect(assistantDescriptors().every((d) => !d.agentExcluded)).toBe(true);
  });
  it("does not offer list_organizations: the assistant works in one org", () => {
    expect(findDescriptor("list_organizations")).toBeUndefined();
    expect(
      assistantDescriptors().some((d) => d.name === "list_organizations"),
    ).toBe(false);
  });
  it("classifies a capability-free tool as a read", () => {
    expect(effectOf(findDescriptor("list_items")!, { boardId: "b" })).toBe(
      "read",
    );
  });
  it("classifies a board.write tool as a write", () => {
    expect(effectOf(findDescriptor("update_item")!, {})).toBe("write");
  });
  it("classifies a board.destroy action as destructive", () => {
    expect(
      effectOf(findDescriptor("manage_board")!, { action: "archive" }),
    ).toBe("destructive");
  });
  it("fails closed for an action the tool does not name", () => {
    expect(
      effectOf(findDescriptor("manage_board")!, { action: "nope" }),
    ).not.toBe("read");
  });
});
