import { describe, expect, it } from "vitest";
import type { ToolInvokeContext } from "@/lib/mcp/tools/descriptor";
import { capabilityFor, scopeFor } from "@/lib/mcp/tools/descriptor";
import {
  agentCreateAutomationSchema,
  createAutomationSchema,
} from "@/lib/validations/automations";
import {
  FAKE_ACTOR,
  FAKE_BOARD,
  makeAutomationClient,
  notifyAction,
  someTrigger,
  webhookAction,
  type AutomationClientSpec,
} from "@/test/automation-fake-client";
import { manageAutomationDescriptor } from "./manage-automation-tool";

const FAKE_AUTOMATION = "55555555-5555-4555-8555-555555555555";

function fixture(spec: AutomationClientSpec = {}) {
  const fake = makeAutomationClient(spec);
  const ctx: ToolInvokeContext = {
    getClient: async () => fake.client,
    actorId: FAKE_ACTOR,
  };
  return { ...fake, ctx };
}

/** Extends the create-only fake with `update`/`delete` chains, for the two
 *  actions `makeAutomationClient` was never built to serve. */
function updateDeleteFixture(opts: {
  automation?: { org_id: string } | null;
  role?: "owner" | "admin" | "member" | null;
  mutateResult?: { data: unknown; error: unknown };
}) {
  const automation =
    opts.automation === undefined ? { org_id: "org-1" } : opts.automation;
  const mutateResult = opts.mutateResult ?? {
    data: { board_id: FAKE_BOARD },
    error: null,
  };

  const client = {
    from: (table: string) => {
      if (table === "automations") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: automation, error: null }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({ maybeSingle: async () => mutateResult }),
            }),
          }),
          delete: () => ({
            eq: () => ({
              select: () => ({ maybeSingle: async () => mutateResult }),
            }),
          }),
        };
      }
      if (table === "org_members") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data:
                    opts.role === null ? null : { role: opts.role ?? "member" },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return {};
    },
  };

  const ctx: ToolInvokeContext = {
    getClient: async () => client as never,
    actorId: FAKE_ACTOR,
  };
  return ctx;
}

const validCreate = {
  action: "create",
  boardId: FAKE_BOARD,
  trigger: someTrigger,
  actions: [notifyAction],
};

describe("manage_automation — never served over MCP", () => {
  // The single most important assertion in this file: a catalog entry would
  // serve this tool to every connected MCP client and silently overturn the
  // decision recorded in agent-only-tools.ts (Spec §9).
  it("is never served over MCP", async () => {
    const { ALL_TOOL_DESCRIPTORS } = await import("@/lib/mcp/tools/catalog");
    expect(ALL_TOOL_DESCRIPTORS.map((d) => d.name)).not.toContain(
      "manage_automation",
    );
  });
});

describe("manage_automation descriptor — capability and scope", () => {
  it("charges automation.create for every action", () => {
    for (const action of ["create", "update", "delete"]) {
      expect(capabilityFor(manageAutomationDescriptor, { action })).toBe(
        "automation.create",
      );
    }
  });

  it("scopes create by boardId and update/delete by automationId", () => {
    expect(scopeFor(manageAutomationDescriptor, { action: "create" })).toBe(
      "boardId",
    );
    expect(scopeFor(manageAutomationDescriptor, { action: "update" })).toBe(
      "automationId",
    );
    expect(scopeFor(manageAutomationDescriptor, { action: "delete" })).toBe(
      "automationId",
    );
  });

  it("declares action as an enum, not a bare string", () => {
    const action = manageAutomationDescriptor.inputSchema.action as unknown as {
      options: string[];
    };
    expect(action.options).toEqual(["create", "update", "delete"]);
  });
});

describe("manage_automation — create", () => {
  it("still refuses a webhook action, even for an org admin", async () => {
    const { ctx, inserts } = fixture({ role: "admin" });
    const r = await manageAutomationDescriptor.invoke(ctx, {
      ...validCreate,
      actions: [webhookAction],
    });
    expect(r.isError).toBe(true);
    expect(inserts).toHaveLength(0);
  });

  it("writes the rule through the core and reports the new id", async () => {
    const { ctx, inserts } = fixture({ role: "member" });
    const r = await manageAutomationDescriptor.invoke(ctx, validCreate);
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0]!.text as string)).toEqual({
      ok: true,
      automationId: "auto-1",
    });
    expect(inserts).toHaveLength(1);
  });

  it("maps a core failure (missing board) to an error result", async () => {
    const { ctx } = fixture({ board: null });
    const r = await manageAutomationDescriptor.invoke(ctx, validCreate);
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe("Board not found.");
  });
});

describe("manage_automation — update", () => {
  it("updates an ordinary field for a non-admin", async () => {
    const ctx = updateDeleteFixture({ role: "member" });
    const r = await manageAutomationDescriptor.invoke(ctx, {
      action: "update",
      id: FAKE_AUTOMATION,
      name: "Renamed",
    });
    expect(r.isError).toBeUndefined();
  });

  // The load-bearing regression check: KEEPS the webhook admin-gate that
  // exists for exactly this case — an agent editing an automation to ADD a
  // webhook.
  it("refuses to add a webhook action when the actor is not an org admin", async () => {
    const ctx = updateDeleteFixture({ role: "member" });
    const r = await manageAutomationDescriptor.invoke(ctx, {
      action: "update",
      id: FAKE_AUTOMATION,
      actions: [webhookAction],
    });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/organization admin/i);
  });

  it("allows adding a webhook action for an org admin", async () => {
    const ctx = updateDeleteFixture({ role: "admin" });
    const r = await manageAutomationDescriptor.invoke(ctx, {
      action: "update",
      id: FAKE_AUTOMATION,
      actions: [webhookAction],
    });
    expect(r.isError).toBeUndefined();
  });

  it("maps a core failure to an error result", async () => {
    const ctx = updateDeleteFixture({
      mutateResult: { data: null, error: { message: "denied by RLS" } },
    });
    const r = await manageAutomationDescriptor.invoke(ctx, {
      action: "update",
      id: FAKE_AUTOMATION,
      name: "Renamed",
    });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe("denied by RLS");
  });
});

describe("manage_automation — delete", () => {
  it("deletes an automation", async () => {
    const ctx = updateDeleteFixture({});
    const r = await manageAutomationDescriptor.invoke(ctx, {
      action: "delete",
      id: FAKE_AUTOMATION,
    });
    expect(r.isError).toBeUndefined();
  });

  it("maps a core failure to an error result", async () => {
    const ctx = updateDeleteFixture({
      mutateResult: { data: null, error: { message: "denied by RLS" } },
    });
    const r = await manageAutomationDescriptor.invoke(ctx, {
      action: "delete",
      id: FAKE_AUTOMATION,
    });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe("denied by RLS");
  });
});

describe("manage_automation — malformed / unrecognised action", () => {
  it("rejects an action absent from the enum", async () => {
    const { ctx } = fixture({});
    const r = await manageAutomationDescriptor.invoke(ctx, {
      action: "rename",
      id: FAKE_AUTOMATION,
    });
    expect(r.isError).toBe(true);
  });
});

describe("manage_automation — create schema narrowing (preserved from create_automation)", () => {
  // The narrowing that keeps `call_webhook` out of `create` is enforced
  // end-to-end in "still refuses a webhook action, even for an org admin"
  // above. This pins the constant it depends on: `agentCreateAutomationSchema`
  // (what `create`'s branch of the union is built from) must remain the
  // NARROWED schema, not the full manual union a future edit could
  // accidentally re-point it at.
  it("builds the create branch from the narrowed schema, not the full manual union", () => {
    expect(agentCreateAutomationSchema.shape).not.toBe(
      createAutomationSchema.shape,
    );
    expect(agentCreateAutomationSchema.shape.actions).not.toBe(
      createAutomationSchema.shape.actions,
    );
  });
});
