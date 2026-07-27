# Formatted Excel Export — Design

**Date:** 2026-07-03
**Status:** Approved (design) — MVP Final Features item 3 (feedback F3, danijel.uae@gmail.com)
**Source feedback:** "Currently when you export the board into Excel, it comes unformatted. It
will be very helpful if we can develop or improve the feature that already exists that actually
formats it properly, meaning it puts colorization and the percentage bars."

## Summary

The board → Excel export (spreadsheet IO, 2026-06-25) produces a correct but visually flat
worksheet: every cell is a plain text string, no fills, no widths, no header styling. This change
enriches the **xlsx** output so the file reads like the board:

- **Status / dropdown cells** get a solid fill in the option's stored hex color with
  contrast-picked text (same `pillTextColor` logic as the board's pills).
- **Percent cells** become real numbers rendered as Excel **data bars**, colored with the same
  six red→green bands the board's `PercentBar` uses.
- **Numbers cells** become real numbers (right-aligned by Excel natively).
- **Header row** is styled (bold, dark fill, white text), **frozen**, and gets an **auto-filter**.
- **Columns get sensible widths** per column kind instead of Excel's default 8.43.
- **Group cells** are filled with the group's color (contrast text) so group bands are scannable.
- **Subitem rows** render the name cell in muted italic (keeping the `↳ ` marker).

CSV output is untouched (the format carries no styling). The import path keeps working on
exported files unchanged — round-trip compatibility is a hard requirement and is tested.

## What exists today (verified in-repo)

| Piece            | Where                                                   | Relevant facts                                                                                                        |
| ---------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Export action    | `src/lib/boards/spreadsheet-actions.ts` → `exportBoard` | Zod-validated; `getBoardPayload` (bounded, batched, RLS-scoped); people-name resolution; returns base64 to the client |
| Workbook builder | `src/lib/boards/spreadsheet/export-workbook.ts`         | Pure; `addRow` of string cells from `cellToText`; xlsx or csv buffer                                                  |
| Cell codec       | `src/lib/boards/spreadsheet/cell-codec.ts`              | `cellToText` renders every kind to a flat string; `textToCell` parses back                                            |
| Import parser    | `src/lib/boards/spreadsheet/parse-workbook.ts`          | Reads `cell.text` — styling-agnostic; numeric cells stringify back                                                    |
| Option colors    | `src/lib/boards/option-colors.ts`                       | Status/dropdown option `color` is a hex from a fixed 15-color palette; stored in column `settings.options[]`          |
| Group color      | `groups.color` (hex)                                    | Already in `BoardPayload`                                                                                             |
| Percent bands    | `src/lib/boards/percent-color.ts` + `globals.css`       | Six bands (0–19 red, 20–39 orange, 40–59 amber, 60–79 lime, 80–99 green, 100 complete-green) as OKLCH tokens          |
| Contrast picker  | `src/lib/boards/contrast.ts`                            | `pillTextColor(hex)` → near-black `#1a1a1d` or white by WCAG ratio; pure, importable server-side                      |
| UI trigger       | `src/components/boards/ExportMenu.tsx`                  | Client dropdown (xlsx/csv) → server action → blob download                                                            |

## exceljs feasibility (verified against `node_modules/exceljs@4.4.0`)

- **Fills / fonts / alignment**: standard `cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } }`, `cell.font`, per-cell. Supported.
- **Column widths**: `ws.getColumn(i).width` (character units). Supported.
- **Freeze panes**: `ws.views = [{ state: "frozen", ySplit: 1 }]`. Supported.
- **Auto-filter**: `ws.autoFilter = { from, to }`. Supported.
- **Data bars**: `ws.addConditionalFormatting({ ref, rules: [{ type: "dataBar", cfvo, gradient, showValue, priority }] })`. The writer (`lib/xlsx/xform/sheet/cf/databar-xform.js`) renders a `color` property on the rule model, and `gradient: false` routes through the x14 ext writer (`cf-ext/databar-ext-xform.js`) for modern solid bars — **but `DataBarRuleType` in `index.d.ts` omits `color`**. We extend the type locally (typed intersection, no `any`) rather than patching the package.
- **Number formats**: `cell.numFmt` — percent cells use `0"%"` (displays `50%`, underlying value stays `50`, so `cell.text` → `"50"` and `textToCell("percent", "50")` still round-trips). We deliberately do NOT use Excel's native percent format (which would need `0.5`) because it would break re-import and the stored shape is `0–100`.
- **Dates**: kept as ISO **strings**. Writing real Date objects would make `cell.text` a JS `Date.toString()` and break the tightened `isDateLike` detector on re-import.

## Design

### Architecture: a formatting pass over the built sheet

`buildExportWorkbook` keeps its current row-emission logic and gains two things:

1. **Typed cell values.** A new `cellToExcelValue(kind, value, settings, resolvePeopleName)` in
   `cell-codec.ts` wraps `cellToText` and returns `number` for `numbers`/`percent` (when the
   stored value is a valid number) and `string` otherwise. `cellToText` itself is untouched
   (import path and CSV semantics unchanged — exceljs's csv writer serializes `50` as `50`).
2. **A `FormatPlan` collected while emitting rows**, applied by a new pure module
   `src/lib/boards/spreadsheet/format-workbook.ts` after all rows exist, **only when
   `format === "xlsx"`**. The plan records, per emitted row: row number, group color, whether it
   is a subitem row, and per-cell option fills; plus per percent column the cell addresses
   bucketed by band.

Keeping formatting in its own module preserves the existing file's single job (structure/order)
and gives the formatting logic an independently testable surface.

### `format-workbook.ts` — responsibilities

```
export type FormatPlan = {
  /** Board columns in emitted order; worksheet column = index + 3 (A=Group, B=Name). */
  columnKinds: ColumnKind[];
  rows: { rowNumber: number; groupColor: string; isSubitem: boolean }[];
  /** Status / single-select dropdown fills. colIndex is 1-based worksheet column. */
  optionFills: { rowNumber: number; colIndex: number; hex: string }[];
  /** Percent cells with their numeric value (0–100); band-bucketing happens inside. */
  percentCells: { rowNumber: number; colIndex: number; value: number }[];
};
export function applyWorkbookFormatting(ws: ExcelJS.Worksheet, plan: FormatPlan): void;
```

Concretely it applies:

- **Header (row 1):** bold, white text on near-black fill (`#1A1A1D` — Monolith's `DARK_FG`),
  row height 22, thin bottom border; `ws.views = [{ state: "frozen", ySplit: 1 }]`;
  `ws.autoFilter` spanning the header.
- **Column widths (per kind):** Group 18, Name 32, text/link/email 24, date 12, status/dropdown 16,
  people 20, numbers 10, percent 12, rating 8, phone 14, checkbox 10, everything else 14.
  Fixed defaults — the board's stored pixel widths are not consulted (v1; see open questions).
- **Group cells (column A, data rows):** solid fill in `groups.color`, font color
  `pillTextColor(groupColor)`.
- **Status cells:** solid fill in the selected option's hex, font `pillTextColor(hex)`,
  horizontal alignment center.
- **Dropdown cells:** same treatment **only when exactly one option is selected**; multi-select
  cells stay unfilled text (one cell cannot honestly carry N chip colors — see open questions).
- **Subitem rows:** Name cell italic, font color `#6B7280` (muted gray), keeping the `↳ ` marker.
- **Percent columns:** `numFmt = '0"%"'` on each percent cell, plus **data bars**: for each
  percent column, up to **six `dataBar` conditional-formatting rules** — one per band actually
  present — each rule's `ref` being the space-separated list of that band's cell addresses
  (OOXML `sqref` supports discontiguous ranges). Rule config: `gradient: false` (flat, matching
  the board's bar), `showValue: true`, `cfvo: [{type:"num", value:0},{type:"num", value:100}]`,
  band hex as the (locally-typed) `color`.

### Band colors: OKLCH tokens → hex constants

Excel needs ARGB hex; the board's band colors are OKLCH CSS tokens. We freeze the light-mode
token values as hex constants in `format-workbook.ts`, with a comment pointing at
`globals.css` as the source of truth (a spreadsheet is a light-mode artifact):

| Band           | Token                                       | Hex (sRGB conversion of the OKLCH token) |
| -------------- | ------------------------------------------- | ---------------------------------------- |
| red (0–19)     | `--progress-red: oklch(0.63 0.23 25)`       | `#EA3A48`                                |
| orange (20–39) | `--progress-orange: oklch(0.7 0.18 50)`     | `#F07437`                                |
| amber (40–59)  | `--progress-amber: oklch(0.8 0.16 85)`      | `#E5A83B`                                |
| lime (60–79)   | `--progress-lime: oklch(0.78 0.17 125)`     | `#8FC15D`                                |
| green (80–99)  | `--progress-green: oklch(0.72 0.17 150)`    | `#3FAE71`                                |
| complete (100) | `--progress-complete: oklch(0.62 0.19 152)` | `#12965C`                                |

Exact hex is finalized at build time (single authoritative conversion, verified visually); the
constants live in one exported record so a future token change is a one-line edit.

### Approaches considered

1. **Single-color data bar per percent column** (Excel default blue or one green). Simplest, one
   rule per column, but loses the board's red→green at-a-glance signal — the explicit ask.
2. **Band-bucketed data bars** (chosen): six rules per percent column with discontiguous refs.
   Matches the board exactly; bounded rule count (≤ 6 × percent-column count, independent of row
   count); flat fill matches the board's bar. Slightly more code; relies on multi-range `ref`
   strings, which the OOXML spec and exceljs's pass-through `sqref` writing both allow. If a
   target Excel build proves incompatible, degrading to approach 1 is a ~10-line change and the
   plan's verification step checks this in real Excel/LibreOffice output.
3. **`colorScale` conditional formatting instead of data bars.** Continuous red→green fills, no
   bars — but the user explicitly asked for "percentage bars", and color-scale fills read as
   heatmap, not progress. Rejected.

### Error handling

- Formatting is best-effort per cell: malformed settings/colors (unparseable hex) fall back to
  no fill; `pillTextColor` already defaults safely. The formatting pass never throws the export
  (guard each stage the same way `cellToText` guards — bad data degrades to today's unformatted
  output, never a failed download).
- CSV path bypasses the formatting pass entirely.

### Security / tenancy

No new reads, no new inputs, no schema change. The formatting pass is a pure transformation of
data already RLS-scoped by `getBoardPayload`. exceljs stays server-only.

## Performance & data-fetching budget (working agreement #5)

- **First paint:** zero change. `ExportMenu` is untouched (or receives no new props); no new
  client JS on the board page's critical path; exceljs remains server-only.
- **Interaction (Export click):** exactly the same **one** server-action round-trip as today.
  No new queries — the plan is derived from the already-fetched `BoardPayload` (bounded, batched,
  cached; attachments capped at 200; people-profile read only when people cells exist). This is
  an on-demand mutation-free action, not an in-page view toggle, so RSC-nav rules don't apply.
- **Server CPU/memory:** the formatting pass is O(rows × columns) over in-memory data — the same
  complexity class as row emission today. Conditional-formatting rules are bounded at ≤ 6 per
  percent column (band bucketing), never per-row. Style objects add roughly 10–30% to xlsx
  buffer size for typical boards; boards are bounded by product caps (import caps at
  2 000 rows × 40 cols; export payloads are the same magnitude), so worst-case buffers stay in
  the low single-digit MB — well inside the existing base64 server-action response pattern.
- **No pagination change needed:** export reads are already bounded by `getBoardPayload`'s
  batched design; this feature adds no reads at all.

## Testing

- **Unit — `cell-codec.test.ts`:** `cellToExcelValue` returns numbers for valid
  numbers/percent, strings otherwise; malformed input degrades to `""` (never throws).
- **Unit — `format-workbook.test.ts`:** build a workbook, apply a plan, then **re-load the
  buffer with exceljs** and assert: header font/fill/freeze/autofilter; column widths; status
  cell fill + contrast font; group cell fill; subitem italic; percent `numFmt`; and
  `ws.conditionalFormattings`-parsed data-bar rules (count, cfvo, refs, band color).
- **Round-trip — `export-workbook.test.ts`:** export a formatted board → `parseWorkbook` →
  `detectColumns` → assert headers, percent detected as percent with original values, status
  labels intact, subtask marker preserved. This pins the hard requirement that formatting never
  breaks import.
- **Existing tests stay green** (cellToText behavior unchanged; CSV byte-compatible except
  numeric cells now serializing from numbers, asserted equal).
- Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Independent units (for the plan's DAG)

1. **Typed cell values** (`cell-codec.ts`) — no dependency on formatting.
2. **Formatting module** (`format-workbook.ts` — constants, static styles, plan applier) — no
   dependency on typed values.
3. **Data-bar rules** (inside the formatting module) — needs 1 (numeric percents) and 2 (module).
4. **Integration** (`export-workbook.ts` plan collection + wiring, round-trip tests) — needs 1–3.

## Out of scope

- CSV styling (format carries none).
- Exporting board pixel column widths, fonts, or themes.
- Excel-side native percent format (`0.00%` over `0..1` values) — breaks round-trip.
- Per-chip multi-color rendering for multi-select dropdown cells.
- Import-side reading of colors/formatting back into board settings.
- People/relation/mirror/files/time-tracking cell enrichment (still v1 text/blank).

## Open questions for review

1. **Multi-select dropdown fill:** v1 fills only single-selection cells. Alternative: always fill
   with the first selected option's color. Which reads more honestly to users?
2. **Header aesthetic:** near-black fill + white text (chosen, Monday-style, unambiguous
   "formatted") vs. light gray fill + dark text (closer to Monolith light mode). Cheap to flip.
3. **Column widths:** fixed per-kind defaults (chosen) vs. mapping the board's stored per-column
   pixel widths (`columns.width`, `boards.name_column_width`) at ~7 px/char. Defaults are
   predictable; stored widths are more "my board". Could be a fast follow.
4. **Group cell fill intensity:** full group color (chosen — matches the board's group header)
   vs. a light tint of it for a quieter sheet.
5. **Band-bucketed data bars in old Excel builds:** discontiguous `sqref` refs are spec-legal and
   verified in current Excel/LibreOffice during build; if a user reports an ancient-client issue,
   the agreed fallback is one single-color (`--progress-green`) data-bar rule per column.
