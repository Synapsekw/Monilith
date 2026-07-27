# Report Builder v2 — Charts Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one orderable `chart` block (donut / horizontal bars) to the shipped Board PDF Report Builder that renders identically in the live preview iframe and in the exported PDF.

**Architecture:** The PDF page runs **no client JavaScript** (`renderToStaticMarkup` → `page.setContent`), and a spike proved recharts 3.8.1 renders an **empty wrapper div** there even with fixed width/height and animation disabled. So the charts are hand-rolled: the donut is pure SVG arc math, the bars are the same HTML/CSS percentage-width idiom `GroupSummariesBlock` already ships. Every chart component is a pure function of props — no hooks, no refs, no measurement, no ids — which makes preview/PDF parity structural rather than incidental. `reports.config` is versioned `jsonb`, so this is an additive Zod variant with **no migration and no `REPORT_CONFIG_VERSION` bump**.

**Tech Stack:** Next.js 16 App Router (RSC), React 19.2, Zod 4, Vitest 4 (jsdom) + @testing-library/react 16, TypeScript strict. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-07-26-report-builder-v2-charts-design.md` — read it before Task 1.

---

## File structure

| File                                                                               | Responsibility                                                                                                                                                                                                | Task |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `src/lib/reports/config.ts`                                                        | **Modify.** Add `chart` to the block-type enum + discriminated union; add `parseReportConfig` (lenient read) and `backfillBlocks`; add `chart` to `defaultReportConfig()`. `REPORT_CONFIG_VERSION` stays `1`. | T1   |
| `src/lib/reports/config.test.ts`                                                   | **Modify.** Versioning, backfill, unknown-block tolerance.                                                                                                                                                    | T1   |
| `src/lib/reports/queries.ts`                                                       | **Modify.** `rowToReport` uses `parseReportConfig` instead of the throwing `reportConfigSchema.parse`.                                                                                                        | T1   |
| `src/lib/reports/chart-palette.ts`                                                 | **Create.** The validated print ramp + neutral + slot assignment. Nothing else.                                                                                                                               | T2   |
| `src/lib/reports/chart-palette.test.ts`                                            | **Create.** Palette regression.                                                                                                                                                                               | T2   |
| `src/lib/reports/report-css.ts`                                                    | **Modify.** Add the `/* ---- charts ---- */` CSS section.                                                                                                                                                     | T2   |
| `src/test/static-imports.ts`                                                       | **Create.** `staticEdges` / `reachable` extracted from the dashboards guard test, so two guards share one walker.                                                                                             | T3   |
| `src/components/dashboards/no-recharts-in-first-paint.test.ts`                     | **Modify.** Import the extracted walker; assertions unchanged.                                                                                                                                                | T3   |
| `src/lib/reports/chart-data.ts`                                                    | **Create.** `computeChartSeries` — the only shaping logic.                                                                                                                                                    | T4   |
| `src/lib/reports/chart-data.test.ts`                                               | **Create.** Shaping + color-assignment contract.                                                                                                                                                              | T4   |
| `src/lib/reports/shape.ts`                                                         | **Modify.** Export the existing `leafItems` helper (currently module-private) so the chart counts items exactly the way the KPI block does. One-line change.                                                  | T4   |
| `src/components/reports/blocks/DonutChart.tsx`                                     | **Create.** Pure SVG ring.                                                                                                                                                                                    | T5   |
| `src/components/reports/blocks/BarsChart.tsx`                                      | **Create.** Pure HTML/CSS bars.                                                                                                                                                                               | T5   |
| `src/components/reports/blocks/ChartLegend.tsx`                                    | **Create.** Donut's legend rows.                                                                                                                                                                              | T5   |
| `src/components/reports/blocks/ChartBlock.tsx`                                     | **Create.** The block: title, empty state, `<2` stat line, variant switch.                                                                                                                                    | T5   |
| `src/components/reports/blocks/ChartBlock.test.tsx`                                | **Create.** SSR geometry assertions.                                                                                                                                                                          | T5   |
| `src/components/reports/blocks/ChartBlock.parity.test.tsx`                         | **Create.** SSR markup === client markup.                                                                                                                                                                     | T5   |
| `src/components/reports/ReportDocument.tsx`                                        | **Modify.** `chartSeries` prop + `case "chart"`.                                                                                                                                                              | T6   |
| `src/lib/reports/actions.ts`                                                       | **Modify.** Compute the series in `exportReportPdf`.                                                                                                                                                          | T6   |
| `src/components/reports/ReportDocument.test.tsx`, `src/lib/reports/export.test.ts` | **Modify.** Pass the new required prop.                                                                                                                                                                       | T6   |
| `src/components/reports/no-recharts-in-report.test.ts`                             | **Create.** Guard: `ReportDocument` never statically reaches recharts.                                                                                                                                        | T7   |
| `src/components/reports/ChartBlockOptions.tsx`                                     | **Create.** The builder rail editor.                                                                                                                                                                          | T8   |
| `src/components/reports/ChartBlockOptions.test.tsx`                                | **Create.** Editor behaviour + a11y.                                                                                                                                                                          | T8   |
| `src/components/reports/SectionRail.tsx`                                           | **Modify.** One `LABELS` entry.                                                                                                                                                                               | T8   |
| `src/components/reports/ReportBuilder.tsx`                                         | **Modify.** `useMemo` for the series + mount the editor + pass the prop.                                                                                                                                      | T8   |

---

## Execution DAG

**Dependency graph**

```
T1 ─┬─────────────┐
    │             ↓
T2 ─┴──→ T4 ──→ T5 ──┬──→ T6 ──┐
                     ├──→ T7 ──┼──→ T9
T3 ──────────────────┘         │
T1,T4,T5 ──────────→ T8 ───────┘
```

- **T1** depends on nothing. **T2** depends on nothing. **T3** depends on nothing.
- **T4** depends on T1 (the `ChartBlockOptions` type) and T2 (the ramp).
- **T5** depends on T2 (CSS classes) and T4 (`ChartSeries`).
- **T6** depends on T4, T5. **T7** depends on T3, T5. **T8** depends on T1, T4, T5.
- **T9** depends on all.

**Parallel batches**

| Batch | Tasks            | Dispatch                                                                        |
| ----- | ---------------- | ------------------------------------------------------------------------------- |
| 1     | **T1 ∥ T2 ∥ T3** | `superpowers:dispatching-parallel-agents` — 3 concurrent agents, disjoint files |
| 2     | T4               | single                                                                          |
| 3     | T5               | single                                                                          |
| 4     | **T6 ∥ T7 ∥ T8** | `superpowers:dispatching-parallel-agents` — 3 concurrent agents, disjoint files |
| 5     | T9               | single                                                                          |

**Critical path (wall-clock floor):** T1/T2 → T4 → T5 → T6 → T9 (5 sequential stages).

All tasks in a batch edit **disjoint files**, so they share the single `task/report-builder-v2-charts` worktree — no nested worktrees needed. Serialize the commits within a batch (each agent commits only its own listed paths, staged explicitly by path — never `git add -A`).

---

## Task 1: Config — `chart` variant, lenient read, backfill

**Interfaces:** Consumes: nothing. Produces: `ChartBlockOptions` type, `parseReportConfig`, `backfillBlocks`, the extended union.

**Files:**

- Modify: `src/lib/reports/config.ts`
- Modify: `src/lib/reports/config.test.ts`
- Modify: `src/lib/reports/queries.ts:28` (`rowToReport`)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/reports/config.test.ts` (keep the three existing tests, but **delete** the existing `"rejects an unknown block type"` test — the read path is deliberately lenient now; its replacement is below. The strict `blockSchema` still rejects, which the replacement asserts):

```ts
import {
  reportConfigSchema,
  blockSchema,
  parseReportConfig,
  defaultReportConfig,
  REPORT_CONFIG_VERSION,
} from "@/lib/reports/config";

describe("report config — charts (v2 slice)", () => {
  it("REPORT_CONFIG_VERSION stays 1 (additive variants never bump it)", () => {
    expect(REPORT_CONFIG_VERSION).toBe(1);
  });

  it("defaultReportConfig has 9 block types with chart enabled", () => {
    const cfg = defaultReportConfig();
    expect(new Set(cfg.blocks.map((b) => b.type)).size).toBe(9);
    const chart = cfg.blocks.find((b) => b.type === "chart");
    expect(chart?.enabled).toBe(true);
    if (chart?.type === "chart") {
      expect(chart.options.variant).toBe("donut");
      expect(chart.options.source).toBe("status");
      expect(chart.options.columnId).toBeNull();
      expect(chart.options.maxCategories).toBe(6);
      expect(chart.options.title).toBe("");
    }
  });

  it("defaultReportConfig places chart directly after kpis", () => {
    const types = defaultReportConfig().blocks.map((b) => b.type);
    expect(types[types.indexOf("kpis") + 1]).toBe("chart");
  });

  it("backfills a missing chart block into a stored v1 config, DISABLED", () => {
    const stored = {
      v: 1,
      title: "Weekly",
      blocks: [
        { type: "cover", enabled: true, options: {} },
        { type: "kpis", enabled: true, options: {} },
        { type: "table", enabled: true, options: {} },
      ],
    };
    const cfg = parseReportConfig(stored);
    const chart = cfg.blocks.find((b) => b.type === "chart");
    expect(chart).toBeDefined();
    expect(chart?.enabled).toBe(false);
    // inserted after the last preceding block that is present (kpis)
    const types = cfg.blocks.map((b) => b.type);
    expect(types[types.indexOf("kpis") + 1]).toBe("chart");
    // the user's own blocks keep their enabled state and relative order
    expect(cfg.title).toBe("Weekly");
    expect(types.indexOf("cover")).toBeLessThan(types.indexOf("kpis"));
  });

  it("backfilled blocks never change an existing block's enabled state", () => {
    const cfg = parseReportConfig({
      v: 1,
      title: "T",
      blocks: [{ type: "table", enabled: false, options: {} }],
    });
    expect(cfg.blocks.find((b) => b.type === "table")?.enabled).toBe(false);
  });

  it("DROPS an unknown future block type instead of throwing (rollback safety)", () => {
    expect(() =>
      parseReportConfig({
        v: 1,
        title: "T",
        blocks: [
          { type: "cover", enabled: true, options: {} },
          { type: "timeline_from_the_future", enabled: true, options: {} },
        ],
      }),
    ).not.toThrow();
    const cfg = parseReportConfig({
      v: 1,
      title: "T",
      blocks: [
        { type: "timeline_from_the_future", enabled: true, options: {} },
      ],
    });
    expect(
      cfg.blocks.some((b) => (b.type as string) === "timeline_from_the_future"),
    ).toBe(false);
  });

  it("parseReportConfig tolerates null/garbage and yields a full default set", () => {
    for (const raw of [null, undefined, {}, 42, "nope"]) {
      const cfg = parseReportConfig(raw);
      expect(new Set(cfg.blocks.map((b) => b.type)).size).toBe(9);
      expect(cfg.v).toBe(1);
    }
  });

  it("the WRITE schema is still strict — junk blocks are rejected", () => {
    expect(
      blockSchema.safeParse({ type: "nope", enabled: true, options: {} })
        .success,
    ).toBe(false);
    expect(
      reportConfigSchema.safeParse({
        blocks: [{ type: "nope", enabled: true, options: {} }],
      }).success,
    ).toBe(false);
  });

  it("clamps maxCategories to 3..6 and rejects out-of-range on write", () => {
    expect(
      blockSchema.safeParse({ type: "chart", options: { maxCategories: 2 } })
        .success,
    ).toBe(false);
    expect(
      blockSchema.safeParse({ type: "chart", options: { maxCategories: 7 } })
        .success,
    ).toBe(false);
    expect(
      blockSchema.safeParse({ type: "chart", options: { maxCategories: 4 } })
        .success,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/reports/config.test.ts`
Expected: FAIL — `parseReportConfig is not a function`, and the default-config tests fail on 8 types.

- [ ] **Step 3: Implement in `src/lib/reports/config.ts`**

Replace the version constant's declaration with this documented one:

```ts
/**
 * The report-config schema version.
 *
 * DO NOT BUMP for a new block type or a new option — those are ADDITIVE and every
 * stored config still parses unchanged. Bumping breaks reads: `v` is a
 * `z.literal(REPORT_CONFIG_VERSION)`, so `v: 2` makes every stored `{"v":1,…}`
 * row fail to parse. Bump ONLY for a breaking reinterpretation of an existing
 * field (a rename, a retype, a changed meaning) — and ship a read-side upgrade
 * step in `parseReportConfig` in the same change.
 */
export const REPORT_CONFIG_VERSION = 1 as const;
```

Add `"chart"` to `blockTypeSchema`:

```ts
export const blockTypeSchema = z.enum([
  "cover",
  "summary",
  "kpis",
  "chart",
  "table",
  "group_summaries",
  "spotlight",
  "notes",
  "appendix",
]);
```

Add the options group beside the other option groups:

```ts
const chartOptions = z.object({
  variant: z.enum(["donut", "bars"]).default("donut"),
  /**
   * "status"      → late-bound to the board's FIRST status column, resolved at
   *                 render time. Survives column renames and needs no board
   *                 knowledge to default.
   * "board_group" → the board's groups.
   * "column"      → the explicit `columnId` below.
   */
  source: z.enum(["status", "board_group", "column"]).default("status"),
  columnId: z.string().nullable().default(null),
  /** "" → derive "Items by <category name>" at render time. */
  title: z.string().max(120).default(""),
  maxCategories: z.number().int().min(3).max(6).default(6),
});
export type ChartBlockOptions = z.infer<typeof chartOptions>;
```

Add the union member (place it after the `kpis` member so the file reads in document order):

```ts
  z.object({
    type: z.literal("chart"),
    enabled: z.boolean().default(true),
    options: chartOptions.prefault({}),
  }),
```

Add, below `reportConfigSchema` / `ReportConfig`:

```ts
/**
 * Canonical block order. Drives both `defaultReportConfig()` and the backfill's
 * insertion position (a missing block lands right after the last block that
 * precedes it here and is actually present).
 */
const BLOCK_ORDER = blockTypeSchema.options;

/** Where a missing `type` should be inserted into `blocks`. */
function insertPosition(blocks: ReportBlock[], type: BlockType): number {
  const precedes = new Set<string>(
    BLOCK_ORDER.slice(0, BLOCK_ORDER.indexOf(type)),
  );
  let pos = 0;
  blocks.forEach((b, i) => {
    if (precedes.has(b.type)) pos = i + 1;
  });
  return pos;
}

/**
 * Append every block type absent from `blocks`, DISABLED, in canonical position.
 * This is what makes a new block type reachable from reports saved before it
 * existed — without a data migration. Disabled on purpose: an existing saved
 * report's rendered output must not change until the user opts in.
 */
export function backfillBlocks(blocks: ReportBlock[]): ReportBlock[] {
  const out = [...blocks];
  for (const type of BLOCK_ORDER) {
    if (out.some((b) => b.type === type)) continue;
    out.splice(
      insertPosition(out, type),
      0,
      blockSchema.parse({ type, enabled: false }),
    );
  }
  return out;
}

const lenientEnvelope = z.object({
  title: z.string().max(200).catch("Status Report").default("Status Report"),
  blocks: z.array(z.unknown()).catch([]).default([]),
});

/**
 * READ path — deliberately lenient, and the ONLY thing that should parse a
 * `reports.config` value out of the database.
 *
 * Blocks that do not match the current union are DROPPED, not thrown on: after
 * a deploy is rolled back, a config saved by the newer build would otherwise
 * take down the whole reports list page, not just one report. Missing block
 * types are backfilled (disabled) so newly-shipped blocks reach old reports.
 *
 * The WRITE path (`saveReport`) keeps the strict `reportConfigSchema` — junk
 * never enters the database.
 */
export function parseReportConfig(raw: unknown): ReportConfig {
  const env = lenientEnvelope.safeParse(
    raw !== null && typeof raw === "object" ? raw : {},
  );
  const base = env.success ? env.data : { title: "Status Report", blocks: [] };
  const blocks: ReportBlock[] = [];
  for (const b of base.blocks) {
    const parsed = blockSchema.safeParse(b);
    if (parsed.success) blocks.push(parsed.data);
  }
  return {
    v: REPORT_CONFIG_VERSION,
    title: base.title,
    blocks: backfillBlocks(blocks),
  };
}
```

Replace `defaultReportConfig`:

```ts
export function defaultReportConfig(): ReportConfig {
  return reportConfigSchema.parse({
    blocks: BLOCK_ORDER.map((type) => ({ type })),
  });
}
```

> The per-block `enabled` defaults already encode the intent: `cover`/`summary`/`kpis`/`chart`/`table`/`group_summaries` default `true`, `spotlight`/`notes`/`appendix` default `false`. Do not hand-list them again here.

- [ ] **Step 4: Switch the read path in `src/lib/reports/queries.ts`**

Change the import and line 28:

```ts
import { parseReportConfig, type ReportConfig } from "@/lib/reports/config";
```

```ts
    config: parseReportConfig(row.config),
```

(`parseReportConfig` handles `null` itself, so drop the `?? {}`.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/reports/config.test.ts`
Expected: PASS, all tests.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0. If `ReportDocument.tsx`'s exhaustive `switch` errors on the new `"chart"` member — **that is correct and expected**; it is fixed in Task 6. If this task is being run in parallel batch 1, leave it; note it in the handoff.

- [ ] **Step 7: Commit**

```bash
git add src/lib/reports/config.ts src/lib/reports/config.test.ts src/lib/reports/queries.ts
git commit -m "feat(reports): add chart block variant, lenient config read + backfill"
```

---

## Task 2: Print palette + report CSS

**Interfaces:** Consumes: nothing. Produces: `PRINT_CATEGORICAL`, `PRINT_NEUTRAL`, `rampSlot`, and the `.r-chart*` CSS.

**Files:**

- Create: `src/lib/reports/chart-palette.ts`
- Create: `src/lib/reports/chart-palette.test.ts`
- Modify: `src/lib/reports/report-css.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/reports/chart-palette.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PRINT_CATEGORICAL,
  PRINT_NEUTRAL,
  rampSlot,
} from "@/lib/reports/chart-palette";
import { REPORT_CSS } from "@/lib/reports/report-css";

describe("report print chart palette", () => {
  it("is the exact validated eight-hex ramp (do not edit without re-validating)", () => {
    expect([...PRINT_CATEGORICAL]).toEqual([
      "#5866c4",
      "#eb6834",
      "#1baf7a",
      "#eda100",
      "#e87ba4",
      "#008300",
      "#4a3aa7",
      "#e34948",
    ]);
  });

  it("slot 1 is the report's own periwinkle accent", () => {
    expect(PRINT_CATEGORICAL[0]).toBe("#5866c4");
    expect(REPORT_CSS).toContain("--peri:#5866c4");
  });

  it("the neutral is not a categorical slot", () => {
    expect(PRINT_NEUTRAL).toBe("#9aa1b1");
    expect(PRINT_CATEGORICAL).not.toContain(PRINT_NEUTRAL);
  });

  it("rampSlot is stable and wraps only past the eighth slot", () => {
    expect(rampSlot(0)).toBe("#5866c4");
    expect(rampSlot(5)).toBe("#008300");
    expect(rampSlot(8)).toBe("#5866c4");
    expect(rampSlot(0)).toBe(rampSlot(0));
  });

  it("REPORT_CSS declares the chart classes and page-break protection", () => {
    for (const cls of [
      ".r-chart",
      ".r-chart-ring",
      ".r-chart-legend",
      ".r-lg-row",
      ".r-lg-sw",
      ".r-bar-row",
      ".r-bar-track",
      ".r-bar-fill",
      ".r-chart-empty",
    ]) {
      expect(REPORT_CSS).toContain(cls);
    }
    expect(REPORT_CSS).toContain("page-break-inside:avoid");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/lib/reports/chart-palette.test.ts`
Expected: FAIL — cannot resolve `@/lib/reports/chart-palette`.

- [ ] **Step 3: Create `src/lib/reports/chart-palette.ts`**

```ts
/**
 * Categorical ramp for report charts, on the report's WHITE print surface.
 *
 * NOT the app's `--chart-cat-*` palette: those hues are stepped for the app's
 * near-black surface and FAIL on paper. Validated with the `dataviz` skill's
 * scripts/validate_palette.js against #ffffff, they return exit 1 —
 * lightness-band FAIL (#22d3ee L .797, #34d399 L .773, both above the .77
 * ceiling) and CVD-separation FAIL (worst adjacent #34d399↔#fb7185 ΔE 4.6
 * deutan, below the 6 floor).
 *
 * This ramp — slot 1 = the report's own periwinkle accent, slots 2–8 = the
 * dataviz reference light palette — was validated on the same surface:
 *
 *   node scripts/validate_palette.js \
 *     "#5866c4,#eb6834,#1baf7a,#eda100,#e87ba4,#008300,#4a3aa7,#e34948" \
 *     --mode light --surface "#ffffff"
 *   → ALL CHECKS PASS (band PASS · chroma PASS · CVD PASS worst adjacent
 *     ΔE 9.1 protan · normal-vision PASS ΔE 19.6 · contrast WARN on slots
 *     3/4/5)
 *
 * The contrast WARN is the skill's *relief* case and is DISCHARGED, not
 * dismissed: every chart mark ships a visible label + value + share, and the
 * report's Board-table / Appendix blocks are the table-view twin. Do not edit
 * these hexes without re-running the validator on #ffffff.
 */
export const PRINT_CATEGORICAL = [
  "#5866c4", // periwinkle — the report accent (--peri)
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
] as const;

/**
 * Reserved neutral: the "no value" category and the "Other" fold-in bucket.
 * Never a categorical slot — it must not read as an identity.
 */
export const PRINT_NEUTRAL = "#9aa1b1";

/**
 * The ramp hex for a zero-based slot. `index` MUST be an entity-stable position
 * (an option's index in its column's settings), never a rank in the sorted
 * chart — "color follows the entity, never its rank". Wrapping past eight is a
 * last-resort fallback for a column with 9+ uncolored options; charts cap at 6
 * categories, so it is not reachable through normal use.
 */
export function rampSlot(index: number): string {
  return PRINT_CATEGORICAL[index % PRINT_CATEGORICAL.length];
}
```

- [ ] **Step 4: Add the CSS to `src/lib/reports/report-css.ts`**

Insert this block immediately **before** the closing `@page` rule:

```
  /* ---- charts: static SVG / CSS only, no client JS ---- */
  .r-chart { display:grid; grid-template-columns:auto 1fr; align-items:center; gap:20px; page-break-inside:avoid; }
  .r-chart.r-chart-bars { display:block; }
  .r-chart-ring { flex:0 0 auto; }
  .r-chart-total { font-size:22px; font-weight:700; letter-spacing:-.02em; fill:var(--ink); }
  .r-chart-total-l { font-size:8.5px; letter-spacing:.14em; text-transform:uppercase; fill:var(--muted); }
  .r-chart-legend { display:flex; flex-direction:column; gap:5px; }
  .r-lg-row { display:grid; grid-template-columns:9px 1fr auto auto; align-items:center; gap:9px; font-size:11.5px; }
  .r-lg-sw { width:9px; height:9px; border-radius:2px; }
  .r-lg-n { font-variant-numeric:tabular-nums; font-weight:600; }
  .r-lg-p { font-variant-numeric:tabular-nums; color:var(--muted); min-width:38px; text-align:right; }
  .r-bar-row { display:grid; grid-template-columns:150px 1fr auto auto; align-items:center; gap:12px; padding:3px 0; }
  .r-bar-name { font-size:12px; font-weight:600; overflow-wrap:anywhere; }
  .r-bar-track { height:14px; background:#f2f3f7; border-radius:3px; overflow:hidden; }
  .r-bar-fill { height:100%; border-radius:0 4px 4px 0; }
  .r-bar-n { font-size:12px; font-variant-numeric:tabular-nums; font-weight:600; }
  .r-bar-p { font-size:11px; font-variant-numeric:tabular-nums; color:var(--muted); min-width:38px; text-align:right; }
  .r-chart-empty { font-size:12px; color:var(--muted); }
  .r-chart-stat { font-size:15px; }
  .r-chart-stat b { font-size:22px; font-weight:700; letter-spacing:-.02em; }
```

> Notes for the implementer: the bar fill's `border-radius:0 4px 4px 0` is the skill's "4px rounded data-end, square at the baseline". The 2px row gap comes from `padding:3px 0` on `.r-bar-row`. Do **not** add a border/stroke around any mark — gaps do the separating.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/reports/chart-palette.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/reports/chart-palette.ts src/lib/reports/chart-palette.test.ts src/lib/reports/report-css.ts
git commit -m "feat(reports): validated print chart palette + chart CSS"
```

---

## Task 3: Extract the static-import walker for reuse

**Interfaces:** Consumes: nothing. Produces: `src/test/static-imports.ts` exporting `staticEdges`, `resolveSpec`, `reachable`.

**Files:**

- Create: `src/test/static-imports.ts`
- Modify: `src/components/dashboards/no-recharts-in-first-paint.test.ts`

> The repo rule is "grep before writing a helper" — Task 7 needs exactly this walker, so it is extracted rather than copy-pasted. **The dashboards test's two `it(...)` assertions must stay byte-identical**; only its imports and the deleted local functions change.

- [ ] **Step 1: Create `src/test/static-imports.ts`**

Move `staticEdges`, `resolveSpec`, and `reachable` out of `src/components/dashboards/no-recharts-in-first-paint.test.ts` verbatim (including their doc comments), and export them:

```ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SRC = join(process.cwd(), "src");

/**
 * Static import/re-export edges of one file. Deferred `dynamic(() => import())`
 * / bare `import()` calls have no `from` clause and are intentionally NOT
 * matched — that is exactly the code-split boundary we want to stop following.
 * Type-only edges (`import type … from`) are erased at build, so they carry no
 * runtime dependency and are skipped.
 */
export function staticEdges(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const edges: string[] = [];
  const fromRe =
    /(?:^|\n)\s*(?:import|export)\b([^;'"]*?)\bfrom\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(src))) {
    if (/^\s*type\b/.test(m[1])) continue; // erased at build
    edges.push(m[2]);
  }
  const sideRe = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  while ((m = sideRe.exec(src))) edges.push(m[1]);
  return edges;
}

export function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = join(dirname(fromFile), spec);
  else return null; // bare specifier → node_modules, not a first-party file
  const candidates = [
    `${base}.tsx`,
    `${base}.ts`,
    join(base, "index.tsx"),
    join(base, "index.ts"),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** First-party files + bare specifiers reachable via STATIC edges from `entry`. */
export function reachable(entry: string): {
  files: Set<string>;
  bare: Set<string>;
} {
  const files = new Set<string>();
  const bare = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of staticEdges(file)) {
      if (spec.startsWith("@/") || spec.startsWith(".")) {
        const resolved = resolveSpec(spec, file);
        if (resolved) stack.push(resolved);
      } else {
        bare.add(spec);
      }
    }
  }
  return { files, bare };
}
```

- [ ] **Step 2: Rewrite `src/components/dashboards/no-recharts-in-first-paint.test.ts` to use it**

The whole file becomes:

```ts
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { reachable } from "@/test/static-imports";

const SRC = join(process.cwd(), "src");
const ENTRY = join(SRC, "components/dashboards/DashboardWidget.tsx");
const CHART_WIDGET = join(SRC, "components/dashboards/widgets/ChartWidget.tsx");

describe("dashboard first-paint bundle boundary", () => {
  const { files, bare } = reachable(ENTRY);

  it("does not statically reach ChartWidget from DashboardWidget", () => {
    expect(files.has(CHART_WIDGET)).toBe(false);
  });

  it("does not statically reach recharts from DashboardWidget", () => {
    expect(bare.has("recharts")).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it still passes**

Run: `pnpm vitest run src/components/dashboards/no-recharts-in-first-paint.test.ts`
Expected: PASS — 2 tests, same names, same assertions.

- [ ] **Step 4: Commit**

```bash
git add src/test/static-imports.ts src/components/dashboards/no-recharts-in-first-paint.test.ts
git commit -m "refactor(test): extract static-import walker for reuse by a second guard"
```

---

## Task 4: `computeChartSeries` — the shaping layer

**Interfaces:** Consumes: T1 (`ChartBlockOptions`), T2 (`rampSlot`, `PRINT_NEUTRAL`). Produces: `ChartSeries`, `ChartCategory`, `computeChartSeries`.

**Files:**

- Create: `src/lib/reports/chart-data.ts`
- Create: `src/lib/reports/chart-data.test.ts`
- Modify: `src/lib/reports/shape.ts` (export `optionColor`)

**Background the implementer needs:**

- `BoardPayload` (`src/lib/boards/queries.ts`) has `board`, `columns: Column[]`, `groups: Group[]`, `items: Item[]`, `cellValues: {item_id, column_id, value}[]`.
- Cell value shapes: status/priority `{ optionId }`, dropdown `{ optionIds: string[] }`, people `{ userIds: string[] }`. `shape.ts#optionColor` already tolerates a bare-string status value too — keep that tolerance by reusing it.
- Column `settings` for option kinds is `{ options: { id, label, color? }[] }`.
- **Leaf items** = items with no children. `shape.ts` already computes this; the chart must use the same definition so its total matches the KPI block's `itemCount`.

- [ ] **Step 1: Export the leaf helper from `src/lib/reports/shape.ts`**

Change `function leafItems(` (line ~127) to `export function leafItems(`. Do not change its body. This is the whole modification to `shape.ts`: the chart must use the **same** leaf definition as `computeKpis`/`computeGroupSummaries`, or the chart total will disagree with the KPI item count printed inches above it. Do not copy the four lines into `chart-data.ts`.

> Do **not** also export `optionColor`. `chart-data.ts` needs the _whole_ option list (to assign ramp slots in settings order), not one cell's color, so it reads `settings.options` directly; an exported-but-unused helper would just be dead surface.

- [ ] **Step 2: Write the failing tests**

Create `src/lib/reports/chart-data.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeChartSeries } from "@/lib/reports/chart-data";
import type { ChartBlockOptions } from "@/lib/reports/config";
import type { BoardPayload } from "@/lib/boards/queries";

const OPTS: ChartBlockOptions = {
  variant: "donut",
  source: "status",
  columnId: null,
  title: "",
  maxCategories: 6,
};
const opts = (o: Partial<ChartBlockOptions> = {}): ChartBlockOptions => ({
  ...OPTS,
  ...o,
});
const NAMES = new Map<string, string>();

/** Minimal payload builder — only the fields the shaper reads. */
function payload(args: {
  columns?: unknown[];
  groups?: unknown[];
  items?: unknown[];
  cellValues?: unknown[];
}): BoardPayload {
  return {
    board: { id: "b1", name: "Board" },
    columns: args.columns ?? [],
    groups: args.groups ?? [],
    items: args.items ?? [],
    cellValues: args.cellValues ?? [],
  } as unknown as BoardPayload;
}

const statusCol = (
  options: { id: string; label: string; color?: string }[],
) => ({
  id: "c1",
  name: "Status",
  kind: "status",
  position: 0,
  settings: { options },
});

const item = (id: string, groupId = "g1", parentId: string | null = null) => ({
  id,
  name: id,
  group_id: groupId,
  parent_id: parentId,
  position: 0,
});

const cell = (itemId: string, optionId: string | null) => ({
  item_id: itemId,
  column_id: "c1",
  value: optionId === null ? null : { optionId },
});

describe("computeChartSeries", () => {
  it("is empty when the board has no items", () => {
    const s = computeChartSeries(
      payload({ columns: [statusCol([])] }),
      NAMES,
      opts(),
    );
    expect(s.empty).toBe(true);
    expect(s.total).toBe(0);
    expect(s.categories).toEqual([]);
  });

  it("is empty when source=status and the board has no status column", () => {
    const s = computeChartSeries(
      payload({ items: [item("i1")] }),
      NAMES,
      opts({ source: "status" }),
    );
    expect(s.empty).toBe(true);
  });

  it("is empty when source=column points at a deleted column", () => {
    const s = computeChartSeries(
      payload({ columns: [statusCol([])], items: [item("i1")] }),
      NAMES,
      opts({ source: "column", columnId: "gone" }),
    );
    expect(s.empty).toBe(true);
  });

  it("counts LEAF items only, so the total matches the KPI item count", () => {
    const s = computeChartSeries(
      payload({
        columns: [statusCol([{ id: "o1", label: "Done", color: "#00aa00" }])],
        items: [item("parent"), item("kid", "g1", "parent")],
        cellValues: [cell("parent", "o1"), cell("kid", "o1")],
      }),
      NAMES,
      opts(),
    );
    expect(s.total).toBe(1); // "parent" has a child → not a leaf
    expect(s.categories).toEqual([
      { key: "o1", label: "Done", value: 1, color: "#00aa00" },
    ]);
  });

  it("uses the board option color when configured", () => {
    const s = computeChartSeries(
      payload({
        columns: [
          statusCol([
            { id: "o1", label: "Done", color: "#00aa00" },
            { id: "o2", label: "Stuck", color: "#dd0000" },
          ]),
        ],
        items: [item("i1"), item("i2"), item("i3")],
        cellValues: [cell("i1", "o1"), cell("i2", "o1"), cell("i3", "o2")],
      }),
      NAMES,
      opts(),
    );
    expect(s.categories.map((c) => [c.label, c.value, c.color])).toEqual([
      ["Done", 2, "#00aa00"],
      ["Stuck", 1, "#dd0000"],
    ]);
  });

  it("assigns ramp slots by SETTINGS index, not by rank (no repaint on reorder)", () => {
    // o1 is first in settings but LAST by value; it must still get slot 1.
    const p = payload({
      columns: [
        statusCol([
          { id: "o1", label: "A" },
          { id: "o2", label: "B" },
        ]),
      ],
      items: [item("i1"), item("i2"), item("i3")],
      cellValues: [cell("i1", "o1"), cell("i2", "o2"), cell("i3", "o2")],
    });
    const s = computeChartSeries(p, NAMES, opts());
    expect(s.categories.map((c) => c.label)).toEqual(["B", "A"]); // value desc
    expect(s.categories.find((c) => c.label === "A")?.color).toBe("#5866c4"); // slot 1
    expect(s.categories.find((c) => c.label === "B")?.color).toBe("#eb6834"); // slot 2
  });

  it("labels blank cells '—' in the reserved neutral, never a ramp slot", () => {
    const s = computeChartSeries(
      payload({
        columns: [statusCol([{ id: "o1", label: "Done" }])],
        items: [item("i1"), item("i2")],
        cellValues: [cell("i1", "o1"), cell("i2", null)],
      }),
      NAMES,
      opts(),
    );
    const none = s.categories.find((c) => c.key === "__none");
    expect(none).toMatchObject({ label: "—", value: 1, color: "#9aa1b1" });
  });

  it("folds the tail into a neutral 'Other' at maxCategories", () => {
    const options = ["a", "b", "c", "d", "e"].map((id, i) => ({
      id,
      label: id.toUpperCase(),
    }));
    // counts: a=5 b=4 c=3 d=2 e=1
    const items: unknown[] = [];
    const cells: unknown[] = [];
    let n = 0;
    options.forEach((o, i) => {
      for (let k = 0; k < 5 - i; k++) {
        const id = `i${n++}`;
        items.push(item(id));
        cells.push(cell(id, o.id));
      }
    });
    const s = computeChartSeries(
      payload({ columns: [statusCol(options)], items, cellValues: cells }),
      NAMES,
      opts({ maxCategories: 3 }),
    );
    expect(s.categories.map((c) => [c.key, c.value])).toEqual([
      ["a", 5],
      ["b", 4],
      ["__other", 6], // 3 + 2 + 1
    ]);
    expect(s.categories[2].color).toBe("#9aa1b1");
    expect(s.total).toBe(15);
  });

  it("breaks value ties by label ascending (deterministic preview/PDF parity)", () => {
    const s = computeChartSeries(
      payload({
        columns: [
          statusCol([
            { id: "z", label: "Zeta" },
            { id: "a", label: "Alpha" },
          ]),
        ],
        items: [item("i1"), item("i2")],
        cellValues: [cell("i1", "z"), cell("i2", "a")],
      }),
      NAMES,
      opts(),
    );
    expect(s.categories.map((c) => c.label)).toEqual(["Alpha", "Zeta"]);
  });

  it("counts an item once per selected value for a multi-value column", () => {
    const s = computeChartSeries(
      payload({
        columns: [
          {
            id: "c1",
            name: "Tags",
            kind: "dropdown",
            position: 0,
            settings: {
              options: [
                { id: "x", label: "X" },
                { id: "y", label: "Y" },
              ],
            },
          },
        ],
        items: [item("i1")],
        cellValues: [
          { item_id: "i1", column_id: "c1", value: { optionIds: ["x", "y"] } },
        ],
      }),
      NAMES,
      opts({ source: "column", columnId: "c1" }),
    );
    expect(s.total).toBe(1);
    expect(s.categories.reduce((n, c) => n + c.value, 0)).toBe(2);
  });

  it("charts board groups with their own colors when source=board_group", () => {
    const s = computeChartSeries(
      payload({
        groups: [
          { id: "g1", name: "Now", color: "#112233", position: 0 },
          { id: "g2", name: "Later", color: "#445566", position: 1 },
        ],
        items: [item("i1", "g1"), item("i2", "g2"), item("i3", "g2")],
      }),
      NAMES,
      opts({ source: "board_group" }),
    );
    expect(s.categoryName).toBe("Group");
    expect(s.categories.map((c) => [c.label, c.value, c.color])).toEqual([
      ["Later", 2, "#445566"],
      ["Now", 1, "#112233"],
    ]);
  });

  it("resolves people ids to names and gives them stable name-ordered slots", () => {
    const names = new Map([
      ["u1", "Zoe"],
      ["u2", "Ada"],
    ]);
    const s = computeChartSeries(
      payload({
        columns: [
          {
            id: "c1",
            name: "Owner",
            kind: "people",
            position: 0,
            settings: null,
          },
        ],
        items: [item("i1"), item("i2"), item("i3")],
        cellValues: [
          { item_id: "i1", column_id: "c1", value: { userIds: ["u1"] } },
          { item_id: "i2", column_id: "c1", value: { userIds: ["u1"] } },
          { item_id: "i3", column_id: "c1", value: { userIds: ["u2"] } },
        ],
      }),
      names,
      opts({ source: "column", columnId: "c1" }),
    );
    expect(s.categoryName).toBe("Owner");
    // Ada sorts first by name → slot 1, even though Zoe has more items.
    expect(s.categories.find((c) => c.label === "Ada")?.color).toBe("#5866c4");
    expect(s.categories.find((c) => c.label === "Zoe")?.color).toBe("#eb6834");
    expect(s.categories.map((c) => c.label)).toEqual(["Zoe", "Ada"]); // value desc
  });

  it("uses the status column's name for the derived title", () => {
    const s = computeChartSeries(
      payload({
        columns: [statusCol([{ id: "o1", label: "Done" }])],
        items: [item("i1")],
        cellValues: [cell("i1", "o1")],
      }),
      NAMES,
      opts(),
    );
    expect(s.categoryName).toBe("Status");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/reports/chart-data.test.ts`
Expected: FAIL — cannot resolve `@/lib/reports/chart-data`.

- [ ] **Step 4: Implement `src/lib/reports/chart-data.ts`**

```ts
import type { BoardPayload, Column } from "@/lib/boards/queries";
import type { ColumnKind } from "@/lib/validations/boards";
import type { ChartBlockOptions } from "@/lib/reports/config";
import { leafItems } from "@/lib/reports/shape";
import { PRINT_NEUTRAL, rampSlot } from "@/lib/reports/chart-palette";

/** One chart category. `color` is already resolved — components never pick colors. */
export type ChartCategory = {
  /** Stable identity: option id | group id | user id | "__none" | "__other". */
  key: string;
  label: string;
  value: number;
  color: string;
};

export type ChartSeries = {
  /** Sorted value desc, then label asc. Length <= options.maxCategories. */
  categories: ChartCategory[];
  /**
   * Leaf items counted, INCLUDING those folded into "Other". For a multi-value
   * column an item can appear in more than one category, so
   * sum(categories) >= total by design.
   */
  total: number;
  /** Human name of the category axis, for the derived block title. */
  categoryName: string;
  empty: boolean;
};

const EMPTY: ChartSeries = {
  categories: [],
  total: 0,
  categoryName: "",
  empty: true,
};

const OPTION_KINDS = new Set(["status", "dropdown", "priority"]);

/** Column kinds a chart can group by. Used by the builder's picker too. */
export const CHARTABLE_KINDS = [
  "status",
  "dropdown",
  "priority",
  "people",
] as const;

export function isChartableColumn(c: Column): boolean {
  return (CHARTABLE_KINDS as readonly string[]).includes(c.kind);
}

/** A bucket before counting: identity, label, optional board color, stable order. */
type Bucket = { key: string; label: string; color?: string; order: number };

function columnBuckets(
  col: Column,
  names: Map<string, string>,
  payload: BoardPayload,
): Bucket[] {
  if (col.kind === "people") {
    // People have no settings order, so use resolved-name order — a property of
    // the directory, not of the chart's value ranking.
    const ids = new Set<string>();
    for (const cv of payload.cellValues) {
      if (cv.column_id !== col.id) continue;
      for (const id of userIdsOf(cv.value)) ids.add(id);
    }
    return [...ids]
      .map((id) => ({ id, label: names.get(id) ?? "" }))
      .filter((p) => p.label !== "")
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((p, i) => ({ key: p.id, label: p.label, order: i }));
  }
  const settings = col.settings as {
    options?: { id: string; label: string; color?: string }[];
  } | null;
  return (settings?.options ?? []).map((o, i) => ({
    key: o.id,
    label: o.label,
    color: o.color ?? undefined,
    order: i,
  }));
}

function userIdsOf(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const ids = (raw as { userIds?: unknown }).userIds;
  return Array.isArray(ids)
    ? ids.filter((v): v is string => typeof v === "string")
    : [];
}

/** The option ids a cell selects — one for status/priority, many for dropdown. */
function optionIdsOf(kind: ColumnKind, raw: unknown): string[] {
  if (kind === "people") return userIdsOf(raw);
  if (typeof raw === "string") return [raw];
  if (!raw || typeof raw !== "object") return [];
  const v = raw as { optionId?: unknown; optionIds?: unknown };
  if (typeof v.optionId === "string") return [v.optionId];
  if (Array.isArray(v.optionIds)) {
    return v.optionIds.filter((x): x is string => typeof x === "string");
  }
  return [];
}

function resolveColumn(
  payload: BoardPayload,
  options: ChartBlockOptions,
): Column | null {
  if (options.source === "status") {
    return payload.columns.find((c) => c.kind === "status") ?? null;
  }
  if (options.source === "column") {
    const col = payload.columns.find((c) => c.id === options.columnId) ?? null;
    return col && isChartableColumn(col) ? col : null;
  }
  return null;
}

/**
 * Assign a color to every bucket: the board's own option/group color when it has
 * one, otherwise the next print-ramp slot walked in BUCKET ORDER (settings index
 * / group position / name order) — never in value order, so a data change that
 * reorders the chart does not repaint the survivors.
 */
function paint(buckets: Bucket[]): Map<string, string> {
  const out = new Map<string, string>();
  let slot = 0;
  for (const b of [...buckets].sort((a, b2) => a.order - b2.order)) {
    out.set(b.key, b.color ?? rampSlot(slot++));
  }
  return out;
}

export function computeChartSeries(
  payload: BoardPayload,
  peopleNames: Map<string, string>,
  options: ChartBlockOptions,
): ChartSeries {
  const leaves = leafItems(payload);
  if (leaves.length === 0) return EMPTY;

  const counts = new Map<string, number>();
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);

  let buckets: Bucket[];
  let categoryName: string;

  if (options.source === "board_group") {
    categoryName = "Group";
    buckets = [...payload.groups]
      .sort((a, b) => a.position - b.position)
      .map((g, i) => ({
        key: g.id,
        label: g.name,
        color: g.color ?? undefined,
        order: i,
      }));
    for (const it of leaves) bump(it.group_id);
  } else {
    const col = resolveColumn(payload, options);
    if (!col) return EMPTY;
    categoryName = col.name;
    buckets = columnBuckets(col, peopleNames, payload);
    const byItem = new Map<string, unknown>();
    for (const cv of payload.cellValues) {
      if (cv.column_id === col.id) byItem.set(cv.item_id, cv.value);
    }
    for (const it of leaves) {
      const ids = optionIdsOf(col.kind as ColumnKind, byItem.get(it.id));
      const known = ids.filter((id) => buckets.some((b) => b.key === id));
      if (known.length === 0) bump("__none");
      else for (const id of known) bump(id);
    }
  }

  const colors = paint(buckets);
  const labels = new Map(buckets.map((b) => [b.key, b.label]));

  let categories: ChartCategory[] = [...counts.entries()]
    .filter(([, value]) => value > 0)
    .map(([key, value]) => ({
      key,
      label: key === "__none" ? "—" : (labels.get(key) ?? "—"),
      value,
      color:
        key === "__none" ? PRINT_NEUTRAL : (colors.get(key) ?? PRINT_NEUTRAL),
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

  if (categories.length === 0) return EMPTY;

  if (categories.length > options.maxCategories) {
    const keep = categories.slice(0, options.maxCategories - 1);
    const rest = categories.slice(options.maxCategories - 1);
    keep.push({
      key: "__other",
      label: "Other",
      value: rest.reduce((n, c) => n + c.value, 0),
      color: PRINT_NEUTRAL,
    });
    categories = keep;
  }

  return { categories, total: leaves.length, categoryName, empty: false };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/reports/chart-data.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 6: Run typecheck + lint on the touched files**

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0 (modulo the expected `ReportDocument.tsx` switch error until Task 6).

- [ ] **Step 7: Commit**

```bash
git add src/lib/reports/chart-data.ts src/lib/reports/chart-data.test.ts src/lib/reports/shape.ts
git commit -m "feat(reports): computeChartSeries — entity-stable chart shaping"
```

---

## Task 5: The print components (donut, bars, legend, block)

**Interfaces:** Consumes: T2 (CSS + palette), T4 (`ChartSeries`). Produces: `ChartBlock` and its parts.

**Files:**

- Create: `src/components/reports/blocks/DonutChart.tsx`
- Create: `src/components/reports/blocks/BarsChart.tsx`
- Create: `src/components/reports/blocks/ChartLegend.tsx`
- Create: `src/components/reports/blocks/ChartBlock.tsx`
- Create: `src/components/reports/blocks/ChartBlock.test.tsx`
- Create: `src/components/reports/blocks/ChartBlock.parity.test.tsx`

**Hard rules for every file in this task** (they are why the PDF works):

- **No `"use client"`.** No `useState`/`useEffect`/`useRef`/`useId`/`useMemo`. No event handlers.
- **No measurement.** Nothing may depend on `getBoundingClientRect`, `ResponsiveContainer`, or rendered text width.
- **No generated ids** (no `<defs>`/gradients/filters/`clipPath`) — an id makes the markup instance-dependent and breaks the parity test.
- **No `recharts`, no `@/components/ui/chart`.**

- [ ] **Step 1: Write the failing tests**

Create `src/components/reports/blocks/ChartBlock.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChartBlock } from "@/components/reports/blocks/ChartBlock";
import type { ChartSeries } from "@/lib/reports/chart-data";
import type { ChartBlockOptions } from "@/lib/reports/config";

const OPTS: ChartBlockOptions = {
  variant: "donut",
  source: "status",
  columnId: null,
  title: "",
  maxCategories: 6,
};

const series = (over: Partial<ChartSeries> = {}): ChartSeries => ({
  categories: [
    { key: "a", label: "Done", value: 12, color: "#5866c4" },
    { key: "b", label: "Working on it", value: 7, color: "#eb6834" },
    { key: "c", label: "Stuck", value: 3, color: "#e34948" },
  ],
  total: 22,
  categoryName: "Status",
  empty: false,
  ...over,
});

describe("ChartBlock — server-rendered geometry", () => {
  it("donut emits real SVG arc geometry under renderToStaticMarkup", () => {
    const html = renderToStaticMarkup(
      <ChartBlock series={series()} options={{ ...OPTS, variant: "donut" }} />,
    );
    expect(html).toContain("<svg");
    // A recharts-style empty wrapper would have none of these:
    expect(html).toMatch(/<path[^>]+d="M/);
    expect((html.match(/<path/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(html).toMatch(/\sA\s/); // elliptical-arc command
    expect(html.length).toBeGreaterThan(500);
  });

  it("donut renders one legend row per category with label, count and share", () => {
    const html = renderToStaticMarkup(
      <ChartBlock series={series()} options={{ ...OPTS, variant: "donut" }} />,
    );
    expect((html.match(/r-lg-row/g) ?? []).length).toBe(3);
    expect(html).toContain("Working on it");
    expect(html).toContain("12");
    expect(html).toContain("55%"); // 12/22
  });

  it("donut shows the total in the ring centre", () => {
    const html = renderToStaticMarkup(
      <ChartBlock series={series()} options={{ ...OPTS, variant: "donut" }} />,
    );
    expect(html).toContain("r-chart-total");
    expect(html).toContain(">22<");
  });

  it("bars emit one CSS-width row per category, no SVG needed", () => {
    const html = renderToStaticMarkup(
      <ChartBlock series={series()} options={{ ...OPTS, variant: "bars" }} />,
    );
    expect((html.match(/r-bar-row/g) ?? []).length).toBe(3);
    expect(html).toContain("width:100%"); // longest bar
    expect(html).toContain("Stuck");
    expect(html).not.toContain("<svg");
  });

  it("uses the derived title when options.title is blank", () => {
    const html = renderToStaticMarkup(
      <ChartBlock series={series()} options={OPTS} />,
    );
    expect(html).toContain("Items by Status");
  });

  it("uses the explicit title when set", () => {
    const html = renderToStaticMarkup(
      <ChartBlock
        series={series()}
        options={{ ...OPTS, title: "Where the work sits" }}
      />,
    );
    expect(html).toContain("Where the work sits");
    expect(html).not.toContain("Items by Status");
  });

  it("renders a quiet empty state, never an error", () => {
    const html = renderToStaticMarkup(
      <ChartBlock
        series={{ categories: [], total: 0, categoryName: "", empty: true }}
        options={OPTS}
      />,
    );
    expect(html).toContain("r-chart-empty");
    expect(html).not.toContain("<svg");
  });

  it("renders a stat line instead of a one-slice ring for a single category", () => {
    const html = renderToStaticMarkup(
      <ChartBlock
        series={series({
          categories: [{ key: "a", label: "Done", value: 9, color: "#5866c4" }],
          total: 9,
        })}
        options={OPTS}
      />,
    );
    expect(html).toContain("r-chart-stat");
    expect(html).not.toContain("<svg");
    expect(html).toContain("Done");
    expect(html).toContain("9");
  });

  it("never emits an svg id, gradient or filter (instance-independent markup)", () => {
    const html = renderToStaticMarkup(
      <ChartBlock series={series()} options={OPTS} />,
    );
    expect(html).not.toContain("<defs");
    expect(html).not.toMatch(/\sid="/);
    expect(html).not.toContain("url(#");
  });
});
```

Create `src/components/reports/blocks/ChartBlock.parity.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { render } from "@testing-library/react";
import { ChartBlock } from "@/components/reports/blocks/ChartBlock";
import type { ChartSeries } from "@/lib/reports/chart-data";
import type { ChartBlockOptions } from "@/lib/reports/config";

const OPTS: ChartBlockOptions = {
  variant: "donut",
  source: "status",
  columnId: null,
  title: "",
  maxCategories: 6,
};

const SERIES: ChartSeries = {
  categories: [
    { key: "a", label: "Done", value: 12, color: "#5866c4" },
    { key: "b", label: "Working on it", value: 7, color: "#eb6834" },
    { key: "c", label: "Stuck", value: 3, color: "#e34948" },
  ],
  total: 22,
  categoryName: "Status",
  empty: false,
};

/**
 * The one-render-surface guarantee, as an executable assertion.
 *
 * The PDF path renders this component with renderToStaticMarkup in a Node
 * server action (no DOM, no client JS); PreviewPane renders the same component
 * into a live React root in an iframe. If those two ever diverge, the exported
 * PDF stops matching what the user approved on screen. This test is the reason
 * the chart components may not use hooks, refs, ids or measurement.
 */
describe("ChartBlock — preview/PDF parity", () => {
  for (const variant of ["donut", "bars"] as const) {
    it(`${variant}: client markup is identical to server markup`, () => {
      const options = { ...OPTS, variant };
      const server = renderToStaticMarkup(
        <ChartBlock series={SERIES} options={options} />,
      );
      const { container } = render(
        <ChartBlock series={SERIES} options={options} />,
      );
      expect(container.innerHTML).toBe(server);
    });
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/components/reports/blocks/ChartBlock.test.tsx src/components/reports/blocks/ChartBlock.parity.test.tsx`
Expected: FAIL — cannot resolve `@/components/reports/blocks/ChartBlock`.

- [ ] **Step 3: Create `src/components/reports/blocks/DonutChart.tsx`**

```tsx
// src/components/reports/blocks/DonutChart.tsx
// Pure SVG. No hooks, no refs, no ids, no measurement — see ChartBlock.parity.test.tsx.
import type { ChartCategory } from "@/lib/reports/chart-data";

const SIZE = 168;
const C = SIZE / 2;
const R_OUT = 76;
const R_IN = 47; // 0.62 ring ratio
const GAP_PX = 2; // the dataviz "surface gap", as an ANGULAR shortening (not a stroke)

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

const f = (n: number) => n.toFixed(3);

/** One ring segment as a closed path: outer arc → inner arc back. */
function segmentPath(startDeg: number, endDeg: number): string {
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const o1 = polar(C, C, R_OUT, startDeg);
  const o2 = polar(C, C, R_OUT, endDeg);
  const i2 = polar(C, C, R_IN, endDeg);
  const i1 = polar(C, C, R_IN, startDeg);
  return [
    `M ${f(o1.x)} ${f(o1.y)}`,
    `A ${R_OUT} ${R_OUT} 0 ${large} 1 ${f(o2.x)} ${f(o2.y)}`,
    `L ${f(i2.x)} ${f(i2.y)}`,
    `A ${R_IN} ${R_IN} 0 ${large} 0 ${f(i1.x)} ${f(i1.y)}`,
    "Z",
  ].join(" ");
}

export function DonutChart({
  categories,
  total,
}: {
  categories: ChartCategory[];
  total: number;
}) {
  const sum = categories.reduce((n, c) => n + c.value, 0) || 1;
  // A 2px gap at the ring's mid-radius, expressed in degrees.
  const gapDeg = (GAP_PX / (((R_OUT + R_IN) / 2) * Math.PI * 2)) * 360;
  let cursor = 0;
  const paths = categories.map((c) => {
    const sweep = (c.value / sum) * 360;
    const start = cursor + gapDeg / 2;
    const end = cursor + sweep - gapDeg / 2;
    cursor += sweep;
    return {
      key: c.key,
      color: c.color,
      d: segmentPath(start, Math.max(start + 0.01, end)),
    };
  });

  return (
    <svg
      className="r-chart-ring"
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`Donut chart, ${total} items`}
    >
      {paths.map((p) => (
        <path key={p.key} d={p.d} fill={p.color} />
      ))}
      <text className="r-chart-total" x={C} y={C - 1} textAnchor="middle">
        {total}
      </text>
      <text className="r-chart-total-l" x={C} y={C + 15} textAnchor="middle">
        ITEMS
      </text>
    </svg>
  );
}
```

- [ ] **Step 4: Create `src/components/reports/blocks/ChartLegend.tsx`**

```tsx
// src/components/reports/blocks/ChartLegend.tsx
import type { ChartCategory } from "@/lib/reports/chart-data";

export function share(value: number, sum: number): string {
  return sum > 0 ? `${Math.round((value / sum) * 100)}%` : "0%";
}

export function ChartLegend({ categories }: { categories: ChartCategory[] }) {
  const sum = categories.reduce((n, c) => n + c.value, 0);
  return (
    <div className="r-chart-legend">
      {categories.map((c) => (
        <div className="r-lg-row" key={c.key}>
          <span className="r-lg-sw" style={{ background: c.color }} />
          <span>{c.label}</span>
          <span className="r-lg-n">{c.value}</span>
          <span className="r-lg-p">{share(c.value, sum)}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Create `src/components/reports/blocks/BarsChart.tsx`**

```tsx
// src/components/reports/blocks/BarsChart.tsx
// Plain HTML/CSS percentage widths — the same idiom GroupSummariesBlock already
// prints correctly. No SVG, no measurement, no client JS.
import type { ChartCategory } from "@/lib/reports/chart-data";
import { share } from "./ChartLegend";

export function BarsChart({ categories }: { categories: ChartCategory[] }) {
  const sum = categories.reduce((n, c) => n + c.value, 0);
  const max = categories.reduce((n, c) => Math.max(n, c.value), 0) || 1;
  return (
    <div>
      {categories.map((c) => (
        <div className="r-bar-row" key={c.key}>
          <span className="r-bar-name">{c.label}</span>
          <span className="r-bar-track">
            <span
              className="r-bar-fill"
              style={{
                width: `${(c.value / max) * 100}%`,
                background: c.color,
              }}
            />
          </span>
          <span className="r-bar-n">{c.value}</span>
          <span className="r-bar-p">{share(c.value, sum)}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Create `src/components/reports/blocks/ChartBlock.tsx`**

```tsx
// src/components/reports/blocks/ChartBlock.tsx
import type { ChartBlockOptions } from "@/lib/reports/config";
import type { ChartSeries } from "@/lib/reports/chart-data";
import { DonutChart } from "./DonutChart";
import { BarsChart } from "./BarsChart";
import { ChartLegend } from "./ChartLegend";

function heading(options: ChartBlockOptions, series: ChartSeries): string {
  if (options.title.trim() !== "") return options.title.trim();
  return series.categoryName
    ? `Items by ${series.categoryName}`
    : "Distribution";
}

export function ChartBlock({
  series,
  options,
}: {
  series: ChartSeries;
  options: ChartBlockOptions;
}) {
  const title = heading(options, series);

  if (series.empty || series.categories.length === 0) {
    return (
      <section className="r-section">
        <div className="r-kicker">{title}</div>
        <p className="r-chart-empty">No data to chart.</p>
      </section>
    );
  }

  // A one-slice ring and a one-bar bar chart are both anti-patterns: the number
  // IS the chart. Render the stat line instead.
  if (series.categories.length < 2) {
    const only = series.categories[0];
    return (
      <section className="r-section">
        <div className="r-kicker">{title}</div>
        <p className="r-chart-stat">
          <b>{only.value}</b> {only.value === 1 ? "item" : "items"} ·{" "}
          {only.label}
        </p>
      </section>
    );
  }

  if (options.variant === "bars") {
    return (
      <section className="r-section">
        <div className="r-kicker">{title}</div>
        <div className="r-chart r-chart-bars">
          <BarsChart categories={series.categories} />
        </div>
      </section>
    );
  }

  return (
    <section className="r-section">
      <div className="r-kicker">{title}</div>
      <div className="r-chart">
        <DonutChart categories={series.categories} total={series.total} />
        <ChartLegend categories={series.categories} />
      </div>
    </section>
  );
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run src/components/reports/blocks/ChartBlock.test.tsx src/components/reports/blocks/ChartBlock.parity.test.tsx`
Expected: PASS — 9 + 2 tests.

If the parity test fails on whitespace or attribute ordering, **do not loosen the assertion** — find the construct that differs between the two renderers and remove it. That divergence is the bug this task exists to prevent.

- [ ] **Step 8: Commit**

```bash
git add src/components/reports/blocks/DonutChart.tsx src/components/reports/blocks/BarsChart.tsx src/components/reports/blocks/ChartLegend.tsx src/components/reports/blocks/ChartBlock.tsx src/components/reports/blocks/ChartBlock.test.tsx src/components/reports/blocks/ChartBlock.parity.test.tsx
git commit -m "feat(reports): static SVG donut + CSS bars chart blocks with SSR parity test"
```

---

## Task 6: Wire the chart into the render surface and the PDF

**Interfaces:** Consumes: T4, T5. Produces: charts in both the preview document and the exported PDF.

**Files:**

- Modify: `src/components/reports/ReportDocument.tsx`
- Modify: `src/lib/reports/actions.ts` (`exportReportPdf`)
- Modify: `src/components/reports/ReportDocument.test.tsx`
- Modify: `src/lib/reports/export.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/components/reports/ReportDocument.test.tsx`:

```tsx
import { computeChartSeries } from "@/lib/reports/chart-data";
import type { ChartSeries } from "@/lib/reports/chart-data";

const chartSeries: ChartSeries = {
  categories: [
    { key: "a", label: "Done", value: 4, color: "#5866c4" },
    { key: "b", label: "Stuck", value: 1, color: "#e34948" },
  ],
  total: 5,
  categoryName: "Status",
  empty: false,
};

describe("ReportDocument — chart block", () => {
  it("renders the chart block when enabled", () => {
    const config = defaultReportConfig();
    const html = renderToStaticMarkup(
      <ReportDocument
        config={config}
        model={model}
        kpis={{
          itemCount: 5,
          percentComplete: 80,
          overdueCount: 0,
          statusTally: [],
        }}
        groupSummaries={[]}
        chartSeries={chartSeries}
        boardName="Marketing"
        orgName="Acme"
      />,
    );
    expect(html).toContain("Items by Status");
    expect(html).toContain("<svg");
  });

  it("omits the chart entirely when the block is disabled", () => {
    const config = defaultReportConfig();
    config.blocks = config.blocks.map((b) =>
      b.type === "chart" ? { ...b, enabled: false } : b,
    );
    const html = renderToStaticMarkup(
      <ReportDocument
        config={config}
        model={model}
        kpis={{
          itemCount: 5,
          percentComplete: 80,
          overdueCount: 0,
          statusTally: [],
        }}
        groupSummaries={[]}
        chartSeries={chartSeries}
        boardName="M"
        orgName="A"
      />,
    );
    expect(html).not.toContain("r-chart-ring");
  });

  it("renders the chart's empty state when chartSeries is null", () => {
    const html = renderToStaticMarkup(
      <ReportDocument
        config={defaultReportConfig()}
        model={model}
        kpis={{
          itemCount: 0,
          percentComplete: 0,
          overdueCount: 0,
          statusTally: [],
        }}
        groupSummaries={[]}
        chartSeries={null}
        boardName="M"
        orgName="A"
      />,
    );
    expect(html).toContain("r-chart-empty");
    expect(typeof computeChartSeries).toBe("function");
  });
});
```

Update the **two existing** tests in that file to pass `chartSeries={null}` (they will not compile otherwise).

Append to `src/lib/reports/export.test.ts`:

```ts
it("inlines the chart CSS and the chart markup for a config with a chart block", async () => {
  const html = await buildReportHtml({
    config: defaultReportConfig(),
    model: { columns: [], groups: [] },
    kpis: {
      itemCount: 3,
      percentComplete: 33,
      overdueCount: 0,
      statusTally: [],
    },
    groupSummaries: [],
    chartSeries: {
      categories: [
        { key: "a", label: "Done", value: 2, color: "#5866c4" },
        { key: "b", label: "Stuck", value: 1, color: "#e34948" },
      ],
      total: 3,
      categoryName: "Status",
      empty: false,
    },
    boardName: "B",
    orgName: "O",
  });
  expect(html).toContain(".r-chart-ring");
  expect(html).toMatch(/<path[^>]+d="M/);
});
```

Update the existing `buildReportHtml` test to pass `chartSeries: null`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/components/reports/ReportDocument.test.tsx src/lib/reports/export.test.ts`
Expected: FAIL — TS/runtime error on the unknown `chartSeries` prop.

- [ ] **Step 3: Modify `src/components/reports/ReportDocument.tsx`**

Add the import and the prop:

```tsx
import type { ChartSeries } from "@/lib/reports/chart-data";
import { ChartBlock } from "./blocks/ChartBlock";

export type ReportDocumentProps = {
  config: ReportConfig;
  model: ReportModel;
  kpis: Kpis;
  groupSummaries: GroupSummary[];
  /**
   * REQUIRED, and `null` when the board has nothing chartable. Not optional on
   * purpose: both render paths (PreviewPane and exportReportPdf) must supply it
   * explicitly, or the preview and the PDF silently drift.
   */
  chartSeries: ChartSeries | null;
  boardName: string;
  orgName: string;
};
```

Destructure `chartSeries` alongside the others, and add the case to the switch, immediately after `case "kpis"`:

```tsx
            case "chart":
              return (
                <ChartBlock
                  key={i}
                  series={
                    chartSeries ?? {
                      categories: [],
                      total: 0,
                      categoryName: "",
                      empty: true,
                    }
                  }
                  options={block.options}
                />
              );
```

- [ ] **Step 4: Modify `exportReportPdf` in `src/lib/reports/actions.ts`**

Add the import:

```ts
import { computeChartSeries } from "@/lib/reports/chart-data";
```

Inside `exportReportPdf`, before `buildReportHtml`, derive the series from the report's own chart block:

```ts
// Compute the chart from the SAME payload the rest of the document uses, so
// the PDF cannot disagree with the preview.
const chartBlock = report.config.blocks.find(
  (b) => b.type === "chart" && b.enabled,
);
const chartSeries =
  chartBlock && chartBlock.type === "chart"
    ? computeChartSeries(payload, names, chartBlock.options)
    : null;
```

and pass `chartSeries,` into the `buildReportHtml({ … })` object.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/components/reports/ReportDocument.test.tsx src/lib/reports/export.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/reports/ReportDocument.tsx src/lib/reports/actions.ts src/components/reports/ReportDocument.test.tsx src/lib/reports/export.test.ts
git commit -m "feat(reports): render the chart block in the document and the exported PDF"
```

---

## Task 7: Guard — the report surface must never reach recharts

**Interfaces:** Consumes: T3 (`reachable`), T5 (the components exist). Produces: the bundle/SSR boundary guard.

**Files:**

- Create: `src/components/reports/no-recharts-in-report.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { reachable } from "@/test/static-imports";

const SRC = join(process.cwd(), "src");
const DOCUMENT = join(SRC, "components/reports/ReportDocument.tsx");
const UI_CHART = join(SRC, "components/ui/chart.tsx");

/**
 * The report document is rendered by `renderToStaticMarkup` in a server action
 * and loaded into headless Chromium with `page.setContent` — a page that runs
 * NO client JavaScript. recharts 3.x renders an empty wrapper div there (it
 * builds its geometry in effects/layout hooks), and `@/components/ui/chart` is
 * a "use client" module. Either import would produce a PDF with blank boxes
 * where the charts should be, while the live preview iframe looked correct.
 *
 * Charts on this surface are hand-rolled static SVG/CSS. This test is the fence.
 */
describe("report render-surface boundary", () => {
  const { files, bare } = reachable(DOCUMENT);

  it("does not statically reach recharts from ReportDocument", () => {
    expect(bare.has("recharts")).toBe(false);
  });

  it("does not statically reach the client ChartContainer from ReportDocument", () => {
    expect(files.has(UI_CHART)).toBe(false);
  });

  it("reaches the hand-rolled chart block (the walker is actually traversing)", () => {
    expect(
      files.has(join(SRC, "components/reports/blocks/ChartBlock.tsx")),
    ).toBe(true);
    expect(
      files.has(join(SRC, "components/reports/blocks/DonutChart.tsx")),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run src/components/reports/no-recharts-in-report.test.ts`
Expected: PASS — 3 tests. (The third assertion is a self-check: if the walker stopped traversing, the first two would pass vacuously.)

- [ ] **Step 3: Commit**

```bash
git add src/components/reports/no-recharts-in-report.test.ts
git commit -m "test(reports): guard the no-client-JS render surface against recharts"
```

---

## Task 8: Builder — the chart options editor

**Interfaces:** Consumes: T1 (`ChartBlockOptions`), T4 (`computeChartSeries`, `isChartableColumn`), T5 (the block renders). Produces: the authoring UI.

**Files:**

- Create: `src/components/reports/ChartBlockOptions.tsx`
- Create: `src/components/reports/ChartBlockOptions.test.tsx`
- Modify: `src/components/reports/SectionRail.tsx` (the `LABELS` map)
- Modify: `src/components/reports/ReportBuilder.tsx`

**`pulse-ui` rules that apply here** (this UI lives in the app shell, not the print surface):

- Semantic tokens only — no raw Tailwind colors. `bg-surface`, `text-muted-foreground`, `border`, `hover:border-border-hover`.
- There is **no `select.tsx` shadcn primitive** in this repo. The established pattern is a native `<select>` with the exported `selectClass` from `src/components/boards/automations/builder-utils.ts` (`WidgetConfigForm` and `FilterBuilder` both use it). **Import it — do not redeclare the string.**
- `<Label>` from `@/components/ui/label`, `<Kicker>` from `@/components/ui/kicker`.
- Every control keyboard-reachable with a visible `focus-visible` ring and an `aria-label`.

- [ ] **Step 1: Write the failing test**

Create `src/components/reports/ChartBlockOptions.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChartBlockOptionsEditor } from "@/components/reports/ChartBlockOptions";
import type { ChartBlockOptions } from "@/lib/reports/config";
import type { Column } from "@/lib/boards/queries";

const options: ChartBlockOptions = {
  variant: "donut",
  source: "status",
  columnId: null,
  title: "",
  maxCategories: 6,
};

const columns = [
  { id: "c1", name: "Status", kind: "status", position: 0, settings: null },
  { id: "c2", name: "Owner", kind: "people", position: 1, settings: null },
  { id: "c3", name: "Notes", kind: "text", position: 2, settings: null },
  { id: "c4", name: "Budget", kind: "currency", position: 3, settings: null },
] as unknown as Column[];

describe("ChartBlockOptionsEditor", () => {
  it("offers only chartable columns as the source", () => {
    render(
      <ChartBlockOptionsEditor
        options={options}
        columns={columns}
        onChange={vi.fn()}
      />,
    );
    const select = screen.getByLabelText("Chart source") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["status", "board_group", "c1", "c2"]);
    expect(values).not.toContain("c3");
    expect(values).not.toContain("c4");
  });

  it("emits source=column with the picked columnId", () => {
    const onChange = vi.fn();
    render(
      <ChartBlockOptionsEditor
        options={options}
        columns={columns}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Chart source"), {
      target: { value: "c2" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...options,
      source: "column",
      columnId: "c2",
    });
  });

  it("clears columnId when switching back to the late-bound status source", () => {
    const onChange = vi.fn();
    render(
      <ChartBlockOptionsEditor
        options={{ ...options, source: "column", columnId: "c2" }}
        columns={columns}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Chart source"), {
      target: { value: "status" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...options,
      source: "status",
      columnId: null,
    });
  });

  it("emits the chosen variant", () => {
    const onChange = vi.fn();
    render(
      <ChartBlockOptionsEditor
        options={options}
        columns={columns}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Chart style"), {
      target: { value: "bars" },
    });
    expect(onChange).toHaveBeenCalledWith({ ...options, variant: "bars" });
  });

  it("emits maxCategories as a number within 3..6", () => {
    const onChange = vi.fn();
    render(
      <ChartBlockOptionsEditor
        options={options}
        columns={columns}
        onChange={onChange}
      />,
    );
    const select = screen.getByLabelText("Max categories") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "3",
      "4",
      "5",
      "6",
    ]);
    fireEvent.change(select, { target: { value: "4" } });
    expect(onChange).toHaveBeenCalledWith({ ...options, maxCategories: 4 });
  });

  it("emits a title override", () => {
    const onChange = vi.fn();
    render(
      <ChartBlockOptionsEditor
        options={options}
        columns={columns}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Chart title"), {
      target: { value: "Where work sits" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...options,
      title: "Where work sits",
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/components/reports/ChartBlockOptions.test.tsx`
Expected: FAIL — cannot resolve `@/components/reports/ChartBlockOptions`.

- [ ] **Step 3: Create `src/components/reports/ChartBlockOptions.tsx`**

```tsx
"use client";
import type { Column } from "@/lib/boards/queries";
import type { ChartBlockOptions } from "@/lib/reports/config";
import { isChartableColumn } from "@/lib/reports/chart-data";
import { selectClass } from "@/components/boards/automations/builder-utils";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

const VARIANTS = [
  { value: "donut", label: "Donut" },
  { value: "bars", label: "Bars" },
] as const;

/**
 * The source `<select>` flattens three config shapes into one control:
 *   "status"      → late-bound to the board's first status column
 *   "board_group" → the board's groups
 *   <column id>   → source: "column", columnId: <id>
 */
export function ChartBlockOptionsEditor({
  options,
  columns,
  onChange,
}: {
  options: ChartBlockOptions;
  columns: Column[];
  onChange: (next: ChartBlockOptions) => void;
}) {
  const chartable = columns.filter(isChartableColumn);
  const sourceValue =
    options.source === "column" ? (options.columnId ?? "") : options.source;

  function pickSource(value: string) {
    if (value === "status" || value === "board_group") {
      onChange({ ...options, source: value, columnId: null });
      return;
    }
    onChange({ ...options, source: "column", columnId: value });
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="text-sm">
        Chart source
        <select
          aria-label="Chart source"
          className={selectClass}
          value={sourceValue}
          onChange={(e) => pickSource(e.target.value)}
        >
          <option value="status">Status (first status column)</option>
          <option value="board_group">Groups</option>
          {chartable.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm">
        Chart style
        <select
          aria-label="Chart style"
          className={selectClass}
          value={options.variant}
          onChange={(e) =>
            onChange({
              ...options,
              variant: e.target.value as ChartBlockOptions["variant"],
            })
          }
        >
          {VARIANTS.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
      </label>

      <label className="text-sm">
        Max categories
        <select
          aria-label="Max categories"
          className={selectClass}
          value={String(options.maxCategories)}
          onChange={(e) =>
            onChange({ ...options, maxCategories: Number(e.target.value) })
          }
        >
          {[3, 4, 5, 6].map((n) => (
            <option key={n} value={String(n)}>
              {n}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground mt-1 block text-xs">
          Extra categories fold into a neutral “Other”.
        </span>
      </label>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="report-chart-title">Chart title</Label>
        <Input
          id="report-chart-title"
          aria-label="Chart title"
          value={options.title}
          onChange={(e) => onChange({ ...options, title: e.target.value })}
          placeholder="Items by …"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the rail label in `src/components/reports/SectionRail.tsx`**

In the `LABELS` map, insert between `kpis` and `table`:

```ts
  chart: "Chart",
```

- [ ] **Step 5: Wire it into `src/components/reports/ReportBuilder.tsx`**

Add imports:

```tsx
import { computeChartSeries } from "@/lib/reports/chart-data";
import type { ChartBlockOptions } from "@/lib/reports/config";
import { ChartBlockOptionsEditor } from "./ChartBlockOptions";
```

Add, next to the existing `summaryBlock` lookup:

```tsx
const chartBlock = config.blocks.find((b) => b.type === "chart");
const chartOptions =
  chartBlock && chartBlock.type === "chart" ? chartBlock.options : null;

function setChartOptions(next: ChartBlockOptions) {
  setConfig((prev) => ({
    ...prev,
    blocks: prev.blocks.map((b) =>
      b.type === "chart" ? { ...b, options: next } : b,
    ),
  }));
}
```

Add the memo next to the existing `model`/`kpis`/`summaries` memos:

```tsx
// Derived from the SAME in-memory payload — 0 server round-trips on every
// chart option change (working agreement #5).
const chartSeries = useMemo(
  () =>
    chartOptions ? computeChartSeries(payload, names, chartOptions) : null,
  [payload, names, chartOptions],
);
```

Mount the editor in the left rail, directly under the `SectionRail` section:

```tsx
{
  chartOptions ? (
    <section className="bg-surface rounded-lg border p-3">
      <Kicker className="mb-2 block">Chart</Kicker>
      <ChartBlockOptionsEditor
        options={chartOptions}
        columns={payload.columns}
        onChange={setChartOptions}
      />
    </section>
  ) : null;
}
```

And pass the new prop to `<PreviewPane … chartSeries={chartSeries} />`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run src/components/reports/ChartBlockOptions.test.tsx src/components/reports/SectionRail.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/reports/ChartBlockOptions.tsx src/components/reports/ChartBlockOptions.test.tsx src/components/reports/SectionRail.tsx src/components/reports/ReportBuilder.tsx
git commit -m "feat(reports): chart block options editor in the builder rail"
```

---

## Task 9: Verification and closure

**Interfaces:** Consumes: all.

- [ ] **Step 1: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all four exit 0. Do not proceed on a red gate; do not claim completion without pasting the output (`superpowers:verification-before-completion`).

- [ ] **Step 2: Confirm the SSR-parity and boundary guards actually ran**

Run: `pnpm vitest run src/components/reports src/lib/reports`
Expected: PASS, and the run includes `ChartBlock.parity.test.tsx` and `no-recharts-in-report.test.ts`.

- [ ] **Step 3: Confirm no migration was created**

Run: `git status --short supabase/migrations/`
Expected: empty output. This slice touches no schema. If anything appears, it does not belong to this task.

- [ ] **Step 4: Manual acceptance (do this before calling it done)**

Run `pnpm dev`, open a board with a status column of ≥3 distinct values and several groups, then walk the "How to test" list in the spec — in particular:

- open a report created **before** this change; the Chart row is present and **unchecked**, and the preview is unchanged until it is ticked;
- **Export PDF** and compare the PDF against the on-screen preview segment-for-segment;
- view the PDF in grayscale — every category is still identifiable from its label and value.

- [ ] **Step 5: Finish the task**

Run `scripts/finish-task.sh` from inside the worktree, then hand the user the numbered "How to test this" walkthrough from the spec.

---

## Self-review

**Spec coverage**

| Spec section                                                             | Task                                        |
| ------------------------------------------------------------------------ | ------------------------------------------- |
| Recharts rejection + hand-rolled decision                                | T5 (components) + T7 (guard)                |
| Donut form + guardrails (≤6, gaps, legend, no ids)                       | T5                                          |
| Bars form (horizontal, 4px data-end, square baseline)                    | T2 (CSS) + T5                               |
| Validated print palette + WARN relief                                    | T2                                          |
| Color follows the entity, never its rank                                 | T4 (`paint()` walks bucket order) + T4 test |
| Board option colors first, ramp second, neutral reserved                 | T4                                          |
| `REPORT_CONFIG_VERSION` stays 1                                          | T1                                          |
| Lenient read / strict write                                              | T1                                          |
| Backfill into existing reports, disabled                                 | T1                                          |
| `chartOptions` schema                                                    | T1                                          |
| `computeChartSeries` contract, leaf items, multi-value, degenerate cases | T4                                          |
| `ChartSeries` into `ReportDocument` + PDF                                | T6                                          |
| Builder rail editor, `selectClass` reuse, chartable kinds only           | T8                                          |
| Perf budget: 0 round-trips, memoised, no new query                       | T8 (memo) + T9 (manual network check)       |
| Tests 1–9 in the spec's table                                            | T1, T2, T4, T5, T6, T7, T8                  |
| Execution DAG                                                            | this document's DAG section                 |

No spec requirement is unassigned. Follow-on slices (roll-ups, org templates, time-series) are explicitly out of scope and have no task, by design.

**Type consistency check**

`ChartBlockOptions` (T1) · `ChartCategory` / `ChartSeries` / `computeChartSeries` / `isChartableColumn` / `CHARTABLE_KINDS` (T4) · `PRINT_CATEGORICAL` / `PRINT_NEUTRAL` / `rampSlot` (T2) · `staticEdges` / `resolveSpec` / `reachable` (T3) · `ChartBlock` / `DonutChart` / `BarsChart` / `ChartLegend` / `share` (T5) · `ChartBlockOptionsEditor` (T8) — every name used in a later task is defined in an earlier one, spelled identically.
