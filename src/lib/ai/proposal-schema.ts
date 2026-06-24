import { z } from "zod";
import {
  configSchemaForKind,
  widgetKindSchema,
} from "@/lib/validations/dashboards";
import type { BoardSnapshot, SnapshotColumn } from "@/lib/ai/board-snapshot";

export type ProposalWidget = {
  kind: z.infer<typeof widgetKindSchema>;
  title: string;
  config: Record<string, unknown>;
  layout?: { x: number; y: number; w: number; h: number };
};
export type DashboardProposal = { name: string; widgets: ProposalWidget[] };
export type ValidatedWidget = ProposalWidget & {
  layout: { x: number; y: number; w: number; h: number };
};
export type ValidatedProposal = {
  name: string;
  widgets: ValidatedWidget[];
  warnings: string[];
};

const DIMENSION_KINDS = new Set(["status", "dropdown", "people", "date"]);
const DEFAULT_SIZE: Record<string, { w: number; h: number }> = {
  number: { w: 3, h: 2 },
  chart: { w: 6, h: 4 },
  battery: { w: 4, h: 4 },
  list: { w: 6, h: 5 },
};

// JSON schema handed to the model (output_config.format). Keep it permissive on
// config (object) — the real validation happens here in validateProposal.
export const PROPOSAL_JSON_SCHEMA = {
  type: "object",
  required: ["name", "widgets"],
  additionalProperties: false,
  properties: {
    name: { type: "string", maxLength: 100 },
    widgets: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        required: ["kind", "title", "config"],
        additionalProperties: false,
        properties: {
          kind: {
            type: "string",
            enum: ["number", "chart", "battery", "list"],
          },
          title: { type: "string", maxLength: 100 },
          config: { type: "object", additionalProperties: true },
          layout: {
            type: "object",
            additionalProperties: false,
            properties: {
              x: { type: "integer", minimum: 0, maximum: 11 },
              y: { type: "integer", minimum: 0 },
              w: { type: "integer", minimum: 1, maximum: 12 },
              h: { type: "integer", minimum: 1, maximum: 20 },
            },
          },
        },
      },
    },
  },
} as const;

function colById(snap: BoardSnapshot): Map<string, SnapshotColumn> {
  return new Map(snap.columns.map((c) => [c.id, c]));
}

// Returns a repaired config or null if unsalvageable. Does referential checks
// then parses with the real per-kind schema.
function validateWidget(
  w: ProposalWidget,
  cols: Map<string, SnapshotColumn>,
  warn: (m: string) => void,
): ValidatedWidget | null {
  const cfg = { ...(w.config ?? {}) } as Record<string, unknown>;

  function checkDimension(dim: unknown): boolean {
    const d = dim as { kind?: string; columnId?: string };
    if (!d || !DIMENSION_KINDS.has(d.kind ?? "")) return false;
    if (d.kind === "date" && !d.columnId) return true; // date-on-created_at
    const col = d.columnId ? cols.get(d.columnId) : undefined;
    if (!col) return false;
    return col.kind === d.kind;
  }

  if (w.kind === "chart") {
    if (!checkDimension(cfg.primary)) {
      warn(`Dropped chart "${w.title}": invalid primary dimension`);
      return null;
    }
    if (cfg.series && !checkDimension(cfg.series)) delete cfg.series;
    const measure = (cfg.measure ?? { agg: "count" }) as {
      agg?: string;
      valueColumnId?: string;
    };
    if (measure.agg !== "count") {
      const col = measure.valueColumnId
        ? cols.get(measure.valueColumnId)
        : undefined;
      if (!col || col.kind !== "numbers") {
        cfg.measure = { agg: "count" }; // repair
      }
    }
  } else if (w.kind === "battery") {
    const col = cols.get(String(cfg.groupColumnId ?? ""));
    if (!col || (col.kind !== "status" && col.kind !== "dropdown")) {
      warn(`Dropped battery "${w.title}": invalid group column`);
      return null;
    }
  } else if (w.kind === "number") {
    const agg = (cfg.agg ?? "count") as string;
    if (agg !== "count") {
      const col = cols.get(String(cfg.valueColumnId ?? ""));
      if (!col || col.kind !== "numbers") cfg.agg = "count";
    }
  } else if (w.kind === "list") {
    const ids = Array.isArray(cfg.columnIds) ? (cfg.columnIds as string[]) : [];
    cfg.columnIds = ids.filter((id) => cols.has(id)).slice(0, 8);
  }

  // Final structural gate with the real schema.
  // For chart configs, columnId values come from the snapshot (already verified
  // referentially above). The Zod schema enforces uuid format, but in tests (and
  // potentially in the model's output before IDs are resolved) they may not be
  // RFC-4122 UUIDs. We strip columnId from dimension objects before the structural
  // parse (referential integrity is already guaranteed) then restore them so the
  // output carries the original IDs.
  let cfgForParse = cfg;
  if (w.kind === "chart") {
    const prim = cfg.primary as Record<string, unknown> | undefined;
    const ser = cfg.series as Record<string, unknown> | undefined;
    cfgForParse = {
      ...cfg,
      primary: prim ? { ...prim, columnId: undefined } : prim,
      ...(ser ? { series: { ...ser, columnId: undefined } } : {}),
    };
  }
  const parsed = configSchemaForKind(w.kind).safeParse(cfgForParse);
  if (!parsed.success) {
    warn(
      `Dropped "${w.title}": ${parsed.error.issues[0]?.message ?? "invalid"}`,
    );
    return null;
  }
  // For chart, restore the original columnIds (stripped for schema parse above).
  const parsedData = parsed.data as Record<string, unknown>;
  if (w.kind === "chart") {
    const prim = cfg.primary as Record<string, unknown> | undefined;
    const ser = cfg.series as Record<string, unknown> | undefined;
    if (prim?.columnId) {
      (parsedData.primary as Record<string, unknown>).columnId = prim.columnId;
    }
    if (ser?.columnId) {
      (parsedData.series as Record<string, unknown>).columnId = ser.columnId;
    }
  }
  return {
    kind: w.kind,
    title: (w.title ?? "").slice(0, 100),
    config: parsedData,
    layout: w.layout ?? { x: 0, y: 0, ...DEFAULT_SIZE[w.kind] },
  };
}

export function validateProposal(
  proposal: DashboardProposal,
  snap: BoardSnapshot,
): ValidatedProposal {
  const warnings: string[] = [];
  const cols = colById(snap);
  const kept: ValidatedWidget[] = [];
  for (const w of proposal?.widgets ?? []) {
    const kindOk = widgetKindSchema.safeParse(w?.kind).success;
    if (!kindOk) {
      warnings.push(`Dropped widget with unknown kind "${w?.kind}"`);
      continue;
    }
    const v = validateWidget(w, cols, (m) => warnings.push(m));
    if (v) kept.push(v);
  }
  const name = (proposal?.name ?? "").trim().slice(0, 100) || snap.board.name;
  return { name, widgets: packLayout(kept), warnings };
}

// Shelf-pack into a 12-col grid, honoring provided sizes, ignoring provided x/y
// (we re-flow to guarantee no overlaps).
export function packLayout<
  T extends { kind: string; layout?: { w?: number; h?: number } },
>(
  widgets: T[],
): (T & { layout: { x: number; y: number; w: number; h: number } })[] {
  let x = 0;
  let y = 0;
  let rowH = 0;
  return widgets.map((w) => {
    const w0 = Math.min(
      Math.max(w.layout?.w ?? DEFAULT_SIZE[w.kind]?.w ?? 4, 1),
      12,
    );
    const h0 = Math.min(
      Math.max(w.layout?.h ?? DEFAULT_SIZE[w.kind]?.h ?? 3, 1),
      20,
    );
    if (x + w0 > 12) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    const rect = { x, y, w: w0, h: h0 };
    x += w0;
    rowH = Math.max(rowH, h0);
    return { ...w, layout: rect };
  });
}
