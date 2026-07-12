import {
  columnKindSchema,
  columnSettingsSchema,
  cellValueSchema,
  type ColumnKind,
} from "@/lib/validations/boards";
import { COLUMN_KIND_META } from "@/lib/boards/column-kinds";
import { GROUP_COLORS } from "@/lib/boards/group-colors";
import { OPTION_COLORS } from "@/lib/boards/option-colors";
import type { TemplatePayload } from "@/lib/boards/template-payload";
import type { Json } from "@/types/database.types";

/**
 * F10 — AI board generation. The model emits a proposed board using TEMPORARY
 * string ids ("g1", "col-2", …) and references options by their label; the
 * validator mints real uuids, remaps every reference, drops/repairs anything
 * that fails the canonical board Zod schemas, and returns a ready-to-persist
 * `TemplatePayload`. Mirrors `proposal-schema.ts` (dashboard-gen).
 */

const MAX_GROUPS = 8;
const MAX_COLUMNS = 20;
const MAX_ITEMS = 60;
const MAX_OPTIONS = 20;

const ALL_KINDS = columnKindSchema.options;

// Kinds the model may never emit for a brand-new board: relation/mirror need a
// target board/column that does not exist yet. Everything else can be seeded.
const UNSUPPORTED_KINDS = new Set<ColumnKind>(["relation", "mirror"]);

export type BoardProposal = {
  name: string;
  groups: { tempId: string; name: string; color?: string }[];
  columns: {
    tempId: string;
    name: string;
    kind: string;
    options?: { label: string; color?: string }[];
  }[];
  items: {
    groupTempId: string;
    name: string;
    cells: { columnTempId: string; value: Record<string, unknown> }[];
  }[];
};

export type ValidatedBoardProposal = {
  name: string;
  templatePayload: TemplatePayload;
  summary: {
    groups: number;
    columns: { name: string; kind: string }[];
    items: number;
  };
  warnings: string[];
};

// JSON schema handed to the model (output_config.format). Discriminating fields
// are REQUIRED so the model can't emit empty configs (see proposal-schema.ts for
// why this matters under strict structured output). Cell `value` is a free-form
// object — its kind-shaped structure is taught by the prompt and re-validated
// per-kind by validateBoardProposal against cellValueSchema.
export const BOARD_PROPOSAL_JSON_SCHEMA = {
  type: "object",
  required: ["name", "groups", "columns", "items"],
  additionalProperties: false,
  properties: {
    name: { type: "string", maxLength: 100 },
    groups: {
      type: "array",
      minItems: 1,
      maxItems: MAX_GROUPS,
      items: {
        type: "object",
        required: ["tempId", "name"],
        additionalProperties: false,
        properties: {
          tempId: { type: "string" },
          name: { type: "string", maxLength: 80 },
          color: { type: "string" },
        },
      },
    },
    columns: {
      type: "array",
      minItems: 1,
      maxItems: MAX_COLUMNS,
      items: {
        type: "object",
        required: ["tempId", "name", "kind"],
        additionalProperties: false,
        properties: {
          tempId: { type: "string" },
          name: { type: "string", maxLength: 80 },
          kind: { type: "string", enum: [...ALL_KINDS] },
          options: {
            type: "array",
            maxItems: MAX_OPTIONS,
            items: {
              type: "object",
              required: ["label"],
              additionalProperties: false,
              properties: {
                label: { type: "string", maxLength: 60 },
                color: { type: "string" },
              },
            },
          },
        },
      },
    },
    items: {
      type: "array",
      maxItems: MAX_ITEMS,
      items: {
        type: "object",
        required: ["groupTempId", "name", "cells"],
        additionalProperties: false,
        properties: {
          groupTempId: { type: "string" },
          name: { type: "string", maxLength: 200 },
          cells: {
            type: "array",
            maxItems: MAX_COLUMNS,
            items: {
              type: "object",
              required: ["columnTempId", "value"],
              additionalProperties: false,
              properties: {
                columnTempId: { type: "string" },
                value: { type: "object", additionalProperties: true },
              },
            },
          },
        },
      },
    },
  },
} as const;

type MintedColumn = {
  id: string;
  kind: ColumnKind;
  name: string;
  /** label(lowercased) -> minted option id, for status/dropdown re-keying. */
  optionByLabel: Map<string, string>;
  /** the set of minted option ids (for direct-id references). */
  optionIds: Set<string>;
};

/**
 * Re-key a status/dropdown cell value: the model references options by LABEL
 * (or, defensively, by an already-minted id). Returns the value with option
 * references replaced by minted ids, or null if nothing resolvable remains.
 */
function rekeyOptionValue(
  kind: ColumnKind,
  value: Record<string, unknown>,
  col: MintedColumn,
): Record<string, unknown> | null {
  const resolve = (ref: unknown): string | null => {
    if (typeof ref !== "string") return null;
    if (col.optionIds.has(ref)) return ref;
    return col.optionByLabel.get(ref.toLowerCase()) ?? null;
  };

  if (kind === "status") {
    const raw = (value as { optionId?: unknown }).optionId;
    if (raw === null) return { optionId: null };
    const id = resolve(raw);
    if (!id) return null;
    return { optionId: id };
  }
  // dropdown
  const rawIds = (value as { optionIds?: unknown }).optionIds;
  if (!Array.isArray(rawIds)) return null;
  const ids = rawIds.map(resolve).filter((x): x is string => x !== null);
  return { optionIds: ids };
}

export function validateBoardProposal(
  proposal: BoardProposal,
  opts?: { newId?: () => string },
): ValidatedBoardProposal {
  const newId = opts?.newId ?? (() => crypto.randomUUID());
  const warnings: string[] = [];

  // --- groups: mint + remap ---
  const rawGroups = (proposal?.groups ?? []).slice(0, MAX_GROUPS);
  const groupIdByTemp = new Map<string, string>();
  const groups = rawGroups.map((g, i) => {
    const id = newId();
    groupIdByTemp.set(g.tempId, id);
    return {
      id,
      name: (g.name ?? "").trim() || `Group ${i + 1}`,
      color: g.color || GROUP_COLORS[i % GROUP_COLORS.length],
      position: i,
    };
  });
  // Items must land in a real group. Synthesize a default one if the model gave none.
  if (groups.length === 0) {
    groups.push({
      id: newId(),
      name: "Group 1",
      color: GROUP_COLORS[0],
      position: 0,
    });
  }
  const firstGroupId = groups[0].id;

  // --- columns: mint + validate kind + synthesize settings ---
  const rawColumns = (proposal?.columns ?? []).slice(0, MAX_COLUMNS);
  const minted: MintedColumn[] = [];
  const templateColumns: TemplatePayload["columns"] = [];
  for (const c of rawColumns) {
    const parsedKind = columnKindSchema.safeParse(c?.kind);
    if (!parsedKind.success) {
      warnings.push(
        `Dropped column "${c?.name ?? ""}": unknown kind "${c?.kind}"`,
      );
      continue;
    }
    const kind = parsedKind.data;
    if (UNSUPPORTED_KINDS.has(kind)) {
      warnings.push(
        `Dropped column "${c?.name ?? ""}": ${kind} columns can't be generated for a new board`,
      );
      continue;
    }

    const optionByLabel = new Map<string, string>();
    const optionIds = new Set<string>();
    let settings: Json = {};
    if (COLUMN_KIND_META[kind].hasOptions) {
      const rawOpts = (c.options ?? []).slice(0, MAX_OPTIONS);
      const options = rawOpts
        .filter((o) => (o?.label ?? "").trim().length > 0)
        .map((o, i) => {
          const id = newId();
          const label = o.label.trim();
          optionByLabel.set(label.toLowerCase(), id);
          optionIds.add(id);
          return {
            id,
            label,
            color: o.color || OPTION_COLORS[i % OPTION_COLORS.length],
          };
        });
      settings = { options };
    } else if (kind === "currency") {
      settings = { currency: "USD" };
    }

    // Defensive structural gate: the synthesized settings must satisfy the
    // canonical per-kind settings schema before we ever hand it to the RPC.
    if (!columnSettingsSchema(kind).safeParse(settings).success) {
      warnings.push(`Dropped column "${c.name}": invalid ${kind} settings`);
      continue;
    }

    const id = newId();
    minted.push({ id, kind, name: c.name, optionByLabel, optionIds });
    templateColumns.push({
      id,
      kind,
      name: (c.name ?? "").trim() || "Column",
      settings,
      position: templateColumns.length,
    });
  }
  // Robust temp→minted map (handles duplicate name+kind) built in emission order.
  const columnByTemp = new Map<string, MintedColumn>();
  {
    let mi = 0;
    for (const c of rawColumns) {
      const parsedKind = columnKindSchema.safeParse(c?.kind);
      if (!parsedKind.success) continue;
      if (UNSUPPORTED_KINDS.has(parsedKind.data)) continue;
      const m = minted[mi];
      if (m && m.kind === parsedKind.data) {
        columnByTemp.set(c.tempId, m);
        mi++;
      }
    }
  }

  // --- items: mint + remap group + validate cells ---
  const rawItems = (proposal?.items ?? []).slice(0, MAX_ITEMS);
  const templateItems: TemplatePayload["items"] = rawItems.map((it, i) => {
    let groupId = groupIdByTemp.get(it.groupTempId);
    if (!groupId) {
      warnings.push(
        `Item "${it?.name ?? ""}" referenced unknown group — placed in "${groups[0].name}"`,
      );
      groupId = firstGroupId;
    }

    const cells: { columnId: string; value: Json }[] = [];
    for (const cell of it?.cells ?? []) {
      const col = columnByTemp.get(cell.columnTempId);
      if (!col) {
        warnings.push(
          `Dropped a cell on "${it?.name ?? ""}": unknown column reference`,
        );
        continue;
      }
      let value: Record<string, unknown> | null = { ...(cell.value ?? {}) };
      if (col.kind === "status" || col.kind === "dropdown") {
        value = rekeyOptionValue(col.kind, value, col);
      }
      if (value === null) {
        warnings.push(
          `Dropped a ${col.kind} cell on "${it?.name ?? ""}": unresolvable option`,
        );
        continue;
      }
      const parsed = cellValueSchema(col.kind).safeParse(value);
      if (!parsed.success) {
        warnings.push(
          `Dropped a ${col.kind} cell on "${it?.name ?? ""}": ${
            parsed.error.issues[0]?.message ?? "invalid value"
          }`,
        );
        continue;
      }
      cells.push({ columnId: col.id, value: parsed.data as Json });
    }

    return {
      id: newId(),
      groupId,
      name: (it?.name ?? "").trim() || `Item ${i + 1}`,
      position: i,
      cells,
    };
  });

  const name = (proposal?.name ?? "").trim().slice(0, 100) || "Untitled board";

  return {
    name,
    templatePayload: {
      groups,
      columns: templateColumns,
      items: templateItems,
    },
    summary: {
      groups: groups.length,
      columns: templateColumns.map((c) => ({ name: c.name, kind: c.kind })),
      items: templateItems.length,
    },
    warnings,
  };
}
