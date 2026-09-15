import type { Draft } from "@/components/boards/automations/recipes";
import type { Action } from "./runs";

/** The least the mapper needs to decide: column kinds and who is a member.
 *  Deliberately not `BoardContext` — see the task note. */
export type RuleBoardMeta = {
  columns: readonly { id: string; kind: string }[];
  memberIds: readonly string[];
};

/**
 * A suggestion's one-off write, restated as the standing rule that would make
 * it unnecessary next time (spec §2.2).
 *
 * Pure: no React, no I/O — so every mapping is table-tested, and the button
 * that calls it decides whether to render by asking for a draft and checking
 * for null.
 *
 * `null` means "this action maps onto no engine primitive on THIS board" —
 * either the kind has no rule form (`set_due`, `filter`) or a column the draft
 * needs is missing. The caller renders no button.
 */
export function ruleDraftFor(
  action: Action,
  meta: RuleBoardMeta,
): Draft | null {
  const firstOfKind = (kind: string): string | null =>
    meta.columns.find((c) => c.kind === kind)?.id ?? null;
  const isKind = (id: string, kind: string): boolean =>
    meta.columns.some((c) => c.id === id && c.kind === kind);

  switch (action.type) {
    case "reassign": {
      // The column and the member both came from model output, so both are
      // re-checked against the board here — the same rule apply-time
      // validation follows, for the same reason.
      if (!isKind(action.columnId, "people")) return null;
      if (!meta.memberIds.includes(action.toUserId)) return null;
      return {
        trigger: { type: "item_created" },
        actions: [
          {
            type: "assign_person",
            columnId: action.columnId,
            userId: action.toUserId,
          },
        ],
      };
    }
    case "set_status": {
      const dateCol = firstOfKind("date");
      if (!dateCol) return null;
      // The target column came from model output, so re-check its kind against
      // the board — the engine only accepts status or dropdown columns for
      // set_option (20260704111500). If the column was converted to a different
      // kind after the suggestion was generated but before the user clicks
      // "Create rule", this guard prevents a broken rule from persisting.
      if (
        !isKind(action.columnId, "status") &&
        !isKind(action.columnId, "dropdown")
      )
        return null;
      return {
        trigger: { type: "date_reached", columnId: dateCol, offsetDays: 0 },
        actions: [
          {
            type: "set_option",
            columnId: action.columnId,
            optionId: action.optionId,
          },
        ],
      };
    }
    case "nudge": {
      const dateCol = firstOfKind("date");
      const peopleCol = firstOfKind("people");
      if (!dateCol || !peopleCol) return null;
      return {
        trigger: { type: "date_reached", columnId: dateCol, offsetDays: 0 },
        // `notify` has no message field. The card's one-off text does not
        // survive; the user sees the rule as it will actually fire before
        // saving it (spec §2.2).
        actions: [
          {
            type: "notify",
            recipient: { kind: "owner", peopleColumnId: peopleCol },
          },
        ],
      };
    }
    // `set_due` writes a date and the engine has no set-date action; `filter`
    // changes only what the reader is looking at. Neither is a rule.
    case "set_due":
    case "filter":
      return null;
  }
}
