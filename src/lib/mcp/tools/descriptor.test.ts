import { describe, expect, it } from "vitest";
import { ALL_TOOL_DESCRIPTORS } from "./catalog";
import {
  TOOL_SCOPES,
  capabilityFor,
  scopeFor,
  type ToolDescriptor,
} from "./descriptor";
import { AGENT_CAPABILITIES } from "@/lib/agents/capabilities";

describe("ALL_TOOL_DESCRIPTORS", () => {
  it("covers every tool exactly once", () => {
    const names = ALL_TOOL_DESCRIPTORS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(24);
  });

  it("classifies every tool with a legal capability and scope", () => {
    // All 24 catalog descriptors carry scalar `capability`/`scope` today, but
    // the fields are typed to also allow a per-action `Record` (Task 2), so
    // this checks every LEAF value rather than assuming a scalar.
    for (const d of ALL_TOOL_DESCRIPTORS) {
      const capabilities =
        d.capability === null || typeof d.capability === "string"
          ? [d.capability]
          : Object.values(d.capability);
      for (const c of capabilities) {
        expect(c === null || AGENT_CAPABILITIES.includes(c)).toBe(true);
      }
      const scopes =
        typeof d.scope === "string" ? [d.scope] : Object.values(d.scope);
      for (const s of scopes) {
        expect(TOOL_SCOPES).toContain(s);
      }
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

  // Guards the fail-closed property in `mostRestrictive`: an empty map would
  // make EVERY action on that tool resolve to its fallback rather than a
  // declared grant, silently. A future descriptor must not ship one.
  it("declares no empty capability map", () => {
    for (const d of ALL_TOOL_DESCRIPTORS) {
      if (d.capability !== null && typeof d.capability === "object") {
        expect(Object.keys(d.capability).length, d.name).toBeGreaterThan(0);
      }
    }
  });
});

const mapped: ToolDescriptor = {
  name: "fake_manage",
  title: "Fake",
  description: "Fake",
  inputSchema: {},
  capability: { create: "board.structure", archive: "board.destroy" },
  scope: { create: "none", archive: "boardId" },
  invoke: async () => ({ content: [{ type: "text", text: "" }] }),
};

describe("capabilityFor", () => {
  it("reads the action's capability from a map", () => {
    expect(capabilityFor(mapped, { action: "create" })).toBe("board.structure");
    expect(capabilityFor(mapped, { action: "archive" })).toBe("board.destroy");
  });

  it("passes a scalar capability through unchanged", () => {
    const scalar = { ...mapped, capability: "board.write" } as ToolDescriptor;
    expect(capabilityFor(scalar, { action: "whatever" })).toBe("board.write");
  });

  // A genuine capability-free read (e.g. describe_schema) must still pass
  // through as null — only the MAP path is hardened to fail closed.
  it("passes a scalar null capability through unchanged", () => {
    const scalar = { ...mapped, capability: null } as ToolDescriptor;
    expect(capabilityFor(scalar, { action: "whatever" })).toBeNull();
  });

  // THE safety property. Returning null for an unknown action would classify
  // it as a capability-free READ and let it execute ungated.
  it("fails closed on an action absent from the map", () => {
    expect(capabilityFor(mapped, { action: "nonsense" })).toBe("board.destroy");
    expect(capabilityFor(mapped, {})).toBe("board.destroy");
  });

  // An empty or all-null map is a DECLARATION BUG (an action added to a
  // handler's union without a matching capability entry), not a read. It
  // must fail closed rather than let an unnamed action execute ungated.
  it("fails closed on an all-null capability map", () => {
    const allNull = {
      ...mapped,
      capability: { a: null, b: null },
    } as ToolDescriptor;
    expect(capabilityFor(allNull, { action: "nonsense" })).not.toBeNull();
  });

  it("fails closed on an empty capability map", () => {
    const empty = { ...mapped, capability: {} } as ToolDescriptor;
    expect(capabilityFor(empty, { action: "nonsense" })).not.toBeNull();
  });
});

describe("scopeFor", () => {
  it("reads the action's scope from a map", () => {
    expect(scopeFor(mapped, { action: "archive" })).toBe("boardId");
  });

  it("passes a scalar scope through unchanged", () => {
    const scalar = { ...mapped, scope: "itemId" } as ToolDescriptor;
    expect(scopeFor(scalar, { action: "archive" })).toBe("itemId");
  });

  // "none" is the only safe default: it means board scope has nothing to say,
  // and RLS remains the boundary. Guessing "boardId" would read a field that
  // is not there and resolve to null anyway.
  it("falls back to none on an unknown action", () => {
    expect(scopeFor(mapped, { action: "nonsense" })).toBe("none");
  });
});
