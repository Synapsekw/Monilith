import {
  automationTriggerSchema,
  automationActionsSchema,
} from "@/lib/validations/automations";
import { z } from "zod";
import type {
  AutomationAction,
  AutomationTrigger,
} from "@/lib/validations/automations";
import type { Draft } from "@/components/boards/automations/recipes";
import type { AutomationContext } from "@/lib/ai/automation-context";

// ---------------------------------------------------------------------------
// JSON schema handed to the model (output_config.format).
//
// CRITICAL (same lesson as proposal-schema.ts): under strict structured output
// the model obeys THIS schema, not the prose. So each trigger/action variant is
// fully specified via `oneOf` with the discriminating field REQUIRED. ids are
// plain strings the model copies verbatim from the supplied context; the
// referential check lives in validateAutomationDraft().
//
// `call_webhook` is intentionally ABSENT from the action union: the AI may not
// mint webhook actions in v1 (admin-gated, manual). If one somehow appears it is
// dropped-with-warning by the validator.
// ---------------------------------------------------------------------------

const TRIGGER_SCHEMA = {
  oneOf: [
    {
      type: "object",
      required: ["type", "columnId"],
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["status_changed"] },
        columnId: { type: "string" },
        // Omit to fire on ANY value change; else copy an option id from the column.
        toOptionId: { type: "string" },
      },
    },
    {
      type: "object",
      required: ["type"],
      additionalProperties: false,
      properties: { type: { type: "string", enum: ["item_created"] } },
    },
    {
      type: "object",
      required: ["type", "columnId"],
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["person_assigned"] },
        columnId: { type: "string" },
      },
    },
    {
      type: "object",
      required: ["type", "columnId", "offsetDays"],
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["date_reached"] },
        columnId: { type: "string" },
        offsetDays: { type: "integer", minimum: -365, maximum: 365 },
      },
    },
    {
      type: "object",
      required: ["type", "columnId"],
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["percent_reached"] },
        columnId: { type: "string" },
        percent: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  ],
} as const;

const ACTION_SCHEMA = {
  oneOf: [
    {
      type: "object",
      required: ["type", "recipient"],
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["notify"] },
        recipient: {
          oneOf: [
            {
              type: "object",
              required: ["kind", "peopleColumnId"],
              additionalProperties: false,
              properties: {
                kind: { type: "string", enum: ["owner"] },
                peopleColumnId: { type: "string" },
              },
            },
            {
              type: "object",
              required: ["kind", "userId"],
              additionalProperties: false,
              properties: {
                kind: { type: "string", enum: ["member"] },
                userId: { type: "string" },
              },
            },
          ],
        },
      },
    },
    {
      type: "object",
      required: ["type", "columnId", "optionId"],
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["set_option"] },
        columnId: { type: "string" },
        optionId: { type: "string" },
      },
    },
    {
      type: "object",
      required: ["type", "columnId", "percent"],
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["set_percent"] },
        columnId: { type: "string" },
        percent: { type: "integer", minimum: 0, maximum: 100 },
      },
    },
    {
      type: "object",
      required: ["type", "groupId"],
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["move_to_group"] },
        groupId: { type: "string" },
      },
    },
  ],
} as const;

export const AUTOMATION_DRAFT_JSON_SCHEMA = {
  type: "object",
  required: ["trigger", "actions"],
  additionalProperties: false,
  properties: {
    name: { type: "string", maxLength: 120 },
    trigger: TRIGGER_SCHEMA,
    actions: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: ACTION_SCHEMA,
    },
  },
} as const;

/** The raw (unvalidated) draft the model emits — a superset of {@link Draft}. */
export type RawAutomationDraft = {
  name?: string;
  trigger?: Record<string, unknown>;
  actions?: Record<string, unknown>[];
};

type ContextIndex = {
  /** status | dropdown columns keyed by id → their option ids. */
  optionColumns: Map<string, Set<string>>;
  peopleColumns: Set<string>;
  dateColumns: Set<string>;
  percentColumns: Set<string>;
  groups: Set<string>;
  members: Set<string>;
};

function indexContext(ctx: AutomationContext): ContextIndex {
  const optionColumns = new Map<string, Set<string>>();
  const peopleColumns = new Set<string>();
  const dateColumns = new Set<string>();
  const percentColumns = new Set<string>();
  for (const c of ctx.columns) {
    if (c.kind === "status" || c.kind === "dropdown") {
      optionColumns.set(c.id, new Set(c.options.map((o) => o.id)));
    } else if (c.kind === "people") {
      peopleColumns.add(c.id);
    } else if (c.kind === "date") {
      dateColumns.add(c.id);
    } else if (c.kind === "percent") {
      percentColumns.add(c.id);
    }
  }
  return {
    optionColumns,
    peopleColumns,
    dateColumns,
    percentColumns,
    groups: new Set(ctx.groups.map((g) => g.id)),
    members: new Set(ctx.members.map((m) => m.id)),
  };
}

/** Referentially validate a raw trigger against the context; null → unusable. */
function validateTrigger(
  raw: Record<string, unknown> | undefined,
  idx: ContextIndex,
  warn: (m: string) => void,
): AutomationTrigger | null {
  const type = raw?.type;
  if (type === "item_created") return { type: "item_created" };

  if (type === "status_changed") {
    const columnId = String(raw?.columnId ?? "");
    const options = idx.optionColumns.get(columnId);
    if (!options) {
      warn("Dropped trigger: status column not found on this board.");
      return null;
    }
    const rawOpt = raw?.toOptionId;
    let toOptionId: string | null = null;
    if (typeof rawOpt === "string" && rawOpt !== "") {
      if (options.has(rawOpt)) toOptionId = rawOpt;
      else warn("Ignored an unknown status value — firing on any change.");
    }
    return { type: "status_changed", columnId, toOptionId };
  }

  if (type === "person_assigned") {
    const columnId = String(raw?.columnId ?? "");
    if (!idx.peopleColumns.has(columnId)) {
      warn("Dropped trigger: people column not found on this board.");
      return null;
    }
    return { type: "person_assigned", columnId };
  }

  if (type === "date_reached") {
    const columnId = String(raw?.columnId ?? "");
    if (!idx.dateColumns.has(columnId)) {
      warn("Dropped trigger: date column not found on this board.");
      return null;
    }
    const offsetDays = Number(raw?.offsetDays ?? 0);
    return { type: "date_reached", columnId, offsetDays };
  }

  if (type === "percent_reached") {
    const columnId = String(raw?.columnId ?? "");
    if (!idx.percentColumns.has(columnId)) {
      warn("Dropped trigger: percent column not found on this board.");
      return null;
    }
    const percent = Number(raw?.percent ?? 100);
    return { type: "percent_reached", columnId, percent };
  }

  warn("Dropped trigger: unknown trigger type.");
  return null;
}

/** Referentially validate a raw action; null → drop it (keep the rest). */
function validateAction(
  raw: Record<string, unknown>,
  idx: ContextIndex,
  warn: (m: string) => void,
): AutomationAction | null {
  const type = raw?.type;

  if (type === "call_webhook") {
    warn(
      "Dropped a webhook action — the AI can't create webhooks (add it manually).",
    );
    return null;
  }

  if (type === "notify") {
    const recipient = raw?.recipient as Record<string, unknown> | undefined;
    if (recipient?.kind === "owner") {
      const peopleColumnId = String(recipient?.peopleColumnId ?? "");
      if (!idx.peopleColumns.has(peopleColumnId)) {
        warn("Dropped notify: people column not found.");
        return null;
      }
      return { type: "notify", recipient: { kind: "owner", peopleColumnId } };
    }
    if (recipient?.kind === "member") {
      const userId = String(recipient?.userId ?? "");
      if (!idx.members.has(userId)) {
        warn("Dropped notify: member not found on this board.");
        return null;
      }
      return { type: "notify", recipient: { kind: "member", userId } };
    }
    warn("Dropped notify: invalid recipient.");
    return null;
  }

  if (type === "set_option") {
    const columnId = String(raw?.columnId ?? "");
    const optionId = String(raw?.optionId ?? "");
    const options = idx.optionColumns.get(columnId);
    if (!options) {
      warn("Dropped set-column: target column not found.");
      return null;
    }
    if (!options.has(optionId)) {
      warn("Dropped set-column: unknown option for that column.");
      return null;
    }
    return { type: "set_option", columnId, optionId };
  }

  if (type === "set_percent") {
    const columnId = String(raw?.columnId ?? "");
    if (!idx.percentColumns.has(columnId)) {
      warn("Dropped set-percent: percent column not found.");
      return null;
    }
    const percent = Number(raw?.percent ?? 0);
    return { type: "set_percent", columnId, percent };
  }

  if (type === "move_to_group") {
    const groupId = String(raw?.groupId ?? "");
    if (!idx.groups.has(groupId)) {
      warn("Dropped move-to-group: group not found on this board.");
      return null;
    }
    return { type: "move_to_group", groupId };
  }

  warn(`Dropped an action with unknown type "${String(type)}".`);
  return null;
}

/** Structural gate reusing the canonical schemas — mirrors createAutomationSchema minus boardId. */
const draftStructuralSchema = z.object({
  name: z.string().trim().max(120).optional(),
  trigger: automationTriggerSchema,
  actions: automationActionsSchema,
});

/**
 * Referentially validate + repair a model-emitted automation draft against the
 * board context: every referenced id must exist on the board (the engine matches
 * raw ids — there is no name→id resolver). Invalid actions are dropped and the
 * rest kept; if the trigger is unusable or zero actions survive the draft is
 * `null`. A final canonical-schema parse is the format gate.
 */
export function validateAutomationDraft(
  raw: RawAutomationDraft | null | undefined,
  ctx: AutomationContext,
): { draft: Draft | null; warnings: string[] } {
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);
  const idx = indexContext(ctx);

  const trigger = validateTrigger(raw?.trigger, idx, warn);
  if (!trigger) return { draft: null, warnings };

  const actions: AutomationAction[] = [];
  for (const a of raw?.actions ?? []) {
    const v = validateAction(a, idx, warn);
    if (v) actions.push(v);
  }
  if (actions.length === 0) {
    warn("No usable actions — couldn't build an automation.");
    return { draft: null, warnings };
  }

  const name =
    typeof raw?.name === "string" && raw.name.trim()
      ? raw.name.trim().slice(0, 120)
      : undefined;

  const parsed = draftStructuralSchema.safeParse({ name, trigger, actions });
  if (!parsed.success) {
    warn(parsed.error.issues[0]?.message ?? "Invalid automation.");
    return { draft: null, warnings };
  }

  return {
    draft: { ...parsed.data, condition: null },
    warnings,
  };
}
