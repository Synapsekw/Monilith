import { createAutomationSchema } from "@/lib/validations/automations";
import {
  createAutomationCore,
  type CreateAutomationCoreInput,
} from "@/lib/boards/automation-core";
import type { ToolDescriptor } from "@/lib/mcp/tools/descriptor";
import type { ToolResult } from "@/lib/mcp/tools/shared";

/**
 * `.shape` of the app's OWN `createAutomationSchema`, not a hand-written
 * restatement: the model is shown exactly the trigger/action/condition
 * vocabulary the Automations dialog writes, and `createAutomationCore`
 * re-validates with the same `createAutomationSchema` regardless. Because
 * `createAutomationSchema` is a plain `z.object` (no object-level `.refine`/
 * `.superRefine`), `.shape` is a lossless `ZodRawShape` view of it — so this
 * cannot drift from the core's accepted schema the way a hand-copied field
 * list could.
 */
const createAutomationInput = createAutomationSchema.shape;

/**
 * `create_automation` — the agent-only tool that files a board automation rule.
 *
 * All behaviour lives in `createAutomationCore`, which the `createAutomation`
 * Server Action calls too, so this tool cannot drift from the UI path — most
 * importantly it inherits the guard that a `call_webhook` action requires an
 * org admin. The action itself is unreachable here: it is `"use server"`, bound
 * to `next/headers` cookies, while an agent run holds only its owner's bridged
 * client.
 */
export const createAutomationDescriptor: ToolDescriptor = {
  name: "create_automation",
  title: "Create automation",
  description:
    "Create an automation rule on a board: a trigger, one or more actions, " +
    "and an optional condition that gates them. Column, option, group and " +
    "member ids must be copied verbatim from a board you have already read — " +
    "they are not validated against names. `call_webhook` actions are " +
    "refused unless the agent's owner is an admin of the board's " +
    "organization. Rules take effect immediately and fire for everyone on " +
    "the board, so create one only when explicitly asked to.",
  inputSchema: createAutomationInput,
  capability: "automation.create",
  scope: "boardId",
  invoke: async (ctx, raw): Promise<ToolResult> => {
    // Validated against `inputSchema` by both transports before we get here;
    // the core re-parses anyway, which is what makes the cast safe.
    const input = raw as CreateAutomationCoreInput;
    const result = await createAutomationCore(
      await ctx.getClient(),
      input,
      ctx.actorId,
    );
    if (!result.ok)
      return { content: [{ type: "text", text: result.error }], isError: true };
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ok: true, automationId: result.data.id }),
        },
      ],
    };
  },
};
