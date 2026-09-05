import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AutomationAction } from "@/lib/validations/automations";
import type { AutomationContext } from "@/lib/ai/automation-context";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import { validateChoice } from "./decide";
import { AUTOPILOT_TASKS, type AutopilotTask } from "./autopilot-config";
import { resolveAssistantName } from "@/lib/org/assistant-name";

export { AUTOPILOT_TASKS, type AutopilotTask };

/**
 * The bounded, REVERSIBLE housekeeping vocabulary the F14 Autopilot agent may
 * emit (spec §4.3 + the pinned E5 decision). Deliberately a SUBSET of the manual
 * action union AND of the F13 `ai_step` set: it EXCLUDES `set_option` (status is
 * a human judgement call, not autopilot housekeeping), `call_webhook`
 * (irreversible egress) and every destructive shape. The agent chooses parameters
 * within these; it can never invent an action outside the box.
 */
export const AUTOPILOT_ACTIONS = [
  "move_to_group",
  "notify",
  "set_percent",
] as const;
export type AutopilotAction = (typeof AUTOPILOT_ACTIONS)[number];

/** Which housekeeping task each sanctioned action serves (spec §4.3). A board
 *  agent's `config.tasks` toggles these on; the union of their actions is the
 *  `allow` set offered to the model, so a disabled task's tool never appears. */
const TASK_ACTIONS: Record<AutopilotTask, AutopilotAction[]> = {
  triage: ["move_to_group"],
  chase_overdue: ["notify"],
  goal_rollup: ["set_percent"],
};

/** Hard caps — bound worst-case token spend + latency (spec §4.1 #5 / §6). */
const MAX_ROUNDS = 4;
const MAX_ACTIONS = 12;

/**
 * The labels+ids the agent is allowed to see: the board's columns (option
 * labels/ids), groups, org members — plus the board's items (title + current
 * group only). Deliberately **no cell values** (E4 privacy parity, spec §11.5):
 * the confined applier matches raw ids, so the model only needs the vocabulary to
 * reference.
 */
export type AutopilotContext = AutomationContext & {
  boardId: string;
  items: { id: string; name: string; groupId: string | null }[];
};

/** One chosen action bound to the item it targets. The endpoint applies each of
 *  these ONLY through the confined `board_agent_apply` definer (spec §4.3). */
export type ChosenAutopilotAction = {
  itemId: string;
  action: AutomationAction;
};

export type AutopilotResult = {
  actions: ChosenAutopilotAction[];
  /** Human-readable reasons a candidate choice was dropped (never applied). */
  warnings: string[];
  usage: AiUsageTokens;
  /** The model actually used — reported to runAi so the ledger is truthful. */
  model: string;
};

/** `item_id` is required on every autopilot tool (unlike F13, the agent picks
 *  WHICH item to act on across the whole board). The remaining params mirror the
 *  F13 tool shapes so `validateChoice` re-validates them unchanged. */
const ITEM_PROP = {
  item_id: {
    type: "string" as const,
    description: "The id of the board item to act on (from context.items).",
  },
};

const TOOL_DEFS: Record<AutopilotAction, Anthropic.Tool> = {
  move_to_group: {
    name: "move_to_group",
    description:
      "Triage: move an item into one of the board's groups. Use only item ids and group ids from the context.",
    input_schema: {
      type: "object",
      properties: {
        ...ITEM_PROP,
        group_id: { type: "string", description: "A group id from context." },
      },
      required: ["item_id", "group_id"],
      additionalProperties: false,
    },
  },
  notify: {
    name: "notify",
    description:
      "Chase an overdue owner: notify the item's owner (via a people column) or a specific org member with a short comment. Use only ids from the context.",
    input_schema: {
      type: "object",
      properties: {
        ...ITEM_PROP,
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
      required: ["item_id", "recipient_kind"],
      additionalProperties: false,
    },
  },
  set_percent: {
    name: "set_percent",
    description:
      "Keep a goal rollup current: set a percent column on an item to a value 0-100. Use only a percent column id from the context.",
    input_schema: {
      type: "object",
      properties: {
        ...ITEM_PROP,
        column_id: {
          type: "string",
          description: "A percent column id from context.",
        },
        percent: { type: "integer", minimum: 0, maximum: 100 },
      },
      required: ["item_id", "column_id", "percent"],
      additionalProperties: false,
    },
  },
};

/** Union of the actions the enabled tasks unlock (defaults to all when empty). */
function allowedFor(tasks: readonly AutopilotTask[]): AutopilotAction[] {
  const active = tasks.length > 0 ? tasks : AUTOPILOT_TASKS;
  const set = new Set<AutopilotAction>();
  for (const t of active) for (const a of TASK_ACTIONS[t]) set.add(a);
  // Preserve the canonical AUTOPILOT_ACTIONS order for stable tool ordering.
  return AUTOPILOT_ACTIONS.filter((a) => set.has(a));
}

function systemPrompt(
  context: AutopilotContext,
  allow: readonly AutopilotAction[],
  assistantName: string,
): string {
  return [
    `You are ${assistantName}, a scheduled housekeeping agent for ONE board.`,
    "Take a SMALL, reversible set of housekeeping actions by calling the provided tools — one tool call per item you want to change. Do nothing to items that are already fine.",
    "You may reference ONLY the item ids, column ids, option ids, group ids, and member ids present in the CONTEXT below — never invent an id, and never act on an item that is not in context.items.",
    `You may take at most ${MAX_ACTIONS} actions in total. When there is nothing worth doing, reply with a short plain-text note and call no tools.`,
    `ENABLED ACTIONS: ${allow.join(", ")}`,
    `CONTEXT: ${JSON.stringify(context)}`,
  ].join("\n");
}

/**
 * Run the bounded F14 Autopilot loop: the model reads the labels+ids board
 * context and chooses a SMALL set of housekeeping actions from the enabled task
 * vocabulary. NO mutation happens here — each chosen action is referentially
 * validated (item on this board + `validateChoice` for the action params, the
 * SAME guardrail as F13) and returned for the confined applier
 * (`board_agent_apply`) to apply. The Anthropic client is DI'd for tests.
 */
export async function autopilotRun(args: {
  apiKey: string;
  /** The WIRE model id to run, resolved by runAi (`requestModel`). */
  model: string;
  agentContext: AutopilotContext;
  tasks: readonly AutopilotTask[];
  /**
   * What the ORG calls the assistant (`org_ai_settings.assistant_name`). The
   * bot authors comments and notifications under this name, so the prompt has
   * to introduce it by the same one — a run that signs off as "Monolith
   * Autopilot" under a profile the org renamed is the visible defect. Optional
   * so a caller with no org context still gets the product default rather than
   * an anonymous agent.
   */
  assistantName?: string;
  client?: Anthropic;
}): Promise<AutopilotResult> {
  const client = args.client ?? new Anthropic({ apiKey: args.apiKey });
  const context = args.agentContext;
  const allow = allowedFor(args.tasks);
  const tools = allow.map((a) => TOOL_DEFS[a]);
  const system = systemPrompt(
    context,
    allow,
    resolveAssistantName(args.assistantName),
  );
  const itemIds = new Set(context.items.map((i) => i.id));

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: "Do this board's housekeeping now." },
  ];
  const usage: AiUsageTokens = { inputTokens: 0, outputTokens: 0 };
  const warnings: string[] = [];
  const actions: ChosenAutopilotAction[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await client.messages.create({
      model: args.model,
      max_tokens: 1024,
      // MUST be explicit, and deliberately NOT the model's own shape: omitting
      // `thinking` on a Sonnet-tier model runs adaptive thinking at effort
      // "high", and max_tokens caps thinking PLUS the tool_use blocks. A
      // thinking block would consume this 1024-token budget, leaving no
      // tool_use — an autopilot run that silently does nothing.
      thinking: { type: "disabled" },
      system,
      tools,
      messages,
    });
    usage.inputTokens += res.usage.input_tokens;
    usage.outputTokens += res.usage.output_tokens;

    const toolBlocks = res.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (res.stop_reason !== "tool_use" || toolBlocks.length === 0) {
      // Model is done (declined / finished) — return what we have.
      return { actions, warnings, usage, model: args.model };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolBlocks) {
      const input = (block.input ?? {}) as Record<string, unknown>;

      if (actions.length >= MAX_ACTIONS) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          is_error: true,
          content: "Action cap reached — stop now.",
        });
        continue;
      }

      const itemId = input.item_id;
      if (typeof itemId !== "string" || !itemIds.has(itemId)) {
        const err = `item "${String(itemId)}" is not on this board`;
        warnings.push(err);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          is_error: true,
          content: `Rejected: ${err}. Use only ids from context.items.`,
        });
        continue;
      }

      // REUSE the F13 confinement validator for the action params (column/group/
      // member ids + the allow-set membership) — same guardrail, no duplication.
      const candidate = validateChoice(context, allow, block.name, input);
      if ("action" in candidate) {
        actions.push({ itemId, action: candidate.action });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: "Queued.",
        });
      } else {
        warnings.push(candidate.error);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          is_error: true,
          content: `Rejected: ${candidate.error}. Choose a valid id from the context or stop.`,
        });
      }
    }

    messages.push({ role: "assistant", content: res.content });
    messages.push({ role: "user", content: toolResults });
  }

  // Exhausted the round cap — return whatever was validated.
  return { actions, warnings, usage, model: args.model };
}
