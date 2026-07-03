import type { Tables } from "@/types/database.types";
import { formatDuration } from "@/lib/boards/time-format";

export type ActivityRow = Tables<"item_activities">;
export type Column = Tables<"columns">;
export type Member = { userId: string; fullName: string | null };

type Chip = { label: string; color: string };
type CellDisplay = Chip | string | null;

export type ActivityDescriptor =
  | { kind: "item_created" }
  | { kind: "item_deleted" }
  | { kind: "item_renamed"; from: string | null; to: string | null }
  | { kind: "item_moved" }
  | { kind: "update_added" }
  | {
      kind: "cell_changed";
      columnName: string;
      columnKind: Column["kind"] | "unknown";
      from: CellDisplay;
      to: CellDisplay;
    };

type StatusOption = { id: string; label: string; color: string };

function describeCell(
  kind: Column["kind"] | "unknown",
  column: Column | undefined,
  value: unknown,
  members: readonly Member[],
): CellDisplay {
  if (value === null || value === undefined) return null;
  switch (kind) {
    case "status": {
      const options =
        (column?.settings as { options?: StatusOption[] })?.options ?? [];
      const optionId = (value as { optionId?: string | null }).optionId ?? null;
      if (!optionId) return null;
      const opt = options.find((o) => o.id === optionId);
      return opt ? { label: opt.label, color: opt.color } : null;
    }
    case "dropdown": {
      const options =
        (column?.settings as { options?: StatusOption[] })?.options ?? [];
      const ids = (value as { optionIds?: string[] }).optionIds ?? [];
      if (ids.length === 0) return null;
      return ids
        .map((id) => options.find((o) => o.id === id)?.label ?? id)
        .join(", ");
    }
    case "people": {
      const ids = (value as { userIds?: string[] }).userIds ?? [];
      if (ids.length === 0) return null;
      return ids
        .map(
          (id) => members.find((m) => m.userId === id)?.fullName ?? "Someone",
        )
        .join(", ");
    }
    case "date": {
      const v = value as { date?: string };
      return v.date ?? null;
    }
    case "text": {
      const v = value as { text?: string };
      return v.text ?? null;
    }
    case "numbers": {
      const v = value as { n?: number };
      return v.n != null ? String(v.n) : null;
    }
    case "currency": {
      const v = value as { amount?: number };
      return v.amount != null ? String(v.amount) : null;
    }
    case "time_tracking": {
      // The only cell_values change a time-tracking column emits is an estimate
      // edit (timer/manual sessions live in time_entries); show it as a duration.
      const v = value as { estimateSeconds?: number };
      return v.estimateSeconds != null
        ? formatDuration(v.estimateSeconds)
        : null;
    }
    default:
      return null;
  }
}

export function resolveActivity(
  row: ActivityRow,
  columns: readonly Column[],
  members: readonly Member[],
): ActivityDescriptor {
  switch (row.action) {
    case "item_created":
      return { kind: "item_created" };
    case "item_deleted":
      return { kind: "item_deleted" };
    case "item_moved":
      return { kind: "item_moved" };
    case "update_added":
      return { kind: "update_added" };
    case "item_renamed":
      return {
        kind: "item_renamed",
        from: row.old_value === null ? null : String(row.old_value),
        to: row.new_value === null ? null : String(row.new_value),
      };
    case "cell_changed": {
      const column = columns.find((c) => c.id === row.column_id);
      const kind = column?.kind ?? "unknown";
      return {
        kind: "cell_changed",
        columnName: column?.name ?? "Field",
        columnKind: kind,
        from: describeCell(kind, column, row.old_value, members),
        to: describeCell(kind, column, row.new_value, members),
      };
    }
  }
}
