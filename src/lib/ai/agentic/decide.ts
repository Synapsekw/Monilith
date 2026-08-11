import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import {
  automationActionSchema,
  type AutomationAction,
  type AiStepAllowedAction,
} from "@/lib/validations/automations";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import type { AutomationContext } from "@/lib/ai/automation-context";
import type { AgenticContext } from "./context";

/** Hard cap on tool-use rounds — bounds worst-case token spend + latency
 *  (spec §4.1 #5). Mirrors askPulseStream/proposeLoop's MAX_ROUNDS discipline. */
const MAX_ROUNDS = 3;

export type DecideResult = {
  /** The single bounded, referentially-valid action the model chose, or null. */
  action: AutomationAction | null;
  /** Human-readable reasons a candidate choice was dropped (never applied). */
  warnings: string[];
  usage: AiUsageTokens;
  /** The model actually used — reported to runAi so the ledger is truthful. */
  model: string;
};

/** One Anthropic tool per action kind, gated to the rule author's `allow` set. */
const TOOL_DEFS: Record<AiStepAllowedAction, Anthropic.Tool> = {
  set_option: {
    name: "set_option",
    description:
      "Set a status/dropdown column on the item to one of its options. Use only column ids and option ids present in the provided context.",
    input_schema: {
      type: "object",
      properties: {
        column_id: {
          type: "string",
          description: "A status/dropdown column id from context.",
        },
        option_id: {
          type: "string",
          description: "An option id belonging to that column.",
        },
      },
      required: ["column_id", "option_id"],
      additionalProperties: false,
    },
  },
  set_percent: {
    name: "set_percent",
    description:
      "Set a percent column on the item to a value 0-100. Use only a percent column id from the context.",
    input_schema: {
      type: "object",
      properties: {
        column_id: {
          type: "string",
          description: "A percent column id from context.",
        },
        percent: { type: "integer", minimum: 0, maximum: 100 },
      },
      required: ["column_id", "percent"],
      additionalProperties: false,
    },
  },
  move_to_group: {
    name: "move_to_group",
    description:
      "Move the item into one of the board's groups. Use only a group id from the context.",
    input_schema: {
      type: "object",
      properties: {
        group_id: { type: "string", description: "A group id from context." },
      },
      required: ["group_id"],
      additionalProperties: false,
    },
  },
  notify: {
    name: "notify",
    description:
      "Notify the item's owner (via a people column) or a specific org member. Use only ids from the context.",
    input_schema: {
      type: "object",
      properties: {
        recipient_kind: { type: "string", enum: ["owner", "member"] },
        people_column_id: {
          type: "string",
          description:
            "Required when recipient_kind=owner: a people column id from context.",
        },
        user_id: {
          type: "string",
          description:
            "Required when recipient_kind=member: a member id from context.",
        },
      },
      required: ["recipient_kind"],
      additionalProperties: false,
    },
  },
};

function systemPrompt(context: AgenticContext, instruction: string): string {
  return [
    "You are an automation step. Choose EXACTLY ONE bounded action to apply to the item, by calling one of the provided tools.",
    "You may reference ONLY the column ids, option ids, group ids, and member ids present in the CONTEXT below — never invent an id.",
    "If no action is appropriate or you cannot resolve a valid id, do NOT call a tool — reply with a short plain-text explanation instead.",
    `INSTRUCTION: ${instruction}`,
    `CONTEXT: ${JSON.stringify(context)}`,
  ].join("\n");
}

export type Candidate = { action: AutomationAction } | { error: string };

/**
 * Referentially re-validate the model's chosen tool call against the context and
 * the `allow` set. This is the guardrail (spec §4.1 #2/#3): the model only
 * *chooses*; a choice with a foreign column/option/group/member id, or a type
 * outside `allow`, is dropped here and never reaches the confined executor.
 *
 * Exported so the F14 Autopilot loop (`autopilot.ts`) reuses the SAME confinement
 * validator — a chosen action with a foreign column/group/member id, or a type
 * outside the agent's `allow` set, is dropped there too (spec §4.3, DRY guardrail).
 */
export function validateChoice(
  // Only the columns/groups/members vocabulary is read here, so the base
  // AutomationContext is enough — the F14 loop passes its own multi-item context.
  context: AutomationContext,
  allow: readonly AiStepAllowedAction[],
  name: string,
  input: Record<string, unknown>,
): Candidate {
  if (!allow.includes(name as AiStepAllowedAction)) {
    return { error: `action "${name}" is not in the allowed set` };
  }
  const column = (id: unknown) => context.columns.find((c) => c.id === id);

  let draft: unknown;
  switch (name) {
    case "set_option": {
      const col = column(input.column_id);
      if (!col || (col.kind !== "status" && col.kind !== "dropdown"))
        return {
          error: `column "${input.column_id}" is not a valid status/dropdown column`,
        };
      if (!col.options.some((o) => o.id === input.option_id))
        return {
          error: `option "${input.option_id}" is not on column "${col.name}"`,
        };
      draft = {
        type: "set_option",
        columnId: input.column_id,
        optionId: input.option_id,
      };
      break;
    }
    case "set_percent": {
      const col = column(input.column_id);
      if (!col || col.kind !== "percent")
        return {
          error: `column "${input.column_id}" is not a valid percent column`,
        };
      draft = {
        type: "set_percent",
        columnId: input.column_id,
        percent: input.percent,
      };
      break;
    }
    case "move_to_group": {
      if (!context.groups.some((g) => g.id === input.group_id))
        return { error: `group "${input.group_id}" is not on this board` };
      draft = { type: "move_to_group", groupId: input.group_id };
      break;
    }
    case "notify": {
      if (input.recipient_kind === "owner") {
        const col = column(input.people_column_id);
        if (!col || col.kind !== "people")
          return {
            error: `people column "${input.people_column_id}" is not valid`,
          };
        draft = {
          type: "notify",
          recipient: { kind: "owner", peopleColumnId: input.people_column_id },
        };
      } else if (input.recipient_kind === "member") {
        if (!context.members.some((m) => m.id === input.user_id))
          return { error: `member "${input.user_id}" is not in this org` };
        draft = {
          type: "notify",
          recipient: { kind: "member", userId: input.user_id },
        };
      } else {
        return { error: "notify requires recipient_kind owner|member" };
      }
      break;
    }
    default:
      return { error: `unknown tool "${name}"` };
  }

  // Final shape gate against the canonical Zod schema — the choice must be a
  // legal AutomationAction or it never leaves this function.
  const parsed = automationActionSchema.safeParse(draft);
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? "invalid action" };
  return { action: parsed.data };
}

/**
 * Run the bounded F13 decision loop: the model reads the labels+ids context and
 * chooses ONE action from the `allow`ed tool set. NO mutation happens here — the
 * chosen action is referentially validated and returned for the confined
 * executor (`automation_ai_apply`) to apply. The Anthropic client is DI'd for
 * tests. When the model stops without a valid choice, `action` is null.
 */
export async function decideAction(args: {
  apiKey: string;
  /** The WIRE model id to run, resolved by runAi (`requestModel`). */
  model: string;
  context: AgenticContext;
  instruction: string;
  allow: readonly AiStepAllowedAction[];
  client?: Anthropic;
}): Promise<DecideResult> {
  const client = args.client ?? new Anthropic({ apiKey: args.apiKey });
  const tools = args.allow.map((a) => TOOL_DEFS[a]);
  const system = systemPrompt(args.context, args.instruction);
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: "Decide the single action to apply now." },
  ];
  const usage: AiUsageTokens = { inputTokens: 0, outputTokens: 0 };
  const warnings: string[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await client.messages.create({
      model: args.model,
      max_tokens: 1024,
      // MUST be explicit, and deliberately NOT the model's own shape: omitting
      // `thinking` on a Sonnet-tier model runs adaptive thinking at effort
      // "high", and max_tokens caps thinking PLUS the tool_use block. A
      // thinking block would consume this 1024-token budget, leaving no
      // tool_use — and a step that silently does nothing.
      thinking: { type: "disabled" },
      system,
      tools,
      messages,
    });
    usage.inputTokens += res.usage.input_tokens;
    usage.outputTokens += res.usage.output_tokens;

    const toolBlock = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (res.stop_reason !== "tool_use" || !toolBlock) {
      // Model declined to act (or produced no tool call) — no action.
      return { action: null, warnings, usage, model: args.model };
    }

    const candidate = validateChoice(
      args.context,
      args.allow,
      toolBlock.name,
      (toolBlock.input ?? {}) as Record<string, unknown>,
    );
    if ("action" in candidate)
      return { action: candidate.action, warnings, usage, model: args.model };

    // Invalid choice: record it, feed the rejection back, let the model retry.
    warnings.push(candidate.error);
    messages.push({ role: "assistant", content: res.content });
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolBlock.id,
          is_error: true,
          content: `Rejected: ${candidate.error}. Choose a valid id from the context or stop.`,
        },
      ],
    });
  }

  // Exhausted the round cap without a valid choice.
  return { action: null, warnings, usage, model: args.model };
}
