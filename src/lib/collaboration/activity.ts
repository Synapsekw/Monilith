import type { Tables } from "@/types/database.types";
import { formatDuration } from "@/lib/boards/time-format";
import { stripMarkdown } from "@/lib/boards/markdown";

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

// Text columns hold Markdown up to 20,000 characters (see
// src/lib/boards/markdown.ts). This descriptor is consumed by two renderers
// that both need a short, syntax-free preview rather than the raw value:
// ActivityRow (renders `from`/`to` TWICE per row — a single long edit would
// otherwise dominate the whole feed) and the AI item-summary transcript
// builder (src/lib/ai/summarize/summarize.ts), which would otherwise burn
// tokens on raw `**`/`-` syntax. Stripping + truncating once here, at the
// resolver, fixes both call sites instead of relying on each view to remember
// to do it — a CSS clamp in just ActivityRow would still ship the full
// 20,000-character string into the DOM and leave the AI transcript unbounded.
const CELL_TEXT_PREVIEW_MAX = 120;

function previewText(text: string): string {
  const stripped = stripMarkdown(text);
  return stripped.length > CELL_TEXT_PREVIEW_MAX
    ? `${stripped.slice(0, CELL_TEXT_PREVIEW_MAX).trimEnd()}…`
    : stripped;
}

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
      if (!v.text) return null;
      const preview = previewText(v.text);
      return preview.length > 0 ? preview : null;
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
