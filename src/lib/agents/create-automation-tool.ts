import { agentCreateAutomationSchema } from "@/lib/validations/automations";
import {
  createAutomationCore,
  type CreateAutomationCoreInput,
} from "@/lib/boards/automation-core";
import type { ToolDescriptor } from "@/lib/mcp/tools/descriptor";
import type { ToolResult } from "@/lib/mcp/tools/shared";

/**
 * `.shape` of the app's OWN `agentCreateAutomationSchema`, not a hand-written
 * restatement: the model is shown the trigger/action/condition vocabulary the
 * Automations dialog writes, MINUS `call_webhook` (see
 * `AGENT_FORBIDDEN_AUTOMATION_ACTIONS`). Because both schemas are plain
 * `z.object`s (no object-level `.refine`/`.superRefine`), `.shape` is a
 * lossless `ZodRawShape` view — so this cannot drift from the vocabulary it
 * narrows the way a hand-copied field list could.
 *
 * THE ORDERING TRAP, stated plainly: `createAutomationCore` re-parses with the
 * FULL `createAutomationSchema`, because it is shared with the human Save path
 * where an org admin may legitimately file a webhook rule. The core is
 * therefore NOT what keeps `call_webhook` away from the model. This shape is —
 * it is both what the tool advertises (so the action is never offered) and what
 * both transports validate against (so a call naming it is refused before the
 * core ever sees it).
 */
const createAutomationInput = agentCreateAutomationSchema.shape;

/**
 * `create_automation` — the agent-only tool that files a board automation rule.
 *
 * All behaviour lives in `createAutomationCore`, which the `createAutomation`
 * Server Action calls too, so this tool cannot drift from the UI path. The
 * action itself is unreachable here: it is `"use server"`, bound to
 * `next/headers` cookies, while an agent run holds only its owner's bridged
 * client.
 *
 * The ONE deliberate divergence from that path is the input schema: an agent is
 * never offered `call_webhook`. The core's org-admin guard on that action was
 * written for a human clicking Save, and an agent's owner is very often an org
 * admin — so under prompt injection that guard admits attacker-chosen egress.
 * See `AGENT_FORBIDDEN_AUTOMATION_ACTIONS`.
 */
export const createAutomationDescriptor: ToolDescriptor = {
  name: "create_automation",
  title: "Create automation",
  description:
    "Create an automation rule on a board: a trigger, one or more actions, " +
    "and an optional condition that gates them. Column, option, group and " +
    "member ids must be copied verbatim from a board you have already read — " +
    "they are not validated against names. Outbound webhook actions are not " +
    "available to agents at all; a person must add those by hand. Rules take " +
    "effect immediately and fire for everyone on the board, so create one " +
    "only when explicitly asked to.",
  inputSchema: createAutomationInput,
  capability: "automation.create",
  scope: "boardId",
  invoke: async (ctx, raw): Promise<ToolResult> => {
    // PARSED here, not cast. Every other descriptor casts because both
    // transports validate against `inputSchema` first and the handler's own
    // core re-parses — but this handler's core re-parses with the WIDER
    // `createAutomationSchema` (it serves the human path too). Casting would
    // therefore make the whole `call_webhook` exclusion a property of the
    // transports alone, and any future in-process caller of `invoke` would
    // slip straight past it. Parsing here makes the narrow schema the tool's
    // own boundary.
    const parsed = agentCreateAutomationSchema.safeParse(raw);
    if (!parsed.success)
      return {
        content: [
          {
            type: "text",
            text: parsed.error.issues[0]?.message ?? "Invalid automation.",
          },
        ],
        isError: true,
      };
    const input: CreateAutomationCoreInput = parsed.data;
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
