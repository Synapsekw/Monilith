import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { ALL_TOOL_DESCRIPTORS } from "@/lib/mcp/tools/catalog";
import type { ToolInvokeContext } from "@/lib/mcp/tools/descriptor";
import { AGENT_ONLY_DESCRIPTORS } from "./agent-only-tools";
import { makeGrantGate, UNGRANTED_REASON } from "./grant-gate";
import { descriptorsFor } from "./tool-descriptors";
import { buildAgentTools } from "./tools";

const noClient = new Proxy(
  {},
  {
    get() {
      throw new Error("no query expected");
    },
  },
) as SupabaseClient<Database>;

const ctx: ToolInvokeContext = {
  getClient: async () => noClient,
  actorId: "00000000-0000-4000-8000-000000000001",
};

const NAMES = ["create_file", "manage_automation", "create_pdf"];

describe("AGENT_ONLY_DESCRIPTORS", () => {
  it("offers create_file, manage_automation and create_pdf to the model", () => {
    const tools = buildAgentTools({
      ctx,
      scope: { mode: "all" },
      client: noClient,
      extra: AGENT_ONLY_DESCRIPTORS,
    });
    expect(Object.keys(tools)).toEqual(expect.arrayContaining(NAMES));
  });

  // The MCP catalog is a contract with third-party clients; these are not
  // part of it, and a name that appeared in both would throw at construction.
  it("keeps all three out of the MCP registration", () => {
    const catalogNames = ALL_TOOL_DESCRIPTORS.map((d) => d.name);
    for (const name of NAMES) expect(catalogNames).not.toContain(name);
    expect(() =>
      descriptorsFor({ extra: AGENT_ONLY_DESCRIPTORS }),
    ).not.toThrow();
  });

  it("declares the capabilities the grant gate keys off", () => {
    const byName = new Map(AGENT_ONLY_DESCRIPTORS.map((d) => [d.name, d]));
    expect(byName.get("create_file")).toMatchObject({
      capability: "files.write",
      scope: "itemId",
    });
    // No new capability for the create/update/delete grown lifecycle — all
    // three actions still charge the EXISTING automation.create.
    expect(byName.get("manage_automation")).toMatchObject({
      capability: {
        create: "automation.create",
        update: "automation.create",
        delete: "automation.create",
      },
      scope: {
        create: "boardId",
        update: "automationId",
        delete: "automationId",
      },
    });
    // REUSES files.write. Minting a new capability would leave every agent
    // already trusted to write files unable to render one until its owner
    // re-approved something they have already approved.
    expect(byName.get("create_pdf")).toMatchObject({
      capability: "files.write",
      scope: "itemId",
    });
    // None may be agentExcluded — that flag would drop them from the very
    // set they exist to join.
    for (const d of AGENT_ONLY_DESCRIPTORS)
      expect(d.agentExcluded).toBeUndefined();
  });

  // The failure the one-source design exists to prevent: a tool offered to the
  // model that the gate cannot classify is denied "Unknown tool." on every
  // call. Passing the same array to both is what makes these two gateable.
  it("is classified by the grant gate when passed as the same `extra`", async () => {
    const onPropose = vi.fn();
    const gate = makeGrantGate({
      granted: ["files.write"],
      ceiling: ["files.write", "automation.create"],
      onPropose,
      extra: AGENT_ONLY_DESCRIPTORS,
    });
    // Granted -> executes.
    expect(
      await gate({
        toolCall: { toolName: "create_file", toolCallId: "c1", input: {} },
      }),
    ).toBeUndefined();
    // Ungranted -> denied and recorded for approval, not "Unknown tool.".
    expect(
      await gate({
        toolCall: {
          toolName: "manage_automation",
          toolCallId: "c2",
          input: {},
        },
      }),
    ).toEqual({ type: "denied", reason: UNGRANTED_REASON });
    expect(onPropose).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "manage_automation",
        capability: "automation.create",
      }),
    );
  });
});
