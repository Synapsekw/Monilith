import { z } from "zod";
import {
  agentCreateAutomationSchema,
  automationActionsSchema,
  automationTriggerSchema,
  automationConditionSchema,
} from "@/lib/validations/automations";
import {
  createAutomationCore,
  updateAutomationCore,
  deleteAutomationCore,
  type CreateAutomationCoreInput,
  type UpdateAutomationCoreInput,
  type DeleteAutomationCoreInput,
} from "@/lib/boards/automation-core";
import { parseAction, type ToolResult } from "@/lib/mcp/tools/shared";
import type { ToolDescriptor } from "@/lib/mcp/tools/descriptor";

/**
 * `.shape` of the app's OWN `agentCreateAutomationSchema`, not a hand-written
 * restatement — see `agentCreateAutomationSchema`'s own doc comment for why
 * `call_webhook` is absent from what the model is offered and validated
 * against. Reused unchanged from the single-action `create_automation` tool
 * this descriptor replaces.
 */
const createAction = agentCreateAutomationSchema.shape;

/**
 * `update`'s and `delete`'s actions vocabulary is UNRESTRICTED — the model
 * may set a `call_webhook` action on an update just as freely as the org-admin
 * guard in `updateAutomationCore` allows a human to. That guard (the very
 * thing `manage_automation` must not lose — see `updateAutomationCore`'s doc
 * comment) is what stands between an agent and that egress, not the schema.
 */
const updateAction = {
  action: z.literal("update"),
  id: z.string().uuid(),
  name: z.string().trim().max(120).optional(),
  enabled: z.boolean().optional(),
  trigger: automationTriggerSchema.optional(),
  actions: automationActionsSchema.optional(),
  condition: automationConditionSchema.nullish(),
};

const deleteAction = {
  action: z.literal("delete"),
  id: z.string().uuid(),
};

/**
 * `inputSchema`'s raw shape. `action` MUST be a `z.enum` — the board-scope
 * guard falls back to scope `"none"` for an action it does not recognise,
 * and `"none"` escapes board-scope narrowing entirely.
 */
const manageAutomationInput = {
  action: z.enum(["create", "update", "delete"]),
  boardId: createAction.boardId.optional(),
  name: z.string().trim().max(120).optional(),
  trigger: automationTriggerSchema.optional(),
  // The WIDER vocabulary at this raw-shape layer, deliberately: both
  // transports validate against `inputSchema` BEFORE `invoke` runs, so an
  // admin's legitimate `update` webhook edit must not be rejected here. The
  // actual narrowing for `create` — never offer `call_webhook` — is enforced
  // by `manageAutomationAction`'s create branch (built from `createAction`,
  // the NARROWED `agentCreateAutomationSchema.shape`) inside `invoke`.
  actions: automationActionsSchema.optional(),
  condition: automationConditionSchema.nullish(),
  id: z.string().uuid().optional(),
  enabled: z.boolean().optional(),
};

const manageAutomationAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), ...createAction }),
  z.object(updateAction),
  z.object(deleteAction),
]);

function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * `manage_automation` — the agent-only tool that files, edits or removes a
 * board automation rule. Replaces the single-action `create_automation` tool:
 * same reasoning (an automation is a standing, org-visible side effect that
 * belongs behind the agent's capability grant rather than a generic bearer
 * token — see `agent-only-tools.ts`), grown to the full rule lifecycle.
 *
 * All behaviour lives in `createAutomationCore` / `updateAutomationCore` /
 * `deleteAutomationCore` (`@/lib/boards/automation-core`), which the
 * `createAutomation` / `updateAutomation` / `deleteAutomation` Server Actions
 * call too, so this tool cannot drift from the human Save path.
 *
 * The ONE deliberate divergence, preserved from `create_automation`: `create`
 * never offers `call_webhook` (see `agentCreateAutomationSchema`'s doc
 * comment). `update` and `delete` are NOT narrowed the same way — the
 * org-admin gate inside `updateAutomationCore` is what decides a webhook
 * addition there, exactly as it does for a human clicking Save, and dropping
 * that check in this move would be the real regression, not narrowing the
 * schema further.
 */
export const manageAutomationDescriptor: ToolDescriptor = {
  name: "manage_automation",
  title: "Manage automation",
  description:
    "Create, update or delete a board automation — a rule that runs on its " +
    "own after you have gone. Call describe_schema for the trigger and " +
    "action vocabulary. Column, option, group and member ids must be copied " +
    "verbatim from a board you have already read. Rules take effect " +
    "immediately and fire for everyone on the board, so create or edit one " +
    "only when explicitly asked to.",
  inputSchema: manageAutomationInput,
  capability: {
    create: "automation.create",
    update: "automation.create",
    delete: "automation.create",
  },
  scope: { create: "boardId", update: "automationId", delete: "automationId" },
  invoke: async (ctx, raw): Promise<ToolResult> => {
    const parsed = parseAction(manageAutomationAction, raw);
    if (!parsed.ok) return parsed.result;

    const supabase = await ctx.getClient();

    switch (parsed.value.action) {
      case "create": {
        const { action: _action, ...input } = parsed.value;
        const result = await createAutomationCore(
          supabase,
          input as CreateAutomationCoreInput,
          ctx.actorId,
        );
        if (!result.ok) return errorResult(result.error);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: true, automationId: result.data.id }),
            },
          ],
        };
      }
      case "update": {
        const { action: _action, ...input } = parsed.value;
        const result = await updateAutomationCore(
          supabase,
          input as UpdateAutomationCoreInput,
          ctx.actorId,
        );
        if (!result.ok) return errorResult(result.error);
        return { content: [{ type: "text", text: '{"ok":true}' }] };
      }
      case "delete": {
        const { action: _action, ...input } = parsed.value;
        const result = await deleteAutomationCore(
          supabase,
          input as DeleteAutomationCoreInput,
        );
        if (!result.ok) return errorResult(result.error);
        return { content: [{ type: "text", text: '{"ok":true}' }] };
      }
    }
  },
};
