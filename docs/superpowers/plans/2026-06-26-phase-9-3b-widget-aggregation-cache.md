# Phase 9.3b — Dashboard Widget Aggregation Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache the dashboard widget aggregation RPC read so a widget's data isn't recomputed on every load, matching the 9.3a `use cache` pattern already shipped (`listDashboardsCached`).

**Architecture:** Extract the `dashboard_aggregate` RPC read (plus the group-column option resolution) into a cached query function `getWidgetAggregationCached(widgetId, orgId)` wrapped with `"use cache"` + a short `cacheLife("widget")` TTL + a per-widget cache tag scoped by **org AND widget id** (`widgetAggregationTag(orgId, widgetId)`) so cross-tenant isolation holds by construction. The existing `getWidgetData` Server Action delegates to it (resolving the widget's org first, with the service client, so the org is part of the cache key + tag). Widget **config** mutations (`createWidget`/`updateWidgetConfig`/`deleteWidget`) call `updateTag` for read-your-own-writes. Board **cell-data** mutations (cell edits, item create/delete) are too numerous/diffuse to tag reliably, so data freshness from those is bounded by the short `cacheLife("widget")` TTL — a deliberate, documented tradeoff.

**Tech Stack:** Next.js 16 Cache Components (`"use cache"`, `cacheLife`, `cacheTag`, `updateTag`), Supabase service client (RLS-bypassing, org filter is the tenant boundary), Vitest, Zod.

---

## Why a short TTL instead of full tag invalidation (the data-freshness tradeoff)

A widget aggregation reads a board's `items` + `cell_values` via `dashboard_aggregate`. Those rows change on **every** board interaction — each cell edit, item add/delete, status change — across many Server Actions in `src/lib/boards/`. Tagging every one of those mutation paths with a widget-scoped tag is infeasible (a board feeds N widgets across M dashboards; the mutation site doesn't know which widgets consume it without an extra query per write). Per the brief, when reliable cross-source tag invalidation isn't cheap, prefer a **short conservative `cacheLife` TTL** over aggressive/incorrect tagging.

- **`cacheLife("widget")` = `{ stale: 30, revalidate: 30, expire: 300 }`** — at most ~30s of staleness for board-data edits, and it stays `revalidate >= 30` / `expire >= 300` so it does not punch a forced-dynamic hole in the 9.2 streaming shell (same constraint the existing `nav`/`guard` profiles satisfy; see `next.config.ts` + `cacheLife.md`).
- **Per-widget tag (`widgetAggregationTag(orgId, widgetId)`)** still gives instant read-your-own-writes for **widget config** changes (source board, group/value column, agg) — those all flow through Server Actions we control, so we `updateTag` there. A user editing a widget sees the change immediately; only _other people's board-data edits_ wait out the ≤30s TTL.

## Performance & data-fetching budget (working-agreement #5)

- **First paint / load:** `getWidgetData` is a Server Action invoked by the `useWidgetData` React-Query hook (client). No change to that round-trip count. The win is server-side: repeated loads of the same widget within the TTL window reuse the cached aggregation instead of re-running the RPC + column-option query.
- **Interaction → server data?** Widget config edits DO change server data → Server Action + `updateTag` (targeted). Layout drags do NOT change aggregation data → already keyed out by the React-Query key (`configHash`), untouched here.
- **Bounded + indexed:** unchanged — `dashboard_aggregate` is already a bounded server RPC over indexed `board_id`. We only wrap it; we do not widen the read.

## Cross-tenant isolation (RLS note)

The cached function uses the **service client** (bypasses RLS), exactly like `listDashboardsCached`. Safety comes from two things, both enforced here: (1) the Server Action resolves the widget's `org_id` from `dashboard_widgets` and passes it in, so `orgId` is part of the cache key AND the tag — a second org can never serve or invalidate org A's entry; (2) the cached function takes `boardId` already resolved from that same widget row, so it cannot read a board outside the widget's org. The tag is `widget-agg:org:${orgId}:widget:${widgetId}` — identity-scoped by construction.

## File Structure

- `src/lib/cache/tags.ts` — add `widgetAggregationTag(orgId, widgetId)`.
- `next.config.ts` — add the `widget` cacheLife profile.
- `src/lib/dashboards/queries-cached.ts` — add `getWidgetAggregationCached(...)` (the cached read; moves the RPC + column-meta resolution out of the action).
- `src/lib/dashboards/actions.ts` — `getWidgetData` delegates to the cached fn (resolves org first); `createWidget`/`updateWidgetConfig`/`deleteWidget` call `updateTag(widgetAggregationTag(...))`.
- `src/lib/dashboards/queries-cached.test.ts` — extend with widget-aggregation caching + cross-tenant isolation tests.

No migration. No UI/component change. The `useWidgetData` hook and widget renderers are untouched.

---

### Task 1: Add the per-widget cache tag

**Files:**

- Modify: `src/lib/cache/tags.ts`
- Test: `src/lib/cache/tags.test.ts` (create if absent; otherwise extend)

- [ ] **Step 1: Write the failing test**

Check whether `src/lib/cache/tags.test.ts` exists. If it does, append the `describe` block below; if not, create it with this content:

```ts
import { describe, expect, it } from "vitest";
import { widgetAggregationTag } from "./tags";

describe("widgetAggregationTag", () => {
  it("scopes by org AND widget id (cross-tenant isolation)", () => {
    expect(widgetAggregationTag("org-A", "w1")).toBe(
      "widget-agg:org:org-A:widget:w1",
    );
  });

  it("differs across orgs for the same widget id", () => {
    expect(widgetAggregationTag("org-A", "w1")).not.toBe(
      widgetAggregationTag("org-B", "w1"),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --project unit -- src/lib/cache/tags.test.ts`
Expected: FAIL — `widgetAggregationTag` is not exported.

- [ ] **Step 3: Add the tag**

In `src/lib/cache/tags.ts`, after the `orgAdminTag` export, add:

```ts
export const widgetAggregationTag = (orgId: string, widgetId: string) =>
  `widget-agg:org:${orgId}:widget:${widgetId}`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --project unit -- src/lib/cache/tags.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cache/tags.ts src/lib/cache/tags.test.ts
git commit -m "feat(cache): add per-widget aggregation cache tag (org+widget scoped)"
```

---

### Task 2: Add the `widget` cacheLife profile

**Files:**

- Modify: `next.config.ts`

- [ ] **Step 1: Add the profile**

In `next.config.ts`, inside the `cacheLife` object, add a `widget` profile alongside `nav` and `guard`, and extend the comment to mention it:

```ts
  cacheLife: {
    nav: { stale: 60, revalidate: 60, expire: 3600 },
    guard: { stale: 60, revalidate: 300, expire: 3600 },
    // `widget` for dashboard widget aggregations: board cell-data feeding them
    // changes from too many sources to tag reliably, so freshness is bounded by
    // a short TTL (config edits stay instant via updateTag on the per-widget
    // tag). revalidate >= 30 / expire >= 300 keeps it from forcing a dynamic
    // hole in the 9.2 streaming shell (see cacheLife.md, Prerendering behavior).
    widget: { stale: 30, revalidate: 30, expire: 300 },
  },
```

- [ ] **Step 2: Verify typecheck passes (config is type-checked)**

Run: `pnpm typecheck`
Expected: PASS (no type errors from the new profile).

- [ ] **Step 3: Commit**

```bash
git add next.config.ts
git commit -m "feat(cache): add short-TTL 'widget' cacheLife profile for widget aggregations"
```

---

### Task 3: Extract the cached widget-aggregation read

**Files:**

- Modify: `src/lib/dashboards/queries-cached.ts`
- Test: `src/lib/dashboards/queries-cached.test.ts`

The cached function reproduces exactly what `getWidgetData` does **after** it has the widget row: run `dashboard_aggregate`, then (for grouped widgets) resolve the group column's options. It takes the already-resolved `orgId`, `boardId`, `config`, and `groupColumnId` so it's pure-by-inputs (cache-keyable) and tenant-scoped.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/dashboards/queries-cached.test.ts`. The existing file already mocks `next/cache` with `cacheTag`/`cacheLife`; extend that mock to include the chainable RPC/maybeSingle service-client surface this function needs. Replace the existing service-client mock block and add the new describe block:

```ts
// ---- widget aggregation cache ----
// Extend the service-client mock to support .rpc() and a columns lookup.
const rpc = vi.fn();
const colMaybeSingle = vi.fn();
const colEq = vi.fn(() => ({ maybeSingle: colMaybeSingle }));
const colSelect = vi.fn(() => ({ eq: colEq }));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) =>
      table === "columns"
        ? { select: colSelect }
        : { select: (() => ({ eq: () => ({ order: orderForList }) }))() },
    rpc,
  }),
}));
```

> NOTE: if the existing `from`/`select`/`eq`/`order` mock at the top of the file conflicts, consolidate into a single `createServiceClient` mock that branches on the table name. Rename the list-test's `order` mock to `orderForList` and update `listDashboardsCached`'s tests to use it. Keep both describe blocks green.

```ts
import { getWidgetAggregationCached } from "./queries-cached";

describe("getWidgetAggregationCached", () => {
  beforeEach(() => {
    rpc.mockReset();
    colMaybeSingle.mockReset();
  });

  it("runs dashboard_aggregate for the widget's board and maps buckets", async () => {
    rpc.mockResolvedValue({
      data: [{ group_key: "opt1", metric: "3" }],
      error: null,
    });
    const res = await getWidgetAggregationCached({
      widgetId: "w1",
      orgId: "org-A",
      boardId: "board-1",
      config: { agg: "count" },
      groupColumnId: null,
    });
    expect(rpc).toHaveBeenCalledWith(
      "dashboard_aggregate",
      expect.objectContaining({ p_board_id: "board-1", p_agg: "count" }),
    );
    expect(res.buckets).toEqual([{ group_key: "opt1", metric: 3 }]);
    expect(res.columnMeta).toBeNull();
  });

  it("resolves group-column options when grouped", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    colMaybeSingle.mockResolvedValue({
      data: {
        kind: "status",
        settings: { options: [{ id: "o1", label: "Open", color: "#fff" }] },
      },
      error: null,
    });
    const res = await getWidgetAggregationCached({
      widgetId: "w1",
      orgId: "org-A",
      boardId: "board-1",
      config: { agg: "count", groupColumnId: "col-1" },
      groupColumnId: "col-1",
    });
    expect(colSelect).toHaveBeenCalled();
    expect(res.columnMeta).toEqual({
      kind: "status",
      options: [{ id: "o1", label: "Open", color: "#fff" }],
    });
  });

  it("returns an error string when the RPC fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await getWidgetAggregationCached({
      widgetId: "w1",
      orgId: "org-A",
      boardId: "board-1",
      config: { agg: "count" },
      groupColumnId: null,
    });
    expect(res.error).toBe("boom");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test --project unit -- src/lib/dashboards/queries-cached.test.ts`
Expected: FAIL — `getWidgetAggregationCached` is not exported.

- [ ] **Step 3: Implement the cached function**

In `src/lib/dashboards/queries-cached.ts`, add the imports and the function. Add `cacheLife`/`cacheTag` are already imported; add `widgetAggregationTag` and `optionSchema`, plus the `AggregateBucket`/`ColumnMeta` types:

```ts
import { optionSchema } from "@/lib/validations/boards";
import { widgetAggregationTag } from "@/lib/cache/tags";
import type { AggregateBucket, ColumnMeta } from "@/lib/dashboards/widget-data";

export type WidgetAggregation =
  | {
      buckets: AggregateBucket[];
      columnMeta: ColumnMeta | null;
      error?: undefined;
    }
  | { error: string; buckets?: undefined; columnMeta?: undefined };

/**
 * Cached widget aggregation read. The caller (getWidgetData) resolves the
 * widget's `orgId` + `boardId` from `dashboard_widgets` first and passes them
 * in: `orgId` is part of the cache key AND the tag, so a second org can never
 * serve or invalidate org A's entry (the service client bypasses RLS — the
 * resolved board/org pair is the tenant boundary, matching listDashboardsCached).
 *
 * Freshness tradeoff: board cell-data feeding the aggregation changes from too
 * many sources to tag reliably, so it's bounded by cacheLife("widget") (~30s).
 * Widget *config* edits stay instant via updateTag on the per-widget tag.
 */
export async function getWidgetAggregationCached(input: {
  widgetId: string;
  orgId: string;
  boardId: string;
  config: Record<string, unknown>;
  groupColumnId: string | null;
}): Promise<WidgetAggregation> {
  "use cache";
  cacheLife("widget");
  cacheTag(widgetAggregationTag(input.orgId, input.widgetId));

  const supabase = createServiceClient();
  const agg = (input.config.agg as string) ?? "count";
  const { data, error } = await supabase.rpc("dashboard_aggregate", {
    p_board_id: input.boardId,
    p_group_column_id: (input.config.groupColumnId as string) ?? undefined,
    p_value_column_id: (input.config.valueColumnId as string) ?? undefined,
    p_agg: agg,
  });
  if (error) return { error: error.message };

  const buckets: AggregateBucket[] = (data ?? []).map((r) => ({
    group_key: r.group_key,
    metric: Number(r.metric),
  }));

  let columnMeta: ColumnMeta | null = null;
  if (input.groupColumnId) {
    const { data: col } = await supabase
      .from("columns")
      .select("kind, settings")
      .eq("id", input.groupColumnId)
      .maybeSingle();
    if (col) {
      const opts = optionSchema
        .array()
        .safeParse((col.settings as { options?: unknown }).options ?? []);
      columnMeta = { kind: col.kind, options: opts.success ? opts.data : [] };
    }
  }

  return { buckets, columnMeta };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test --project unit -- src/lib/dashboards/queries-cached.test.ts`
Expected: PASS (both the existing `listDashboardsCached` tests and the new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboards/queries-cached.ts src/lib/dashboards/queries-cached.test.ts
git commit -m "feat(dashboards): cache widget aggregation read with use cache + short TTL"
```

---

### Task 4: Delegate `getWidgetData` to the cached read; invalidate on config mutations

**Files:**

- Modify: `src/lib/dashboards/actions.ts`
- Test: `src/lib/dashboards/actions.test.ts` (extend if it covers `getWidgetData`; otherwise verify behavior preserved via Task 3 + typecheck)

- [ ] **Step 1: Resolve org + board in `getWidgetData`, delegate to the cached fn**

In `src/lib/dashboards/actions.ts`, change the `getWidgetData` widget select to also fetch `org_id`, and replace the inline RPC + column-meta block with a call to `getWidgetAggregationCached`:

```ts
const supabase = await createClient();
const { data: widget } = await supabase
  .from("dashboard_widgets")
  .select("kind, config, source_board_id, org_id")
  .eq("id", parsed.data.widgetId)
  .maybeSingle();
if (!widget) return fail("Widget not found.");
if (!widget.source_board_id)
  return {
    ok: true,
    data: { kind: widget.kind, config: {}, buckets: [], columnMeta: null },
  };

const config = (widget.config ?? {}) as Record<string, unknown>;
const result = await getWidgetAggregationCached({
  widgetId: parsed.data.widgetId,
  orgId: widget.org_id,
  boardId: widget.source_board_id,
  config,
  groupColumnId: (config.groupColumnId as string | undefined) ?? null,
});
if (result.error) return fail(result.error);

return {
  ok: true,
  data: {
    kind: widget.kind,
    config,
    buckets: result.buckets,
    columnMeta: result.columnMeta,
  },
};
```

Add the import at the top:

```ts
import { getWidgetAggregationCached } from "@/lib/dashboards/queries-cached";
import { widgetAggregationTag } from "@/lib/cache/tags";
```

Remove the now-unused `optionSchema` import **only if** nothing else in the file uses it (`getWidgetRows` and `getWidgetSeries` still use `optionSchema` — so KEEP it). Verify with: `grep -n optionSchema src/lib/dashboards/actions.ts`.

- [ ] **Step 2: Invalidate the per-widget tag on config mutations**

`createWidget` returns the new widget row (`data` is a `Widget` with `org_id` + `id`). After its `revalidatePath`, add:

```ts
updateTag(widgetAggregationTag(data.org_id, data.id));
```

`updateWidgetConfig` returns the updated row (`data` is a `Widget`). After its `revalidatePath`, add:

```ts
updateTag(widgetAggregationTag(data.org_id, parsed.data.widgetId));
```

`deleteWidget` currently selects nothing back. Change its delete to return `org_id`, and invalidate:

```ts
const { data, error } = await supabase
  .from("dashboard_widgets")
  .delete()
  .eq("id", parsed.data.widgetId)
  .select("org_id")
  .maybeSingle();
if (error) return fail(error.message);
if (data) updateTag(widgetAggregationTag(data.org_id, parsed.data.widgetId));

return { ok: true, data: { widgetId: parsed.data.widgetId } };
```

> `updateTag` is already imported at the top of `actions.ts` (used by the dashboard mutations).

- [ ] **Step 3: Run the dashboards action + cached tests**

Run: `pnpm test --project unit -- src/lib/dashboards`
Expected: PASS. If `actions.test.ts` asserts the old `getWidgetData` internals (inline RPC), update those expectations to the delegated shape (the action now calls the cached fn). Do NOT weaken cross-tenant assertions.

- [ ] **Step 4: Commit**

```bash
git add src/lib/dashboards/actions.ts src/lib/dashboards/actions.test.ts
git commit -m "feat(dashboards): delegate getWidgetData to cached read; invalidate widget tag on config edits"
```

---

### Task 5: Full local gate run

- [ ] **Step 1: Run all four local gates**

Run:

```bash
pnpm typecheck && pnpm lint && pnpm test --project unit && pnpm build
```

Expected: all PASS. (Do NOT run the full integration suite — shared-DB contention.)

- [ ] **Step 2: Fix any failures, then re-run the gate.** Commit fixes staged by path with a `fix:` or `test:` message.

---

## Self-Review

- **Spec coverage:** Brief asks for (a) cached widget aggregation via `use cache` matching 9.3a → Task 3; (b) appropriate `cacheLife` → Task 2; (c) per-widget tag scoped by org AND widget id → Task 1; (d) Server Action delegates → Task 4 step 1; (e) `updateTag` on data-feeding mutations or short TTL tradeoff → Task 4 step 2 invalidates on the config mutations we control, with the board-cell-data TTL tradeoff documented (the "Why a short TTL" section). No migration (none needed). No UI change. Covered.
- **Type consistency:** `getWidgetAggregationCached` input/return shape is identical across Task 3 (definition) and Task 4 (call site). `widgetAggregationTag(orgId, widgetId)` signature identical in Tasks 1, 3, 4.
- **Placeholder scan:** none — all steps carry concrete code/commands.

## Execution DAG

- Task 1 (tag) and Task 2 (profile) are independent → can run concurrently.
- Task 3 depends on Task 1 + Task 2.
- Task 4 depends on Task 3.
- Task 5 depends on Task 4.
- Critical path: (1∥2) → 3 → 4 → 5. Small enough to execute inline sequentially.
