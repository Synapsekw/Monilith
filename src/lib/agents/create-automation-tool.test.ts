import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolInvokeContext } from "@/lib/mcp/tools/descriptor";
import {
  FAKE_ACTOR,
  FAKE_BOARD,
  makeAutomationClient,
  notifyAction,
  someTrigger,
  webhookAction,
  type AutomationClientSpec,
} from "@/test/automation-fake-client";
import { createAutomationDescriptor } from "./create-automation-tool";

function fixture(spec: AutomationClientSpec = {}) {
  const fake = makeAutomationClient(spec);
  const ctx: ToolInvokeContext = {
    getClient: async () => fake.client,
    actorId: FAKE_ACTOR,
  };
  return { ...fake, ctx };
}

const validInput = {
  boardId: FAKE_BOARD,
  trigger: someTrigger,
  actions: [notifyAction],
};

describe("create_automation descriptor", () => {
  it("is declared as a board-scoped automation.create write", () => {
    expect(createAutomationDescriptor).toMatchObject({
      name: "create_automation",
      capability: "automation.create",
      scope: "boardId",
    });
    // `scope: "boardId"` is only enforceable if the input actually carries the
    // field the board-scope guard reads.
    expect(createAutomationDescriptor.inputSchema).toHaveProperty("boardId");
  });

  it("accepts a well-formed rule through its own input schema", () => {
    const parsed = z
      .object(createAutomationDescriptor.inputSchema)
      .safeParse(validInput);
    expect(parsed.success).toBe(true);
  });

  it("writes the rule through the core and reports the new id", async () => {
    const { ctx, inserts } = fixture({ role: "member" });
    const r = await createAutomationDescriptor.invoke(ctx, validInput);
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0].text)).toEqual({
      ok: true,
      automationId: "auto-1",
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ created_by: FAKE_ACTOR });
  });

  // ActionResult -> ToolResult: `ok: false` must become `isError: true` with
  // the message, or the model reads a refusal as a success.
  it("maps a core failure to an error result carrying the message", async () => {
    const { ctx } = fixture({ board: null });
    const r = await createAutomationDescriptor.invoke(ctx, validInput);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("Board not found.");
  });

  it("surfaces the webhook admin refusal to the model", async () => {
    const { ctx, inserts } = fixture({ role: "member" });
    const r = await createAutomationDescriptor.invoke(ctx, {
      ...validInput,
      actions: [webhookAction],
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/organization admin/i);
    expect(inserts).toHaveLength(0);
  });

  it("lets an org admin file a webhook rule", async () => {
    const { ctx } = fixture({ role: "admin" });
    const r = await createAutomationDescriptor.invoke(ctx, {
      ...validInput,
      actions: [webhookAction],
    });
    expect(r.isError).toBeUndefined();
  });
});
