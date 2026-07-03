# Currency column type — design spec

- **Date:** 2026-07-03
- **Source:** MVP Final Features item 1 (`docs/superpowers/plans/2026-07-03-mvp-final-features.md`),
  from user feedback F1 "Currency Column" — _"We need a feature that has selection for different
  currencies."_
- **Status:** approved for planning (solo brainstorming run; open product questions listed at the
  end rather than blocking)

## 1. What we're building

A new board column kind, **`currency`**, for money values. Each currency column has a
**per-column currency** (ISO 4217 code, e.g. `USD`, `EUR`, `KWD`) chosen by the user; cells hold
plain numeric amounts and render formatted with the column's currency symbol, grouping, and the
currency's correct decimal count (JPY → 0, USD → 2, KWD → 3). It plugs into the existing
column-kind registry exactly like `numbers`/`percent` did: same add-column menu, same inline cell
editor pattern, same footer aggregation, same collapsed-parent rollup.

Two owner-flagged headline requirements (not nice-to-haves):

1. **Quick selection** — _"I should be able to very quickly select different types of
   currencies."_ Switching a column's currency is a first-class acceptance criterion, not a
   settings afterthought: search-first picker, GCC + majors surfaced up front, recents remembered,
   instant apply on select. Acceptance criteria in §5.2.
2. **New UAE dirham sign** — AED amounts display the new Emirati dirham sign (capital D crossed by
   two horizontal lines, **U+20C3 UAE DIRHAM SIGN**). The code point is not in any _released_
   Unicode version today (accepted by the UTC in July 2025; ships in Unicode 18.0, September
   2026), so system fonts and `Intl` cannot render it yet — we present it with a bundled glyph in
   surfaces we render ourselves, with graceful fallback to "AED" everywhere else. Design in §5.4.

### Non-goals (MVP)

- No FX conversion or exchange rates.
- No per-cell currency (see §2 decision).
- No custom format overrides (symbol position, custom separators) — locale-default `Intl`
  formatting only.
- No formatted currency cells in the Excel export beyond raw numbers (item 3, "Formatted Excel
  export", owns export styling; this spec keeps export raw-numeric and structurally correct).

## 2. Core decision: fixed currency per column (not per cell)

**Decision: the currency is a column setting; every cell in the column shares it.**

| Option                            | Verdict   | Why                                                                                                                                                                                                                                  |
| --------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. Per-column currency**        | ✅ chosen | Cells stay pure numbers → `sum`/`avg` are always well-defined, which the upcoming **summary row** (MVP item 2) requires. Matches Monday/Notion semantics. One selector, zero per-cell friction.                                      |
| B. Per-cell currency              | ❌        | A column mixing USD and EUR cannot be summed without FX rates (explicitly out of scope). Aggregation would silently produce nonsense or need "mixed" states everywhere (footer, rollup, dashboards). Editor gains a picker per cell. |
| C. Column default + cell override | ❌        | All of B's aggregation problems, plus two sources of truth. YAGNI for the feedback as written ("selection for different currencies" is satisfied by choosing per column).                                                            |

Consequence for the summary row (item 2): a currency column aggregates as a plain numeric column
whose formatted output carries the column's currency code. Mixed currencies **within one column
cannot occur by construction** — item 2 only needs to format `sum/avg/min/max` with
`formatCurrency(value, column.settings.currency)`. Cross-column totals (e.g. summing a USD column
and a EUR column into one number) remain undefined and out of scope.

## 3. Data model

### 3.1 Enum migration (the only schema change)

`supabase/migrations/20260703??????_currency_enum.sql` — enum-only, mirroring
`20260623000000_percent_enum.sql`:

```sql
-- MVP Final item 1: add the currency (money) column kind.
-- Enum-only migration: ALTER TYPE ... ADD VALUE must commit before any later
-- statement references the new value. Mirrors percent/relation/mirror.
-- Currency cells store { "amount": <number> } jsonb; the ISO 4217 code lives
-- in columns.settings ({ "currency": "USD" }) — fixed per column so sums are
-- always single-currency (summary-row item 2 depends on this).
alter type public.column_kind add value if not exists 'currency';
```

No new tables, columns, indexes, or RLS: cells reuse `cell_values` (already unique on
`item_id, column_id` and org-scoped by existing RLS), settings reuse `columns.settings` jsonb.
The user applies the migration to cloud dev manually (agent DDL is classifier-blocked), then
`pnpm db:types` regenerates `src/types/database.types.ts`, which flows `"currency"` into
`ColumnKind` and forces every exhaustive kind-switch to handle it (typecheck is the safety net).

### 3.2 Cell value shape

```ts
// src/lib/validations/boards.ts
export const currencyValueSchema = z.object({
  amount: z.number().finite(),
});
```

- **Plain decimal amount** (e.g. `1234.5`), not integer minor units. Rationale: consistent with
  the `numbers` kind (`{ n }`), direct spreadsheet import/export, and jsonb round-trips it
  losslessly. Float64 is exact for sums well past any realistic board total; display rounding to
  the currency's minor units absorbs representation noise.
- The **editor rounds to the currency's minor-unit count at commit** (`roundToCurrency`), so
  stored values never carry sub-minor-unit precision. The Zod schema stays settings-agnostic
  (schemas are selected by kind only, matching the existing `cellValueSchema(kind)` contract).
- Empty = no `cell_values` row (clearing deletes the row), like every other kind.

### 3.3 Column settings shape

```ts
// src/lib/validations/boards.ts — stored snake_case in columns.settings jsonb
export const currencySettingsSchema = baseColumnSettingsSchema.extend({
  currency: currencyCodeSchema, // z.enum(CURRENCY_CODES) — required
  // AED only: render the new U+20C3 dirham sign glyph (§5.4). Absent = true.
  dirham_sign: z.boolean().optional(),
});
```

- `currency` is **required** (default column settings seed `{ currency: "USD" }`, see §5.1), and
  validated against a **curated code list** rather than a free string —
  `Intl.NumberFormat` throws on unknown codes, so the enum guard is the safety boundary.
- `dirham_sign` is a **per-column display choice, defaulting ON** when absent — it only affects
  AED presentation (§5.4) and is ignored for every other code.
- Extends `baseColumnSettingsSchema` so the column can carry `summary_aggregation` (6d-3) like
  every other kind. Non-strict extend, matching the existing kind-specific schemas
  (`numbersSettingsSchema`, `relationSettingsSchema`) — only `emptySettingsSchema` is `.strict()`.

### 3.4 Currency catalogue + formatting helper (new module)

`src/lib/boards/currency.ts` — pure, client+server safe (no `server-only`):

```ts
export const CURRENCY_CODES = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CHF",
  "CAD",
  "AUD",
  "NZD",
  "KWD",
  "AED",
  "SAR",
  "QAR",
  "BHD",
  "OMR",
  "EGP",
  "JOD",
  "INR",
  "PKR",
  "CNY",
  "HKD",
  "SGD",
  "KRW",
  "THB",
  "MYR",
  "IDR",
  "PHP",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "TRY",
  "BRL",
  "MXN",
  "ARS",
  "CLP",
  "COP",
  "ZAR",
  "NGN",
  "KES",
  "MAD",
  "ILS",
] as const; // ~44 codes: majors + full GCC (the user base) + common regionals

export type CurrencyCode = (typeof CURRENCY_CODES)[number];
export const currencyCodeSchema = z.enum(CURRENCY_CODES);

/** Pinned "Common" picker group: GCC + majors, most-relevant-first (§5.2). */
export const COMMON_CURRENCY_CODES = [
  "AED",
  "KWD",
  "SAR",
  "QAR",
  "BHD",
  "OMR",
  "USD",
  "EUR",
  "GBP",
] as const satisfies readonly CurrencyCode[];

/** "USD 1,234.50" → "$1,234.50" (viewer-locale via Intl; cached formatters). */
export function formatCurrency(amount: number, code: CurrencyCode): string;
/** formatToParts variant so renderers can swap the symbol part (§5.4). */
export function formatCurrencyParts(
  amount: number,
  code: CurrencyCode,
): Intl.NumberFormatPart[];
/** Minor-unit decimals for a code (USD→2, JPY→0, KWD→3) via Intl resolvedOptions. */
export function currencyDecimals(code: CurrencyCode): number;
/** Round an entered amount to the code's minor units (commit-time normalization). */
export function roundToCurrency(amount: number, code: CurrencyCode): number;
/** Human label for the picker, e.g. "USD — US Dollar" via Intl.DisplayNames. */
export function currencyLabel(code: CurrencyCode): string;
/** AED + dirham_sign !== false → show the U+20C3 glyph (§5.4). */
export function dirhamSignEnabled(settings: unknown): boolean;
```

`Intl.NumberFormat`/`Intl.DisplayNames` supply the symbol, grouping, decimals, and display name —
no hand-maintained symbol/decimals table. Formatters are memoized per code (a `Map`), since cells
render in a virtualized hot path. A defensive fallback (`code + amount.toFixed(2)`) guards a
malformed stored code so a bad row can never crash a board render.

## 4. Registry integration (the kind-switch checklist)

Adding `'currency'` to `ColumnKind` breaks every exhaustive switch until handled — that is the
designed guardrail. Complete inventory of touchpoints (verified against the current tree):

| Surface                     | File                                                                                                        | Behavior for `currency`                                                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kind meta (menu label/icon) | `src/lib/boards/column-kinds.ts`                                                                            | `{ label: "Currency", Icon: Banknote, hasOptions: false }`; append to `COLUMN_KIND_ORDER` after `percent`                                                                                      |
| Default name + settings     | `src/lib/boards/column-defaults.ts`                                                                         | name `"Currency"`, settings `{ currency: "USD" }`                                                                                                                                              |
| Settings schema switch      | `src/lib/validations/boards.ts` `columnSettingsSchema`                                                      | `currencySettingsSchema`                                                                                                                                                                       |
| Cell value schema switch    | `src/lib/validations/boards.ts` `cellValueSchema`                                                           | `currencyValueSchema`                                                                                                                                                                          |
| Cell renderer               | `src/components/boards/cells/index.tsx` (`CurrencyCell` + `CellRenderer` case)                              | formatted amount, `text-sm tabular-nums`, blank when null                                                                                                                                      |
| Inline editor               | `src/components/boards/cells/editors/index.tsx` (`CurrencyEditor` + `CellEditor` case)                      | numeric input, code prefix, Enter/blur commit, empty→clear, NaN→cancel, `roundToCurrency` on commit                                                                                            |
| Column settings UI          | `src/components/boards/ColumnHeader.tsx` + new `CurrencyDialog` + `BoardTable.tsx` wiring                   | "Change currency" menu item (currency kind only) → searchable dialog → `updateColumnSettings`                                                                                                  |
| Footer aggregation          | `src/lib/boards/aggregation.ts`                                                                             | `allowedAggregations`: `["sum","avg","min","max", ...COUNT_FAMILY]`; `numericValues` reads `amount`; `isFilled`/`identitiesOf` cases; `AggregateResult` number style gains `"currency"` + code |
| Footer rendering            | `src/components/boards/FooterCell.tsx`                                                                      | `FooterValue` formats `style: "currency"` via `formatCurrency`; `FooterCell` threads the column's code                                                                                         |
| Parent rollup               | `src/lib/boards/rollup.ts` + `src/components/boards/RollupCell.tsx`                                         | collapsed parent shows the **sum** of subitem amounts (money sums; contrast percent, which averages), rendered formatted                                                                       |
| Kanban card                 | `src/lib/boards/kanban-card.ts` (`META_KINDS`, `isCardCellEmpty`) + `src/components/boards/KanbanBoard.tsx` | meta-footer field, formatted                                                                                                                                                                   |
| Spreadsheet codec           | `src/lib/boards/spreadsheet/types.ts` (`ImportableKind`) + `cell-codec.ts`                                  | export `String(amount)` (raw, Excel-friendly); import parses like numbers after stripping `[^0-9.,-]` (symbols/grouping), imported columns default to USD                                      |
| Activity feed               | `src/lib/collaboration/activity.ts`                                                                         | describe values as `String(amount)` (mirrors numbers; formatting-free — the feed is plain text)                                                                                                |
| AI board snapshot           | `src/lib/ai/board-snapshot.ts`                                                                              | mirror the numbers case (numeric scalar)                                                                                                                                                       |
| Dashboards                  | `src/lib/dashboards/list-rows.ts`, `filter-meta.ts`                                                         | mirror the numbers handling (numeric filter/display semantics)                                                                                                                                 |
| Templates                   | `src/lib/boards/templates.ts` / `template-payload.ts`                                                       | no template currently emits a currency column; only satisfy any exhaustive typing — no behavior change                                                                                         |
| AED symbol presentation     | new `src/components/boards/CurrencyAmount.tsx` (+ `DirhamSign` inline SVG)                                  | U+20C3 glyph swap in the renderers we control (cell, editor prefix, footer, rollup, kanban, dialog); plain-text contexts keep "AED" (§5.4)                                                     |

Server actions need **zero changes**: `createColumn`, `upsertCell`, and `updateColumnSettings`
already dispatch through `columnSettingsSchema(kind)` / `cellValueSchema(kind)`
(`src/lib/boards/actions.ts:782` validates settings server-side against the kind's shape).

## 5. UX design (pulse-ui conventions)

Monochrome chrome throughout — a currency cell is data, not a label, so **no color anywhere** in
this feature; amounts render in `text-foreground`/`text-sm tabular-nums` like `numbers`.
Negative amounts use the locale's minus formatting, not `text-destructive` (color is earned;
red-negative is a rejected embellishment — see open questions).

### 5.1 Adding a currency column

Pick **Currency** (lucide `Banknote` icon) from the existing Add-column menu → the column is
created **immediately** with `{ currency: "USD" }`, zero extra dialogs (mirrors how
status/dropdown seed usable defaults; contrast relation/mirror, which block on a config dialog
only because they cannot function without a target). Changing the currency is one click away.

### 5.2 Changing the column's currency — quick selection is the acceptance bar

`ColumnHeader` dropdown gains a **"Change currency"** item, shown only for `currency` columns
(same gating pattern as "Edit labels" via `hasOptions`; implemented as a kind check + a new
optional `onEditCurrency` callback owned by `BoardTable`, mirroring `onEditOptions`). It opens a
small shadcn `Dialog` (`CurrencyDialog`, sibling of `ColumnOptionsDialog`) containing a
`Command` searchable list rendered as `currencyLabel(code)` (e.g. "KWD — Kuwaiti Dinar"),
current selection marked. Choosing a code merges `{ ...settings, currency: code }` (preserving
`summary_aggregation` and `dirham_sign`) through the existing `updateColumnSettings` mutation.
Existing amounts are **not converted** — the same numbers re-render under the new currency
(documented in the dialog with one muted caption line: "Amounts are not converted.").

**Picker speed/ergonomics acceptance criteria** (headline requirement #1 — each is testable):

1. **Search-first:** the `CommandInput` is autofocused on open; matching is fuzzy over
   `"CODE — Display Name"` so `kwd`, `kuwait`, and `dinar` all hit KWD. Keyboard path is
   menu → type → `Enter` — **switching currency takes ≤ 2 interactions after the dialog opens**
   (type-to-filter + Enter, or one click on a visible group entry).
2. **Common group pinned first:** a `Common` `CommandGroup` (`COMMON_CURRENCY_CODES`: AED, KWD,
   SAR, QAR, BHD, OMR, USD, EUR, GBP — GCC prominent for the user base) renders above the full
   `All currencies` group, so the likely picks are visible with zero typing.
3. **Recents:** the last 3 codes the user picked (any column) render in a `Recent` group above
   `Common`. Stored client-side in `localStorage` (`pulse.currency.recent`) — per-device, no
   schema, no server read/write; silently absent when `localStorage` is unavailable.
4. **Instant apply:** selecting a code applies immediately — no Save/confirm button, dialog
   closes on select, cells re-render optimistically. Exactly **one** server round-trip (the
   `updateColumnSettings` action); opening/searching/browsing the picker performs **zero**.
5. Keyboard reachable end-to-end, `focus-visible:ring-2`, coarse-pointer targets per existing
   editor patterns.

### 5.3 Cell display + inline editor

- **Display:** `formatCurrency(amount, code)` — e.g. `$1,234.50`, `KD 1,234.500`, `¥1,235` —
  truncating, right-aligned is **not** introduced (numbers cells are left-aligned today;
  consistency beats convention here, alignment is a board-wide decision out of scope).
- **Editor:** clones `NumbersEditor` ergonomics exactly (autofocus `Input type="number"`, Enter
  commits, Escape cancels, blur commits, empty string clears the cell, non-number cancels) inside
  an `InputGroup`-style wrapper with a muted currency-code prefix (`USD`) so the unit is visible
  while typing. Commit sends `{ amount: roundToCurrency(n, code) }`.
- **Footer:** the summary picker offers Sum/Average/Min/Max plus the count family; numeric
  results render formatted (`Sum $12,340.00`).
- **Collapsed parent rollup:** sum of subitem amounts, formatted.

### 5.4 New UAE dirham sign (U+20C3) presentation

**Verified facts driving the design:** the Emirati dirham sign (a capital **D crossed by two
horizontal lines**) was accepted by the Unicode Technical Committee in **July 2025** as
**U+20C3 UAE DIRHAM SIGN** and ships in **Unicode 18.0 (September 2026)**. As of today
(July 2026) it is **not in any released Unicode version**, so no system font contains the glyph
and `Intl.NumberFormat` still yields `"AED"` / `"د.إ"` for AED. OS font support will lag well
past September 2026. Therefore the character cannot be emitted as text — **the symbol
presentation must be custom while number formatting stays with `Intl`.**

**Design:**

- **`formatCurrencyParts(amount, code)`** (`Intl.NumberFormat.formatToParts`) exposes the
  formatted number as parts. A small client component **`CurrencyAmount`**
  (`src/components/boards/CurrencyAmount.tsx`) renders the parts verbatim, except: when
  `code === "AED"` and `dirhamSignEnabled(settings)`, the `currency` part is replaced by a
  **`DirhamSign`** glyph — an **inline SVG** drawn by us (capital D + two crossbars),
  `1em`-sized, `fill="currentColor"` so it inherits text color/weight in light + dark,
  `role="img"` + `aria-label="AED"` so screen readers and copy/paste degrade to the code.
- **Glyph source:** evaluate the open-source **"dirham" webfont package** (license check first)
  vs **drawing our own SVG**. Default decision: **own inline SVG** — a single static path, no
  font pipeline, no external dependency or license exposure, trivially theme-aware via
  `currentColor`; revisit the webfont only if the hand-drawn glyph proves visually insufficient
  next to Geist. (Recorded as a task step, not an open question — the fallback order is decided.)
- **Where the glyph appears:** exactly the surfaces whose rendering we control — `CurrencyCell`,
  the `CurrencyEditor` prefix, `FooterValue`, `RollupCell`, kanban card meta (via `CurrencyCell`),
  and the picker labels in `CurrencyDialog`. All of these route through `CurrencyAmount`.
- **Graceful fallback to "AED"** wherever we do not control the font or the medium is plain
  text: Excel/CSV export (`cell-codec`), clipboard/copy text, activity feed, AI board snapshot,
  email/digest text, and any `formatCurrency` string consumer. `formatCurrency("…","AED")`
  keeps returning Intl's string output unchanged — only the React presentation layer swaps the
  symbol.
- **Scope of the choice:** per-column setting `dirham_sign?: boolean` (§3.3), **default ON** for
  AED (absent = enabled), toggleable via a small switch row inside `CurrencyDialog` that appears
  only when AED is the current/selected code. No app-level setting for MVP — the column setting
  is strictly more granular and the default covers the intent.
- **Forward path:** once U+20C3 lands in shipped fonts (post-Unicode 18.0), swapping
  `DirhamSign` for the real character is a one-component change (open question §9.6).

## 6. Performance & data-fetching budget (working agreement #5)

- **First paint:** currency columns/cells arrive inside the existing board payload (columns +
  bounded, virtualized `cell_values` read) — **0 additional queries**, no new tables, no new
  indexes needed (`cell_values` is already keyed/unique on `(item_id, column_id)` and read
  through the existing bounded board query).
- **In-page interactions = 0 new server round-trips:** formatting (`Intl`), the currency picker
  list (static const), the `Recent` group (`localStorage`, client-only), footer aggregation, and
  parent rollups are all pure client computation over already-loaded data. Opening the currency
  dialog fetches nothing; the `DirhamSign` glyph is an inline SVG in the bundle — **no font or
  asset fetch**, ever.
- **Server data changes → one Server Action each** (the sanctioned path): editing a cell =
  existing `upsertCell`; changing the column currency = existing `updateColumnSettings` (+
  targeted `revalidatePath` already in place); both ride the existing optimistic-mutation hooks
  in `use-board-mutations.ts`. No RSC navigation is introduced anywhere (gotcha-09).
- **Bounded reads:** unchanged — this feature adds no reads.

## 7. Testing (working agreement #4)

Vitest, colocated like the existing suites (`column-kinds.test.ts`, `aggregation.test.ts`,
`cells.test.tsx`):

1. **`currency.test.ts` (new):** `formatCurrency` symbol/decimals across USD/JPY/KWD;
   `currencyDecimals`; `roundToCurrency` (2/0/3-decimal rounding, negative amounts); fallback on
   a bad code never throws.
2. **`boards.test.ts` (validations):** `currencyValueSchema` accepts finite amounts, rejects
   `NaN`/`Infinity`/strings/extra keys; `currencySettingsSchema` requires a known code, accepts
   `summary_aggregation`, rejects unknown keys.
3. **`aggregation.test.ts`:** sum/avg/min/max over amount values; `isFilled`; currency style
   propagation into `AggregateResult`.
4. **`rollup.test.ts`:** currency parent rollup sums (not averages) and blanks on empty.
5. **`cells.test.tsx` / editor tests:** `CurrencyCell` renders formatted + blank-on-null;
   `CurrencyEditor` commit/clear/cancel/rounding behavior.
6. **`cell-codec.test.ts`:** export `String(amount)`; import parses `"$1,234.50"` → `1234.5`,
   garbage → null.
7. **`kanban-card.test.ts`, `column-kinds.test.ts`, `AddColumnMenu.test.tsx`:** registry
   completeness (every `ColumnKind` has meta; currency appears in the menu; card meta/empty
   checks).
8. **`CurrencyDialog.test.tsx` (picker ergonomics, §5.2):** search by code, country word, and
   currency-name word all match; `Common` group renders GCC + majors with zero typing; selecting
   fires exactly one `onSave` with merged settings; a pick is appended to
   `localStorage["pulse.currency.recent"]` and re-renders in `Recent` next open.
9. **`CurrencyAmount.test.tsx` (dirham sign, §5.4):** AED + default settings renders the
   `DirhamSign` SVG (with `aria-label="AED"`) and the Intl-formatted digits; `dirham_sign: false`
   renders Intl's plain output; non-AED codes never render the glyph; `formatCurrency` string
   output is unchanged for AED (fallback contexts).

## 8. Independent units (for the plan's DAG)

- **U1 — DB enum + regenerated types** (migration; user-applied; `pnpm db:types`).
- **U2 — currency lib** (`src/lib/boards/currency.ts`) — pure, no dependency on U1.
- **U3 — validations + registry** (schemas, kind meta, defaults) — needs U1 (type) + U2 (codes).
- **U4 — cell renderer + editor** — needs U2/U3.
- **U5 — aggregation + footer + rollup** — needs U2/U3; independent of U4.
- **U6 — currency settings dialog + header/table wiring** (incl. §5.2 picker ergonomics:
  groups, recents, instant apply) — needs U3 (+U2 for labels).
- **U7 — peripheral switches** (kanban, codec/import, activity, AI snapshot, dashboards,
  templates typing) — needs U3; independent of U4/U5/U6.
- **U8 — AED dirham sign presentation** (`DirhamSign` SVG + `CurrencyAmount` parts renderer +
  call-site swaps + dialog toggle) — needs U4/U5/U6 (it re-skins their render paths); the last
  unit before the gates.
- Note: after U1's types regenerate, `pnpm typecheck` stays red until U3–U7 cover every
  exhaustive switch — all units land on one `task/currency-column` branch before the gates run.

## 9. Open questions for review

1. **Org-level default currency:** new columns seed `USD`. Should organizations get a default
   currency setting (e.g. KWD for the primary user) that seeds new currency columns instead?
   Deferred — one-click change makes the default cheap, and an org setting is a separate surface.
2. **Full ISO 4217 list vs curated ~44:** curated list chosen (guards `Intl` throws, keeps the
   picker scannable). Expanding is a one-array change if a user requests a missing code.
3. **Negative amounts in red:** rejected for now (pulse-ui: color is earned, monochrome data
   surfaces; accounting-style red/parentheses can ship later behind a column setting if asked).
4. **Per-cell currency / FX:** rejected for MVP (see §2). If real multi-currency demand appears,
   the escape hatch is FX-rate-aware _display_ conversion at the board level, not per-cell codes.
5. **Excel export formatting:** raw numbers here; applying a currency number format
   (`#,##0.00 "USD"`) belongs to item 3 (formatted export), which should read
   `columns.settings.currency` when it lands — flagged as a consumes-edge for that task. Note:
   the export writes `"AED"`, never the U+20C3 glyph (§5.4 fallback rule), until spreadsheet
   fonts catch up.
6. **U+20C3 native migration:** once Unicode 18.0 fonts ship broadly (2027+?), replace the
   `DirhamSign` SVG with the literal character (one-component change) and let `Intl` take over
   if/when CLDR adopts the sign as AED's symbol. No action now; revisit when OS coverage is real.
