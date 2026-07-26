# Report Builder v2 — Charts slice — Design

**Date:** 2026-07-26
**Status:** Spec written — awaiting review
**Author:** Dani (with Claude)
**Predecessor:** `docs/superpowers/specs/2026-07-16-board-pdf-report-builder-design.md`
(v1 shipped; its Non-goals defer **charts**, multi-board roll-ups, and org-level templates
to v2). **This spec scopes charts only.**

## Summary

Add one new orderable report block — **`chart`** — to the shipped Board PDF Report Builder,
with two forms: a **donut** (part-to-whole at a glance) and **horizontal bars** (magnitude
comparison). Both render as **hand-rolled static SVG / HTML with zero client JavaScript**, so
the live preview iframe and the headless-Chromium PDF produce byte-identical markup. No
migration: `reports.config` is versioned `jsonb`, so the change is an additive variant in the
Zod discriminated union plus a lenient read path.

## Goals

- One `chart` block, configurable in the section rail, that charts the **distribution of the
  board's leaf items across a category** (a status/dropdown/priority column, a people column,
  or the board's groups).
- **Pixel-identical** in the preview iframe and in the exported PDF — the v1
  "one-render-surface" principle extended to charts.
- Reachable from **existing saved reports**, not just newly created ones, without a data
  migration.
- Chart design governed by the `dataviz` skill: validated palette, mandatory secondary
  encoding, no anti-patterns.

## Non-goals (the v2 scope line for this slice)

- **Multi-board / workspace roll-ups** — still deferred. Blocked by `reports.board_id NOT
NULL`; needs its own migration. Follow-on slice.
- **Org-level reusable templates** — still deferred. Same blocker, same reason.
- **Time-series charts** (burn-up/burndown, trend over time). The board payload carries no
  history snapshot; a trend chart would need an events/rollup source. Not in this slice.
- **Interactive charts** (hover, tooltips, crossfilter). The report is a print document; see
  "Deviations from the dataviz skill" below.
- **Recharts.** Rejected on evidence — see the next section.
- **Sums of number/currency columns as the chart measure.** The measure in this slice is
  item count only. `group_summaries` already carries per-group progress.

---

## The central constraint: the PDF page runs no client JavaScript

The export path is:

```
exportReportPdf()  →  buildReportHtml()          →  renderHtmlToPdf()
  (server action)      renderToStaticMarkup(          playwright-core + @sparticuz/chromium
                         <ReportDocument/>)           page.setContent(html)
                       + inlined REPORT_CSS
```

`renderToStaticMarkup` produces markup with **no hydration bundle**, and `page.setContent`
loads a document with **no `<script>` tags**. Anything that computes its geometry in an
effect, a layout measurement, or a `ResponsiveContainer` renders as an empty box in the PDF —
while rendering correctly in `PreviewPane`, which _is_ a live React root. That asymmetry is
the exact failure mode this spec must design out.

### Evidence: recharts 3.8.1 does not render under `renderToStaticMarkup`

A spike was run in this worktree against the installed `recharts@3.8.1`, in plain Node 22
(`typeof window === "undefined"`, no jsdom) — i.e. the literal environment of the PDF server
action:

| Case                                                                             | Result                                                                                                           |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `<PieChart width={320} height={200}>` + `<Pie isAnimationActive={false}>`        | `<div class="recharts-wrapper" style="…width:320px;height:200px"></div>` — **127 chars, 0 `<path>`, 0 `<text>`** |
| `<BarChart width={520} height={240}>` + `<Bar isAnimationActive={false}>` + axes | **127 chars, 0 `<path>`, 0 `<rect>`, 0 `<text>`**                                                                |
| Same donut with animation left ON (default)                                      | identical empty wrapper                                                                                          |
| `<ResponsiveContainer>` (control)                                                | `<div class="recharts-responsive-container">…</div>`, empty as expected                                          |

Recharts 3.x builds its chart state in a store populated by effects/layout hooks, so
**explicit `width`/`height` and `isAnimationActive={false}` are not sufficient** — the
mitigation the task brief hypothesised does not work on this major version. The import itself
succeeds (87 exports, no DOM access at module load); only the render is empty.

Ruled-out alternatives, for the record:

- **Ship recharts as a real script into the PDF HTML** (bundle react + recharts, inline it,
  let Chromium execute and `waitUntil: networkidle`): adds a bundler step to a server action,
  a hydration race against `page.pdf()`, and hundreds of KB per export. Rejected on
  fragility, not just size.
- **Render recharts under jsdom on the server, then serialise:** jsdom does not run layout
  (`getBoundingClientRect` returns zeroes), so measurement-driven recharts still degenerates;
  and it puts a DOM emulator in the production server-action path.

### Decision: hand-rolled static SVG (donut) + static HTML/CSS (bars)

Both forms are **pure functions of their props** — no hooks, no refs, no measurement, no
animation, no `useId`. Consequences:

- **Parity is structural, not tested-into-existence.** The same component instance under
  `renderToStaticMarkup` (PDF) and under `createRoot().render` (preview) emits the same
  element tree, because there is no code path that behaves differently with or without a DOM.
  A test asserts this rather than assuming it (see Testing).
- **Bars need no SVG at all.** Horizontal bars are a CSS grid of `<div>`s with a percentage
  width — exactly the mechanism `GroupSummariesBlock` already ships (`.r-gs-track` /
  `.r-gs-fill`), which is already known to print correctly. Reuse the idiom.
- **The donut is arc math.** `polarToCartesian` + an SVG `A` (elliptical arc) path per
  segment, drawn into a fixed `viewBox`. Deterministic to the digit.
- **No text measurement anywhere.** The single hardest thing to do without a DOM is decide
  whether a label fits inside a mark. This design never needs to: values live in an HTML
  legend/label column laid out by CSS flow, never inside a slice or bar. That is also what
  the `dataviz` skill prescribes ("a label that won't fit doesn't get clipped — measure
  first"; here nothing is placed where it could fail to fit).

**Bundle consequence:** the report path gains **0 KB** of charting library. A guard test
enforces that `ReportDocument.tsx` never statically reaches `recharts` or
`@/components/ui/chart` (the shadcn `ChartContainer`, which is `"use client"`).

---

## Chart design (governed by the `dataviz` skill)

### The form

The data's job is **part-to-whole / magnitude comparison over a nominal category** — "how are
this board's items distributed across statuses / owners / groups". Two user-selectable forms:

| Variant     | When it is right                                    | Spec                                                                                                                                                                                   |
| ----------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`donut`** | part-to-whole, at a glance, ≤ 6 segments            | ring, `innerRadius/outerRadius = 0.62`, segments sorted by value desc; center carries the total as a stat value (not a hero figure — the KPI block owns the report's largest numerals) |
| **`bars`**  | comparing magnitudes, many or long-named categories | **horizontal** bars (category names — group names, status labels, people names — are long); ≤ 24px thick; 4px rounded data-end, square at the baseline; grows from one baseline        |

Both always ship a legend/label column carrying `label · count · %`.

### Guardrails taken directly from the skill

- **≤ 6 segments.** Beyond that, the top 5 by value plus an **"Other"** bucket in a neutral
  gray. Never a generated 7th/9th hue. (`maxCategories` is configurable 3–6, default 6.)
- **Fewer than 2 categories → not a chart.** Render a single stat line ("24 items · Done")
  instead of a one-bar bar chart or a one-slice ring.
- **A legend is always present** (≥ 2 series) and every category is direct-labeled with its
  value and share. Identity is never color-alone.
- **2px surface gap between touching marks** — for the donut, each arc is shortened by
  `Δθ = 2 / r` radians at both ends (a computed angular gap, _not_ a white stroke, which the
  skill explicitly forbids); for bars, a 2px row gap.
- **No dual axis, no value-ramp on nominal categories, no rainbow.** One measure, one scale.
- **Text never wears the data color.** Labels and values use the report's ink/muted tokens;
  a colored swatch beside the text carries identity.
- **Proportional figures on the donut's center value; `tabular-nums` only in the aligned
  count column** of the legend.
- **`page-break-inside: avoid`** on the chart section so a ring never splits across a page.

### Color — three sources, in priority order

The report's surface is **white paper**, not the app. That matters:

> **The app's `--chart-cat-*` palette is NOT portable to this surface.** Validated with
> `dataviz/scripts/validate_palette.js` against `#ffffff`:
> `#6366f1,#22d3ee,#a855f7,#f59e0b,#fb7185,#34d399` →
> **FAIL** lightness band (`#22d3ee` L .797, `#34d399` L .773 — both above the .77 ceiling),
> **FAIL** CVD separation (worst adjacent `#34d399↔#fb7185` ΔE 4.6 deutan, below the 6 floor),
> WARN contrast (4 of 6 slots below 3:1 on white). Exit code 1.
> Those hues are stepped for the app's near-black surface; on paper they wash out. Reusing
> them literally would ship a chart that fails colorblind separation in a client-facing PDF.

So the print ramp is its own validated instance:

1. **Board option color, when the category has one.** Status/dropdown/priority options and
   board groups already carry a user-chosen hex, and the report already renders those (status
   pills in `TableBlock` via `shape.ts`'s `optionColor`, group ticks in `.r-grp-tick`).
   A donut whose "Done" slice is a different green from the "Done" pill three inches below it
   is worse than an imperfect palette. **Fidelity to the board wins.** The mandatory
   label + value + % on every category is the secondary encoding that makes an unvalidatable
   user palette safe.
2. **The validated print ramp**, for options with no configured color:

   | Slot | Hue        | Hex       | Source                                                      |
   | ---- | ---------- | --------- | ----------------------------------------------------------- |
   | 1    | periwinkle | `#5866c4` | the report's own accent (`--peri`), already in `REPORT_CSS` |
   | 2    | orange     | `#eb6834` | `dataviz` reference light palette                           |
   | 3    | aqua       | `#1baf7a` | "                                                           |
   | 4    | yellow     | `#eda100` | "                                                           |
   | 5    | magenta    | `#e87ba4` | "                                                           |
   | 6    | green      | `#008300` | "                                                           |
   | 7    | violet     | `#4a3aa7` | "                                                           |
   | 8    | red        | `#e34948` | "                                                           |

   Validated on the report surface — `node scripts/validate_palette.js
"#5866c4,#eb6834,#1baf7a,#eda100,#e87ba4,#008300,#4a3aa7,#e34948" --mode light --surface
"#ffffff"` → **ALL CHECKS PASS** (lightness band PASS, chroma floor PASS, CVD separation
   PASS worst adjacent ΔE 9.1 protan, normal-vision floor PASS ΔE 19.6, contrast WARN on
   slots 3/4/5). The contrast WARN is the skill's _relief_ case and is **discharged, not
   dismissed**: every mark ships a visible direct label plus the legend, and the report's own
   Board-table/Appendix blocks are the table-view twin.
   Slot 1 is the periwinkle rather than the reference blue so the chart reads as part of the
   same document as the cover rule, the KPI figure and the progress bars.

3. **Neutral gray `#9aa1b1`** — reserved for the "no value" category and for "Other". Never a
   categorical slot; it must not read as an identity.

**Color follows the entity, never its rank** (the skill's named anti-pattern). Ramp slots are
assigned by the option's **index in the column's `settings.options` array**, not by its
position in the value-sorted chart. Filtering or a data change that reorders the chart does
**not** repaint the survivors.

### Deviations from the `dataviz` skill, and why

| Skill rule                                                          | Deviation                                      | Rationale                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Add the hover layer — by default"                                  | **No hover, no tooltip.**                      | The artifact is a PDF. The preview iframe deliberately renders the _identical_ document; adding interaction to the preview would break the one-render-surface guarantee for zero benefit in the deliverable. The relief the rule protects — "a tooltip must never be the only way to read a value" — is satisfied maximally: every value is permanently visible. |
| "Donut stays deprioritized; part-to-whole rides on the stacked bar" | **Donut is shipped as a first-class variant.** | It is the commissioned form and the v1 spec's named deferral. It is constrained to the skill's legal envelope (at-a-glance part-to-whole, ≤ 6 segments, never for comparing close values) and the `bars` variant is offered alongside for exactly the comparison case.                                                                                           |
| "Dark mode is selected, not flipped"                                | **No dark mode.**                              | The report is a white-paper print document by design (`REPORT_CSS` hardcodes `background:#fff`). One surface, validated once.                                                                                                                                                                                                                                    |

---

## Data model & config versioning

### No migration

`reports.config` is `jsonb` validated by Zod at the boundary. A new block variant is a code
change only. The roll-ups and org-templates slices _do_ need a migration (both blocked by
`reports.board_id NOT NULL`) — they are the follow-on slice and are out of scope here.

### `REPORT_CONFIG_VERSION` stays at `1`

**Decision: do not bump.**

- The change is **purely additive**. Every existing v1 config still parses unchanged under
  the extended union — no field is renamed, retyped, or reinterpreted. There is nothing for a
  migration step to do.
- **Bumping would break every saved report.** `reportConfigSchema` declares
  `v: z.literal(REPORT_CONFIG_VERSION)` and `queries.ts#rowToReport` calls
  `reportConfigSchema.parse(row.config)` — a **throwing** parse. Setting
  `REPORT_CONFIG_VERSION = 2` makes every stored `{"v":1,…}` row fail `z.literal(2)`, so
  `getReport`/`listReports` throw and the reports list and builder 500 for existing data.
  The bump would be a breaking data migration bought for zero benefit.
- `v` is reserved for a **breaking reinterpretation of existing fields** (e.g. renaming
  `blocks[].options.columnIds`, or changing what an existing option means). Additive variants
  are not that. This rule is written into `config.ts` as a comment so the next person adding a
  block does not bump it reflexively.

### The hazard the bump decision exposes, and the fix

Not bumping is correct, but the strict throwing read path has a real failure mode in the
other direction: once a user saves a config containing a `chart` block, **a rollback to the
previous deploy makes `reportConfigSchema.parse` throw on that row**, taking down the reports
list page — not just the one report. The same is true for any future block type.

So this slice splits the config boundary by direction:

- **Reads are lenient.** A new `parseReportConfig(raw): ReportConfig` parses the envelope with
  `blocks: z.array(z.unknown())`, runs each element through `blockSchema.safeParse`, and
  **drops** the ones that fail. An unknown future block is silently omitted from the render
  instead of crashing the page. `queries.ts#rowToReport` switches to this.
- **Writes stay strict.** `saveReport` keeps `reportConfigSchema` (strict, throwing/`safeParse`
  on the action boundary) — junk never enters the database.

### Reaching existing reports: `normalizeReportConfig`

Adding `chart` to `defaultReportConfig()` only helps reports created _after_ the deploy.
Existing rows have 8 blocks and no chart, and the section rail has no "add block" affordance
(it toggles and reorders a fixed list). Without a fix, charts would be unreachable from every
report a user already has.

`parseReportConfig` therefore **backfills** any block type missing from `config.blocks`:

- inserted **disabled** (`enabled: false`) with its option defaults, so an existing saved
  report's rendered output is byte-for-byte unchanged until the user opts in;
- `chart` is inserted **after `kpis`** when present, else appended;
- generic over `blockTypeSchema.options`, so the next block type inherits this for free.

For a **new** report, `defaultReportConfig()` includes `chart` **enabled**, defaulting to a
donut of the board's first status column. Charts are the headline of this slice; a new report
should show one.

### Config schema (the delta to `src/lib/reports/config.ts`)

```ts
const chartOptions = z.object({
  variant: z.enum(["donut", "bars"]).default("donut"),
  // "status"      → late-bound: the board's FIRST status column, resolved at render.
  //                 Survives column renames/reorders and needs no board knowledge to default.
  // "board_group" → the board's groups.
  // "column"      → the explicit `columnId` below.
  source: z.enum(["status", "board_group", "column"]).default("status"),
  columnId: z.string().nullable().default(null), // required only when source === "column"
  title: z.string().max(120).default(""), // "" → the derived title (see below)
  maxCategories: z.number().int().min(3).max(6).default(6),
});

// added to the discriminated union:
z.object({
  type: z.literal("chart"),
  enabled: z.boolean().default(true),
  options: chartOptions.prefault({}),
});
```

`.prefault({})` (not `.default({})`) — Zod 4 types `.default`'s argument as the object's
_output_, which `{}` fails; the existing option groups already document this trap.

Derived title when `options.title` is `""`: `"Items by <category name>"` — e.g. "Items by
Status", "Items by Group", "Items by Owner". Stored empty rather than materialised so a
column rename is reflected without an edit.

---

## Shaping (`src/lib/reports/chart-data.ts` — new)

One pure function, alongside `computeKpis` / `computeGroupSummaries` in the existing shaping
layer, consuming the **same already-loaded `BoardPayload`**.

```ts
export type ChartCategory = {
  key: string; // stable identity (option id | group id | "__none" | "__other")
  label: string;
  value: number; // leaf-item count
  color: string; // resolved hex (board color → ramp slot → neutral)
};

export type ChartSeries = {
  categories: ChartCategory[]; // sorted value desc, then label asc; ≤ maxCategories
  total: number; // leaf items counted, INCLUDING those folded into "Other"
  categoryName: string; // for the derived title
  empty: boolean; // total === 0 or no resolvable source
};

export function computeChartSeries(
  payload: BoardPayload,
  peopleNames: Map<string, string>,
  options: ChartBlockOptions,
): ChartSeries;
```

Rules:

- **Leaf items only** — same definition `computeKpis`/`computeGroupSummaries` already use
  (items with no children), so the chart total agrees with the KPI item count. A chart that
  disagrees with the KPI row three inches above it is a bug in the deliverable.
- **Deterministic ordering**: value desc, then label asc. Required — the preview and the PDF
  must match, and the tests must not be flaky.
- **Multi-value cells** (a people column with two assignees, a multi-select dropdown) count
  the item **once per selected option**, so `sum(categories) ≥ total`. The block states
  `n items` from `total` and the legend shows per-category counts; this is stated in the spec
  so it is a decision, not a surprise.
- **Blank/unset** → a single `"__none"` category labeled `"—"` in the neutral gray.
- **`source: "status"`** with no status column on the board, or `source: "column"` with a
  `columnId` that no longer exists → `empty: true` (renders the empty state, never throws).
- Reuses `cellToText` and the option-color lookup already in `shape.ts` — the `optionColor`
  helper is exported from `shape.ts` rather than reimplemented (repo rule: grep before
  writing a helper).

Complexity is `O(items)` over the already-bounded payload (`getBoardPayload` caps items at
5000 / cells at 20000). No new query, no new index, no new column read.

---

## Components

### Print surface (no `"use client"`, no hooks)

- **`src/components/reports/blocks/ChartBlock.tsx`** — the block: kicker (title), then the
  variant. Handles `empty` (muted "No data") and `< 2 categories` (stat line).
- **`src/components/reports/blocks/DonutChart.tsx`** — pure SVG. Fixed `viewBox`, arc paths,
  angular 2px gaps, center total. No `<defs>`/gradients (a gradient id would need to be
  unique per instance; solid fills keep the markup id-free and therefore trivially identical
  across both render paths).
- **`src/components/reports/blocks/BarsChart.tsx`** — HTML/CSS grid rows, mirroring the
  existing `.r-gs-row` idiom.
- **`src/components/reports/blocks/ChartLegend.tsx`** — swatch · label · count · %, used by
  the **donut only**, sitting beside the ring. The `bars` variant carries its category names
  in its own row labels — those are axis categories, not series, so a legend box would
  restate them (the skill's "a single series needs no legend box"); `bars` renders
  `label · count · %` inline on each row instead.
- **`REPORT_CSS`** gains a `/* ---- charts ---- */` section: `.r-chart`, `.r-chart-ring`,
  `.r-chart-legend`, `.r-lg-row`, `.r-lg-sw`, `.r-bar-row`, `.r-bar-track`, `.r-bar-fill`,
  plus the `--cat-1…8` and `--cat-neutral` custom properties. Same file, same discipline: no
  app Tailwind, print-safe units.

### Builder rail (client, `pulse-ui` governs)

- **`src/components/reports/ChartBlockOptions.tsx`** (`"use client"`) — the per-block editor
  in the left rail: variant (donut / bars), source (Status / Groups / a listed column),
  max categories, optional title override.
  - No `select.tsx` primitive exists in `src/components/ui/`; the codebase's established
    pattern is a native `<select>` with the exported `selectClass` from
    `src/components/boards/automations/builder-utils.ts` — **import that, do not redeclare**
    (it is also what `WidgetConfigForm` and `FilterBuilder` use).
  - Labels via `<Label>`, section header via `<Kicker>`, semantic tokens only
    (`bg-surface`, `text-muted-foreground`, `border` → `hover:border-border-hover`), 14px
    radius, no shadows. Every control keyboard-reachable with a visible `focus-visible` ring
    and an `aria-label` where the visual label is a kicker.
  - The source `<select>` lists only **chartable** columns: `status`, `dropdown`, `priority`,
    `people`. Others are not offered rather than offered-and-broken.
- **`SectionRail.tsx`** — one new entry in `LABELS`: `chart: "Chart"`.
- **`ReportBuilder.tsx`** — mount `ChartBlockOptions` when a chart block exists; add a
  `useMemo` for the chart series next to the existing `computeKpis`/`computeGroupSummaries`
  memos.

### Wiring

- **`ReportDocument.tsx`** — one new `case "chart"` in the switch, receiving the memoised
  series. `ReportDocumentProps` gains a **required** `chartSeries: ChartSeries | null`
  (computed by the same helper on both sides: `ReportBuilder` for preview,
  `actions.ts#exportReportPdf` for the PDF), so the render surface stays a pure function of
  props and every call site is forced to supply it. Required, not optional: the three
  existing call sites (`ReportBuilder`, `exportReportPdf`, and the two existing tests
  `ReportDocument.test.tsx` / `export.test.ts`) are updated in the same task — a silently
  defaulting `undefined` is exactly how the preview and the PDF would drift.

---

## Performance & data-fetching budget (working agreement #5)

**(a) First paint vs. interaction.** First paint is _unchanged_: the builder page already
loads `getReport` + `getBoardPayload` + `resolvePeopleNames` once, server-side, and hands the
payload to the client. The chart adds **no new server data** — it is derived from the payload
already in memory. Every chart interaction (toggle the block, switch donut↔bars, change the
source column, change max categories, reorder) is **pure client state → 0 server
round-trips**; `PreviewPane` re-renders its own React root from local props. No `<Link>`, no
`router.push`, no RSC re-run. Builder state is component state, not URL state, so the History
API is not involved (unchanged from v1).

**(b) Does the interaction change server data?** No — only `Save` does, via the existing
`saveReport` server action with its existing targeted revalidation. The chart block adds no
new mutation.

**(c) Is the hot-path read bounded over indexed columns?** No new read is introduced.
`getBoardPayload` is already RLS-scoped and bounded (items ≤ 5000, cells ≤ 20000) over
indexed columns; `reports` reads hit the existing `(org_id, board_id)` index. Chart shaping
is a single `O(items)` pass over that bounded payload, memoised on `[payload, names,
chartOptions]`, so a re-render without an option change is free.

**Bundle & export budget.** 0 KB of charting library on either path (guard-tested). The PDF
gains a few hundred characters of SVG path data and no additional `page.setContent` work — no
scripts, no network, so no change to the `waitUntil: "networkidle"` settle.

---

## Testing (working agreement #4 — mandatory, written and executed)

| #   | Test                                                                                                                                                                                                                                                                                         | What it proves                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `chart-data.test.ts` — empty board, single category, exactly 6, 9 → top-5 + Other, blank cells → `—`, multi-value people cell, `source:"status"` with no status column, `columnId` pointing at a deleted column, tie-breaking order                                                          | the shaping contract, including every degenerate case                                                                                                     |
| 2   | `chart-data.test.ts` — color resolution: board option color wins; uncolored option takes its **settings index** slot (not its rank); reordering by value does not repaint                                                                                                                    | the "color follows the entity, never its rank" anti-pattern                                                                                               |
| 3   | `ChartBlock.test.tsx` — `renderToStaticMarkup` emits real geometry: `<svg`, `<path d="M`, arc `A` commands, one legend row per category                                                                                                                                                      | **recharts' failure mode cannot recur silently** — this is the regression test for the whole spike                                                        |
| 4   | `ChartBlock.parity.test.tsx` — render the same props twice: once via `renderToStaticMarkup`, once via `react-dom/client` `createRoot` into a jsdom container; assert the resulting markup is **identical**                                                                                   | the one-render-surface guarantee, as an executable assertion rather than a claim                                                                          |
| 5   | `no-recharts-in-report.test.ts` — static-import walk from `ReportDocument.tsx` never reaches `recharts` or `@/components/ui/chart`                                                                                                                                                           | the bundle/SSR boundary. Reuses the edge-walker extracted from `no-recharts-in-first-paint.test.ts` — **that test's assertions must stay byte-identical** |
| 6   | `config.test.ts` — a v1 config (no chart block) parses and is backfilled with a **disabled** chart; `defaultReportConfig()` has 9 types with chart **enabled**; a config carrying an unknown future block type parses with that block **dropped**, not thrown; `REPORT_CONFIG_VERSION === 1` | the versioning decision and the rollback-tolerance fix                                                                                                    |
| 7   | `export.test.ts` — `buildReportHtml` with a chart block yields a document containing the chart CSS custom properties and the SVG                                                                                                                                                             | the full HTML assembly path                                                                                                                               |
| 8   | `ChartBlockOptions.test.tsx` — the source `<select>` offers only chartable column kinds; changing variant/source calls `onChange` with a valid config; controls are labelled                                                                                                                 | the builder editor, incl. a11y labelling                                                                                                                  |
| 9   | Palette regression — assert the print ramp constant equals the validated eight hexes                                                                                                                                                                                                         | nobody re-eyeballs the palette later                                                                                                                      |

All four gates green before "done": `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

## Execution DAG (working agreement #6)

**Interfaces / dependency edges**

- **T1 — Config: `chart` variant + `parseReportConfig` + `normalizeReportConfig` backfill +
  `defaultReportConfig` update + `queries.ts#rowToReport` switched to the lenient read.**
  Consumes: nothing. Produces: `ChartBlockOptions` type, the config contract, the read path.
- **T2 — Print palette + `REPORT_CSS` chart section.** Consumes: nothing (the validated hexes
  are in this spec). Produces: `src/lib/reports/chart-palette.ts`, the CSS classes.
- **T3 — Test-helper extraction: `staticEdges`/`reachable` out of
  `no-recharts-in-first-paint.test.ts` into a shared test util.** Consumes: nothing.
  Produces: the walker for T7. _(Independent of everything else — touches only test files.)_
- **T4 — `chart-data.ts` shaping + tests.** Consumes: T1 (options type), T2 (ramp).
  Produces: `computeChartSeries`, `ChartSeries`.
- **T5 — `DonutChart` / `BarsChart` / `ChartLegend` / `ChartBlock` + render + parity tests.**
  Consumes: T2 (CSS/ramp), T4 (`ChartSeries`). Produces: the print components.
- **T6 — `ReportDocument` wiring + `export-html`/`actions.ts` chart-series computation +
  `export.test.ts`.** Consumes: T4, T5. Produces: charts in the PDF.
- **T7 — `no-recharts-in-report.test.ts` guard.** Consumes: T3, T5.
- **T8 — Builder: `ChartBlockOptions`, `SectionRail` label, `ReportBuilder` memo + mount.**
  Consumes: T1, T4, T5. Produces: the authoring UI.
- **T9 — Verification pass + manual acceptance walkthrough.** Consumes: all.

**Dependency graph**

```
T1 ─┬─────────────┐
    │             ↓
T2 ─┴──→ T4 ──→ T5 ──┬──→ T6 ──┐
                     ├──→ T7 ──┼──→ T9
T3 ──────────────────┘         │
T1,T4,T5 ──────────→ T8 ───────┘
```

**Parallel batches (waves of concurrent agents)**

- **Batch 1:** T1 ∥ T2 ∥ T3 — three files/areas with no shared state.
- **Batch 2:** T4 (single task; it is the critical-path narrow point).
- **Batch 3:** T5.
- **Batch 4:** T6 ∥ T7 ∥ T8 — disjoint file sets (`ReportDocument`+`actions` / a new test file
  / the builder rail).
- **Batch 5:** T9.

**Critical path (wall-clock floor):** T1/T2 → T4 → T5 → T6 → T9.

Batches 1 and 4 each carry ≥ 2 tasks and must be dispatched with
`superpowers:dispatching-parallel-agents`, not run one-at-a-time. All tasks edit disjoint
files within their batch, so they share the one `task/report-builder-v2-charts` worktree
rather than needing nested worktrees; the only shared file is `config.ts` (T1 alone) and
`report-css.ts` (T2 alone).

---

## How to test (manual acceptance, post-merge)

1. Pull `develop`. Open a board that has a **status column with at least three distinct
   values** and several groups.
2. Board header → **Report**. Open an **existing** report from before this change. Confirm
   the section rail now shows a **Chart** row, **unchecked**, and the preview is unchanged.
3. Tick **Chart**. A donut of the status distribution appears in the preview — instantly, with
   no page reload and no network request (watch the Network tab: zero new requests).
4. Switch the variant to **Bars**, then change the source to **Groups**, then to a **people**
   column. Each change updates the preview instantly. Confirm the slice/bar colors match the
   status pills and group ticks elsewhere in the same document.
5. Set **Max categories** to 3 on a board with more than three statuses. Confirm the chart
   shows the top 2 plus a gray **Other**, and that the legend counts still sum to the stated
   total.
6. Click **Save**, reload the page — the chart block and its options persist.
7. Click **Export PDF**. Open the PDF: the chart must look **identical** to the preview —
   same segments, same order, same colors, same labels — and must not be split across a page
   break.
8. Create a **new** report on the same board. Confirm the chart block is present and
   **enabled** by default.
9. Open a report on a board with **no status column**. Confirm the chart block renders a
   quiet "No data" line rather than an error, and the rest of the report is intact.
10. Print-check: view the PDF in grayscale (or print preview → grayscale). Every category is
    still identifiable from its label and value — nothing depends on color alone.

---

## Follow-on slices (named, not scoped here)

- **Multi-board / workspace roll-ups** — needs a migration to relax `reports.board_id NOT
NULL` (nullable + a `report_boards` join, or a `scope` discriminator), plus RLS across the
  board set and a roll-up shaping layer. Must land after this slice; the chart block's
  `ChartSeries` contract is deliberately board-agnostic so it can be fed a roll-up series
  without a rewrite.
- **Org-level reusable templates** — same `board_id NOT NULL` blocker.
- **Time-series / burndown charts** — needs a history source that does not exist today.

## Open questions for the plan

- Exact donut geometry constants (outer radius, ring thickness, center-value size) —
  settle against a rendered PDF during T5, not on paper.
- Whether `bars` should offer a "% of total" scale in addition to raw counts. Lean: no in this
  slice — the legend already carries the share, and a scale toggle is a second measure.
