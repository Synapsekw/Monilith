import { valueControlFor } from "@/lib/dashboards/filter-meta";
import type { CacheColumn } from "@/lib/boards/cache";
import type { ColumnOption } from "@/lib/validations/boards";
import type { FilterCondition } from "@/lib/validations/dashboards";
import type {
  AutomationAction,
  AutomationTrigger,
} from "@/lib/validations/automations";

export type BuilderMember = {
  userId: string;
  fullName: string | null;
  email: string | null;
};

export type BuilderGroup = { id: string; name: string };

/** Read the option list off a column's JSON settings (status/dropdown only). */
export function columnOptions(column: CacheColumn): ColumnOption[] {
  const settings = column.settings as { options?: ColumnOption[] } | null;
  return settings?.options ?? [];
}

export const selectClass =
  "bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm";

export const ANY = "__any__";
export const CONDITION_KINDS = ["status", "text", "numbers", "date"];
export type TriggerType = AutomationTrigger["type"];
export type DateDirection = "on" | "before" | "after";

export type DraftAction = AutomationAction & { _id: string };

let idCounter = 0;
export function nextId() {
  idCounter += 1;
  return `a${idCounter}`;
}
export function withIds(actions: AutomationAction[]): DraftAction[] {
  return actions.map((a) => ({ ...a, _id: nextId() }));
}
export function stripId(a: DraftAction): AutomationAction {
  const { _id, ...rest } = a;
  void _id;
  return rest;
}
export function isActionComplete(a: AutomationAction): boolean {
  if (a.type === "notify") {
    return a.recipient.kind === "owner"
      ? !!a.recipient.peopleColumnId
      : !!a.recipient.userId;
  }
  if (a.type === "call_webhook") {
    return /^https:\/\/.+/.test(a.url);
  }
  if (a.type === "set_option") {
    return !!a.columnId && !!a.optionId;
  }
  if (a.type === "move_to_group") {
    return !!a.groupId;
  }
  if (a.type === "set_percent") {
    return !!a.columnId && a.percent >= 0 && a.percent <= 100;
  }
  return false;
}
export function memberLabel(m: BuilderMember): string {
  return m.fullName ?? m.email ?? m.userId;
}
export function isConditionComplete(c: FilterCondition, kind: string): boolean {
  if (valueControlFor(kind, c.operator) === "none") return true;
  return c.value !== undefined && c.value !== null && `${c.value}` !== "";
}
