import type { ColumnKind, ColumnOption } from "@/lib/validations/boards";

/**
 * The board facts an NL-automation generator is allowed to see: column labels +
 * ids (+ option labels/ids for status/dropdown), group labels + ids, and member
 * names + ids. Deliberately **labels and ids only — never cell values**: the
 * engine matches raw ids, so the model only needs the vocabulary to reference,
 * and shipping row data would be a needless egress. `buildAutomationContext`
 * enforces the projection.
 */
export type AutomationContext = {
  columns: {
    id: string;
    name: string;
    kind: string;
    options: { id: string; label: string }[];
  }[];
  groups: { id: string; name: string }[];
  members: { id: string; name: string }[];
};

/** Minimal column shape accepted from a board payload (Tables<"columns">). */
type ColumnLike = {
  id: string;
  name: string;
  kind: ColumnKind | string;
  settings: unknown;
};

type GroupLike = { id: string; name: string };
type MemberLike = {
  userId: string;
  fullName: string | null;
  email: string | null;
};

/** status/dropdown carry an option list under `settings.options`. */
function readOptions(settings: unknown): { id: string; label: string }[] {
  const opts = (settings as { options?: ColumnOption[] } | null)?.options;
  if (!Array.isArray(opts)) return [];
  // Project to id + label only — drop color and any other settings keys.
  return opts.map((o) => ({ id: o.id, label: o.label }));
}

/**
 * Build the labels-and-ids-only context handed to the automation generator.
 * NO cell values ever cross this boundary — the projection here is the security
 * guarantee (asserted in the test).
 */
export function buildAutomationContext(input: {
  columns: ColumnLike[];
  groups: GroupLike[];
  members: MemberLike[];
}): AutomationContext {
  return {
    columns: input.columns.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      options: readOptions(c.settings),
    })),
    groups: input.groups.map((g) => ({ id: g.id, name: g.name })),
    members: input.members.map((m) => ({
      id: m.userId,
      name: m.fullName ?? m.email ?? m.userId,
    })),
  };
}
