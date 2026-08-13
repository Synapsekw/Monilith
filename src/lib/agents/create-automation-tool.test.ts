import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolInvokeContext } from "@/lib/mcp/tools/descriptor";
import {
  AGENT_ALLOWED_AUTOMATION_ACTIONS,
  AGENT_FORBIDDEN_AUTOMATION_ACTIONS,
  agentCreateAutomationSchema,
  automationActionSchema,
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
  // Regression guard for the review finding: the tool must advertise a shape
  // DERIVED from the app's own schema, not a hand-copied restatement that can
  // silently drift. Reference equality (not a deep-equal of keys) is
  // deliberate: it fails the instant this stops being
  // `agentCreateAutomationSchema.shape` itself, e.g. if a future edit
  // reintroduces a separate literal object that merely happens to match today.
  it("derives its input schema from agentCreateAutomationSchema.shape, not a restatement", () => {
    expect(createAutomationDescriptor.inputSchema).toBe(
      agentCreateAutomationSchema.shape,
    );
    // …and that schema is the NARROWED one. Advertising the full manual union
    // is the Critical this test exists for: it would hand the model
    // `call_webhook` with a model-chosen url and auth header.
    expect(createAutomationDescriptor.inputSchema).not.toBe(
      createAutomationSchema.shape,
    );
  });

  // The narrowing is DERIVED, so a new action type joins the agent vocabulary
  // by itself and only an explicit entry can leave it. Pinning the excluded set
  // is what makes a rename of `call_webhook` fail here rather than silently
  // re-open egress.
  it("excludes exactly call_webhook from the manual action union", () => {
    expect(AGENT_FORBIDDEN_AUTOMATION_ACTIONS).toEqual(["call_webhook"]);
    const manual = automationActionSchema.options.map(
      (o) => o.shape.type.value,
    );
    expect(manual).toContain("call_webhook");
    expect(AGENT_ALLOWED_AUTOMATION_ACTIONS).toEqual(
      manual.filter((t) => t !== "call_webhook"),
    );
  });

  // AT SCHEMA LEVEL, so the model is never even OFFERED the action: both
  // transports validate against `inputSchema` before `invoke` runs, and the AI
  // SDK converts this same shape into the JSON Schema the model is shown.
  it("refuses a call_webhook action through its own input schema", () => {
    const parsed = z
      .object(createAutomationDescriptor.inputSchema)
      .safeParse({ ...validInput, actions: [webhookAction] });
    expect(parsed.success).toBe(false);
  });

  // The other direction: narrowing must not have cost the agent the reversible
  // vocabulary it is supposed to have.
  it("still accepts a notify action through its own input schema", () => {
    const parsed = z
      .object(createAutomationDescriptor.inputSchema)
      .safeParse({ ...validInput, actions: [notifyAction] });
    expect(parsed.success).toBe(true);
  });

  // End to end through `invoke`, for an owner who IS an org admin — the exact
  // actor the core's own guard would have waved through. Nothing is written.
  it("refuses a webhook rule even for an org admin", async () => {
    const { ctx, inserts } = fixture({ role: "admin" });
    const r = await createAutomationDescriptor.invoke(ctx, {
      ...validInput,
      actions: [webhookAction],
    });
    expect(r.isError).toBe(true);
    expect(inserts).toHaveLength(0);
  });

  // And an agent's ordinary, reversible rule still lands.
  it("lets an agent file a notify rule", async () => {
    const { ctx, inserts } = fixture({ role: "member" });
    const r = await createAutomationDescriptor.invoke(ctx, {
      ...validInput,
      actions: [notifyAction],
    });
    expect(r.isError).toBeUndefined();
    expect(inserts).toHaveLength(1);
  });

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

  it("refuses a webhook action for an ordinary member too", async () => {
    const { ctx, inserts } = fixture({ role: "member" });
    const r = await createAutomationDescriptor.invoke(ctx, {
      ...validInput,
      actions: [webhookAction],
    });
    expect(r.isError).toBe(true);
    expect(inserts).toHaveLength(0);
  });
});
