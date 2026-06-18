import type {
  AutomationAction,
  AutomationTrigger,
} from "@/lib/validations/automations";

/**
 * A not-yet-persisted automation. Mirrors {@link createAutomationSchema}'s
 * payload minus `boardId`, which the dialog supplies on submit.
 */
export type Draft = {
  name?: string;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
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
