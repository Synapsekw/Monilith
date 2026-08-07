import type { ColumnKind, ColumnOption } from "@/lib/validations/boards";
import { parseColumnOptions } from "@/lib/boards/column-options";

/** One column as `get_board` describes it to an MCP agent. */
export type ColumnDescription = {
  id: string;
  name: string;
  kind: ColumnKind;
  /** False when the kind stores no `cell_values` row — a write can never succeed. */
  writable: boolean;
  /** Shape for `fields[].value` in create_item / update_item; null when not writable. */
  valueShape: string | null;
  /** Constraint the bare shape cannot express, e.g. "integer 1-5". */
  note?: string;
  options?: ColumnOption[];
  settings?: Record<string, unknown>;
};

/**
 * The value shape each kind accepts, mirroring `cellValueSchema(kind)` in
 * `@/lib/validations/boards`. Kept honest by the anti-drift suite in
 * `column-meta.test.ts` — update both together or the tests fail.
 *
 * `null` marks a kind whose content does NOT live in `cell_values`:
 * `relation` derives from `relation_links`, `mirror` is a read-only rollup, and
 * `files` derives from `attachments` (write it with `attach_file`). Their
 * schemas are `z.object({}).strict()` and, per their own comments, exist only
 * to keep the switch exhaustive — they are never used by `upsertCell`.
 */
const VALUE_SHAPE: Record<ColumnKind, string | null> = {
  text: "{ text: string }",
  status: "{ optionId: string | null }",
  dropdown: "{ optionIds: string[] }",
  people: "{ userIds: string[] }",
  date: '{ date: "YYYY-MM-DD", end?: "YYYY-MM-DD" }',
  numbers: "{ n: number }",
  checkbox: "{ checked: boolean }",
  rating: "{ rating: number }",
  percent: "{ percent: number }",
  currency: "{ amount: number }",
  priority: '{ level: "normal" | "critical" }',
  link: "{ url: string, text?: string }",
  email: "{ email: string }",
  phone: "{ phone: string }",
  time_tracking: "{ estimateSeconds: number }",
  files: null,
  relation: null,
  mirror: null,
};

/**
 * Extra guidance emitted as a separate `note` where the bare shape
 * under-specifies what the schema enforces. Kept OUT of `valueShape` so the
 * anti-drift test can pin shapes exactly, without prose interfering.
 */
const SHAPE_NOTE: Partial<Record<ColumnKind, string>> = {
  text: "max 20000 characters",
  status: "optionId must be an id from this column's options[]",
  dropdown: "ids must come from this column's options[]",
  rating: "integer 1-5",
  percent: "0-100",
  link: "url must be http or https",
  phone: "1-40 characters",
  time_tracking: "positive integer seconds",
  files: "use the attach_file tool",
  relation: "derived from linked items; not writable here",
  mirror: "read-only rollup",
};

/**
 * Settings keys surfaced per kind. A deliberate ALLOW-LIST, not the raw jsonb:
 * only keys that change how a value must be written are public. Internal keys
 * (`summary_aggregation`, `dirham_sign`, mirror wiring) stay internal so this
 * tool's contract is not pinned to the DB jsonb shape.
 */
const SETTINGS_KEYS: Partial<Record<ColumnKind, readonly string[]>> = {
  currency: ["currency"],
  numbers: ["unit", "precision"],
  relation: ["target_board_id", "allow_multiple"],
};

export function describeColumn(col: {
  id: string;
  name: string;
  kind: ColumnKind;
  settings: unknown;
}): ColumnDescription {
  const shape = VALUE_SHAPE[col.kind];
  const options =
    col.kind === "status" || col.kind === "dropdown"
      ? parseColumnOptions(col.settings)
      : [];

  const raw =
    typeof col.settings === "object" && col.settings !== null
      ? (col.settings as Record<string, unknown>)
      : {};
  const picked: Record<string, unknown> = {};
  for (const key of SETTINGS_KEYS[col.kind] ?? []) {
    if (raw[key] !== undefined) picked[key] = raw[key];
  }

  const note = SHAPE_NOTE[col.kind];

  return {
    id: col.id,
    name: col.name,
    kind: col.kind,
    writable: shape !== null,
    valueShape: shape,
    ...(note ? { note } : {}),
    ...(options.length ? { options } : {}),
    ...(Object.keys(picked).length ? { settings: picked } : {}),
  };
}
