import type {
  AutomationAction,
  AutomationTrigger,
} from "@/lib/validations/automations";
import type { ListFilter } from "@/lib/validations/dashboards";

/**
 * A not-yet-persisted automation. Mirrors {@link createAutomationSchema}'s
 * payload minus `boardId`, which the dialog supplies on submit.
 */
export type Draft = {
  name?: string;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  condition?: ListFilter | null;
};

/**
 * "When status changes (to X), notify the item owner."
 * `optionId === null` means the trigger fires on any value change.
 */
export function recipeNotifyOwner(
  statusColumnId: string,
  optionId: string | null,
  peopleColumnId: string,
): Draft {
  return {
    trigger: {
      type: "status_changed",
      columnId: statusColumnId,
      toOptionId: optionId,
    },
    actions: [{ type: "notify", recipient: { kind: "owner", peopleColumnId } }],
  };
}

/**
 * "When status changes (to X), set another status/dropdown column to Y."
 * `fromOptionId === null` means the trigger fires on any value change.
 */
export function recipeSetOption(
  statusColumnId: string,
  fromOptionId: string | null,
  targetColumnId: string,
  toOptionId: string,
): Draft {
  return {
    trigger: {
      type: "status_changed",
      columnId: statusColumnId,
      toOptionId: fromOptionId,
    },
    actions: [
      { type: "set_option", columnId: targetColumnId, optionId: toOptionId },
    ],
  };
}

/** "When an item is created, set a status/dropdown column to Y." */
export function recipeItemCreatedSetOption(
  targetColumnId: string,
  toOptionId: string,
): Draft {
  return {
    trigger: { type: "item_created" },
    actions: [
      { type: "set_option", columnId: targetColumnId, optionId: toOptionId },
    ],
  };
}

/** "When someone is assigned in a People column, notify them (first assignee)." */
export function recipePersonAssignedNotify(peopleColumnId: string): Draft {
  return {
    trigger: { type: "person_assigned", columnId: peopleColumnId },
    actions: [{ type: "notify", recipient: { kind: "owner", peopleColumnId } }],
  };
}

/**
 * "When a date column is reached (offsetDays = 0), set a status/dropdown column to Y."
 * Requires a date column and a status/dropdown column.
 */
export function recipeDateReachedSetOption(
  dateColumnId: string,
  targetColumnId: string,
  toOptionId: string,
): Draft {
  return {
    trigger: { type: "date_reached", columnId: dateColumnId, offsetDays: 0 },
    actions: [
      { type: "set_option", columnId: targetColumnId, optionId: toOptionId },
    ],
  };
}

/** "When status changes (to X), POST to a webhook." optionId null = any change. */
export function recipeStatusChangedWebhook(
  statusColumnId: string,
  optionId: string | null,
  url: string,
): Draft {
  return {
    trigger: {
      type: "status_changed",
      columnId: statusColumnId,
      toOptionId: optionId,
    },
    actions: [{ type: "call_webhook", url }],
  };
}

/**
 * "X days before a date column is reached, notify the item owner."
 * `daysBefore` is the number of days before (stored as a negative offset).
 */
export function recipeDueSoonNotifyOwner(
  dateColumnId: string,
  peopleColumnId: string,
  daysBefore = 3,
): Draft {
  return {
    trigger: {
      type: "date_reached",
      columnId: dateColumnId,
      offsetDays: -Math.abs(daysBefore),
    },
    actions: [{ type: "notify", recipient: { kind: "owner", peopleColumnId } }],
  };
}

/**
 * "When status changes to Done, set a percent column to 100%."
 * One half of the Completed <-> 100% two-way sync; the engine's
 * skipped_equal idempotence terminates the loop at depth 2.
 */
export function recipeCompletedSetsPercent(
  statusColumnId: string,
  doneOptionId: string,
  percentColumnId: string,
): Draft {
  return {
    name: "Completed sets 100%",
    trigger: {
      type: "status_changed",
      columnId: statusColumnId,
      toOptionId: doneOptionId,
    },
    actions: [{ type: "set_percent", columnId: percentColumnId, percent: 100 }],
  };
}

/**
 * "When a percent column reaches 100%, set status to Done."
 * The percent_reached trigger only fires on threshold-crossing writes,
 * so a 100 -> 100 rewrite never re-fires this rule.
 */
export function recipePercentSetsCompleted(
  percentColumnId: string,
  statusColumnId: string,
  doneOptionId: string,
): Draft {
  return {
    name: "100% sets Completed",
    trigger: {
      type: "percent_reached",
      columnId: percentColumnId,
      percent: 100,
    },
    actions: [
      { type: "set_option", columnId: statusColumnId, optionId: doneOptionId },
    ],
  };
}
