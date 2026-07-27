# Dashboards D1 — Foundation + Canvas + Number Widget — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first slice of cross-board dashboards — a workspace-scoped `/dashboards/[id]` surface with a drag-resize canvas, an "Add widget" flow, and a working **Number/KPI** widget that aggregates one source board via a bounded server-side RPC.

**Architecture:** New `dashboards` + `dashboard_widgets` tables (org-RLS, mirroring boards-core). A single `SECURITY DEFINER` `dashboard_aggregate` RPC is the shared data spine (count / sum / avg, optionally grouped). Server Actions mutate rows; widget _layout_ is client state persisted by a debounced RPC (0 data refetch on drag); each widget fetches its own bounded aggregate via `getWidgetData`, cached in TanStack Query. The canvas uses `react-grid-layout`.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), React 19, Supabase (Postgres + RLS + RPCs), TanStack Query, Zod, `react-grid-layout`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-17-dashboards-cross-board-design.md`

---

## File structure

**Create:**

- `supabase/migrations/20260617130000_dashboards.sql` — tables, enum, RLS, RPCs.
- `src/lib/validations/dashboards.ts` — Zod schemas (widget config per kind + action inputs).
- `src/lib/dashboards/queries.ts` — `listDashboards`, `getDashboardPayload`, types (server-only).
- `src/lib/dashboards/actions.ts` — Server Actions (`"use server"`).
- `src/lib/dashboards/cache.ts` — pure cache ops (`insertWidget`/`replaceWidget`/`removeWidget`/`applyLayouts`).
- `src/lib/dashboards/cache.test.ts` — unit tests for cache ops.
- `src/lib/dashboards/widget-data.ts` — pure helpers (`configHash`, `formatMetric`, `numberFromBuckets`).
- `src/lib/dashboards/widget-data.test.ts` — unit tests.
- `src/lib/dashboards/use-dashboard-cache.ts` — TanStack cache hook + patch helper.
- `src/lib/dashboards/use-dashboard-mutations.ts` — mutation hooks.
- `src/lib/dashboards/use-widget-data.ts` — per-widget aggregate query hook.
- `src/lib/dashboards/dashboards.rls.integration.test.ts` — live cross-org RLS + aggregate correctness.
- `src/app/dashboards/layout.tsx` — app-shell + sidebar data (mirrors boards layout); imports rgl CSS.
- `src/app/dashboards/page.tsx` — empty state ("select or create a dashboard").
- `src/app/dashboards/[dashboardId]/page.tsx` — RSC loader.
- `src/components/dashboards/DashboardCanvas.tsx` — client; react-grid-layout + edit mode + debounced save.
- `src/components/dashboards/DashboardWidget.tsx` — widget frame (title, config/delete menu) + kind dispatch.
- `src/components/dashboards/widgets/NumberWidget.tsx` — Number widget body.
- `src/components/dashboards/AddWidgetDialog.tsx` — add-widget + config form (source board → agg → numbers column).

**Modify:**

- `src/components/sidebar.tsx` — wire the existing disabled "Dashboards" nav entry to the dashboards list + create flow.
- `package.json` (+ lockfile) — add `react-grid-layout` + `@types/react-grid-layout`.
- `src/types/database.types.ts` — regenerated after the migration (do not hand-edit).
- `e2e/` — add `dashboards.spec.ts`.

---

## Task 1: Migration — tables, enum, RLS, RPCs

**Files:**

- Create: `supabase/migrations/20260617130000_dashboards.sql`
- Modify: `src/types/database.types.ts` (regenerated)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260617130000_dashboards.sql`:

```sql
-- Phase 8 (D1): cross-board dashboards. Workspace-scoped, org-RLS. Mirrors
-- boards-core conventions: denormalized org_id, is_org_member RLS, set_updated_at
-- trigger, position float8, SECURITY DEFINER create-RPCs that derive org_id.

-- ── dashboards ──────────────────────────────────────────────────────────────
create table public.dashboards (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 100),
  created_by   uuid not null references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index dashboards_workspace_id_idx on public.dashboards (workspace_id);
create index dashboards_org_id_idx on public.dashboards (org_id);

create trigger dashboards_set_updated_at
  before update on public.dashboards
  for each row execute function public.set_updated_at();

alter table public.dashboards enable row level security;

create policy "dashboards: read if member" on public.dashboards
  for select using (public.is_org_member(org_id));
create policy "dashboards: insert if member" on public.dashboards
  for insert with check (public.is_org_member(org_id));
create policy "dashboards: update if member" on public.dashboards
  for update using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
create policy "dashboards: delete if member" on public.dashboards
  for delete using (public.is_org_member(org_id));

-- ── dashboard_widgets ───────────────────────────────────────────────────────
create type public.widget_kind as enum ('number', 'chart', 'battery', 'list');

create table public.dashboard_widgets (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  dashboard_id    uuid not null references public.dashboards (id) on delete cascade,
  source_board_id uuid references public.boards (id) on delete set null,
  kind            public.widget_kind not null,
  title           text not null default '' check (char_length(title) between 0 and 100),
  config          jsonb not null default '{}'::jsonb,
  layout          jsonb not null default '{}'::jsonb,
  position        double precision not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index dashboard_widgets_dashboard_id_idx on public.dashboard_widgets (dashboard_id);
create index dashboard_widgets_org_id_idx on public.dashboard_widgets (org_id);

create trigger dashboard_widgets_set_updated_at
  before update on public.dashboard_widgets
  for each row execute function public.set_updated_at();

alter table public.dashboard_widgets enable row level security;

create policy "dashboard_widgets: read if member" on public.dashboard_widgets
  for select using (public.is_org_member(org_id));
create policy "dashboard_widgets: insert if member" on public.dashboard_widgets
  for insert with check (public.is_org_member(org_id));
create policy "dashboard_widgets: update if member" on public.dashboard_widgets
  for update using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
create policy "dashboard_widgets: delete if member" on public.dashboard_widgets
  for delete using (public.is_org_member(org_id));

-- ── RPC: create_dashboard (derive org from workspace, membership-checked) ─────
create or replace function public.create_dashboard(p_workspace_id uuid, p_name text)
returns public.dashboards
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
  v_row    public.dashboards;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select org_id into v_org_id from public.workspaces where id = p_workspace_id;
  if v_org_id is null then
    raise exception 'workspace not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  insert into public.dashboards (org_id, workspace_id, name, created_by)
  values (v_org_id, p_workspace_id, p_name, v_uid)
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.create_dashboard(uuid, text) to authenticated;

-- ── RPC: create_dashboard_widget (derive org from dashboard, position=max+1) ──
create or replace function public.create_dashboard_widget(
  p_dashboard_id    uuid,
  p_kind            public.widget_kind,
  p_source_board_id uuid,
  p_title           text default '',
  p_config          jsonb default '{}'::jsonb,
  p_layout          jsonb default '{}'::jsonb
) returns public.dashboard_widgets
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
  v_pos    double precision;
  v_row    public.dashboard_widgets;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select org_id into v_org_id from public.dashboards where id = p_dashboard_id;
  if v_org_id is null then
    raise exception 'dashboard not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  -- source board must belong to the same org (when provided)
  if p_source_board_id is not null
     and not exists (select 1 from public.boards b
                     where b.id = p_source_board_id and b.org_id = v_org_id) then
    raise exception 'source board not in org' using errcode = '42501';
  end if;

  select coalesce(max(position), -1) + 1 into v_pos
  from public.dashboard_widgets where dashboard_id = p_dashboard_id;

  insert into public.dashboard_widgets
    (org_id, dashboard_id, source_board_id, kind, title, config, layout, position)
  values
    (v_org_id, p_dashboard_id, p_source_board_id, p_kind, coalesce(p_title, ''),
     coalesce(p_config, '{}'::jsonb), coalesce(p_layout, '{}'::jsonb), v_pos)
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function public.create_dashboard_widget(uuid, public.widget_kind, uuid, text, jsonb, jsonb)
  to authenticated;

-- ── RPC: set_widget_layouts (batch layout persist, one round-trip) ────────────
create or replace function public.set_widget_layouts(p_dashboard_id uuid, p_layouts jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.dashboards where id = p_dashboard_id;
  if v_org_id is null then
    raise exception 'dashboard not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  update public.dashboard_widgets w
  set layout = jsonb_build_object('x', e.x, 'y', e.y, 'w', e.w, 'h', e.h)
  from jsonb_to_recordset(p_layouts)
    as e(id uuid, x int, y int, w int, h int)
  where w.id = e.id and w.dashboard_id = p_dashboard_id;
end; $$;
grant execute on function public.set_widget_layouts(uuid, jsonb) to authenticated;

-- ── RPC: dashboard_aggregate (the spine — count/sum/avg, optional grouping) ───
-- Returns ≤ K rows. group_key null = ungrouped (whole board) OR the "no value"
-- bucket. Grouping in D1 supports status (value->>'optionId'); dropdown/people
-- array grouping is added in D2. count counts items; sum/avg operate on the
-- numbers cell (value->>'n') of p_value_column_id. LEFT JOIN keeps empty cells.
create or replace function public.dashboard_aggregate(
  p_board_id        uuid,
  p_group_column_id uuid  default null,
  p_value_column_id uuid  default null,
  p_agg             text  default 'count'
) returns table (group_key text, metric numeric)
language plpgsql security definer set search_path = '' as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.boards where id = p_board_id;
  if v_org_id is null then
    raise exception 'board not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if p_agg not in ('count', 'sum', 'avg') then
    raise exception 'invalid agg %', p_agg using errcode = '22023';
  end if;

  return query
  with rows as (
    select
      (gcv.value ->> 'optionId') as gkey,
      (vcv.value ->> 'n')::numeric as nval
    from public.items i
    left join public.cell_values gcv
      on gcv.item_id = i.id and gcv.column_id = p_group_column_id
    left join public.cell_values vcv
      on vcv.item_id = i.id and vcv.column_id = p_value_column_id
    where i.board_id = p_board_id
  )
  select
    (case when p_group_column_id is null then null else gkey end) as group_key,
    (case p_agg
       when 'count' then count(*)::numeric
       when 'sum'   then coalesce(sum(nval), 0)
       when 'avg'   then coalesce(avg(nval), 0)
     end) as metric
  from rows
  group by (case when p_group_column_id is null then null else gkey end);
end; $$;
grant execute on function public.dashboard_aggregate(uuid, uuid, uuid, text) to authenticated;
```

- [ ] **Step 2: Apply the migration to the linked project**

This repo is cloud-native (no local stack). With per-session authorization, apply via the CLI:

Run: `pnpm dlx supabase db push --linked`
Expected: the new migration `20260617130000_dashboards.sql` applies cleanly; no errors.

- [ ] **Step 3: Regenerate types**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` updates to include `dashboards`, `dashboard_widgets`, the `widget_kind` enum, and the three new functions.
⚠️ Known gotcha: `pnpm db:types` can leak a PostHog telemetry line — if `git diff` shows a stray line containing `"_tag"`, remove it before committing.

- [ ] **Step 4: Verify advisors are clean**

Use the Supabase MCP `get_advisors` (security + performance) for the project.
Expected: no new warnings introduced by the migration (RLS enabled on both tables; indexes present on FK columns).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260617130000_dashboards.sql src/types/database.types.ts
git commit -m "feat(dashboards): schema + RLS + aggregate/create RPCs (D1)"
```

---

## Task 2: Zod validations

**Files:**

- Create: `src/lib/validations/dashboards.ts`
- Test: `src/lib/validations/dashboards.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/validations/dashboards.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createDashboardSchema,
  createWidgetSchema,
  numberConfigSchema,
  saveLayoutSchema,
} from "./dashboards";

describe("numberConfigSchema", () => {
  it("accepts count without a value column", () => {
    expect(numberConfigSchema.safeParse({ agg: "count" }).success).toBe(true);
  });
  it("rejects sum without a value column", () => {
    expect(numberConfigSchema.safeParse({ agg: "sum" }).success).toBe(false);
  });
  it("accepts sum with a value column", () => {
    const r = numberConfigSchema.safeParse({
      agg: "sum",
      valueColumnId: "11111111-1111-1111-1111-111111111111",
    });
    expect(r.success).toBe(true);
  });
});

describe("createWidgetSchema", () => {
  it("requires a uuid dashboardId and a known kind", () => {
    const r = createWidgetSchema.safeParse({
      dashboardId: "11111111-1111-1111-1111-111111111111",
      kind: "number",
      sourceBoardId: "22222222-2222-2222-2222-222222222222",
      title: "Open items",
      config: { agg: "count" },
    });
    expect(r.success).toBe(true);
  });
});

describe("saveLayoutSchema", () => {
  it("validates an array of grid rects", () => {
    const r = saveLayoutSchema.safeParse({
      dashboardId: "11111111-1111-1111-1111-111111111111",
      layouts: [
        { id: "22222222-2222-2222-2222-222222222222", x: 0, y: 0, w: 2, h: 2 },
      ],
    });
    expect(r.success).toBe(true);
  });
});

describe("createDashboardSchema", () => {
  it("trims and bounds the name", () => {
    expect(
      createDashboardSchema.safeParse({
        workspaceId: "11111111-1111-1111-1111-111111111111",
        name: "  My Dash  ",
      }).success,
    ).toBe(true);
    expect(
      createDashboardSchema.safeParse({
        workspaceId: "11111111-1111-1111-1111-111111111111",
        name: "",
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/validations/dashboards.test.ts`
Expected: FAIL — cannot find module `./dashboards`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/validations/dashboards.ts`:

```ts
import { z } from "zod";

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(100);
const title = z.string().trim().max(100);

export const widgetKindSchema = z.enum(["number", "chart", "battery", "list"]);

// ── per-kind config (D1 implements `number`; others are placeholders for D2/D3) ──
export const numberConfigSchema = z
  .object({
    agg: z.enum(["count", "sum", "avg"]),
    valueColumnId: uuid.optional(),
  })
  .refine((c) => c.agg === "count" || !!c.valueColumnId, {
    message: "Sum and average need a numbers column.",
    path: ["valueColumnId"],
  });

export type NumberConfig = z.infer<typeof numberConfigSchema>;

// Structural gate for the jsonb column; kind-specific shape is enforced in the
// action via configSchemaForKind(kind).
const configObject = z.record(z.string(), z.unknown());

export function configSchemaForKind(kind: z.infer<typeof widgetKindSchema>) {
  switch (kind) {
    case "number":
      return numberConfigSchema;
    // D2/D3 add chart/battery/list; until then accept any object.
    default:
      return configObject;
  }
}

// ── action inputs ──
export const createDashboardSchema = z.object({ workspaceId: uuid, name });
export const renameDashboardSchema = z.object({ dashboardId: uuid, name });
export const deleteDashboardSchema = z.object({ dashboardId: uuid });

export const createWidgetSchema = z.object({
  dashboardId: uuid,
  kind: widgetKindSchema,
  sourceBoardId: uuid,
  title: title.default(""),
  config: configObject,
});

export const updateWidgetConfigSchema = z.object({
  widgetId: uuid,
  title: title.optional(),
  sourceBoardId: uuid.optional(),
  config: configObject.optional(),
});

export const deleteWidgetSchema = z.object({ widgetId: uuid });

const gridRect = z.object({
  id: uuid,
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(20),
});

export const saveLayoutSchema = z.object({
  dashboardId: uuid,
  layouts: z.array(gridRect).max(100),
});

export const getWidgetDataSchema = z.object({ widgetId: uuid });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/validations/dashboards.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/dashboards.ts src/lib/validations/dashboards.test.ts
git commit -m "feat(dashboards): zod schemas for actions + number config"
```

---

## Task 3: Pure cache operations

**Files:**

- Create: `src/lib/dashboards/cache.ts`
- Test: `src/lib/dashboards/cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/dashboards/cache.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  applyLayouts,
  insertWidget,
  removeWidget,
  replaceWidget,
  type DashboardCache,
  type CacheWidget,
} from "./cache";

function widget(id: string, extra: Partial<CacheWidget> = {}): CacheWidget {
  return {
    id,
    org_id: "o1",
    dashboard_id: "d1",
    source_board_id: "b1",
    kind: "number",
    title: "",
    config: { agg: "count" },
    layout: { x: 0, y: 0, w: 2, h: 2 },
    position: 0,
    created_at: "",
    updated_at: "",
    ...extra,
  } as CacheWidget;
}

function base(): DashboardCache {
  return {
    dashboard: {
      id: "d1",
      org_id: "o1",
      name: "D",
    } as DashboardCache["dashboard"],
    widgets: [widget("w1")],
  };
}

describe("insertWidget", () => {
  it("appends a widget; idempotent on id", () => {
    const next = insertWidget(base(), widget("w2"));
    expect(next.widgets.map((w) => w.id)).toEqual(["w1", "w2"]);
    expect(insertWidget(next, widget("w2")).widgets).toHaveLength(2);
  });
  it("does not mutate the input", () => {
    const input = base();
    insertWidget(input, widget("w2"));
    expect(input.widgets).toHaveLength(1);
  });
});

describe("replaceWidget", () => {
  it("replaces by id", () => {
    const next = replaceWidget(base(), widget("w1", { title: "X" }));
    expect(next.widgets[0].title).toBe("X");
  });
});

describe("removeWidget", () => {
  it("removes by id", () => {
    expect(removeWidget(base(), "w1").widgets).toHaveLength(0);
  });
});

describe("applyLayouts", () => {
  it("patches layout rects by id, leaving others untouched", () => {
    const cache = insertWidget(base(), widget("w2"));
    const next = applyLayouts(cache, [{ id: "w2", x: 3, y: 1, w: 4, h: 2 }]);
    expect(next.widgets.find((w) => w.id === "w2")!.layout).toEqual({
      x: 3,
      y: 1,
      w: 4,
      h: 2,
    });
    expect(next.widgets.find((w) => w.id === "w1")!.layout).toEqual({
      x: 0,
      y: 0,
      w: 2,
      h: 2,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/dashboards/cache.test.ts`
Expected: FAIL — cannot find module `./cache`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/dashboards/cache.ts`:

```ts
import type { Tables } from "@/types/database.types";

export type Dashboard = Tables<"dashboards">;
export type CacheWidget = Tables<"dashboard_widgets">;

export type GridRect = { x: number; y: number; w: number; h: number };

export type DashboardCache = {
  dashboard: Dashboard;
  widgets: CacheWidget[];
};

/** Append a widget; idempotent on id. Immutable. */
export function insertWidget(
  cache: DashboardCache,
  widget: CacheWidget,
): DashboardCache {
  if (cache.widgets.some((w) => w.id === widget.id)) return cache;
  return { ...cache, widgets: [...cache.widgets, widget] };
}

/** Replace a widget by id. Immutable; no-op if absent. */
export function replaceWidget(
  cache: DashboardCache,
  widget: CacheWidget,
): DashboardCache {
  return {
    ...cache,
    widgets: cache.widgets.map((w) => (w.id === widget.id ? widget : w)),
  };
}

/** Remove a widget by id. Immutable. */
export function removeWidget(
  cache: DashboardCache,
  widgetId: string,
): DashboardCache {
  return {
    ...cache,
    widgets: cache.widgets.filter((w) => w.id !== widgetId),
  };
}

/** Patch layout rects by id. Immutable; widgets not in the list keep their layout. */
export function applyLayouts(
  cache: DashboardCache,
  layouts: ({ id: string } & GridRect)[],
): DashboardCache {
  const byId = new Map(layouts.map((l) => [l.id, l]));
  return {
    ...cache,
    widgets: cache.widgets.map((w) => {
      const l = byId.get(w.id);
      return l ? { ...w, layout: { x: l.x, y: l.y, w: l.w, h: l.h } } : w;
    }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/dashboards/cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboards/cache.ts src/lib/dashboards/cache.test.ts
git commit -m "feat(dashboards): pure cache ops (insert/replace/remove/applyLayouts)"
```

---

## Task 4: Widget-data helpers (configHash, formatMetric, numberFromBuckets)

**Files:**

- Create: `src/lib/dashboards/widget-data.ts`
- Test: `src/lib/dashboards/widget-data.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/dashboards/widget-data.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { configHash, formatMetric, numberFromBuckets } from "./widget-data";

describe("configHash", () => {
  it("is stable regardless of key order", () => {
    expect(configHash({ a: 1, b: 2 })).toBe(configHash({ b: 2, a: 1 }));
  });
  it("differs when values differ", () => {
    expect(configHash({ agg: "count" })).not.toBe(configHash({ agg: "sum" }));
  });
});

describe("numberFromBuckets", () => {
  it("sums all bucket metrics into a single scalar", () => {
    expect(numberFromBuckets([{ group_key: null, metric: 5 }])).toBe(5);
    expect(
      numberFromBuckets([
        { group_key: "a", metric: 2 },
        { group_key: "b", metric: 3 },
      ]),
    ).toBe(5);
  });
  it("returns 0 for no buckets", () => {
    expect(numberFromBuckets([])).toBe(0);
  });
});

describe("formatMetric", () => {
  it("formats whole numbers without decimals", () => {
    expect(formatMetric(42, "count")).toBe("42");
  });
  it("rounds avg to one decimal", () => {
    expect(formatMetric(3.333, "avg")).toBe("3.3");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/dashboards/widget-data.test.ts`
Expected: FAIL — cannot find module `./widget-data`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/dashboards/widget-data.ts`:

```ts
/** A single aggregate bucket as returned by the dashboard_aggregate RPC. */
export type AggregateBucket = { group_key: string | null; metric: number };

/** Stable, order-independent hash of a widget config — used as a query-key part. */
export function configHash(config: Record<string, unknown>): string {
  const sortedKeys = Object.keys(config).sort();
  const stable: Record<string, unknown> = {};
  for (const k of sortedKeys) stable[k] = config[k];
  return JSON.stringify(stable);
}

/** Collapse aggregate buckets into a single scalar (Number widget). */
export function numberFromBuckets(buckets: AggregateBucket[]): number {
  return buckets.reduce((sum, b) => sum + (b.metric ?? 0), 0);
}

/** Display formatting for a metric. avg → 1 decimal; others → integer-ish. */
export function formatMetric(
  value: number,
  agg: "count" | "sum" | "avg",
): string {
  if (agg === "avg") return value.toFixed(1);
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/dashboards/widget-data.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboards/widget-data.ts src/lib/dashboards/widget-data.test.ts
git commit -m "feat(dashboards): widget-data helpers (configHash/formatMetric/numberFromBuckets)"
```

---

## Task 5: Queries (server-only)

**Files:**

- Create: `src/lib/dashboards/queries.ts`

- [ ] **Step 1: Write the implementation**

This mirrors `src/lib/boards/queries.ts` (server-only, RLS-scoped reads). Create `src/lib/dashboards/queries.ts`:

```ts
import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";

export type Dashboard = Tables<"dashboards">;
export type DashboardWidget = Tables<"dashboard_widgets">;

export type DashboardPayload = {
  dashboard: Dashboard;
  widgets: DashboardWidget[];
};

/** Workspace-scoped list of dashboards visible to the current user (RLS). */
export async function listDashboards(): Promise<Dashboard[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("dashboards")
    .select("*")
    .order("created_at", { ascending: true });
  return data ?? [];
}

/** A dashboard + its widgets. Returns null when not visible (RLS) or absent. */
export async function getDashboardPayload(
  dashboardId: string,
): Promise<DashboardPayload | null> {
  const supabase = await createClient();

  const { data: dashboard, error } = await supabase
    .from("dashboards")
    .select("*")
    .eq("id", dashboardId)
    .maybeSingle();
  if (error || !dashboard) return null;

  const { data: widgets } = await supabase
    .from("dashboard_widgets")
    .select("*")
    .eq("dashboard_id", dashboardId)
    .order("position", { ascending: true });

  return { dashboard, widgets: widgets ?? [] };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (types resolve against the regenerated `database.types.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/dashboards/queries.ts
git commit -m "feat(dashboards): server-only queries (listDashboards/getDashboardPayload)"
```

---

## Task 6: Server Actions

**Files:**

- Create: `src/lib/dashboards/actions.ts`

- [ ] **Step 1: Write the implementation**

Mirror `src/lib/boards/actions.ts` exactly: `"use server"`, the `ActionResult<T>` union, `fail()` helper, `createClient()`, Zod `.safeParse`, RPC calls, `revalidatePath`. Create `src/lib/dashboards/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { type AggregateBucket } from "@/lib/dashboards/widget-data";
import {
  configSchemaForKind,
  createDashboardSchema,
  createWidgetSchema,
  deleteWidgetSchema,
  getWidgetDataSchema,
  saveLayoutSchema,
  updateWidgetConfigSchema,
} from "@/lib/validations/dashboards";
import type { Tables } from "@/types/database.types";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

type Widget = Tables<"dashboard_widgets">;

/** Create a dashboard (server derives org from workspace). */
export async function createDashboard(input: {
  workspaceId: string;
  name: string;
}): Promise<ActionResult<{ dashboard: Tables<"dashboards"> }>> {
  const parsed = createDashboardSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_dashboard", {
    p_workspace_id: parsed.data.workspaceId,
    p_name: parsed.data.name,
  });
  if (error || !data)
    return fail(error?.message ?? "Could not create dashboard.");

  revalidatePath("/dashboards");
  return { ok: true, data: { dashboard: data as Tables<"dashboards"> } };
}

/** Add a widget. Validates the kind-specific config, returns the full row. */
export async function createWidget(input: {
  dashboardId: string;
  kind: Widget["kind"];
  sourceBoardId: string;
  title: string;
  config: Record<string, unknown>;
}): Promise<ActionResult<{ widget: Widget }>> {
  const parsed = createWidgetSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const cfg = configSchemaForKind(parsed.data.kind).safeParse(
    parsed.data.config,
  );
  if (!cfg.success)
    return fail(cfg.error.issues[0]?.message ?? "Invalid widget config");

  // Default starting layout: a 3×2 tile at the origin (the canvas relays out on add).
  const layout = { x: 0, y: 0, w: 3, h: 2 };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_dashboard_widget", {
    p_dashboard_id: parsed.data.dashboardId,
    p_kind: parsed.data.kind,
    p_source_board_id: parsed.data.sourceBoardId,
    p_title: parsed.data.title,
    p_config: cfg.data,
    p_layout: layout,
  });
  if (error || !data) return fail(error?.message ?? "Could not add widget.");

  revalidatePath(`/dashboards/${parsed.data.dashboardId}`);
  return { ok: true, data: { widget: data as Widget } };
}

/** Update a widget's title/source/config. Returns the updated row. */
export async function updateWidgetConfig(input: {
  widgetId: string;
  title?: string;
  sourceBoardId?: string;
  config?: Record<string, unknown>;
}): Promise<ActionResult<{ widget: Widget }>> {
  const parsed = updateWidgetConfigSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();

  // Validate config against the widget's actual kind (read it first).
  const patch: Partial<Widget> = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.sourceBoardId !== undefined)
    patch.source_board_id = parsed.data.sourceBoardId;
  if (parsed.data.config !== undefined) {
    const { data: existing } = await supabase
      .from("dashboard_widgets")
      .select("kind")
      .eq("id", parsed.data.widgetId)
      .maybeSingle();
    if (!existing) return fail("Widget not found.");
    const cfg = configSchemaForKind(existing.kind).safeParse(
      parsed.data.config,
    );
    if (!cfg.success)
      return fail(cfg.error.issues[0]?.message ?? "Invalid widget config");
    patch.config = cfg.data;
  }

  const { data, error } = await supabase
    .from("dashboard_widgets")
    .update(patch)
    .eq("id", parsed.data.widgetId)
    .select("*")
    .maybeSingle();
  if (error || !data) return fail(error?.message ?? "Could not update widget.");

  revalidatePath(`/dashboards/${data.dashboard_id}`);
  return { ok: true, data: { widget: data as Widget } };
}

/** Delete a widget. */
export async function deleteWidget(input: {
  widgetId: string;
}): Promise<ActionResult<{ widgetId: string }>> {
  const parsed = deleteWidgetSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await supabase
    .from("dashboard_widgets")
    .delete()
    .eq("id", parsed.data.widgetId);
  if (error) return fail(error.message);

  return { ok: true, data: { widgetId: parsed.data.widgetId } };
}

/** Persist the grid layout for all widgets in one round-trip (debounced caller). */
export async function saveLayout(input: {
  dashboardId: string;
  layouts: { id: string; x: number; y: number; w: number; h: number }[];
}): Promise<ActionResult<{ saved: number }>> {
  const parsed = saveLayoutSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_widget_layouts", {
    p_dashboard_id: parsed.data.dashboardId,
    p_layouts: parsed.data.layouts,
  });
  if (error) return fail(error.message);

  return { ok: true, data: { saved: parsed.data.layouts.length } };
}

/** Fetch a widget's bounded aggregate data. Reads the widget, runs the RPC. */
export async function getWidgetData(input: { widgetId: string }): Promise<
  ActionResult<{
    kind: Widget["kind"];
    config: Record<string, unknown>;
    buckets: AggregateBucket[];
  }>
> {
  const parsed = getWidgetDataSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data: widget } = await supabase
    .from("dashboard_widgets")
    .select("kind, config, source_board_id")
    .eq("id", parsed.data.widgetId)
    .maybeSingle();
  if (!widget) return fail("Widget not found.");
  if (!widget.source_board_id)
    return { ok: true, data: { kind: widget.kind, config: {}, buckets: [] } };

  const config = (widget.config ?? {}) as Record<string, unknown>;
  const agg = (config.agg as string) ?? "count";
  const { data, error } = await supabase.rpc("dashboard_aggregate", {
    p_board_id: widget.source_board_id,
    p_group_column_id: (config.groupColumnId as string) ?? undefined,
    p_value_column_id: (config.valueColumnId as string) ?? undefined,
    p_agg: agg,
  });
  if (error) return fail(error.message);

  const buckets: AggregateBucket[] = (data ?? []).map((r) => ({
    group_key: r.group_key,
    metric: Number(r.metric),
  }));
  return { ok: true, data: { kind: widget.kind, config, buckets } };
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. (If the RPC arg types complain about `undefined`, pass `null` instead — confirm against the regenerated types.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/dashboards/actions.ts
git commit -m "feat(dashboards): server actions (create/update/delete/layout/getWidgetData)"
```

---

## Task 7: Live RLS + aggregate integration test

**Files:**

- Create: `src/lib/dashboards/dashboards.rls.integration.test.ts`

- [ ] **Step 1: Write the test**

Mirror the header/provisioning pattern from `src/lib/boards/boards.rls.integration.test.ts` (`describe.skipIf(!SERVICE_ROLE_KEY)`, `config({ path: ".env.local" })`, admin + two anon users in different orgs). Create `src/lib/dashboards/dashboards.rls.integration.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/types/database.types";

config({ path: ".env.local", override: true });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

type U = {
  id: string;
  orgId: string;
  workspaceId: string;
  boardId: string;
  statusColumnId: string;
  doneOptionId: string;
  dashboardId: string;
  anon: SupabaseClient<Database>;
};

describe.skipIf(!SERVICE)(
  "RLS: dashboards tenant isolation + aggregate",
  () => {
    let admin: SupabaseClient<Database>;
    const userIds: string[] = [];
    let a: U;
    let b: U;

    async function provision(): Promise<U> {
      const email = `rls-dash-${randomUUID()}@example.com`;
      const { data: created } = await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
      const id = created.user!.id;
      userIds.push(id);

      const anon = createClient<Database>(URL!, ANON!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await anon.auth.signInWithPassword({ email, password: PASSWORD });

      // create_org + workspace come from the auth/tenancy + boards-core RPCs.
      const { data: org } = await anon.rpc("create_org", { p_name: "Org" });
      const orgId = org!.id;
      const { data: ws } = await anon
        .from("workspaces")
        .insert({ org_id: orgId, name: "WS", created_by: id })
        .select("id")
        .single();
      const workspaceId = ws!.id;

      const { data: board } = await anon.rpc("create_board", {
        p_workspace_id: workspaceId,
        p_name: "Board",
      });
      const boardId = board!.id;

      // grab the seeded Status column + its "Done" option
      const { data: statusCol } = await anon
        .from("columns")
        .select("id, settings")
        .eq("board_id", boardId)
        .eq("kind", "status")
        .single();
      const statusColumnId = statusCol!.id;
      const options = (
        statusCol!.settings as { options: { id: string; label: string }[] }
      ).options;
      const doneOptionId = options.find((o) => o.label === "Done")!.id;

      const { data: dash } = await anon.rpc("create_dashboard", {
        p_workspace_id: workspaceId,
        p_name: "Dash",
      });
      const dashboardId = dash!.id;

      return {
        id,
        orgId,
        workspaceId,
        boardId,
        statusColumnId,
        doneOptionId,
        dashboardId,
        anon,
      };
    }

    beforeAll(async () => {
      admin = createClient<Database>(URL!, SERVICE!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      a = await provision();
      b = await provision();
    }, 60_000);

    afterAll(async () => {
      for (const id of userIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("dashboard_aggregate count returns the item total", async () => {
      // add 3 items to A's board
      for (let i = 0; i < 3; i++) {
        await a.anon.rpc("create_item", {
          p_group_id: (
            await a.anon
              .from("groups")
              .select("id")
              .eq("board_id", a.boardId)
              .single()
          ).data!.id,
          p_name: `Item ${i}`,
        });
      }
      const { data, error } = await a.anon.rpc("dashboard_aggregate", {
        p_board_id: a.boardId,
        p_agg: "count",
      });
      expect(error).toBeNull();
      expect(Number(data![0].metric)).toBe(3);
      expect(data![0].group_key).toBeNull();
    });

    it("denies aggregating another org's board", async () => {
      const { error } = await b.anon.rpc("dashboard_aggregate", {
        p_board_id: a.boardId,
        p_agg: "count",
      });
      expect(error).not.toBeNull(); // 42501 not a member
    });

    it("denies reading another org's dashboard + widgets", async () => {
      const { data } = await b.anon
        .from("dashboards")
        .select("*")
        .eq("id", a.dashboardId);
      expect(data).toEqual([]);
    });

    it("create_dashboard_widget rejects a source board from another org", async () => {
      const { error } = await b.anon.rpc("create_dashboard_widget", {
        p_dashboard_id: b.dashboardId,
        p_kind: "number",
        p_source_board_id: a.boardId, // cross-org board
        p_title: "",
        p_config: { agg: "count" },
        p_layout: {},
      });
      expect(error).not.toBeNull();
    });
  },
);
```

> Note: confirm the exact org-creation RPC name (`create_org`) and workspace-insert shape against `src/lib/boards/boards.rls.integration.test.ts` while implementing — reuse whatever that file does verbatim.

- [ ] **Step 2: Run the test (live)**

Run: `pnpm vitest run src/lib/dashboards/dashboards.rls.integration.test.ts`
Expected: PASS (4 tests). If `SUPABASE_SERVICE_ROLE_KEY` is unset locally the suite is skipped — it must run against the linked project.

- [ ] **Step 3: Commit**

```bash
git add src/lib/dashboards/dashboards.rls.integration.test.ts
git commit -m "test(dashboards): live cross-org RLS + aggregate correctness"
```

---

## Task 8: Add react-grid-layout dependency

**Files:**

- Modify: `package.json`, lockfile

- [ ] **Step 1: Install**

Run: `pnpm add react-grid-layout && pnpm add -D @types/react-grid-layout`
Expected: both added to `package.json`.

- [ ] **Step 2: Verify build still green**

Run: `pnpm build`
Expected: PASS (no usage yet, just the dependency).

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build(dashboards): add react-grid-layout"
```

---

## Task 9: TanStack cache hook + per-widget data hook + mutations

**Files:**

- Create: `src/lib/dashboards/use-dashboard-cache.ts`
- Create: `src/lib/dashboards/use-widget-data.ts`
- Create: `src/lib/dashboards/use-dashboard-mutations.ts`

- [ ] **Step 1: Write the cache hook**

Mirror `src/lib/boards/use-board-cache.ts`. Create `src/lib/dashboards/use-dashboard-cache.ts`:

```ts
"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { DashboardCache } from "@/lib/dashboards/cache";

export function dashboardKey(dashboardId: string) {
  return ["dashboard", dashboardId] as const;
}

export function useDashboardCache(
  dashboardId: string,
  initialData: DashboardCache,
) {
  return useQuery({
    queryKey: dashboardKey(dashboardId),
    queryFn: () => initialData,
    initialData,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function patchDashboardCache(
  qc: QueryClient,
  dashboardId: string,
  patch: (prev: DashboardCache) => DashboardCache,
) {
  qc.setQueryData<DashboardCache>(dashboardKey(dashboardId), (prev) =>
    prev ? patch(prev) : prev,
  );
}
```

- [ ] **Step 2: Write the per-widget data hook**

Create `src/lib/dashboards/use-widget-data.ts`:

```ts
"use client";

import { useQuery } from "@tanstack/react-query";

import { getWidgetData } from "@/lib/dashboards/actions";
import { configHash, type AggregateBucket } from "@/lib/dashboards/widget-data";

/**
 * Fetch one widget's bounded aggregate. Keyed by widget id + config hash so an
 * edit re-queries only this widget. Never refetched by layout drags.
 */
export function useWidgetData(
  widgetId: string,
  config: Record<string, unknown>,
) {
  return useQuery({
    queryKey: ["dashboard-widget", widgetId, configHash(config)],
    queryFn: async (): Promise<AggregateBucket[]> => {
      const res = await getWidgetData({ widgetId });
      if (!res.ok) throw new Error(res.error);
      return res.data.buckets;
    },
    staleTime: 60_000,
  });
}
```

- [ ] **Step 3: Write the mutations hook**

Mirror the optimistic patterns from `src/lib/boards/use-board-mutations.ts` (`onSuccess` insert from server row for create; `onMutate`/`onError` rollback for edits). Create `src/lib/dashboards/use-dashboard-mutations.ts`:

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  createWidget,
  deleteWidget,
  saveLayout,
  updateWidgetConfig,
} from "@/lib/dashboards/actions";
import {
  applyLayouts,
  insertWidget,
  removeWidget,
  replaceWidget,
  type CacheWidget,
  type DashboardCache,
  type GridRect,
} from "@/lib/dashboards/cache";
import { dashboardKey } from "@/lib/dashboards/use-dashboard-cache";

export function useDashboardMutations(dashboardId: string) {
  const qc = useQueryClient();
  const key = dashboardKey(dashboardId);

  const addWidget = useMutation({
    mutationFn: async (vars: {
      kind: CacheWidget["kind"];
      sourceBoardId: string;
      title: string;
      config: Record<string, unknown>;
    }) => {
      const res = await createWidget({ dashboardId, ...vars });
      if (!res.ok) throw new Error(res.error);
      return res.data.widget as CacheWidget;
    },
    onSuccess: (widget) => {
      qc.setQueryData<DashboardCache>(key, (prev) =>
        prev ? insertWidget(prev, widget) : prev,
      );
    },
  });

  const editWidget = useMutation({
    mutationFn: async (vars: {
      widgetId: string;
      title?: string;
      sourceBoardId?: string;
      config?: Record<string, unknown>;
    }) => {
      const res = await updateWidgetConfig(vars);
      if (!res.ok) throw new Error(res.error);
      return res.data.widget as CacheWidget;
    },
    onSuccess: (widget) => {
      qc.setQueryData<DashboardCache>(key, (prev) =>
        prev ? replaceWidget(prev, widget) : prev,
      );
    },
  });

  const removeWidgetMut = useMutation<
    unknown,
    Error,
    { widgetId: string },
    { previous?: DashboardCache }
  >({
    mutationFn: async (vars) => {
      const res = await deleteWidget(vars);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<DashboardCache>(key);
      if (previous) qc.setQueryData(key, removeWidget(previous, vars.widgetId));
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
  });

  // Layout: patch cache immediately, persist debounced (caller debounces).
  const persistLayout = useMutation({
    mutationFn: async (layouts: ({ id: string } & GridRect)[]) => {
      const res = await saveLayout({ dashboardId, layouts });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onMutate: (layouts) => {
      qc.setQueryData<DashboardCache>(key, (prev) =>
        prev ? applyLayouts(prev, layouts) : prev,
      );
    },
  });

  return {
    addWidget,
    editWidget,
    removeWidget: removeWidgetMut,
    persistLayout,
  };
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboards/use-dashboard-cache.ts src/lib/dashboards/use-widget-data.ts src/lib/dashboards/use-dashboard-mutations.ts
git commit -m "feat(dashboards): tanstack cache + widget-data + mutation hooks"
```

---

## Task 10: Number widget body

**Files:**

- Create: `src/components/dashboards/widgets/NumberWidget.tsx`

- [ ] **Step 1: Write the implementation**

Follow `pulse-ui` tokens (monochromatic surfaces, single accent; use existing utility classes / shadcn primitives — check a board component like `KanbanBoard.tsx` for the class vocabulary). Create `src/components/dashboards/widgets/NumberWidget.tsx`:

```tsx
"use client";

import { useWidgetData } from "@/lib/dashboards/use-widget-data";
import { formatMetric, numberFromBuckets } from "@/lib/dashboards/widget-data";
import type { CacheWidget } from "@/lib/dashboards/cache";

export function NumberWidget({ widget }: { widget: CacheWidget }) {
  const config = (widget.config ?? {}) as { agg?: "count" | "sum" | "avg" };
  const agg = config.agg ?? "count";
  const { data, isLoading, isError } = useWidgetData(
    widget.id,
    widget.config as Record<string, unknown>,
  );

  if (!widget.source_board_id) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Pick a source board
      </div>
    );
  }
  if (isLoading)
    return <div className="bg-muted/40 h-full animate-pulse rounded-md" />;
  if (isError)
    return <div className="text-destructive text-sm">Failed to load</div>;

  const value = numberFromBuckets(data ?? []);
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <span className="text-4xl font-semibold tabular-nums">
        {formatMetric(value, agg)}
      </span>
      <span className="text-muted-foreground mt-1 text-xs tracking-wide uppercase">
        {agg === "count" ? "items" : agg}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboards/widgets/NumberWidget.tsx
git commit -m "feat(dashboards): Number/KPI widget body"
```

---

## Task 11: Widget frame + Add-widget dialog

**Files:**

- Create: `src/components/dashboards/DashboardWidget.tsx`
- Create: `src/components/dashboards/AddWidgetDialog.tsx`

- [ ] **Step 1: Write the widget frame**

`DashboardWidget` renders the card chrome (title + a config/delete menu in edit mode) and dispatches to the body by kind. Create `src/components/dashboards/DashboardWidget.tsx`:

```tsx
"use client";

import { MoreVertical, Trash2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NumberWidget } from "@/components/dashboards/widgets/NumberWidget";
import { useDashboardMutations } from "@/lib/dashboards/use-dashboard-mutations";
import type { CacheWidget } from "@/lib/dashboards/cache";

export function DashboardWidget({
  widget,
  dashboardId,
  editing,
}: {
  widget: CacheWidget;
  dashboardId: string;
  editing: boolean;
}) {
  const { removeWidget } = useDashboardMutations(dashboardId);

  return (
    <div className="bg-card flex h-full flex-col rounded-lg border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="truncate text-sm font-medium">
          {widget.title || "Untitled"}
        </span>
        {editing ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="text-muted-foreground hover:text-foreground"
              aria-label="Widget menu"
              // keep the drag handler from hijacking the click
              onMouseDown={(e) => e.stopPropagation()}
            >
              <MoreVertical className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => removeWidget.mutate({ widgetId: widget.id })}
              >
                <Trash2 className="mr-2 size-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 p-3">
        {widget.kind === "number" ? (
          <NumberWidget widget={widget} />
        ) : (
          <div className="text-muted-foreground text-sm">
            {widget.kind} widget — coming soon
          </div>
        )}
      </div>
    </div>
  );
}
```

> Confirm `@/components/ui/dropdown-menu` exists (it's used by the board column header menu — see `ColumnHeader`). Reuse the same primitive.

- [ ] **Step 2: Write the Add-widget dialog**

For D1 the only kind is Number. The form collects: source board, title, agg (count/sum/avg), and a numbers column when agg≠count. Source boards + their numbers columns come from props (passed by the page from a server query — see Task 12). Create `src/components/dashboards/AddWidgetDialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDashboardMutations } from "@/lib/dashboards/use-dashboard-mutations";

export type BoardOption = {
  id: string;
  name: string;
  numbersColumns: { id: string; name: string }[];
};

export function AddWidgetDialog({
  dashboardId,
  boards,
}: {
  dashboardId: string;
  boards: BoardOption[];
}) {
  const { addWidget } = useDashboardMutations(dashboardId);
  const [open, setOpen] = useState(false);
  const [boardId, setBoardId] = useState(boards[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [agg, setAgg] = useState<"count" | "sum" | "avg">("count");
  const [valueColumnId, setValueColumnId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const numbersCols =
    boards.find((b) => b.id === boardId)?.numbersColumns ?? [];

  function submit() {
    setError(null);
    if (!boardId) return setError("Pick a source board.");
    const config: Record<string, unknown> =
      agg === "count" ? { agg } : { agg, valueColumnId };
    if (agg !== "count" && !valueColumnId)
      return setError("Pick a numbers column for sum/average.");
    addWidget.mutate(
      { kind: "number", sourceBoardId: boardId, title, config },
      {
        onSuccess: () => {
          setOpen(false);
          setTitle("");
          setAgg("count");
          setValueColumnId("");
        },
        onError: (e) => setError(e.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="mr-1.5 size-4" /> Add widget
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a Number widget</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="text-sm">
            Source board
            <select
              className="bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
              value={boardId}
              onChange={(e) => setBoardId(e.target.value)}
            >
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Title
            <Input
              className="mt-1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Open items"
            />
          </label>
          <label className="text-sm">
            Metric
            <select
              className="bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
              value={agg}
              onChange={(e) =>
                setAgg(e.target.value as "count" | "sum" | "avg")
              }
            >
              <option value="count">Count of items</option>
              <option value="sum">Sum of a number column</option>
              <option value="avg">Average of a number column</option>
            </select>
          </label>
          {agg !== "count" ? (
            <label className="text-sm">
              Number column
              <select
                className="bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
                value={valueColumnId}
                onChange={(e) => setValueColumnId(e.target.value)}
              >
                <option value="">Select…</option>
                {numbersCols.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={addWidget.isPending}>
            Add widget
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

> Confirm the shadcn primitives `dialog`, `button`, `input` exist under `src/components/ui/` (they're used across the app). Match their import paths exactly.

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboards/DashboardWidget.tsx src/components/dashboards/AddWidgetDialog.tsx
git commit -m "feat(dashboards): widget frame + add-widget dialog"
```

---

## Task 12: Canvas (react-grid-layout) + route + layout

**Files:**

- Create: `src/components/dashboards/DashboardCanvas.tsx`
- Create: `src/app/dashboards/layout.tsx`
- Create: `src/app/dashboards/page.tsx`
- Create: `src/app/dashboards/[dashboardId]/page.tsx`

- [ ] **Step 1: Write the canvas**

`react-grid-layout` is client-only and needs its CSS. Create `src/components/dashboards/DashboardCanvas.tsx`:

```tsx
"use client";

import { useCallback, useRef, useState } from "react";
import { Responsive, WidthProvider, type Layout } from "react-grid-layout";

import {
  AddWidgetDialog,
  type BoardOption,
} from "@/components/dashboards/AddWidgetDialog";
import { DashboardWidget } from "@/components/dashboards/DashboardWidget";
import { Button } from "@/components/ui/button";
import type { DashboardCache, GridRect } from "@/lib/dashboards/cache";
import { useDashboardCache } from "@/lib/dashboards/use-dashboard-cache";
import { useDashboardMutations } from "@/lib/dashboards/use-dashboard-mutations";

const GridLayout = WidthProvider(Responsive);

const DEFAULT_RECT: GridRect = { x: 0, y: 0, w: 3, h: 2 };

export function DashboardCanvas({
  initialData,
  boards,
}: {
  initialData: DashboardCache;
  boards: BoardOption[];
}) {
  const dashboardId = initialData.dashboard.id;
  const { data: cache } = useDashboardCache(dashboardId, initialData);
  const { persistLayout } = useDashboardMutations(dashboardId);
  const [editing, setEditing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const widgets = cache.widgets;

  const layout: Layout[] = widgets.map((w) => {
    const r = (w.layout ?? {}) as Partial<GridRect>;
    return {
      i: w.id,
      x: r.x ?? DEFAULT_RECT.x,
      y: r.y ?? DEFAULT_RECT.y,
      w: r.w ?? DEFAULT_RECT.w,
      h: r.h ?? DEFAULT_RECT.h,
    };
  });

  const onLayoutChange = useCallback(
    (next: Layout[]) => {
      if (!editing) return; // ignore layout events while in view mode
      const rects = next.map((l) => ({
        id: l.i,
        x: l.x,
        y: l.y,
        w: l.w,
        h: l.h,
      }));
      if (timer.current) clearTimeout(timer.current);
      // debounce: persist 600ms after the last drag/resize. onMutate patches
      // the cache immediately, so no data refetch happens here.
      timer.current = setTimeout(() => persistLayout.mutate(rects), 600);
    },
    [editing, persistLayout],
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{cache.dashboard.name}</h1>
        <div className="flex items-center gap-2">
          {editing ? (
            <AddWidgetDialog dashboardId={dashboardId} boards={boards} />
          ) : null}
          <Button
            size="sm"
            variant={editing ? "default" : "outline"}
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Done" : "Edit"}
          </Button>
        </div>
      </div>

      {widgets.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-12 text-center text-sm">
          No widgets yet. Click <strong>Edit</strong> →{" "}
          <strong>Add widget</strong>.
        </div>
      ) : (
        <GridLayout
          className="layout"
          layouts={{
            lg: layout,
            md: layout,
            sm: layout,
            xs: layout,
            xxs: layout,
          }}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
          cols={{ lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 }}
          rowHeight={80}
          isDraggable={editing}
          isResizable={editing}
          onLayoutChange={onLayoutChange}
          margin={[12, 12]}
        >
          {widgets.map((w) => (
            <div key={w.id}>
              <DashboardWidget
                widget={w}
                dashboardId={dashboardId}
                editing={editing}
              />
            </div>
          ))}
        </GridLayout>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write the dashboards layout (app-shell + sidebar data + rgl CSS)**

Mirror `src/app/boards/layout.tsx` (query boards + workspaces for the sidebar via `AppShell`). Importing rgl CSS in a layout file is allowed. Create `src/app/dashboards/layout.tsx`:

```tsx
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { AppShell } from "@/components/app-shell"; // confirm exact path/export used by boards/layout.tsx
import { listBoards } from "@/lib/boards/queries";
import { listDashboards } from "@/lib/dashboards/queries";

export default async function DashboardsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Reuse exactly what boards/layout.tsx passes to AppShell so the sidebar
  // renders identically across both surfaces, plus dashboards for the new section.
  const { boards, workspaces } = await listBoards();
  const dashboards = await listDashboards();
  return (
    <AppShell boards={boards} workspaces={workspaces} dashboards={dashboards}>
      {children}
    </AppShell>
  );
}
```

> Implementation note: open `src/app/boards/layout.tsx` and copy its exact `AppShell` usage + the precise return shape of `listBoards()` (explore notes show it returns `{ boards, workspaces }`-shaped data). The only addition here is the `dashboards` prop — which means `AppShell`/`Sidebar` gain a `dashboards` prop in Task 13 (and `boards/layout.tsx` must pass it too, so the section shows on both surfaces). The goal: dashboards routes render inside the same shell/sidebar as boards.

- [ ] **Step 3: Write the dashboards index page**

Create `src/app/dashboards/page.tsx`:

```tsx
import { listDashboards } from "@/lib/dashboards/queries";
import { redirect } from "next/navigation";

export default async function DashboardsIndex() {
  const dashboards = await listDashboards();
  if (dashboards.length > 0) redirect(`/dashboards/${dashboards[0].id}`);
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center p-12 text-sm">
      No dashboards yet. Create one from the sidebar.
    </div>
  );
}
```

- [ ] **Step 4: Write the dashboard detail loader**

Mirror `src/app/boards/[boardId]/page.tsx` (Next 16 async params, `requireUser`, `notFound`). It also needs the source-board options (boards + their numbers columns) for the Add-widget dialog. Create `src/app/dashboards/[dashboardId]/page.tsx`:

```tsx
import { notFound } from "next/navigation";

import { DashboardCanvas } from "@/components/dashboards/DashboardCanvas";
import type { BoardOption } from "@/components/dashboards/AddWidgetDialog";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getDashboardPayload } from "@/lib/dashboards/queries";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ dashboardId: string }>;
}) {
  const { dashboardId } = await params;
  await requireUser();

  const payload = await getDashboardPayload(dashboardId);
  if (!payload) notFound();

  // Source-board options for the Add-widget dialog: org boards + their numbers columns.
  const supabase = await createClient();
  const { data: boardRows } = await supabase
    .from("boards")
    .select("id, name")
    .eq("workspace_id", payload.dashboard.workspace_id)
    .order("position", { ascending: true });
  const { data: numberCols } = await supabase
    .from("columns")
    .select("id, name, board_id")
    .eq("kind", "numbers");

  const boards: BoardOption[] = (boardRows ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    numbersColumns: (numberCols ?? [])
      .filter((c) => c.board_id === b.id)
      .map((c) => ({ id: c.id, name: c.name })),
  }));

  return <DashboardCanvas initialData={payload} boards={boards} />;
}
```

- [ ] **Step 5: Build + manually verify**

Run: `pnpm build`
Expected: PASS. Then `pnpm dev`, sign in, navigate to `/dashboards` → redirect or empty state; create a dashboard (after Task 13) → Edit → Add widget → see a Number count; drag a tile; reload → layout persisted.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboards/DashboardCanvas.tsx src/app/dashboards
git commit -m "feat(dashboards): grid canvas + routes + layout (D1)"
```

---

## Task 13: Sidebar Dashboards section + create flow

**Files:**

- Modify: `src/components/sidebar.tsx`
- (Optional) Create: `src/components/dashboards/DashboardsNav.tsx`

- [ ] **Step 1: Add the dashboards list + create to the sidebar**

The sidebar already has a disabled "Dashboards" nav entry (`nav` array in `src/components/sidebar.tsx`). Wire it to: (a) link to `/dashboards`, and (b) list the workspace's dashboards with a "New dashboard" action that calls `createDashboard` then navigates — mirroring `BoardsNav`'s create dialog. The dashboards list must reach the sidebar; pass it from `src/app/dashboards/layout.tsx` (and the boards layout, so the section shows everywhere) via `AppShell` → `Sidebar`.

Implementation steps:

1. Extend `listDashboards()` results into the `AppShell`/`Sidebar` props (add `dashboards: {id,name}[]`).
2. In both `src/app/boards/layout.tsx` and `src/app/dashboards/layout.tsx`, call `listDashboards()` and pass it down.
3. In `src/components/sidebar.tsx`, render a Dashboards section (mirror the Workspaces/BoardsNav block): each dashboard as a `<Link href={`/dashboards/${d.id}`}>`, plus a "New dashboard" inline dialog using `createDashboard({ workspaceId, name })` + `router.push`.

Create `src/components/dashboards/DashboardsNav.tsx` mirroring `BoardsNav.tsx` (same dialog + `useTransition` + `router.push`/`router.refresh` pattern), accepting `dashboards`, `workspaces`, `collapsed`, then render it from `Sidebar`.

- [ ] **Step 2: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 3: Manually verify create + navigate**

`pnpm dev` → sidebar shows Dashboards section → "New dashboard" → created → navigates to `/dashboards/[id]`.

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar.tsx src/components/dashboards/DashboardsNav.tsx src/app/boards/layout.tsx src/app/dashboards/layout.tsx
git commit -m "feat(dashboards): sidebar Dashboards section + create flow"
```

---

## Task 14: e2e — create dashboard → add Number widget → drag → persist

**Files:**

- Create: `e2e/dashboards.spec.ts`

- [ ] **Step 1: Write the e2e test**

Mirror an existing spec under `e2e/` for auth/setup helpers (sign-in, a seeded board). The test must assert the **0-refetch-on-drag** budget. Create `e2e/dashboards.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
// reuse the project's existing auth/board fixtures — copy the import + setup
// helpers verbatim from the closest existing spec (e.g. e2e/boards.spec.ts).

test("create dashboard, add a Number widget, drag, persist layout", async ({
  page,
}) => {
  // 1. sign in + ensure a board with items exists (reuse existing helpers)
  // ...

  // 2. create a dashboard from the sidebar
  await page.goto("/dashboards");
  await page.getByRole("button", { name: /new dashboard/i }).click();
  await page.getByLabel(/name/i).fill("E2E Dash");
  await page.getByRole("button", { name: /create/i }).click();
  await expect(page).toHaveURL(/\/dashboards\/[0-9a-f-]+/);

  // 3. add a Number widget
  await page.getByRole("button", { name: /^edit$/i }).click();
  await page.getByRole("button", { name: /add widget/i }).click();
  await page
    .getByRole("button", { name: /add widget/i })
    .last()
    .click();

  // 4. the count renders (a number)
  const widget = page.locator(".react-grid-item").first();
  await expect(widget.locator("text=/^[0-9]+$/")).toBeVisible();

  // 5. assert NO aggregate request fires on drag (0-refetch budget)
  let aggregateCalls = 0;
  page.on("request", (r) => {
    if (
      r.url().includes("dashboard_aggregate") ||
      r.postData()?.includes("getWidgetData")
    )
      aggregateCalls++;
  });
  // drag the widget
  const box = await widget.boundingBox();
  if (box) {
    await page.mouse.move(box.x + 20, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 200, { steps: 10 });
    await page.mouse.up();
  }
  await page.waitForTimeout(1000); // allow debounce to fire
  expect(aggregateCalls).toBe(0);

  // 6. reload → widget still present at its new spot (layout persisted)
  await page.reload();
  await expect(page.locator(".react-grid-item").first()).toBeVisible();
});
```

> Note: Server Actions post to the route, not a literal `dashboard_aggregate` URL; assert against the Server Action invocation instead (inspect how existing e2e specs detect Server Action calls, or count requests to the page route during drag). The intent is binding: **layout drag triggers no widget-data fetch.**

- [ ] **Step 2: Run e2e**

Run: `pnpm e2e e2e/dashboards.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/dashboards.spec.ts
git commit -m "test(dashboards): e2e create→add→drag→persist (0-refetch on drag)"
```

---

## Task 15: Full gate + final review

- [ ] **Step 1: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS. Then run the live integration suite (Task 7) against the linked project and confirm green.

- [ ] **Step 2: Advisors**

Use Supabase MCP `get_advisors` (security + performance). Expected: clean (no new findings).

- [ ] **Step 3: Request code review**

Use the `superpowers:requesting-code-review` skill on the full D1 diff. Address findings.

- [ ] **Step 4: Push**

```bash
git push origin develop
```

---

## Notes for the implementer

- **Next.js 16:** `params`/`searchParams` are Promises; `cookies()` is async. Read `node_modules/next/dist/docs/` before touching framework APIs.
- **RLS is the boundary:** never trust the client; every table is org-scoped via `is_org_member(org_id)`. The integration test (Task 7) is the proof.
- **Performance budget (spec §2):** layout drag = client state + debounced `set_widget_layouts` RPC, **0 data refetch**. Widget aggregates are bounded (`GROUP BY`, ≤ K rows) over indexed columns. The e2e test (Task 14) guards the 0-refetch rule.
- **pulse-ui:** load the `pulse-ui` + `frontend-design` skills before finalizing widget/canvas styling; match the monochromatic + single-accent tokens and existing class vocabulary (crib from `KanbanBoard.tsx`, `ColumnHeader.tsx`).
- **Deferred to D2/D3:** Chart + Battery (reuse `dashboard_aggregate` with grouping; extend RPC for dropdown/people array grouping), List widget (bounded `LIMIT` row fetch), widget config editing for non-Number kinds, per-widget refresh affordance.

```

```
