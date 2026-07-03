# Widget Config Sheet — Live Preview Real Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the widget edit drawer's "Live preview" render real, board-scoped data for the current _draft_ config (across all six widget kinds), instead of the current placeholder/error state, via a preview-scoped, debounced, single-widget server fetch.

**Architecture:** Add one draft-aware Server Action (`getWidgetPreviewData`) that accepts `{ kind, sourceBoardId, config }`, re-derives `org_id` from the board **server-side** (RLS-scoped read — the client config is never trusted for tenant access), validates the config with `configSchemaForKind`, and resolves the same bounded RPCs the live widgets use — **uncached** so every draft is fresh. A `WidgetPreviewProvider` wraps the preview block, runs exactly one debounced `useQuery`, and feeds the result into the existing widget bodies through the contexts their hooks already read (`useWidgetData` via a single-entry `WidgetDataContext`; `useWidgetSeries`/`useWidgetRows` via a new `WidgetPreviewContext` short-circuit). The six widget components are rendered **unchanged**.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, `@tanstack/react-query`, Supabase (RLS + service client), Zod, Vitest + Testing Library, Tailwind v4.

## Global Constraints

- **Next.js 16** — confirm APIs against `node_modules/next/dist/docs/`. The preview action returns fresh per-request data to a client component through react-query; per `01-getting-started/08-caching.md` ("require fresh data on every request, do not use `use cache`"), it MUST NOT use `"use cache"`/`cacheLife`/`cacheTag`. No `revalidatePath`/`updateTag` — the preview is a read, not a mutation.
- **RLS is the security boundary.** The preview action reads the board row with the **RLS-scoped** server client (`createClient()`); `org_id` comes from that server-read row, never from the client. A board the caller can't see under RLS ⇒ error slot. `SUPABASE_SERVICE_ROLE_KEY` must never reach the browser.
- **Validate at boundaries with Zod.** New action input parsed by `getWidgetPreviewDataSchema` then `configSchemaForKind(kind)`. TypeScript strict; no `any` (except the one pre-existing, already-justified `dashboard_series` cast being relocated verbatim).
- **Server Components by default / mutations via Server Actions.** The preview data source is a Server Action; the provider and hooks are client (`"use client"`). No new client boundary widened beyond the sheet subtree.
- **Commit identity pinned:** `Danijel Jovanovic <info@synapse-solutions.ai>`. Stage explicitly by path (never `git add -A`). Commit subjects lowercase after `type(scope):`, with a descriptive body and the `Co-Authored-By` trailer.
- **Gates (all must pass before finish):** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- **UI/tokens:** No new visual chrome is introduced; the preview surface (`bg-card rounded-xl border`) is unchanged. If any loading affordance text is touched, use semantic tokens only (pulse-ui): `text-muted-foreground`, `text-destructive`.

## Data-Fetching Budget (AGENTS.md #5)

- **What loads on first paint of the sheet:** The `WidgetPreviewProvider` mounts with the initial draft. Its single `useQuery` is `enabled: Boolean(sourceBoardId)`. On **Add** with no board preselected ⇒ **0 server round-trips** (widget bodies short-circuit to "Pick a source board"). On **Add** with a board preselected, or on **Edit** (draft seeded from the target's persisted config) ⇒ **exactly 1** single-widget round-trip.
- **What loads on each config edit:** Config edits mutate **client draft state** (`useState` in `WidgetConfigSheetForm`) — no server call per keystroke. The existing 400 ms debounce (`previewCfg`) plus the discrete `draft.kind` / `draft.sourceBoardId` pickers form the query key `["widget-preview", kind, sourceBoardId, configHash(previewCfg)]`. A settled edit fires **exactly 1** single-widget fetch. Reverting to a prior draft is served from the react-query cache (`staleTime: 60_000`) ⇒ 0 network.
- **No dashboard refetch:** The dashboard's `WidgetDataProvider` is **not** mounted inside the sheet. The preview fetch resolves **one** widget's data; it never touches the batched dashboard query or triggers an RSC navigation.
- **Server data vs. client state:** Config edits are client-only draft state (a modal drawer, no URL view — History API not applicable). The single debounced preview fetch is the only server round-trip.
- **Bounded + indexed:** The preview calls the same bounded RPCs as the live widgets — `dashboard_aggregate`, `dashboard_completion`, `dashboard_health_summary`, `dashboard_series` (`p_limit: 12`), `dashboard_list_rows` (`p_limit` clamped 1..100) — all over the indexed `board_id`. No unbounded `select *`.

---

## File Structure

- **Create** `src/lib/dashboards/widget-resolve.ts` — server-only, **uncached** per-kind resolvers shared by the id-keyed actions (series/rows) and the new preview action. One responsibility: turn a `(supabase, boardId, orgId, config)` tuple into a widget payload via the bounded RPCs.
- **Create** `src/lib/dashboards/use-widget-preview.tsx` — client `WidgetPreviewProvider` + `WidgetPreviewContext` (+ the `useWidgetPreview` reader for chart/list hooks). One responsibility: run the single debounced draft fetch and expose its slices.
- **Modify** `src/lib/validations/dashboards.ts` — add `getWidgetPreviewDataSchema`.
- **Modify** `src/lib/dashboards/actions.ts` — add `getWidgetPreviewData` + its `WidgetPreviewResult` type; refactor `getWidgetSeries`/`getWidgetRows` to delegate to the new resolvers (behavior-preserving).
- **Modify** `src/lib/dashboards/use-widget-data.tsx` — export a `SingleWidgetDataProvider` that feeds `WidgetDataContext` from one preview slot (keeps `WidgetDataContext` otherwise private; `useWidgetData` unchanged).
- **Modify** `src/lib/dashboards/use-widget-series.ts` and `src/lib/dashboards/use-widget-rows.ts` — add a preview short-circuit reading `WidgetPreviewContext`.
- **Modify** `src/components/dashboards/WidgetConfigSheet.tsx` — wrap the live-preview block in `WidgetPreviewProvider`.
- **Modify (rewrite)** `src/components/dashboards/WidgetConfigSheet.test.tsx` — replace the "outside provider ⇒ Failed to load" regression expectations with "live data renders in the preview" assertions.
- **Create** `src/lib/dashboards/use-widget-preview.test.tsx` — unit tests for the provider/hooks (debounced single fetch, per-kind slice routing, disabled-when-no-board, error slot).
- **Keep** `src/lib/dashboards/use-widget-data.test.tsx` — the "degrades to error without a provider" test still holds (`useWidgetData` unchanged); no edit expected.

---

## Task 1 (single node): Preview-scoped live widget data

> This is the **only** task. See the Execution DAG section — the work is one self-contained unit (shared resolvers → preview action → preview provider/hook seams → sheet wiring → test rewrite). It carries one review gate and one test cycle. Steps are grouped A–F; keep the TDD rhythm within each group.

**Files:**

- Create: `src/lib/dashboards/widget-resolve.ts`
- Create: `src/lib/dashboards/use-widget-preview.tsx`
- Create (test): `src/lib/dashboards/use-widget-preview.test.tsx`
- Modify: `src/lib/validations/dashboards.ts` (append after line 207)
- Modify: `src/lib/dashboards/actions.ts` (add action; refactor `getWidgetSeries` ~558-691 and `getWidgetRows` ~452-536)
- Modify: `src/lib/dashboards/use-widget-data.tsx` (export `SingleWidgetDataProvider`)
- Modify: `src/lib/dashboards/use-widget-series.ts` and `src/lib/dashboards/use-widget-rows.ts` (preview short-circuit)
- Modify: `src/components/dashboards/WidgetConfigSheet.tsx:139-160` (wrap preview block)
- Modify (test, rewrite): `src/components/dashboards/WidgetConfigSheet.test.tsx`

**Interfaces:**

- Consumes (existing, unchanged):
  - `resolveWidgetAggregate` semantics from `actions.ts` (aggregate/completion/health payload shape `WidgetAggregatePayload`).
  - `configSchemaForKind(kind)`, `widgetKindSchema` from `@/lib/validations/dashboards`.
  - `configHash(config)` from `@/lib/dashboards/widget-data`.
  - `WidgetDataContext` internals in `use-widget-data.tsx` (`useWidgetData` reads `ctx.results?.[widgetId]`, `ctx.isLoading`, `ctx.isError`).
  - `SeriesData` from `@/lib/dashboards/series`; `DisplayColumn` from `@/lib/dashboards/list-rows`.
  - `createClient` (RLS) from `@/lib/supabase/server`.
- Produces (relied on within this task):
  - `widget-resolve.ts`:
    - `type WidgetRowsData = { columns: DisplayColumn[]; rows: { itemId: string; name: string; cells: Record<string, unknown> }[] }`
    - `resolveAggregate(supabase, args: { boardId: string; config: Record<string, unknown> }): Promise<{ ok: true; buckets: AggregateBucket[]; columnMeta: ColumnMeta | null } | { ok: false; error: string }>`
    - `resolveCompletion(supabase, args: { boardId: string; config: Record<string, unknown> }): Promise<WidgetCompletion>`
    - `resolveHealth(supabase, args: { boardId: string }): Promise<WidgetHealth>`
    - `resolveSeries(supabase, args: { boardId: string; orgId: string; config: Record<string, unknown> }): Promise<{ ok: true; data: SeriesData } | { ok: false; error: string }>`
    - `resolveRows(supabase, args: { boardId: string; config: Record<string, unknown> }): Promise<{ ok: true; data: WidgetRowsData } | { ok: false; error: string }>`
    - (`WidgetCompletion`/`WidgetHealth` are the existing union types re-exported from `@/lib/dashboards/queries-cached`.)
  - `actions.ts`:
    - `type WidgetPreviewResult = { ok: true; shape: "aggregate"; payload: WidgetAggregatePayload } | { ok: true; shape: "series"; payload: SeriesData } | { ok: true; shape: "rows"; payload: WidgetRowsData } | { ok: false; error: string }`
    - `getWidgetPreviewData(input: { kind: Widget["kind"]; sourceBoardId: string; config: Record<string, unknown> }): Promise<ActionResult<WidgetPreviewResult>>`
  - `use-widget-data.tsx`:
    - `SingleWidgetDataProvider(props: { widgetId: string; slot: WidgetDataResult | undefined; isLoading: boolean; isError: boolean; children: ReactNode }): JSX.Element`
  - `use-widget-preview.tsx`:
    - `WidgetPreviewProvider(props: { previewWidgetId: string; kind: CacheWidget["kind"]; sourceBoardId: string; config: Record<string, unknown>; children: ReactNode }): JSX.Element`
    - `useWidgetPreview(): { active: boolean; isLoading: boolean; isError: boolean; series: SeriesData | undefined; rows: WidgetRowsData | undefined }`

---

### Group A — Zod schema for the preview input

- [ ] **A1. Write the failing test.** Append to `src/lib/validations/dashboards.test.ts` if it exists, else create it. Full test:

```ts
import { describe, it, expect } from "vitest";
import { getWidgetPreviewDataSchema } from "./dashboards";

describe("getWidgetPreviewDataSchema", () => {
  const board = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  it("accepts a well-formed draft", () => {
    const r = getWidgetPreviewDataSchema.safeParse({
      kind: "number",
      sourceBoardId: board,
      config: { agg: "count" },
    });
    expect(r.success).toBe(true);
  });
  it("rejects a non-uuid board", () => {
    const r = getWidgetPreviewDataSchema.safeParse({
      kind: "number",
      sourceBoardId: "__preview__",
      config: {},
    });
    expect(r.success).toBe(false);
  });
  it("rejects an unknown kind", () => {
    const r = getWidgetPreviewDataSchema.safeParse({
      kind: "gauge",
      sourceBoardId: board,
      config: {},
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **A2. Run it, expect FAIL** (`getWidgetPreviewDataSchema` not exported):
      `pnpm test -- src/lib/validations/dashboards.test.ts`
      Expected: FAIL — "getWidgetPreviewDataSchema is not a function"/import error.

- [ ] **A3. Implement.** Append to `src/lib/validations/dashboards.ts` (after line 207, the `getWidgetsDataSchema` block). `uuid`, `widgetKindSchema`, `configObject` already exist in this file:

```ts
// Draft-aware preview fetch: the config is client draft state (never persisted),
// so — unlike the id-keyed reads — the caller passes kind + board + config
// directly. RLS + a server-side re-read of the board (org derivation) is the
// authorization boundary; the kind-specific shape is enforced in the action via
// configSchemaForKind(kind).
export const getWidgetPreviewDataSchema = z.object({
  kind: widgetKindSchema,
  sourceBoardId: uuid,
  config: configObject,
});
```

- [ ] **A4. Run it, expect PASS.** `pnpm test -- src/lib/validations/dashboards.test.ts` → PASS.

- [ ] **A5. Commit.**
  ```bash
  git add src/lib/validations/dashboards.ts src/lib/validations/dashboards.test.ts
  git commit  # subject: feat(dashboards): add getWidgetPreviewDataSchema for draft preview
  ```

---

### Group B — Shared uncached resolvers (`widget-resolve.ts`)

Extract the **series** and **rows** RPC logic verbatim from the existing actions (both are already uncached, RLS-client based), and add fresh **uncached** aggregate/completion/health resolvers for the preview. The live cached path (`queries-cached.ts`) is intentionally **left untouched** — its `getWidget*Cached` fns keep their `"use cache"`/`cacheTag` wrappers; the preview must be uncached (fresh per draft, no per-draft cache entries to invalidate), so the small RPC-call duplication for the aggregate kinds is deliberate and low-risk.

- [ ] **B1. Write the failing test** `src/lib/dashboards/widget-resolve.test.ts`. Mock the supabase client; assert each resolver calls the right RPC and shapes the result. Full test:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  resolveAggregate,
  resolveCompletion,
  resolveHealth,
} from "./widget-resolve";

function fakeClient(rpc: Record<string, unknown>) {
  return {
    rpc: vi.fn(async (name: string) => ({
      data: (rpc as Record<string, unknown>)[name] ?? null,
      error: null,
    })),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        order: () => ({ limit: async () => ({ data: [], error: null }) }),
      }),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("resolveAggregate", () => {
  it("sums buckets from dashboard_aggregate", async () => {
    const c = fakeClient({
      dashboard_aggregate: [{ group_key: null, metric: 7 }],
    });
    const r = await resolveAggregate(c, {
      boardId: "b",
      config: { agg: "count" },
    });
    expect(r).toEqual({
      ok: true,
      buckets: [{ group_key: null, metric: 7 }],
      columnMeta: null,
    });
  });
});

describe("resolveHealth", () => {
  it("camelCases the health summary row", async () => {
    const c = fakeClient({
      dashboard_health_summary: [
        {
          total_items: 8,
          done_items: 2,
          overdue_items: 3,
          incomplete_items: 4,
          new_items: 1,
        },
      ],
    });
    const r = await resolveHealth(c, { boardId: "b" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.counts.overdueItems).toBe(3);
  });
});

describe("resolveCompletion", () => {
  it("returns empty when unconfigured", async () => {
    const c = fakeClient({});
    const r = await resolveCompletion(c, { boardId: "b", config: {} });
    expect(r).toEqual({ ok: true, rows: [], groups: [] });
  });
});
```

- [ ] **B2. Run it, expect FAIL** (module missing):
      `pnpm test -- src/lib/dashboards/widget-resolve.test.ts` → FAIL (cannot find module).

- [ ] **B3. Implement `src/lib/dashboards/widget-resolve.ts`.** The aggregate/completion/health bodies mirror `queries-cached.ts` **minus** the `"use cache"`/`cacheLife`/`cacheTag` lines and take an injected `supabase` client. The series/rows bodies are **moved verbatim** from `actions.ts` (`getWidgetSeries` lines ~573-691 and `getWidgetRows` lines ~472-535), parameterized on `boardId`/`orgId`/`config` instead of re-reading the widget row. Keep the existing justified `dashboard_series` `any` cast comment verbatim.

```ts
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
```

> **B3 (cont.) — series + rows:** In the same file add `resolveSeries(supabase, { boardId, orgId, config })` and `resolveRows(supabase, { boardId, config })`. Their bodies are the existing `getWidgetSeries` (lines ~573-691, starting at `const cfg = normalizeChartConfig(...)`) and `getWidgetRows` (lines ~472-535, starting at `const config = (widget.config ?? {}) as {...}`) **cut verbatim**, with `widget.source_board_id` → `boardId`, `widget.org_id` → `orgId`, `widget.config` → `config`, each returning `{ ok: true, data }` / `{ ok: false, error }`. The `PALETTE`, `formatBucketLabel`, and the `resolver()` helper move with `resolveSeries`; keep the existing `eslint-disable ... no-explicit-any` cast comment for `dashboard_series` verbatim. (Exact text is the current action bodies — reproduce them unchanged except for the three field renames.)

- [ ] **B4. Run it, expect PASS.** `pnpm test -- src/lib/dashboards/widget-resolve.test.ts` → PASS.

- [ ] **B5. Refactor the id-keyed actions to delegate (behavior-preserving).** In `actions.ts`:
  - `getWidgetSeries`: after reading `widget` (keep the `.select("config, source_board_id, org_id").eq("id", ...)` + not-found guard), replace the inline body with `return resolveSeries(supabase, { boardId: widget.source_board_id!, orgId: widget.org_id, config: (widget.config ?? {}) as Record<string, unknown> });` — but preserve the existing empty-series short-circuit by leaving that guard in `resolveSeries` (it already lives in the moved body). Move `PALETTE`/`formatBucketLabel`/`resolver` out of `actions.ts` (now in `widget-resolve.ts`).
  - `getWidgetRows`: after the `widget` read + `!widget.source_board_id` guard, replace the inline body with `return resolveRows(supabase, { boardId: widget.source_board_id, config: (widget.config ?? {}) as Record<string, unknown> });`.
  - Add `import { resolveSeries, resolveRows, resolveAggregate, resolveCompletion, resolveHealth, type WidgetRowsData } from "@/lib/dashboards/widget-resolve";`.

- [ ] **B6. Run the existing widget-data + any series/rows tests to prove no regression.**
      `pnpm test -- src/lib/dashboards`
      Expected: PASS (the `getWidgetSeries`/`getWidgetRows` refactor is behavior-preserving; `use-widget-data.test.tsx` unaffected).

- [ ] **B7. Commit.**
  ```bash
  git add src/lib/dashboards/widget-resolve.ts src/lib/dashboards/widget-resolve.test.ts src/lib/dashboards/actions.ts
  git commit  # subject: refactor(dashboards): extract uncached widget resolvers
  ```

---

### Group C — The `getWidgetPreviewData` Server Action

- [ ] **C1. Write the failing test** `src/lib/dashboards/actions.preview.test.ts`. Mock `@/lib/supabase/server` so the board read returns a row (org derivation) and the RPC returns buckets. Full test:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const maybeSingle = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    rpc,
  }),
}));

import { getWidgetPreviewData } from "./actions";

const BOARD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

beforeEach(() => {
  rpc.mockReset();
  maybeSingle.mockReset();
});

describe("getWidgetPreviewData", () => {
  it("derives org from the board and returns an aggregate payload", async () => {
    maybeSingle.mockResolvedValue({ data: { org_id: "org1" }, error: null });
    rpc.mockResolvedValue({
      data: [{ group_key: null, metric: 3 }],
      error: null,
    });

    const res = await getWidgetPreviewData({
      kind: "number",
      sourceBoardId: BOARD,
      config: { agg: "count" },
    });

    expect(res.ok).toBe(true);
    if (res.ok && res.data.ok && res.data.shape === "aggregate") {
      expect(res.data.payload.buckets).toEqual([
        { group_key: null, metric: 3 },
      ]);
    } else {
      throw new Error("expected aggregate payload");
    }
  });

  it("errors when the board is not visible under RLS", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await getWidgetPreviewData({
      kind: "number",
      sourceBoardId: BOARD,
      config: { agg: "count" },
    });
    expect(res.ok).toBe(false);
  });

  it("returns a neutral empty aggregate for a transiently-invalid draft config", async () => {
    maybeSingle.mockResolvedValue({ data: { org_id: "org1" }, error: null });
    // agg:"sum" without valueColumnId fails configSchemaForKind → empty, not error.
    const res = await getWidgetPreviewData({
      kind: "number",
      sourceBoardId: BOARD,
      config: { agg: "sum" },
    });
    expect(res.ok).toBe(true);
    if (res.ok && res.data.ok && res.data.shape === "aggregate") {
      expect(res.data.payload.buckets).toEqual([]);
    } else {
      throw new Error("expected empty aggregate payload");
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});
```

- [ ] **C2. Run it, expect FAIL** (`getWidgetPreviewData` not exported):
      `pnpm test -- src/lib/dashboards/actions.preview.test.ts` → FAIL.

- [ ] **C3. Implement `getWidgetPreviewData` in `actions.ts`.** Add near the other read actions. Note the **transiently-invalid draft** rule: while the user is mid-edit the draft config is frequently invalid (e.g. `agg:"sum"` before a column is picked); mirror the live widgets' behavior by returning a **neutral empty payload** for that kind (so the preview shows the widget's own "No data"/configure affordance), not a scary error. A hard failure (RPC error, board not visible) is still an error slot.

```ts
import type { SeriesData } from "@/lib/dashboards/series";
import {
  resolveAggregate,
  resolveCompletion,
  resolveHealth,
  resolveSeries,
  resolveRows,
  type WidgetRowsData,
} from "@/lib/dashboards/widget-resolve";
// (add getWidgetPreviewDataSchema to the existing import from "@/lib/validations/dashboards")

/** Result of a single draft preview fetch — one shape per widget family. */
export type WidgetPreviewResult =
  | { ok: true; shape: "aggregate"; payload: WidgetAggregatePayload }
  | { ok: true; shape: "series"; payload: SeriesData }
  | { ok: true; shape: "rows"; payload: WidgetRowsData }
  | { ok: false; error: string };

/**
 * Resolve a *draft* widget's data for the config-sheet live preview. Unlike the
 * id-keyed reads, the config is unsaved client draft state, so it's passed in
 * directly. Authorization: re-read the board row with the RLS-scoped client to
 * derive org_id — a board the caller can't see is absent ⇒ error. The config is
 * Zod-validated per kind; a transiently-invalid draft yields a neutral empty
 * payload (the preview shows the widget's own configure/empty state), matching
 * how half-configured live widgets render. Uncached: every draft is fresh.
 */
export async function getWidgetPreviewData(input: {
  kind: Widget["kind"];
  sourceBoardId: string;
  config: Record<string, unknown>;
}): Promise<ActionResult<WidgetPreviewResult>> {
  const parsed = getWidgetPreviewDataSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  // Validate the kind-specific shape; invalid drafts render as neutral/empty.
  const kindParsed = widgetKindSchema.safeParse(parsed.data.kind);
  if (!kindParsed.success) return fail("Unsupported widget kind.");
  const cfg = configSchemaForKind(kindParsed.data).safeParse(
    parsed.data.config,
  );
  const config = cfg.success ? (cfg.data as Record<string, unknown>) : null;

  const supabase = await createClient();
  // Tenant boundary: derive org from an RLS-visible board row, never the client.
  const { data: board } = await supabase
    .from("boards")
    .select("org_id")
    .eq("id", parsed.data.sourceBoardId)
    .maybeSingle();
  if (!board) return fail("Board not found.");
  const orgId = board.org_id;
  const boardId = parsed.data.sourceBoardId;

  // Chart + list.
  if (kindParsed.data === "chart") {
    if (!config)
      return {
        ok: true,
        data: {
          ok: true,
          shape: "series",
          payload: {
            chartType: "bar",
            primaryKind: "date",
            seriesKind: null,
            points: [],
          },
        },
      };
    const r = await resolveSeries(supabase, { boardId, orgId, config });
    return r.ok
      ? { ok: true, data: { ok: true, shape: "series", payload: r.data } }
      : { ok: true, data: { ok: false, error: r.error } };
  }
  if (kindParsed.data === "list") {
    if (!config)
      return {
        ok: true,
        data: { ok: true, shape: "rows", payload: { columns: [], rows: [] } },
      };
    const r = await resolveRows(supabase, { boardId, config });
    return r.ok
      ? { ok: true, data: { ok: true, shape: "rows", payload: r.data } }
      : { ok: true, data: { ok: false, error: r.error } };
  }

  // Aggregate family (number / battery / completion / health).
  if (!config)
    return {
      ok: true,
      data: {
        ok: true,
        shape: "aggregate",
        payload: {
          kind: kindParsed.data,
          config: {},
          buckets: [],
          columnMeta: null,
        },
      },
    };

  if (kindParsed.data === "completion") {
    const r = await resolveCompletion(supabase, { boardId, config });
    if (!r.ok) return { ok: true, data: { ok: false, error: r.error } };
    return {
      ok: true,
      data: {
        ok: true,
        shape: "aggregate",
        payload: {
          kind: kindParsed.data,
          config,
          buckets: [],
          columnMeta: null,
          completion: { rows: r.rows, groups: r.groups },
        },
      },
    };
  }
  if (kindParsed.data === "health") {
    const r = await resolveHealth(supabase, { boardId });
    if (!r.ok) return { ok: true, data: { ok: false, error: r.error } };
    return {
      ok: true,
      data: {
        ok: true,
        shape: "aggregate",
        payload: {
          kind: kindParsed.data,
          config,
          buckets: [],
          columnMeta: null,
          health: r.counts,
        },
      },
    };
  }
  // number / battery
  const r = await resolveAggregate(supabase, { boardId, config });
  if (!r.ok) return { ok: true, data: { ok: false, error: r.error } };
  return {
    ok: true,
    data: {
      ok: true,
      shape: "aggregate",
      payload: {
        kind: kindParsed.data,
        config,
        buckets: r.buckets,
        columnMeta: r.columnMeta,
      },
    },
  };
}
```

> Note: the outer `ActionResult` is `{ ok:false }` only for **input** failures (bad schema). Board-not-visible / RPC errors surface as an inner `{ ok:true, data:{ ok:false, error } }` so the provider can render a per-widget error slot without a thrown action. The board-not-found case above uses `fail(...)` (outer error) — either is acceptable; the provider treats both as `isError`. Keep board-not-found as `fail(...)` for a clear signal.

- [ ] **C4. Run it, expect PASS.** `pnpm test -- src/lib/dashboards/actions.preview.test.ts` → PASS.

- [ ] **C5. Commit.**
  ```bash
  git add src/lib/dashboards/actions.ts src/lib/dashboards/actions.preview.test.ts
  git commit  # subject: feat(dashboards): add getWidgetPreviewData draft-aware read
  ```

---

### Group D — `SingleWidgetDataProvider` + preview provider/hook seams

- [ ] **D1. Export `SingleWidgetDataProvider` from `use-widget-data.tsx`.** This lets the preview feed one aggregate slot into the existing `WidgetDataContext` so the four aggregate widget bodies (and `useWidgetData`) work **unchanged**. Add below `WidgetDataProvider`:

```tsx
/**
 * Feed a single widget's already-resolved slot into WidgetDataContext — used by
 * the config-sheet live preview, which fetches one draft widget outside the
 * dashboard grid. `slot === undefined` while loading; a resolved `{ ok:false }`
 * slot surfaces as that widget's error, exactly like the batched path.
 */
export function SingleWidgetDataProvider({
  widgetId,
  slot,
  isLoading,
  isError,
  children,
}: {
  widgetId: string;
  slot: WidgetDataResult | undefined;
  isLoading: boolean;
  isError: boolean;
  children: ReactNode;
}) {
  const value = useMemo<WidgetDataContextValue>(
    () => ({
      isLoading,
      isError,
      results: slot ? { [widgetId]: slot } : undefined,
    }),
    [widgetId, slot, isLoading, isError],
  );
  return (
    <WidgetDataContext.Provider value={value}>
      {children}
    </WidgetDataContext.Provider>
  );
}
```

(Requires importing the existing `WidgetDataResult` type at the top of the file — it's already available via `import type { WidgetDataResult } from "@/lib/dashboards/actions";`.)

- [ ] **D2. Write the failing test for the provider** `src/lib/dashboards/use-widget-preview.test.tsx`. Mock `getWidgetPreviewData`; assert (a) one fetch for an aggregate draft feeds `useWidgetData`; (b) a chart draft feeds `useWidgetPreview().series`; (c) `sourceBoardId===""` ⇒ no fetch. Full test:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const getWidgetPreviewData = vi.fn();
vi.mock("@/lib/dashboards/actions", () => ({ getWidgetPreviewData }));

import { WidgetPreviewProvider, useWidgetPreview } from "./use-widget-preview";
import { useWidgetData } from "./use-widget-data";

const BOARD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PID = "__preview__";

function AggProbe() {
  const { data, isError } = useWidgetData(PID);
  return (
    <div data-testid="agg">
      {isError
        ? "error"
        : `total:${(data?.buckets ?? []).reduce((s, b) => s + b.metric, 0)}`}
    </div>
  );
}
function SeriesProbe() {
  const { series } = useWidgetPreview();
  return <div data-testid="series">pts:{series?.points.length ?? "none"}</div>;
}

function wrap(kind: string, sourceBoardId: string, ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WidgetPreviewProvider
        previewWidgetId={PID}
        kind={kind as never}
        sourceBoardId={sourceBoardId}
        config={{ agg: "count" }}
      >
        {ui}
      </WidgetPreviewProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => getWidgetPreviewData.mockReset());

describe("WidgetPreviewProvider", () => {
  it("feeds an aggregate draft into useWidgetData", async () => {
    getWidgetPreviewData.mockResolvedValue({
      ok: true,
      data: {
        ok: true,
        shape: "aggregate",
        payload: {
          kind: "number",
          config: {},
          buckets: [{ group_key: null, metric: 6 }],
          columnMeta: null,
        },
      },
    });
    wrap("number", BOARD, <AggProbe />);
    await waitFor(() =>
      expect(screen.getByTestId("agg")).toHaveTextContent("total:6"),
    );
    expect(getWidgetPreviewData).toHaveBeenCalledTimes(1);
    expect(getWidgetPreviewData).toHaveBeenCalledWith({
      kind: "number",
      sourceBoardId: BOARD,
      config: { agg: "count" },
    });
  });

  it("feeds a chart draft into useWidgetPreview().series", async () => {
    getWidgetPreviewData.mockResolvedValue({
      ok: true,
      data: {
        ok: true,
        shape: "series",
        payload: {
          chartType: "bar",
          primaryKind: "date",
          seriesKind: null,
          points: [
            {
              primaryKey: "k",
              primaryLabel: "K",
              seriesKey: null,
              seriesLabel: null,
              seriesColor: "#000",
              value: 1,
            },
          ],
        },
      },
    });
    wrap("chart", BOARD, <SeriesProbe />);
    await waitFor(() =>
      expect(screen.getByTestId("series")).toHaveTextContent("pts:1"),
    );
  });

  it("does not fetch when no board is chosen", () => {
    wrap("number", "", <AggProbe />);
    expect(getWidgetPreviewData).not.toHaveBeenCalled();
  });
});
```

- [ ] **D3. Run it, expect FAIL** (module missing): `pnpm test -- src/lib/dashboards/use-widget-preview.test.tsx` → FAIL.

- [ ] **D4. Implement `src/lib/dashboards/use-widget-preview.tsx`.**

```tsx
"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { getWidgetPreviewData } from "@/lib/dashboards/actions";
import type { WidgetDataResult } from "@/lib/dashboards/actions";
import { SingleWidgetDataProvider } from "@/lib/dashboards/use-widget-data";
import { configHash } from "@/lib/dashboards/widget-data";
import type { CacheWidget } from "@/lib/dashboards/cache";
import type { SeriesData } from "@/lib/dashboards/series";
import type { WidgetRowsData } from "@/lib/dashboards/widget-resolve";

type WidgetPreviewContextValue = {
  active: boolean;
  isLoading: boolean;
  isError: boolean;
  series: SeriesData | undefined;
  rows: WidgetRowsData | undefined;
};

const WidgetPreviewContext = createContext<WidgetPreviewContextValue | null>(
  null,
);

/**
 * Fetch ONE draft widget's data for the config-sheet live preview, keyed on the
 * (debounced) draft config so a config edit refetches exactly one widget and a
 * mere kind/board re-pick re-keys cleanly. Feeds aggregate kinds through the
 * existing WidgetDataContext (so NumberWidget/BatteryWidget/CompletionWidget/
 * HealthWidget stay unchanged) and chart/list through WidgetPreviewContext
 * (read by useWidgetSeries/useWidgetRows). Disabled until a board is chosen.
 */
export function WidgetPreviewProvider({
  previewWidgetId,
  kind,
  sourceBoardId,
  config,
  children,
}: {
  previewWidgetId: string;
  kind: CacheWidget["kind"];
  sourceBoardId: string;
  config: Record<string, unknown>;
  children: ReactNode;
}) {
  const query = useQuery({
    queryKey: ["widget-preview", kind, sourceBoardId, configHash(config)],
    queryFn: async () => {
      const res = await getWidgetPreviewData({ kind, sourceBoardId, config });
      if (!res.ok) throw new Error(res.error);
      return res.data; // WidgetPreviewResult
    },
    enabled: Boolean(sourceBoardId),
    staleTime: 60_000,
  });

  const result = query.data;
  const isError = query.isError || result?.ok === false;

  // Aggregate slot for WidgetDataContext (undefined while loading / for non-agg).
  const aggregateSlot: WidgetDataResult | undefined = useMemo(() => {
    if (query.isError) return { ok: false, error: "Failed to load" };
    if (!result) return undefined;
    if (result.ok === false) return { ok: false, error: result.error };
    if (result.shape !== "aggregate") return undefined;
    return { ok: true, ...result.payload };
  }, [query.isError, result]);

  const previewValue = useMemo<WidgetPreviewContextValue>(
    () => ({
      active: true,
      isLoading: query.isLoading && Boolean(sourceBoardId),
      isError,
      series:
        result && result.ok && result.shape === "series"
          ? result.payload
          : undefined,
      rows:
        result && result.ok && result.shape === "rows"
          ? result.payload
          : undefined,
    }),
    [query.isLoading, sourceBoardId, isError, result],
  );

  return (
    <SingleWidgetDataProvider
      widgetId={previewWidgetId}
      slot={aggregateSlot}
      isLoading={query.isLoading && Boolean(sourceBoardId)}
      isError={isError}
    >
      <WidgetPreviewContext.Provider value={previewValue}>
        {children}
      </WidgetPreviewContext.Provider>
    </SingleWidgetDataProvider>
  );
}

/** Read the current preview slice. `active:false` outside a preview provider. */
export function useWidgetPreview(): WidgetPreviewContextValue {
  const ctx = useContext(WidgetPreviewContext);
  return (
    ctx ?? {
      active: false,
      isLoading: false,
      isError: false,
      series: undefined,
      rows: undefined,
    }
  );
}
```

- [ ] **D5. Add the preview short-circuit to `use-widget-series.ts`.** `useContext` is called unconditionally (hook-rules safe); the query is disabled in preview mode so no id-keyed fetch fires:

```ts
"use client";

import { useQuery } from "@tanstack/react-query";

import { getWidgetSeries } from "@/lib/dashboards/actions";
import { configHash } from "@/lib/dashboards/widget-data";
import { useWidgetPreview } from "@/lib/dashboards/use-widget-preview";
import type { SeriesData } from "@/lib/dashboards/series";

export function useWidgetSeries(
  widgetId: string,
  config: Record<string, unknown>,
) {
  const preview = useWidgetPreview();
  const query = useQuery({
    queryKey: ["dashboard-widget-series", widgetId, configHash(config)],
    queryFn: async (): Promise<SeriesData> => {
      const res = await getWidgetSeries({ widgetId });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: !preview.active,
    staleTime: 60_000,
  });
  if (preview.active)
    return {
      data: preview.series,
      isLoading: preview.isLoading,
      isError: preview.isError,
    };
  return query;
}
```

- [ ] **D6. Add the same short-circuit to `use-widget-rows.ts`.**

```ts
"use client";

import { useQuery } from "@tanstack/react-query";

import { getWidgetRows } from "@/lib/dashboards/actions";
import { configHash } from "@/lib/dashboards/widget-data";
import { useWidgetPreview } from "@/lib/dashboards/use-widget-preview";
import type { DisplayColumn } from "@/lib/dashboards/list-rows";

export type WidgetRows = {
  columns: DisplayColumn[];
  rows: { itemId: string; name: string; cells: Record<string, unknown> }[];
};

export function useWidgetRows(
  widgetId: string,
  config: Record<string, unknown>,
) {
  const preview = useWidgetPreview();
  const query = useQuery({
    queryKey: ["dashboard-widget-rows", widgetId, configHash(config)],
    queryFn: async (): Promise<WidgetRows> => {
      const res = await getWidgetRows({ widgetId });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    enabled: !preview.active,
    staleTime: 60_000,
  });
  if (preview.active)
    return {
      data: preview.rows,
      isLoading: preview.isLoading,
      isError: preview.isError,
    };
  return query;
}
```

> Type note: `WidgetRowsData` (widget-resolve) and `WidgetRows` (use-widget-rows) are structurally identical; `preview.rows` (typed `WidgetRowsData`) is assignable to the `WidgetRows` return. Keep both type aliases — they're structurally compatible, so no cast is needed.

- [ ] **D7. Run it, expect PASS.** `pnpm test -- src/lib/dashboards/use-widget-preview.test.tsx` → PASS. Also re-run `pnpm test -- src/lib/dashboards` to confirm series/rows/data tests still pass (the short-circuit is inert when no preview provider wraps them — `preview.active === false`).

- [ ] **D8. Commit.**
  ```bash
  git add src/lib/dashboards/use-widget-data.tsx src/lib/dashboards/use-widget-preview.tsx src/lib/dashboards/use-widget-preview.test.tsx src/lib/dashboards/use-widget-series.ts src/lib/dashboards/use-widget-rows.ts
  git commit  # subject: feat(dashboards): preview provider feeding widget bodies
  ```

---

### Group E — Wire the sheet's live-preview block

- [ ] **E1. Wrap the preview block in `WidgetConfigSheet.tsx`.** Import the provider and wrap only the preview column (the `WidgetConfigForm` stays outside — it's pure draft state). The provider keys on `draft.kind`, `draft.sourceBoardId`, and the **debounced** `previewCfg` (all already in scope). Replace lines 141-160 (the `<div className="flex flex-col gap-2">…</div>` preview column):

```tsx
<div className="flex flex-col gap-2">
  <span className="text-muted-foreground text-xs tracking-wide uppercase">
    Live preview
  </span>
  <div className="bg-card relative h-64 rounded-xl border p-3">
    <WidgetPreviewProvider
      previewWidgetId={previewWidget.id}
      kind={draft.kind}
      sourceBoardId={draft.sourceBoardId}
      config={previewCfg}
    >
      {draft.kind === "number" ? (
        <NumberWidget widget={previewWidget} />
      ) : draft.kind === "chart" ? (
        <ChartWidget widget={previewWidget} />
      ) : draft.kind === "battery" ? (
        <BatteryWidget widget={previewWidget} />
      ) : draft.kind === "completion" ? (
        <CompletionWidget widget={previewWidget} />
      ) : draft.kind === "health" ? (
        <HealthWidget widget={previewWidget} />
      ) : (
        <ListWidget widget={previewWidget} />
      )}
    </WidgetPreviewProvider>
  </div>
</div>
```

Add the import: `import { WidgetPreviewProvider } from "@/lib/dashboards/use-widget-preview";`.

> `previewWidget.id` (= `target?.id ?? "__preview__"`) is only the local render key into `WidgetDataContext`; the fetch keys on `kind`/`sourceBoardId`/`previewCfg`, so the preview reflects the **draft**, never the persisted row.

- [ ] **E2. Typecheck + lint the touched files.** `pnpm typecheck && pnpm lint` → PASS.

- [ ] **E3. Commit.**
  ```bash
  git add src/components/dashboards/WidgetConfigSheet.tsx
  git commit  # subject: feat(dashboards): render live preview inside the preview provider
  ```

---

### Group F — Rewrite the regression tests

The old `WidgetConfigSheet.test.tsx` asserted the **buggy** behavior ("outside WidgetDataProvider ⇒ Failed to load"). Rewrite it to assert the **fixed** behavior: the preview mounts inside `WidgetPreviewProvider`, and live draft data renders.

- [ ] **F1. Rewrite `src/components/dashboards/WidgetConfigSheet.test.tsx`.** Mock `getWidgetPreviewData` (the sheet's only data source now) alongside the existing action mocks. Full file:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const getWidgetPreviewData = vi.fn();
vi.mock("@/lib/dashboards/actions", () => ({
  createWidget: vi.fn(),
  updateWidgetConfig: vi.fn(),
  deleteWidget: vi.fn(),
  renameDashboard: vi.fn(),
  saveLayout: vi.fn(),
  getWidgetsData: vi.fn(),
  getWidgetRows: vi.fn(),
  getWidgetSeries: vi.fn(),
  getWidgetPreviewData: (...a: unknown[]) => getWidgetPreviewData(...a),
}));

// Chart (recharts) and List rendering internals are out of scope here; the
// aggregate widgets stay REAL so we prove live data reaches the preview body.
vi.mock("@/components/dashboards/widgets/ChartWidget", () => ({
  ChartWidget: () => <div data-testid="chart-widget" />,
}));
vi.mock("@/components/dashboards/widgets/ListWidget", () => ({
  ListWidget: () => <div data-testid="list-widget" />,
}));

import { WidgetConfigSheet } from "./WidgetConfigSheet";
import type { BoardOption } from "./WidgetConfigForm";
import type { CacheWidget } from "@/lib/dashboards/cache";

const BOARD_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const WIDGET_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const boardOption: BoardOption = {
  id: BOARD_ID,
  name: "Sprint board",
  numbersColumns: [],
  statusColumns: [{ id: "col-1", name: "Status" }],
  dateColumns: [],
  peopleColumns: [],
  dropdownColumns: [],
  percentColumns: [],
  allColumns: [],
};

function renderSheet(props: {
  boards: BoardOption[];
  editWidget?: CacheWidget;
}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <WidgetConfigSheet
      dashboardId="dash1"
      boards={props.boards}
      open
      onOpenChange={() => {}}
      editWidget={props.editWidget}
    />,
    { wrapper: Wrapper },
  );
}

describe("WidgetConfigSheet live preview (inside WidgetPreviewProvider)", () => {
  it("opens the add-widget sheet without a board and issues no preview fetch", () => {
    getWidgetPreviewData.mockReset();
    renderSheet({ boards: [] });
    expect(screen.getByText("Add a widget")).toBeInTheDocument();
    expect(screen.getByText("Live preview")).toBeInTheDocument();
    // No source board → widget shows its own affordance; no server round-trip.
    expect(screen.getByText("Pick a source board")).toBeInTheDocument();
    expect(getWidgetPreviewData).not.toHaveBeenCalled();
  });

  it("renders LIVE number data in the preview once a board is preselected", async () => {
    getWidgetPreviewData.mockReset();
    getWidgetPreviewData.mockResolvedValue({
      ok: true,
      data: {
        ok: true,
        shape: "aggregate",
        payload: {
          kind: "number",
          config: { agg: "count" },
          buckets: [{ group_key: null, metric: 42 }],
          columnMeta: null,
        },
      },
    });
    renderSheet({ boards: [boardOption] });
    // The real NumberWidget renders the fetched metric — not "Failed to load".
    await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());
    expect(screen.queryByText("Failed to load")).not.toBeInTheDocument();
    // Debounced single-widget fetch for the draft (kind+board+config).
    await waitFor(() =>
      expect(getWidgetPreviewData).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "number", sourceBoardId: BOARD_ID }),
      ),
    );
  });

  it("renders LIVE battery data in edit mode from the draft config", async () => {
    getWidgetPreviewData.mockReset();
    getWidgetPreviewData.mockResolvedValue({
      ok: true,
      data: {
        ok: true,
        shape: "aggregate",
        payload: {
          kind: "battery",
          config: { groupColumnId: "col-1" },
          buckets: [{ group_key: "col-1", metric: 3 }],
          columnMeta: {
            kind: "status",
            options: [{ id: "col-1", label: "Status", color: "#22c55e" }],
          },
        },
      },
    });
    const target = {
      id: WIDGET_ID,
      kind: "battery",
      title: "By status",
      config: { groupColumnId: "col-1" },
      source_board_id: BOARD_ID,
      dashboard_id: "dash1",
      org_id: "org1",
      layout: {},
      position: 0,
      created_at: "2026-06-18T00:00:00Z",
      updated_at: "2026-06-18T00:00:00Z",
    } as CacheWidget;

    renderSheet({ boards: [boardOption], editWidget: target });
    expect(screen.getByText("Edit widget")).toBeInTheDocument();
    // BatteryWidget renders its option label from live data (no error state).
    await waitFor(() => expect(screen.getByText("Status")).toBeInTheDocument());
    expect(screen.queryByText("Failed to load")).not.toBeInTheDocument();
  });

  it("shows the preview error state when the draft fetch fails", async () => {
    getWidgetPreviewData.mockReset();
    getWidgetPreviewData.mockResolvedValue({ ok: false, error: "boom" });
    renderSheet({ boards: [boardOption] });
    await waitFor(() =>
      expect(screen.getByText("Failed to load")).toBeInTheDocument(),
    );
  });
});
```

> Before finalizing F1, open `BatteryWidget.tsx` and confirm the exact text it renders for a shaped bucket (option label vs. a percentage). If it does not render the literal option label "Status", adjust the assertion in the battery test to the actual rendered text (e.g. a percentage or count). The number test (`"42"`) is robust; the battery assertion must match `BatteryWidget`'s real output.

- [ ] **F2. Run the sheet tests, expect PASS.** `pnpm test -- src/components/dashboards/WidgetConfigSheet.test.tsx` → PASS.

- [ ] **F3. Confirm the still-valid provider-less test.** `use-widget-data.test.tsx`'s "degrades to a non-crashing error state when rendered without a provider" is unchanged and must still PASS (`useWidgetData` was not modified): `pnpm test -- src/lib/dashboards/use-widget-data.test.tsx` → PASS.

- [ ] **F4. Full gate.**

  ```bash
  pnpm typecheck && pnpm lint && pnpm test && pnpm build
  ```

  Expected: all PASS. (If cold `pnpm typecheck` complains about `cacheLife("nav"/"guard")` `.next/types`, run `pnpm build` first — known env quirk, not a real break.)

- [ ] **F5. Commit.**
  ```bash
  git add src/components/dashboards/WidgetConfigSheet.test.tsx
  git commit  # subject: test(dashboards): assert live data renders in widget preview
  ```

---

## Execution DAG

**This plan is a single self-contained task — one node.** The change is one cohesive data-path unit: the shared resolvers, the preview action, the preview provider/hook seams, the sheet wiring, and the test rewrite only make sense together and share a single review gate and a single test cycle. Groups A–F are an **internal linear sequence within the one node** (each group's output is consumed by the next: schema → resolvers → action → provider/hooks → sheet → tests), not independently shippable tasks.

- **Dependency graph:** `{Task 1}` — no dependencies, no dependents.
- **Parallel batches:** Batch 1 = `{Task 1}`. There is no second task, so there is nothing to parallelize; dispatch as a single agent (no `dispatching-parallel-agents` needed).
- **Critical path:** Task 1 (A→B→C→D→E→F). Wall-clock floor = this one task.

---

## Self-Review

- **Spec coverage:** Live data for all six kinds ✓ (aggregate via `SingleWidgetDataProvider`+`useWidgetData`; chart via `resolveSeries`+`useWidgetSeries`; list via `resolveRows`+`useWidgetRows`). Debounced single-widget fetch ✓ (existing `previewCfg` 400 ms + query key). No dashboard refetch ✓ (dashboard provider not mounted in the sheet). Tenant boundary ✓ (org derived from RLS-read board). Regression tests rewritten ✓ (Group F). Next 16 caching claim grounded ✓ (uncached read per `08-caching.md`). Execution DAG ✓ (single node).
- **Placeholder scan:** No TBD/TODO; every code step shows complete code except two explicit verbatim-move steps (B3 series/rows, referencing exact existing line ranges) and one verify-the-rendered-text note (F1 battery assertion) — both are precise instructions, not vague ones.
- **Type consistency:** `WidgetPreviewResult` (shape: "aggregate"|"series"|"rows") used identically in the action, provider, and tests. `WidgetRowsData` defined once in `widget-resolve.ts`, structurally compatible with `useWidgetRows`'s `WidgetRows`. `SingleWidgetDataProvider` signature identical in D1 and its consumer in D4. `useWidgetPreview()` return shape identical in D4 and its consumers D5/D6.
- **Risk notes:** (a) The B5 refactor of `getWidgetSeries`/`getWidgetRows` is behavior-preserving — guarded by B6 re-running the existing dashboards tests. (b) The live cached path (`queries-cached.ts`) is deliberately untouched. (c) The preview short-circuit in the two hooks is inert (`preview.active === false`) outside a preview provider, so the live canvas is unaffected.

---

## Status

**Spec written, awaiting review.** No source, tests, or commits have been produced by the scoping session — this document is the plan only. Implementation begins after review approval.
