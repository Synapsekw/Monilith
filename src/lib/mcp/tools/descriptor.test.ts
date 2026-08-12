import { describe, expect, it } from "vitest";
import { ALL_TOOL_DESCRIPTORS } from "./register";
import { TOOL_SCOPES } from "./descriptor";
import { AGENT_CAPABILITIES } from "@/lib/agents/capabilities";

describe("ALL_TOOL_DESCRIPTORS", () => {
  it("covers every tool exactly once", () => {
    const names = ALL_TOOL_DESCRIPTORS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(24);
  });

  it("classifies every tool with a legal capability and scope", () => {
    for (const d of ALL_TOOL_DESCRIPTORS) {
      expect(
        d.capability === null || AGENT_CAPABILITIES.includes(d.capability),
      ).toBe(true);
      expect(TOOL_SCOPES).toContain(d.scope);
    }
  });

  // The classification the consent screen and the grant gate both depend on.
  it("marks exactly the five write tools with a capability", () => {
    const writes = ALL_TOOL_DESCRIPTORS.filter((d) => d.capability !== null)
      .map((d) => d.name)
      .sort();
    expect(writes).toEqual([
      "attach_file",
      "create_attachment_upload",
      "create_item",
      "log_time_allocation",
      "update_item",
    ]);
  });

  it("excludes create_attachment_upload from the agent surface", () => {
    // It returns a signed URL the caller must PUT bytes to, which an agent
    // inside a tool loop cannot do. Classified, but never offered to a model.
    const excluded = ALL_TOOL_DESCRIPTORS.filter((d) => d.agentExcluded).map(
      (d) => d.name,
    );
    expect(excluded).toEqual(["create_attachment_upload"]);
  });

  it("gives every board-addressed tool a resolvable scope", () => {
    const byName = new Map(ALL_TOOL_DESCRIPTORS.map((d) => [d.name, d]));
    expect(byName.get("list_items")?.scope).toBe("boardId");
    expect(byName.get("get_board")?.scope).toBe("boardId");
    expect(byName.get("search_items")?.scope).toBe("boardId");
    expect(byName.get("get_item")?.scope).toBe("itemId");
    expect(byName.get("update_item")?.scope).toBe("itemId");
    expect(byName.get("attach_file")?.scope).toBe("itemId");
    expect(byName.get("create_item")?.scope).toBe("groupId");
    expect(byName.get("list_boards")?.scope).toBe("none");
  });
});
