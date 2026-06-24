# AI Dashboard Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Spec: `docs/superpowers/specs/2026-06-23-ai-dashboard-gen-design.md`.

**Goal:** From the Dashboards area, let a user pick one board, approve a compact schema+stats summary, and have Anthropic **Opus 4.8** propose a full dashboard (widgets + grid layout) that materializes as a real dashboard the user reviews with live data and keeps or discards.

**Architecture:** New `src/lib/ai/` module (clean slate — no AI infra exists). A pure **board-snapshot** builder (schema + aggregate stats, **no raw cell values**) feeds a pure **proposal schema + validator/repairer**. A thin **generate** layer calls the Anthropic SDK with structured output (dependency-injected client → testable). Server **actions** compose existing dashboard RPCs (`create_dashboard`, `create_dashboard_widget`, `set_widget_layouts`) to materialize a proposal. The UI is a client **wizard** (client state + History API, 0 RSC navigations) launched from `DashboardsNav`; after create it routes to the live dashboard in a **review** state (banner: Keep / Discard / Regenerate) — this reuses 100% of existing widget rendering for "real data preview".

**Tech Stack:** Next.js 16 (App Router, Server Actions), Supabase (RLS), Zod, `@anthropic-ai/sdk`, React Query, Vitest + jsdom, react-grid-layout, recharts, pulse-ui (shadcn/Tailwind v4).

---

## Key existing facts (verified — do not re-derive)

- **Widget config schemas** live in `src/lib/validations/dashboards.ts`: `numberConfigSchema`, `chartConfigSchema` (`primary`/`series` of kind `status|dropdown|people|date`; `measure` = `{agg: count|sum|avg, valueColumnId?}`), `batteryConfigSchema` (`{groupColumnId}`), `listConfigSchema`, and `configSchemaForKind(kind)`. Re-use these — never re-define.
- **Chart dimensions support only** `status | dropdown | people | date`. **Measures (sum/avg)** require a `numbers` column. Battery groups by a `status | dropdown` column. Columns can be many other kinds (`text, checkbox, rating, link, email, phone, files, time_tracking, relation, mirror, percent`) — describe them in the snapshot but never reference a non-chartable kind in a dimension.
- **Cell value JSON shapes** (`cell_values.value`): text `{text:string}`, status `{optionId:string}`, dropdown `{optionIds:string[]}`, people `{userIds:string[]}`, date `{date:"YYYY-MM-DD"}`, numbers `{n:number}`, checkbox `{checked:boolean}`. Missing `(item_id,column_id)` row = empty cell.
- **Option labels** (status/dropdown) are in `columns.settings.options: {id,label,color}[]` — parse with `optionSchema` from `src/lib/validations/boards.ts`.
- **Board read:** `getBoardPayload(boardId)` in `src/lib/boards/queries.ts` returns `{board, columns, items, cellValues, ...}` RLS-scoped (null if not visible). `listMyBoards()` returns `{id,name,workspace_id,position,shared_out}[]`.
- **Existing aggregate helper:** `aggregate(kind, values)` in `src/lib/boards/aggregation.ts` (reuse for stats where convenient).
- **Action pattern** (`src/lib/dashboards/actions.ts`): `"use server"`, Zod `safeParse`, `createClient()` from `@/lib/supabase/server`, `ActionResult<T> = {ok:true;data:T}|{ok:false;error:string}`, `revalidatePath`. RPCs: `create_dashboard({p_workspace_id,p_name})→dashboard row`; `create_dashboard_widget({p_dashboard_id,p_kind,p_source_board_id,p_title,p_config,p_layout})→widget row`; `set_widget_layouts({p_dashboard_id,p_layouts:[{id,x,y,w,h}]})`.
- **Entry point:** `src/components/dashboards/DashboardsNav.tsx` (client) renders the "New dashboard" `+` and dialog; gets `workspaces` prop. Add the AI entry here.
- **Dashboard page:** `src/app/dashboards/[dashboardId]/page.tsx` (RSC) renders the canvas. Add review-banner reading a `?review=1` searchParam.
- **Commit subjects must be lowercase** (commitlint rejects `AI…`/sentence-case). Prefix `feat(ai):` / `test(ai):` etc. Stage by path. Commit identity is pinned by the worktree.
- **Integration tests** use `describe.skipIf(!SERVICE_ROLE_KEY)` + `config({path:".env.local"})` + `@supabase/supabase-js` admin/anon clients + `signInWithRetry` from `@/test/integration-auth`. Pattern: `src/lib/dashboards/dashboards.rls.integration.test.ts`.

---

## File structure

**Create:**

- `src/lib/ai/anthropic.ts` — client factory, `MODEL`, `AiNotConfiguredError`
- `src/lib/ai/board-snapshot.ts` + `.test.ts` — pure snapshot builder
- `src/lib/ai/proposal-schema.ts` + `.test.ts` — proposal Zod, model JSON schema, `validateProposal`, `packLayout`
- `src/lib/ai/generate.ts` + `.test.ts` — prompt + Anthropic call (DI client)
- `src/lib/ai/actions.ts` + `.test.ts` — server actions
- `src/lib/ai/ai-dashboard.rls.integration.test.ts` — RLS coverage
- `src/components/dashboards/ai/GenerateWithAiButton.tsx`
- `src/components/dashboards/ai/AiDashboardWizard.tsx` + `.test.tsx`
- `src/components/dashboards/ai/AiReviewBanner.tsx` + `.test.tsx`

**Modify:**

- `src/components/dashboards/DashboardsNav.tsx` — mount the AI entry + wizard
- `src/app/dashboards/[dashboardId]/page.tsx` — render `AiReviewBanner` when `?review=1`
- `.env.example` — add `ANTHROPIC_API_KEY=`
- `package.json` / lockfile — `@anthropic-ai/sdk`

---

## Execution DAG

- **Batch A (parallel, no deps):** Task 0 (SDK + client + env), Task 1 (board-snapshot), Task 2 (proposal-schema). Disjoint files.
- **Batch B:** Task 3 (generate) — needs 0,1,2.
- **Batch C:** Task 4 (server actions) — needs 1,2,3.
- **Batch D (parallel):** Task 5 (RLS integration), Task 6 (wizard UI + nav), Task 7 (review banner + page). Disjoint files; all need 4.
- **Batch E:** Task 8 (final wiring + four gates).

**Critical path:** (0|1|2) → 3 → 4 → 6 → 8.

---

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint** of `/dashboards`: unchanged. The AI entry is a static button; the wizard is lazy (`next/dynamic`, `ssr:false`).
- **In-page interactions** (wizard steps, board pick, approval): client state only — **0 RSC navigations**. The only navigation is the final `router.push('/dashboards/<id>?review=1')` after the user clicks Generate (a real server-data change → navigation is correct).
- **Server round-trips only on explicit actions:** `listAiBoards` (once, on wizard open), `getBoardSnapshotSummary` (on board pick), `generateDashboardProposal` (Generate — includes the LLM call + create), Keep/Discard. None are view toggles.
- **Bounded/indexed:** snapshot reads go through `getBoardPayload` (existing RLS-scoped batched read, `board_id`-indexed). Live review reuses the already-bounded widget RPCs (12–100 caps). Snapshot is schema+stats only — payload is tiny regardless of row count.

---

## Task 0: Anthropic SDK + client factory + env

**Files:**

- Create: `src/lib/ai/anthropic.ts`
- Modify: `.env.example`, `package.json` (+lockfile)

- [ ] **Step 1: Install the SDK**

Run: `pnpm add @anthropic-ai/sdk`
Expected: `package.json` gains `@anthropic-ai/sdk`; lockfile updates.

- [ ] **Step 2: Add the env var to `.env.example`**

Append a line (keep existing content):

```
# Server-only. Powers AI dashboard generation (Anthropic Opus 4.8).
ANTHROPIC_API_KEY=
```

- [ ] **Step 3: Write the client factory**

Create `src/lib/ai/anthropic.ts`:

```ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/** The model that powers AI dashboard generation. Single source of truth. */
export const MODEL = "claude-opus-4-8";

/** Thrown when ANTHROPIC_API_KEY is absent. Actions translate it to a clean
 *  user-facing error rather than a 500. */
export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI generation isn't configured.");
    this.name = "AiNotConfiguredError";
  }
}

/** Build a server-only Anthropic client. Throws AiNotConfiguredError if the key
 *  is missing. Never import this into a client component. */
export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AiNotConfiguredError();
  return new Anthropic({ apiKey });
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no usages yet; just verifies the import resolves).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml .env.example src/lib/ai/anthropic.ts
git commit -m "feat(ai): add anthropic sdk client factory and env var"
```

---

## Task 1: Board snapshot builder (pure, schema + aggregate stats)

**Files:**

- Create: `src/lib/ai/board-snapshot.ts`, `src/lib/ai/board-snapshot.test.ts`

The snapshot is what the model sees. **No raw cell values** — only column metadata and per-column aggregate stats.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ai/board-snapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildBoardSnapshot } from "@/lib/ai/board-snapshot";

const board = { id: "b1", name: "Sprint" };
const columns = [
  {
    id: "c-status",
    name: "Status",
    kind: "status",
    settings: {
      options: [
        { id: "o-todo", label: "To Do", color: "#1" },
        { id: "o-done", label: "Done", color: "#2" },
      ],
    },
  },
  { id: "c-pts", name: "Points", kind: "numbers", settings: {} },
  { id: "c-notes", name: "Notes", kind: "text", settings: {} },
] as const;
const items = [{ id: "i1" }, { id: "i2" }, { id: "i3" }];
const cellValues = [
  { item_id: "i1", column_id: "c-status", value: { optionId: "o-todo" } },
  { item_id: "i2", column_id: "c-status", value: { optionId: "o-done" } },
  { item_id: "i3", column_id: "c-status", value: { optionId: "o-done" } },
  { item_id: "i1", column_id: "c-pts", value: { n: 2 } },
  { item_id: "i2", column_id: "c-pts", value: { n: 8 } },
  // i3 points empty
];

describe("buildBoardSnapshot", () => {
  const snap = buildBoardSnapshot({
    board,
    columns: columns as never,
    items,
    cellValues,
  });

  it("includes board, rowCount, and column metadata", () => {
    expect(snap.board).toEqual({ id: "b1", name: "Sprint" });
    expect(snap.rowCount).toBe(3);
    const status = snap.columns.find((c) => c.id === "c-status");
    expect(status?.kind).toBe("status");
    expect(status?.options).toEqual([
      { id: "o-todo", label: "To Do" },
      { id: "o-done", label: "Done" },
    ]);
  });

  it("computes status distribution from cell values, never exposing rows", () => {
    const stats = snap.columnStats["c-status"];
    expect(stats.fillRate).toBe(1);
    expect(stats.distribution).toEqual(
      expect.arrayContaining([
        { label: "Done", count: 2 },
        { label: "To Do", count: 1 },
      ]),
    );
    // no per-item data anywhere in the snapshot
    expect(JSON.stringify(snap)).not.toContain("i1");
  });

  it("computes numeric stats and fill rate", () => {
    const stats = snap.columnStats["c-pts"];
    expect(stats.fillRate).toBeCloseTo(2 / 3);
    expect(stats.numeric).toEqual({ min: 2, max: 8, avg: 5, sum: 10 });
  });

  it("reports text columns as fill-rate only (no values)", () => {
    const stats = snap.columnStats["c-notes"];
    expect(stats.fillRate).toBe(0);
    expect(stats.numeric).toBeUndefined();
    expect(stats.distribution).toBeUndefined();
  });

  it("estimates token size and column count in meta", () => {
    expect(snap.meta.columnCount).toBe(3);
    expect(snap.meta.rowCount).toBe(3);
    expect(snap.meta.estimatedTokens).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/ai/board-snapshot.test.ts`
Expected: FAIL — `buildBoardSnapshot` not defined.

- [ ] **Step 3: Implement the builder**

Create `src/lib/ai/board-snapshot.ts`:

```ts
import { optionSchema } from "@/lib/validations/boards";

type RawColumn = { id: string; name: string; kind: string; settings: unknown };
type RawItem = { id: string };
type RawCell = { item_id: string; column_id: string; value: unknown };

export type SnapshotColumn = {
  id: string;
  name: string;
  kind: string;
  options?: { id: string; label: string }[];
};

export type ColumnStats = {
  fillRate: number; // 0..1 of items with a non-empty cell
  distinctCount: number;
  distribution?: { label: string; count: number }[]; // status/dropdown (top 12)
  numeric?: { min: number; max: number; avg: number; sum: number };
  dateRange?: { earliest: string; latest: string };
};

export type BoardSnapshot = {
  board: { id: string; name: string };
  rowCount: number;
  columns: SnapshotColumn[];
  columnStats: Record<string, ColumnStats>;
  meta: { rowCount: number; columnCount: number; estimatedTokens: number };
};

function isFilled(kind: string, v: unknown): boolean {
  const o = (v ?? {}) as Record<string, unknown>;
  switch (kind) {
    case "status":
      return o.optionId != null;
    case "dropdown":
      return Array.isArray(o.optionIds) && o.optionIds.length > 0;
    case "people":
      return Array.isArray(o.userIds) && o.userIds.length > 0;
    case "date":
      return typeof o.date === "string" && o.date.length > 0;
    case "numbers":
    case "percent":
    case "rating":
      return typeof o.n === "number" && Number.isFinite(o.n);
    case "checkbox":
      return o.checked === true;
    case "text":
    case "link":
    case "email":
    case "phone":
      return typeof o.text === "string" && o.text.trim().length > 0;
    default:
      return v != null;
  }
}

export function buildBoardSnapshot(input: {
  board: { id: string; name: string };
  columns: RawColumn[];
  items: RawItem[];
  cellValues: RawCell[];
}): BoardSnapshot {
  const { board, columns, items, cellValues } = input;
  const rowCount = items.length;

  // index cells by column
  const byColumn = new Map<string, RawCell[]>();
  for (const c of cellValues) {
    const arr = byColumn.get(c.column_id) ?? [];
    arr.push(c);
    byColumn.set(c.column_id, arr);
  }

  const snapColumns: SnapshotColumn[] = [];
  const columnStats: Record<string, ColumnStats> = {};

  for (const col of columns) {
    const opts =
      optionSchema
        .array()
        .safeParse((col.settings as { options?: unknown })?.options ?? [])
        .data ?? [];
    const labelById = new Map(opts.map((o) => [o.id, o.label]));
    snapColumns.push({
      id: col.id,
      name: col.name,
      kind: col.kind,
      ...(opts.length
        ? { options: opts.map((o) => ({ id: o.id, label: o.label })) }
        : {}),
    });

    const cells = (byColumn.get(col.id) ?? []).filter((c) =>
      isFilled(col.kind, c.value),
    );
    const filled = cells.length;
    const stats: ColumnStats = {
      fillRate: rowCount === 0 ? 0 : filled / rowCount,
      distinctCount: 0,
    };

    if (col.kind === "status" || col.kind === "dropdown") {
      const counts = new Map<string, number>();
      for (const c of cells) {
        const o = c.value as { optionId?: string; optionIds?: string[] };
        const ids = col.kind === "status" ? [o.optionId!] : (o.optionIds ?? []);
        for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      stats.distinctCount = counts.size;
      stats.distribution = [...counts.entries()]
        .map(([id, count]) => ({
          label: labelById.get(id) ?? "Unknown",
          count,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 12);
    } else if (
      col.kind === "numbers" ||
      col.kind === "percent" ||
      col.kind === "rating"
    ) {
      const ns = cells.map((c) => (c.value as { n: number }).n);
      if (ns.length) {
        const sum = ns.reduce((a, b) => a + b, 0);
        stats.numeric = {
          min: Math.min(...ns),
          max: Math.max(...ns),
          avg: sum / ns.length,
          sum,
        };
        stats.distinctCount = new Set(ns).size;
      }
    } else if (col.kind === "date") {
      const ds = cells
        .map((c) => (c.value as { date: string }).date)
        .filter(Boolean)
        .sort();
      stats.distinctCount = new Set(ds).size;
      if (ds.length)
        stats.dateRange = { earliest: ds[0], latest: ds[ds.length - 1] };
    } else if (col.kind === "people") {
      const ids = new Set<string>();
      for (const c of cells)
        for (const u of (c.value as { userIds: string[] }).userIds) ids.add(u);
      stats.distinctCount = ids.size;
    }

    columnStats[col.id] = stats;
  }

  const snapshot: Omit<BoardSnapshot, "meta"> = {
    board: { id: board.id, name: board.name },
    rowCount,
    columns: snapColumns,
    columnStats,
  };
  const estimatedTokens = Math.ceil(JSON.stringify(snapshot).length / 4);

  return {
    ...snapshot,
    meta: { rowCount, columnCount: columns.length, estimatedTokens },
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test src/lib/ai/board-snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/board-snapshot.ts src/lib/ai/board-snapshot.test.ts
git commit -m "feat(ai): pure board snapshot builder (schema + aggregate stats, no cell values)"
```

---

## Task 2: Proposal schema, validator/repairer, layout packer (pure)

**Files:**

- Create: `src/lib/ai/proposal-schema.ts`, `src/lib/ai/proposal-schema.test.ts`

This is the safety boundary: whatever the model returns is re-validated against the real widget config schemas + referential checks, invalid widgets are dropped/repaired, and layout is auto-packed.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ai/proposal-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateProposal, packLayout } from "@/lib/ai/proposal-schema";
import type { BoardSnapshot } from "@/lib/ai/board-snapshot";

const snap: BoardSnapshot = {
  board: { id: "b1", name: "Sprint" },
  rowCount: 10,
  columns: [
    { id: "c-status", name: "Status", kind: "status", options: [] },
    { id: "c-pts", name: "Points", kind: "numbers" },
    { id: "c-notes", name: "Notes", kind: "text" },
  ],
  columnStats: {},
  meta: { rowCount: 10, columnCount: 3, estimatedTokens: 1 },
};

describe("validateProposal", () => {
  it("keeps a valid chart widget and a number widget", () => {
    const res = validateProposal(
      {
        name: "Sprint overview",
        widgets: [
          { kind: "number", title: "Total", config: { agg: "count" } },
          {
            kind: "chart",
            title: "By status",
            config: {
              chartType: "bar",
              primary: { kind: "status", columnId: "c-status" },
              measure: { agg: "count" },
            },
          },
        ],
      },
      snap,
    );
    expect(res.name).toBe("Sprint overview");
    expect(res.widgets).toHaveLength(2);
    expect(res.warnings).toHaveLength(0);
  });

  it("drops a chart referencing a non-existent column", () => {
    const res = validateProposal(
      {
        name: "x",
        widgets: [
          {
            kind: "chart",
            title: "bad",
            config: {
              chartType: "bar",
              primary: { kind: "status", columnId: "nope" },
              measure: { agg: "count" },
            },
          },
        ],
      },
      snap,
    );
    expect(res.widgets).toHaveLength(0);
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it("drops a chart whose primary kind mismatches the column's kind", () => {
    const res = validateProposal(
      {
        name: "x",
        widgets: [
          {
            kind: "chart",
            title: "bad",
            config: {
              chartType: "bar",
              primary: { kind: "status", columnId: "c-pts" }, // c-pts is numbers
              measure: { agg: "count" },
            },
          },
        ],
      },
      snap,
    );
    expect(res.widgets).toHaveLength(0);
  });

  it("repairs a sum measure with a missing value column down to count", () => {
    const res = validateProposal(
      {
        name: "x",
        widgets: [
          {
            kind: "chart",
            title: "repair",
            config: {
              chartType: "bar",
              primary: { kind: "status", columnId: "c-status" },
              measure: { agg: "sum" }, // no valueColumnId → coerce to count
            },
          },
        ],
      },
      snap,
    );
    expect(res.widgets).toHaveLength(1);
    expect(
      (res.widgets[0].config as { measure: { agg: string } }).measure.agg,
    ).toBe("count");
  });

  it("returns empty (with a warning) when name is missing", () => {
    const res = validateProposal({ widgets: [] } as never, snap);
    expect(res.name.length).toBeGreaterThan(0); // falls back to board name
  });
});

describe("packLayout", () => {
  it("assigns non-overlapping 12-col rects when layout is omitted", () => {
    const widgets = [
      { kind: "number" as const, title: "a", config: {} },
      { kind: "number" as const, title: "b", config: {} },
      { kind: "chart" as const, title: "c", config: {} },
    ];
    const packed = packLayout(widgets);
    expect(packed).toHaveLength(3);
    for (const w of packed) {
      expect(w.layout.x).toBeGreaterThanOrEqual(0);
      expect(w.layout.x + w.layout.w).toBeLessThanOrEqual(12);
      expect(w.layout.w).toBeGreaterThanOrEqual(1);
      expect(w.layout.h).toBeGreaterThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/ai/proposal-schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the schema + validator + packer**

Create `src/lib/ai/proposal-schema.ts`. Use the existing config schemas; do referential checks against the snapshot. Key contract:

```ts
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
  const parsed = configSchemaForKind(w.kind).safeParse(cfg);
  if (!parsed.success) {
    warn(
      `Dropped "${w.title}": ${parsed.error.issues[0]?.message ?? "invalid"}`,
    );
    return null;
  }
  return {
    kind: w.kind,
    title: (w.title ?? "").slice(0, 100),
    config: parsed.data as Record<string, unknown>,
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
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test src/lib/ai/proposal-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/proposal-schema.ts src/lib/ai/proposal-schema.test.ts
git commit -m "feat(ai): proposal schema, validator/repairer, and layout packer"
```

---

## Task 3: Generate layer (prompt + Anthropic call, DI client)

**Files:**

- Create: `src/lib/ai/generate.ts`, `src/lib/ai/generate.test.ts`

**Before coding, the subagent MUST read the claude-api skill's TypeScript docs for the exact structured-output call shape:** `Skill claude-api`, then read `typescript/claude-api/README.md` and `typescript/claude-api/tool-use.md` (structured outputs section). Use `messages.parse()` / `output_config.format` per those docs. Model `MODEL` (= `claude-opus-4-8`), `thinking: { type: "adaptive" }`, `output_config: { effort: "high" }`. Prompt-cache the system prompt (`cache_control: { type: "ephemeral" }`). `max_tokens` ~16000 (non-streaming; output is small).

- [ ] **Step 1: Write the failing test (mocked client)**

Create `src/lib/ai/generate.test.ts`. The function takes an **injected client** so no network is hit:

```ts
import { describe, expect, it, vi } from "vitest";
import { generateProposal, buildSystemPrompt } from "@/lib/ai/generate";
import type { BoardSnapshot } from "@/lib/ai/board-snapshot";

const snap: BoardSnapshot = {
  board: { id: "b1", name: "Sprint" },
  rowCount: 5,
  columns: [{ id: "c-status", name: "Status", kind: "status", options: [] }],
  columnStats: { "c-status": { fillRate: 1, distinctCount: 2 } },
  meta: { rowCount: 5, columnCount: 1, estimatedTokens: 50 },
};

function fakeClient(proposalJson: unknown) {
  // Mimic the shape generate.ts expects from the SDK. Adjust to the real
  // parse() return shape discovered from the claude-api docs.
  return {
    messages: {
      parse: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: JSON.stringify(proposalJson) }],
        parsed: proposalJson,
      }),
    },
  } as never;
}

describe("buildSystemPrompt", () => {
  it("teaches the widget vocabulary", () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/number|chart|battery|list/);
    expect(p).toMatch(/12/); // 12-column grid
  });
});

describe("generateProposal", () => {
  it("returns the model's proposal object", async () => {
    const proposal = {
      name: "Sprint overview",
      widgets: [{ kind: "number", title: "Total", config: { agg: "count" } }],
    };
    const client = fakeClient(proposal);
    const res = await generateProposal(snap, { client });
    expect(res.name).toBe("Sprint overview");
    expect(res.widgets).toHaveLength(1);
  });

  it("passes feedback into the user message when provided", async () => {
    const client = fakeClient({ name: "x", widgets: [] });
    await generateProposal(snap, { client, feedback: "more charts please" });
    const call = (
      client as never as { messages: { parse: ReturnType<typeof vi.fn> } }
    ).messages.parse.mock.calls[0][0];
    expect(JSON.stringify(call)).toContain("more charts please");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/ai/generate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement generate.ts**

Contract (adjust SDK call to the claude-api docs):

```ts
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, MODEL } from "@/lib/ai/anthropic";
import {
  PROPOSAL_JSON_SCHEMA,
  type DashboardProposal,
} from "@/lib/ai/proposal-schema";
import type { BoardSnapshot } from "@/lib/ai/board-snapshot";

export function buildSystemPrompt(): string {
  return [
    "You design analytics dashboards for a Monday-style work board.",
    "Output a dashboard proposal: a name and up to 8 widgets on a 12-column grid.",
    "Widget kinds and their config:",
    "- number: { agg: 'count'|'sum'|'avg', valueColumnId?, display?: 'plain'|'gauge', target? }. sum/avg need a numbers column.",
    "- chart: { chartType: 'bar'|'stackedBar'|'groupedBar'|'line'|'area'|'combo'|'pie'|'donut'|'radial', primary: {kind:'status'|'dropdown'|'people'|'date', columnId?, bucket?}, series?: <same>, measure: {agg, valueColumnId?} }.",
    "- battery: { groupColumnId } — must be a status or dropdown column.",
    "- list: { columnIds: string[] (<=8), limit?: number }.",
    "Rules: only reference columnId values that exist in the snapshot. primary/series.kind MUST equal the referenced column's kind. Only status/dropdown/people/date are chartable dimensions; sum/avg measures need a numbers column.",
    "Design well: lead with 1-2 headline number widgets, then charts. Prefer pie/donut for low-cardinality status; bar for categories; line/area for date trends. Don't chart near-empty columns. Give each widget a short human title.",
    "Provide a sensible layout {x,y,w,h} per widget (number 3x2, chart 6x4).",
  ].join("\n");
}

function buildUserPrompt(snap: BoardSnapshot, feedback?: string): string {
  return [
    `Board snapshot (schema + aggregate stats, no raw rows):`,
    JSON.stringify(snap),
    feedback ? `\nUser feedback for this revision: ${feedback}` : "",
  ].join("\n");
}

export async function generateProposal(
  snap: BoardSnapshot,
  opts: { client?: Anthropic; feedback?: string } = {},
): Promise<DashboardProposal> {
  const client = opts.client ?? getAnthropicClient();
  // NOTE: confirm parse()/output_config syntax against claude-api TS docs.
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: {
        type: "json_schema",
        schema: PROPOSAL_JSON_SCHEMA,
        name: "dashboard_proposal",
      },
    },
    system: [
      {
        type: "text",
        text: buildSystemPrompt(),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: buildUserPrompt(snap, opts.feedback) }],
  } as never);
  // Prefer the SDK's parsed field; fall back to JSON.parse of the text block.
  const parsed =
    (res as { parsed?: unknown }).parsed ??
    JSON.parse(
      (res as { content: { type: string; text?: string }[] }).content.find(
        (b) => b.type === "text",
      )?.text ?? "{}",
    );
  return parsed as DashboardProposal;
}
```

- [ ] **Step 4: Run tests; iterate against the real SDK shape**

Run: `pnpm test src/lib/ai/generate.test.ts`
Expected: PASS. If the real `parse()` return shape differs from the mock, fix BOTH the mock and the extraction so they agree with the claude-api docs.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/generate.ts src/lib/ai/generate.test.ts
git commit -m "feat(ai): opus 4.8 proposal generation with structured output (injectable client)"
```

---

## Task 4: Server actions

**Files:**

- Create: `src/lib/ai/actions.ts`, `src/lib/ai/actions.test.ts`

Four actions, all `ActionResult<T>`. Compose existing RPCs.

Signatures:

- `listAiBoards(): Promise<ActionResult<{ boards: { id: string; name: string; workspaceId: string }[] }>>` — wraps `listMyBoards()`.
- `getBoardSnapshotSummary({ boardId }): Promise<ActionResult<{ boardName: string; rowCount: number; columns: { name: string; kind: string }[]; estimatedTokens: number }>>` — `getBoardPayload`, then `buildBoardSnapshot`, return a slim summary (no stats payload).
- `generateDashboardProposal({ boardId, feedback? }): Promise<ActionResult<{ proposal: ValidatedProposal }>>` — `getBoardPayload` → `buildBoardSnapshot`; block if `rowCount === 0` or no chartable columns ("This board has no data to build a dashboard from yet."); `generateProposal(snap, { feedback })`; `validateProposal`; if `widgets.length === 0` return error "Couldn't generate a usable layout — try Regenerate." Catch `AiNotConfiguredError` → `fail("AI generation isn't configured.")`; catch other errors → `fail("AI generation failed. Please try again.")`.
- `createDashboardFromProposal({ workspaceId, proposal }): Promise<ActionResult<{ dashboardId: string }>>` where `proposal` is the validated `{ name, widgets }` plus each widget's `sourceBoardId` (the board it was generated from). Steps: `create_dashboard` → for each widget `create_dashboard_widget` (config + layout) collecting `{id,...layout}` → `set_widget_layouts` to persist the packed grid → `revalidatePath("/dashboards")` → return `dashboardId`.

- [ ] **Step 1: Write failing tests (mock supabase + generate)**

Create `src/lib/ai/actions.test.ts`. Mock `@/lib/supabase/server` `createClient` and `@/lib/ai/generate` + `@/lib/boards/queries`. Cover:

- `generateDashboardProposal` returns `fail` with the empty-board message when `rowCount===0` (and never calls `generateProposal`).
- `generateDashboardProposal` maps a good proposal through `validateProposal` and returns it.
- `generateDashboardProposal` returns the not-configured message when `generateProposal` throws `AiNotConfiguredError`.
- `createDashboardFromProposal` calls `create_dashboard` then `create_dashboard_widget` once per widget then `set_widget_layouts`, and returns the new id.

Use `vi.mock`. Example skeleton for the create test:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc })),
}));

beforeEach(() => rpc.mockReset());

it("createDashboardFromProposal composes the three RPCs", async () => {
  rpc
    .mockResolvedValueOnce({ data: { id: "dash-1" }, error: null }) // create_dashboard
    .mockResolvedValueOnce({ data: { id: "w-1" }, error: null }) // create_dashboard_widget
    .mockResolvedValueOnce({ data: null, error: null }); // set_widget_layouts
  const { createDashboardFromProposal } = await import("@/lib/ai/actions");
  const res = await createDashboardFromProposal({
    workspaceId: "11111111-1111-1111-1111-111111111111",
    proposal: {
      name: "Sprint",
      sourceBoardId: "22222222-2222-2222-2222-222222222222",
      widgets: [
        {
          kind: "number",
          title: "Total",
          config: { agg: "count" },
          layout: { x: 0, y: 0, w: 3, h: 2 },
        },
      ],
    },
  });
  expect(res.ok).toBe(true);
  expect(rpc.mock.calls[0][0]).toBe("create_dashboard");
  expect(rpc.mock.calls[1][0]).toBe("create_dashboard_widget");
  expect(rpc.mock.calls[2][0]).toBe("set_widget_layouts");
});
```

(Write the other three tests analogously — mock `getBoardPayload` to return a payload with the desired `items`/`columns`, and `vi.mock("@/lib/ai/generate")` to control `generateProposal`.)

- [ ] **Step 2: Run to verify fail.** Run: `pnpm test src/lib/ai/actions.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/lib/ai/actions.ts`** following `src/lib/dashboards/actions.ts` conventions exactly (`"use server"`, Zod input schemas, `ActionResult`, `createClient`). Reuse `buildBoardSnapshot`, `validateProposal`, `generateProposal`, `getBoardPayload`, `listMyBoards`. The proposal passed to `createDashboardFromProposal` carries `sourceBoardId` so every widget gets `p_source_board_id`. Validate the proposal input with a Zod schema (kind enum, config object, layout rect, sourceBoardId uuid).

- [ ] **Step 4: Run tests to verify pass.** Run: `pnpm test src/lib/ai/actions.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/actions.ts src/lib/ai/actions.test.ts
git commit -m "feat(ai): server actions for snapshot summary, generate, and create-from-proposal"
```

---

## Task 5: RLS integration tests

**Files:**

- Create: `src/lib/ai/ai-dashboard.rls.integration.test.ts`

Follow `src/lib/dashboards/dashboards.rls.integration.test.ts` exactly (dotenv, `describe.skipIf(!SERVICE_ROLE_KEY)`, admin + anon clients, `signInWithRetry`). Because the actions use the cookie-bound server client (not available in node tests), test the **RLS boundary at the data layer** the actions rely on:

- [ ] **Step 1:** Seed two orgs/users with a board each (admin client). User A signs in (anon client).
- [ ] **Step 2:** Assert user A's anon client can read board A's `columns`/`items`/`cell_values` (the snapshot inputs) and **cannot** read board B's (RLS returns empty) — this is exactly what `getBoardSnapshotSummary`/`generateDashboardProposal` depend on.
- [ ] **Step 3:** Assert user A can `rpc("create_dashboard", ...)` in their workspace and `rpc("create_dashboard_widget", ...)` against board A, and that the rows are org-scoped; assert creating a widget with `p_source_board_id` = board B fails or is not visible cross-tenant.
- [ ] **Step 4:** Run: `pnpm test src/lib/ai/ai-dashboard.rls.integration.test.ts` → PASS (or SKIP if no `SUPABASE_SERVICE_ROLE_KEY`, matching repo norm).
- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/ai-dashboard.rls.integration.test.ts
git commit -m "test(ai): rls coverage for snapshot reads and create-from-proposal"
```

---

## Task 6: Wizard UI + nav entry

**Files:**

- Create: `src/components/dashboards/ai/GenerateWithAiButton.tsx`, `src/components/dashboards/ai/AiDashboardWizard.tsx`, `src/components/dashboards/ai/AiDashboardWizard.test.tsx`
- Modify: `src/components/dashboards/DashboardsNav.tsx`

**Load pulse-ui + frontend-design skills before building UI (AGENTS.md #3).** Use existing shadcn primitives (`Dialog`, `Button`, `Select`/list, `Label`). Monochromatic + single `--brand` accent. A `Sparkles` lucide icon for the entry.

Wizard is a controlled `Dialog`. **All step state is client state — no router navigation between steps.** Steps:

1. **board-pick** — on open, call `listAiBoards()`; render a selectable list. Disabled "Next" until one chosen.
2. **approval** — call `getBoardSnapshotSummary({boardId})`; show board name, row count, column count + a compact column list, estimated payload size, and the reassurance line "Only column names, types, option labels, and summary counts are sent — no cell contents leave your workspace." Buttons: Back / **Generate**.
3. **generating** — call `generateDashboardProposal({boardId})`; show a spinner ("Designing your dashboard…"). On success immediately call `createDashboardFromProposal({workspaceId, proposal:{...proposal, sourceBoardId: boardId}})`; on success `router.push(\`/dashboards/${id}?review=1\`)`and close. On any`{ok:false}` show the error with Back / Retry.

Errors render via `role="alert"`. The not-configured error shows a friendly explainer.

- [ ] **Step 1: Write the failing component test**

Create `src/components/dashboards/ai/AiDashboardWizard.test.tsx`. Mock the action module. Assert:

- Renders the board list from `listAiBoards`.
- "Generate" is not reachable until a board is selected and approval is shown (step gating).
- When `generateDashboardProposal` returns `{ok:false, error}`, the error text appears in an alert.

Use `@testing-library/react` + `vi.mock("@/lib/ai/actions")` (match existing `*.test.tsx` setup — see `DashboardsNav.test.tsx`).

- [ ] **Step 2: Run → FAIL.** `pnpm test src/components/dashboards/ai/AiDashboardWizard.test.tsx`
- [ ] **Step 3: Implement** `AiDashboardWizard.tsx` (state machine via `useState<"pick"|"approve"|"generating">`, `useTransition` for actions) and `GenerateWithAiButton.tsx` (renders trigger + lazy-loads the wizard via `next/dynamic`, `{ ssr: false }`). Wire into `DashboardsNav.tsx`: next to the existing "New dashboard" `+`, add a `Sparkles` button (`aria-label="Generate dashboard with AI"`) that opens the wizard; pass `workspaceId={workspaces[0]?.id}`. Keep the existing dialog intact.
- [ ] **Step 4: Run → PASS.** Also run `pnpm test src/components/dashboards/DashboardsNav.test.tsx` to confirm no regression.
- [ ] **Step 5: Commit**

```bash
git add src/components/dashboards/ai/GenerateWithAiButton.tsx src/components/dashboards/ai/AiDashboardWizard.tsx src/components/dashboards/ai/AiDashboardWizard.test.tsx src/components/dashboards/DashboardsNav.tsx
git commit -m "feat(ai): generate-with-ai wizard and dashboards nav entry"
```

---

## Task 7: Review banner on the dashboard page

**Files:**

- Create: `src/components/dashboards/ai/AiReviewBanner.tsx`, `src/components/dashboards/ai/AiReviewBanner.test.tsx`
- Modify: `src/app/dashboards/[dashboardId]/page.tsx`

When a dashboard is opened with `?review=1`, show a dismissible banner above the canvas: "AI generated this dashboard — Keep it, or discard." Buttons:

- **Keep** — `router.replace(\`/dashboards/${id}\`)` (drops the param via History API; no refetch) + a "Kept" toast.
- **Discard** — `deleteDashboard({dashboardId})` (existing action) → `router.push("/dashboards")`.
- **Regenerate** — `deleteDashboard` then reopen the wizard via the `useUIStore` flag (add a `aiWizardOpen` flag mirroring `newDashboardOpen`) or simply route to `/dashboards` and let the user reopen; keep it simple: Discard + open wizard.

- [ ] **Step 1: Write the failing test.** `AiReviewBanner.test.tsx`: renders when shown; clicking Discard calls the mocked `deleteDashboard` with the id. Mock `@/lib/dashboards/actions` and `next/navigation`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `AiReviewBanner.tsx` (client). In `page.tsx` (RSC), read `searchParams` (Next.js 16 — `searchParams` is async; `const sp = await searchParams`) and render `<AiReviewBanner dashboardId={id} />` only when `sp.review === "1"`. Confirm the `searchParams` API against `node_modules/next/dist/docs/` before editing.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit**

```bash
git add src/components/dashboards/ai/AiReviewBanner.tsx src/components/dashboards/ai/AiReviewBanner.test.tsx "src/app/dashboards/[dashboardId]/page.tsx"
git commit -m "feat(ai): post-generation review banner (keep/discard/regenerate)"
```

---

## Task 8: Final wiring + verification gates

**Files:** none new — integration + cleanup.

- [ ] **Step 1:** Manually trace the end-to-end path against the code: nav button → wizard → listAiBoards → summary → generate → create → push `?review=1` → banner → keep/discard. Fix any mismatched prop/return-type names.
- [ ] **Step 2: Run the four gates:**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: all PASS. (`pnpm test` runs unit + component; integration RLS test SKIPs without the service-role key, which is the repo norm.)

- [ ] **Step 3:** If `lint` flags an unavoidable `any` at the SDK boundary, justify it with a one-line comment (matching the existing `dashboard_series` precedent in `actions.ts`). Prefer typed SDK helpers over casts where the claude-api docs provide them.
- [ ] **Step 4: Commit any fixes**

```bash
git add <paths>
git commit -m "chore(ai): wire end-to-end and green the gates"
```

---

## Self-review (completed)

- **Spec coverage:** data scope (schema+stats, no cell values) → Task 1; structured generation + re-validation → Tasks 2,3; one-board flow + entry point → Tasks 4,6; approval summary → Task 6 step 2; preview-with-real-data → Task 7 (live review on the real canvas) + flagged as a design refinement for Gate 2; error handling (no key / empty board / invalid proposal) → Task 4; perf budget → addressed (lazy wizard, client-state steps, bounded reads); tests → every task is TDD; env → Task 0. **Note for Gate 2:** the spec said "read-only preview _then_ create"; this plan delivers real-data preview by creating then offering Keep/Discard (review mode), which reuses all existing rendering with far less risk than building parallel preview renderers. Flag for user confirmation.
- **Placeholder scan:** none — pure-logic tasks ship full code+tests; action/UI tasks give exact signatures, RPC names, return shapes, and representative test code.
- **Type consistency:** `BoardSnapshot`, `ValidatedProposal`, `ProposalWidget`, `MODEL`, `getAnthropicClient`, `validateProposal`, `packLayout`, `generateProposal`, action names are used consistently across tasks.
- **SDK caveat:** Task 3 explicitly defers the exact `messages.parse()`/`output_config` syntax to the claude-api skill docs (knowledge cutoff) and keeps the client injectable so tests never hit the network.
