import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { optionSchema } from "@/lib/validations/boards";
import { normalizeChartConfig } from "@/lib/dashboards/chart-config";
import type { SeriesData, SeriesPoint } from "@/lib/dashboards/series";
import type { DisplayColumn } from "@/lib/dashboards/list-rows";
import type { AggregateBucket, ColumnMeta } from "@/lib/dashboards/widget-data";
import type {
  WidgetCompletion,
  WidgetHealth,
} from "@/lib/dashboards/queries-cached";
import type { Database, Json } from "@/types/database.types";

export type WidgetRowsData = {
  columns: DisplayColumn[];
  rows: { itemId: string; name: string; cells: Record<string, unknown> }[];
};

type DB = SupabaseClient<Database>;

/** Uncached aggregate resolve (Number/Battery). Bounded RPC over indexed board_id.
 *  Mirrors getWidgetAggregationCached without the cache wrapper — the preview
 *  needs the current draft, never a TTL'd entry. */
export async function resolveAggregate(
  supabase: DB,
  { boardId, config }: { boardId: string; config: Record<string, unknown> },
): Promise<
  | { ok: true; buckets: AggregateBucket[]; columnMeta: ColumnMeta | null }
  | { ok: false; error: string }
> {
  const agg = (config.agg as string) ?? "count";
  const groupColumnId = (config.groupColumnId as string | undefined) ?? null;
  const { data, error } = await supabase.rpc("dashboard_aggregate", {
    p_board_id: boardId,
    p_group_column_id: groupColumnId ?? undefined,
    p_value_column_id: (config.valueColumnId as string) ?? undefined,
    p_agg: agg,
  });
  if (error) return { ok: false, error: error.message };

  const buckets: AggregateBucket[] = (data ?? []).map((r) => ({
    group_key: r.group_key,
    metric: Number(r.metric),
  }));

  let columnMeta: ColumnMeta | null = null;
  if (groupColumnId) {
    const { data: col } = await supabase
      .from("columns")
      .select("kind, settings")
      .eq("id", groupColumnId)
      .maybeSingle();
    if (col) {
      const opts = optionSchema
        .array()
        .safeParse((col.settings as { options?: unknown }).options ?? []);
      columnMeta = { kind: col.kind, options: opts.success ? opts.data : [] };
    }
  }
  return { ok: true, buckets, columnMeta };
}

/** Uncached completion resolve — mirrors getWidgetCompletionCached body. */
export async function resolveCompletion(
  supabase: DB,
  { boardId, config }: { boardId: string; config: Record<string, unknown> },
): Promise<WidgetCompletion> {
  const mode = (config.mode as string) ?? "status";
  const valueColumnId =
    mode === "percent"
      ? ((config.percentColumnId as string | undefined) ?? null)
      : ((config.statusColumnId as string | undefined) ?? null);
  if (!valueColumnId) return { ok: true, rows: [], groups: [] };

  const [rpc, groupsRes] = await Promise.all([
    supabase.rpc("dashboard_completion", {
      p_board_id: boardId,
      p_mode: mode,
      p_value_column_id: valueColumnId,
      p_done_option_ids: ((config.doneOptionIds as string[]) ?? []) as Json,
    }),
    supabase
      .from("groups")
      .select("id, name, color")
      .eq("board_id", boardId)
      .order("position", { ascending: true })
      .limit(100),
  ]);
  if (rpc.error) return { ok: false, error: rpc.error.message };

  return {
    ok: true,
    rows: (rpc.data ?? []).map((r) => ({
      groupKey: r.group_key,
      itemCount: Number(r.item_count),
      completion: Number(r.completion),
    })),
    groups: (groupsRes.data ?? []).map((g) => ({
      id: g.id,
      label: g.name,
      color: g.color,
    })),
  };
}

/** Uncached health resolve — mirrors getWidgetHealthCached body. */
export async function resolveHealth(
  supabase: DB,
  { boardId }: { boardId: string },
): Promise<WidgetHealth> {
  const { data, error } = await supabase.rpc("dashboard_health_summary", {
    p_board_id: boardId,
  });
  if (error) return { ok: false, error: error.message };
  const row = data?.[0];
  return {
    ok: true,
    counts: {
      totalItems: Number(row?.total_items ?? 0),
      doneItems: Number(row?.done_items ?? 0),
      overdueItems: Number(row?.overdue_items ?? 0),
      incompleteItems: Number(row?.incomplete_items ?? 0),
      newItems7d: Number(row?.new_items ?? 0),
    },
  };
}

const PALETTE = [
  "var(--brand)",
  "var(--status-green)",
  "var(--status-orange)",
  "var(--status-purple)",
  "var(--status-teal)",
  "var(--status-red)",
  "var(--status-yellow)",
  "var(--status-blue)",
];

function formatBucketLabel(key: string, bucket: string): string {
  // key is "YYYY-MM-DD" (start of bucket)
  const d = new Date(key);
  if (Number.isNaN(d.getTime())) return key;
  if (bucket === "month")
    return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Uncached series resolve (Chart). Bounded dashboard_series RPC (p_limit: 12)
 *  over indexed board_id. Moved verbatim from getWidgetSeries, parameterized on
 *  boardId/orgId/config instead of re-reading the widget row. */
export async function resolveSeries(
  supabase: DB,
  {
    boardId,
    orgId,
    config,
  }: { boardId: string; orgId: string; config: Record<string, unknown> },
): Promise<{ ok: true; data: SeriesData } | { ok: false; error: string }> {
  const cfg = normalizeChartConfig(config);
  const empty: SeriesData = {
    chartType: cfg.chartType,
    primaryKind: cfg.primary.kind,
    seriesKind: cfg.series?.kind ?? null,
    points: [],
  };
  if (!boardId || (cfg.primary.kind !== "date" && !cfg.primary.columnId))
    return { ok: true, data: empty };

  const { data: raw, error } = await supabase.rpc("dashboard_series", {
    p_board_id: boardId,
    p_primary: cfg.primary as Json,
    p_series: (cfg.series ?? null) as Json,
    p_measure: cfg.measure as Json,
    p_limit: 12,
  });
  if (error) return { ok: false, error: error.message };

  // Resolve a key -> {label,color} map for a dimension.
  // NOTE: org_members → profiles has no declared FK in database.types.ts (user_id
  // references auth.users, not profiles), so a PostgREST embed won't typecheck.
  // We use a two-query JS join instead, matching the existing pattern in
  // src/lib/org/queries-cached.ts::listOrgMembersCached.
  async function resolver(dim: { kind: string; columnId?: string }) {
    const map = new Map<string, { label: string; color: string }>();
    if (dim.kind === "status" || dim.kind === "dropdown") {
      if (!dim.columnId) return map;
      const { data: col } = await supabase
        .from("columns")
        .select("settings")
        .eq("id", dim.columnId)
        .maybeSingle();
      const opts =
        optionSchema
          .array()
          .safeParse((col?.settings as { options?: unknown })?.options ?? [])
          .data ?? [];
      opts.forEach((o) => map.set(o.id, { label: o.label, color: o.color }));
    } else if (dim.kind === "people") {
      // Two-query JS join: fetch org_members user_ids (scoped to this widget's
      // org, matching src/lib/org/queries-cached.ts::listOrgMembersCached), then fetch
      // profiles by id. The org_id filter keeps the member set + palette indices
      // deterministic for multi-org users (RLS alone would merge orgs).
      const { data: members } = await supabase
        .from("org_members")
        .select("user_id")
        .eq("org_id", orgId);
      const userIds = (members ?? []).map((m) => m.user_id);
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        (profiles ?? []).forEach((p, i) =>
          map.set(p.id, {
            label: p.full_name ?? "Member",
            color: PALETTE[i % PALETTE.length],
          }),
        );
      }
    }
    return map;
  }

  const primaryMap = await resolver(cfg.primary);
  const seriesMap = cfg.series ? await resolver(cfg.series) : new Map();

  const points: SeriesPoint[] = (raw ?? []).map((r, i) => {
    // The generated RPC return types the keys as non-null `string`, but the SQL
    // function can emit NULL group keys — widen to `string | null` so the
    // null-handling below (None / Other buckets) typechecks and stays correct.
    const pk: string | null = r.primary_key;
    const sk: string | null = r.series_key;
    const primaryLabel =
      pk === null
        ? "None"
        : pk === "__other__"
          ? "Other"
          : cfg.primary.kind === "date"
            ? formatBucketLabel(pk, cfg.primary.bucket ?? "month")
            : (primaryMap.get(pk)?.label ?? "Unknown");
    const seriesLabel =
      sk === null
        ? null
        : (seriesMap.get(sk)?.label ??
          (sk === "__other__" ? "Other" : "Unknown"));
    const seriesColor =
      (sk !== null
        ? seriesMap.get(sk!)?.color
        : primaryMap.get(pk ?? "")?.color) ?? PALETTE[i % PALETTE.length];
    return {
      primaryKey: pk,
      primaryLabel,
      seriesKey: sk,
      seriesLabel,
      seriesColor,
      value: Number(r.value),
    };
  });

  return { ok: true, data: { ...empty, points } };
}

/** Uncached rows resolve (List). Bounded dashboard_list_rows RPC (p_limit clamped
 *  1..100) over indexed board_id. Moved verbatim from getWidgetRows,
 *  parameterized on boardId/config instead of re-reading the widget row. */
export async function resolveRows(
  supabase: DB,
  { boardId, config }: { boardId: string; config: Record<string, unknown> },
): Promise<{ ok: true; data: WidgetRowsData } | { ok: false; error: string }> {
  const cfg = config as {
    columnIds?: string[];
    limit?: number;
    filter?: unknown;
  };
  const columnIds = Array.isArray(cfg.columnIds) ? cfg.columnIds : [];
  const limit = Math.min(Math.max(cfg.limit ?? 25, 1), 100);

  // Bounded, indexed, membership-checked row fetch — LIMIT applied after the
  // filter inside the RPC (D3b). Empty/absent filter ⇒ latest-N (D3a parity).
  const { data: items } = await supabase.rpc("dashboard_list_rows", {
    p_board_id: boardId,
    p_filter: (cfg.filter ?? {}) as Json,
    p_limit: limit,
  });
  const itemIds = (items ?? []).map((i) => i.item_id);

  let columns: DisplayColumn[] = [];
  const cellMap = new Map<string, unknown>(); // `${itemId}:${columnId}` → value
  if (columnIds.length > 0) {
    const { data: cols } = await supabase
      .from("columns")
      .select("id, name, kind, settings")
      .in("id", columnIds);
    columns = (cols ?? [])
      .map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        options:
          optionSchema
            .array()
            .safeParse((c.settings as { options?: unknown }).options ?? [])
            .data ?? [],
        // Raw settings ride along so formatCell can read e.g. the currency code.
        settings: c.settings,
      }))
      // preserve the config's column order
      .sort((a, b) => columnIds.indexOf(a.id) - columnIds.indexOf(b.id));

    if (itemIds.length > 0) {
      const { data: cells } = await supabase
        .from("cell_values")
        .select("item_id, column_id, value")
        .eq("board_id", boardId)
        .in("item_id", itemIds)
        .in("column_id", columnIds);
      for (const cell of cells ?? [])
        cellMap.set(`${cell.item_id}:${cell.column_id}`, cell.value);
    }
  }

  const rows = (items ?? []).map((it) => ({
    itemId: it.item_id,
    name: it.name,
    cells: Object.fromEntries(
      columnIds.map((cid) => [
        cid,
        cellMap.get(`${it.item_id}:${cid}`) ?? null,
      ]),
    ),
  }));

  return { ok: true, data: { columns, rows } };
}
