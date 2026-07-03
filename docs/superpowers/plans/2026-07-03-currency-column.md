# Currency Column Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `currency` board column kind — money amounts with a per-column ISO 4217 currency selector, formatted via `Intl`, aggregatable (sum/avg/min/max) so the upcoming summary-row feature can consume it.

**Architecture:** One enum-only migration adds `'currency'` to `public.column_kind`; regenerated types flow the new kind into `ColumnKind`, and TypeScript's exhaustive kind-switches enumerate every integration point. Cells store `{ amount: number }` in `cell_values.value` jsonb; the currency code lives in `columns.settings` (`{ currency: "USD" }`) — fixed per column so sums are always single-currency. A new pure module `src/lib/boards/currency.ts` owns the code catalogue and `Intl`-based formatting. No server-action changes: `createColumn`/`upsertCell`/`updateColumnSettings` already validate through `columnSettingsSchema(kind)` / `cellValueSchema(kind)`.

**Tech Stack:** Next.js 16 (App Router) + Supabase (Postgres enum, jsonb), Zod 4, React 19, shadcn/ui (`Dialog`, `Command`, `Input`, `DropdownMenu`), `Intl.NumberFormat`/`Intl.DisplayNames`, Vitest + Testing Library, lucide-react (`Banknote`).

**Spec:** `docs/superpowers/specs/2026-07-03-currency-column-design.md`

## Global Constraints

- Work happens in the worktree `.claude/worktrees/currency-column` on branch `task/currency-column`; all paths below are worktree-relative.
- **Migrations are applied to cloud dev manually by the user** (agent DDL/`db push` is classifier-blocked — see memory note "migration apply blocked by classifier"). Task 1 has a hard user checkpoint before `pnpm db:types`.
- Commit subjects: lowercase after `type(scope):` (commitlint); every commit needs a descriptive body and must end with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Stage explicitly by path — never `git add -A`.
- Monochrome UI (pulse-ui): amounts render `text-sm tabular-nums` in foreground/muted tokens; **no color** for currency data (negatives are not red).
- `Intl.NumberFormat` throws on unknown codes → every formatting entry point goes through the curated `CURRENCY_CODES` guard with a non-throwing fallback.
- After Task 1 regenerates types, `pnpm typecheck` is **expected to fail** until Tasks 3–6 cover the exhaustive switches (`columnSettingsSchema`, `cellValueSchema`, `allowedAggregations`, `isFilled`, `rollupCell`, `COLUMN_KIND_META`, `DEFAULT_NAME`). Run per-file tests in between; the full gate is Task 9.
- In-page interactions stay 0 server round-trips: formatting, picker list, footer aggregation, and rollups are pure client computation; the only server calls are the existing `upsertCell` and `updateColumnSettings` Server Actions (perf budget, spec §6).

---

## Execution DAG (working agreement #6)

**Dependency graph** (synthesized from the per-task Interfaces blocks):

- Task 1 (migration + types) — no deps (user checkpoint inside)
- Task 2 (currency lib) — no deps
- Task 3 (validation schemas) — depends on **1** (`ColumnKind` includes `"currency"`) and **2** (`currencyCodeSchema`)
- Task 4 (kind registry + defaults) — depends on **3** (compiling `ColumnKind` records)
- Task 5 (cell renderer + inline editor) — depends on **2**, **3**
- Task 6 (aggregation + rollup + footer) — depends on **2**, **3**
- Task 7 (currency settings dialog + header/table wiring) — depends on **4** (menu meta), **6** (both edit `BoardTable.tsx`; 6 first avoids conflicts)
- Task 8 (peripheral kind-switches: kanban, spreadsheet codec, activity, AI snapshot, dashboards) — depends on **2**, **3**
- Task 9 (full gates + finish) — depends on **all**

**Parallel batches** (tasks inside a batch touch disjoint files and can be dispatched concurrently; all share the one `task/currency-column` worktree, so only file-disjoint tasks may run in the same wave):

| Batch | Tasks      | Notes                                                                                       |
| ----- | ---------- | ------------------------------------------------------------------------------------------- |
| A     | 1, 2       | disjoint (SQL/types vs. new lib module); 1 contains the user checkpoint                     |
| B     | 3          | the schema hub every later task consumes                                                    |
| C     | 4, 5, 6, 8 | pairwise file-disjoint (registry / cells+editors / aggregation+footer+rollup / peripherals) |
| D     | 7          | serialized after 6 (both touch `BoardTable.tsx`), after 4 (menu meta)                       |
| E     | 9          | gates + merge                                                                               |

**Critical path:** 1 → 3 → 6 → 7 → 9 (5 tasks). Task 1's user checkpoint (manual migration apply) is the only human-blocking step — dispatch Batch A first so the wait overlaps Task 2.

---

### Task 1: `currency` enum migration + regenerated types

**Files:**

- Create: `supabase/migrations/20260703090000_currency_enum.sql`
- Regenerate: `src/types/database.types.ts` (via `pnpm db:types` — **never hand-edit**)

**Interfaces:**

- Consumes: nothing (first task).
- Produces: Postgres enum value `currency` on `public.column_kind`; `Database["public"]["Enums"]["column_kind"]` union includes `"currency"`, so `ColumnKind` (in `src/lib/validations/boards.ts:4`) includes it — this is what makes Tasks 3–6's exhaustive switches compile-enforced.

- [ ] **Step 1: Write the migration**

```sql
-- MVP Final item 1: add the currency (money) column kind.
-- Enum-only migration: ALTER TYPE ... ADD VALUE must commit before any later
-- statement references the new value (PG can't use a value added in the same
-- txn). Mirrors 20260623000000_percent_enum.sql and the relation/mirror/
-- time_tracking enum migrations.
-- Currency cells store { "amount": <number> } jsonb; the ISO 4217 code lives
-- in columns.settings ({ "currency": "USD" }) — fixed per column so sums are
-- always single-currency (the summary-row feature, MVP item 2, depends on this).
alter type public.column_kind add value if not exists 'currency';
```

- [ ] **Step 2: USER CHECKPOINT — ask the user to apply the migration to cloud dev**

Stop and tell the user: "Please apply `supabase/migrations/20260703090000_currency_enum.sql` to the cloud dev project (agent DDL is blocked). The statement is a single `alter type ... add value` — safe and idempotent." Wait for confirmation. Then verify (read-only queries are allowed):

Run (MCP): `mcp__supabase-dev__execute_sql` with `select unnest(enum_range(null::public.column_kind))::text as kind;`
Expected: rows include `currency`.

- [ ] **Step 3: Regenerate types**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` changes; verify with:

Run: `grep -n '"currency"' src/types/database.types.ts`
Expected: two hits (the `column_kind` union near line 2611 and the `Constants` array near line 2787).

Note: `pnpm typecheck` now fails on the exhaustive switches — expected until Tasks 3–6 land (see Global Constraints).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260703090000_currency_enum.sql src/types/database.types.ts
git commit -m "feat(boards): add currency column_kind enum value

Enum-only migration (mirrors percent_enum) applied to cloud dev by the
user; types regenerated with pnpm db:types. Currency cells will store
{ amount } jsonb with the ISO 4217 code fixed per column in settings.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: currency catalogue + formatting lib

**Files:**

- Create: `src/lib/boards/currency.ts`
- Test: `src/lib/boards/currency.test.ts`

**Interfaces:**

- Consumes: nothing (pure module; only `zod`).
- Produces (exact, used by Tasks 3–8):
  - `CURRENCY_CODES: readonly string[]` (44-entry `as const` tuple)
  - `type CurrencyCode = (typeof CURRENCY_CODES)[number]`
  - `currencyCodeSchema: z.ZodEnum` (over `CURRENCY_CODES`)
  - `isCurrencyCode(code: unknown): code is CurrencyCode`
  - `formatCurrency(amount: number, code: string): string` — never throws; unknown code falls back to `` `${code} ${amount.toFixed(2)}` ``
  - `currencyDecimals(code: CurrencyCode): number` (USD→2, JPY→0, KWD→3)
  - `roundToCurrency(amount: number, code: CurrencyCode): number`
  - `currencyLabel(code: CurrencyCode): string` (e.g. `"KWD — Kuwaiti Dinar"`)
  - `currencyOf(settings: unknown): CurrencyCode` (reads `settings.currency`, USD fallback)

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/boards/currency.test.ts
import { describe, expect, it } from "vitest";
import {
  CURRENCY_CODES,
  currencyDecimals,
  currencyLabel,
  currencyOf,
  formatCurrency,
  isCurrencyCode,
  roundToCurrency,
} from "@/lib/boards/currency";

describe("currencyDecimals", () => {
  it("knows minor units per code", () => {
    expect(currencyDecimals("USD")).toBe(2);
    expect(currencyDecimals("JPY")).toBe(0);
    expect(currencyDecimals("KWD")).toBe(3);
  });
});

describe("roundToCurrency", () => {
  it("rounds to the code's minor units", () => {
    expect(roundToCurrency(10.126, "USD")).toBe(10.13);
    expect(roundToCurrency(100.5, "JPY")).toBe(101);
    expect(roundToCurrency(1.23456, "KWD")).toBe(1.235);
    expect(roundToCurrency(-2.005, "JPY")).toBe(-2);
  });
});

describe("formatCurrency", () => {
  it("matches Intl currency-style output for known codes", () => {
    const oracle = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
    });
    expect(formatCurrency(1234.5, "USD")).toBe(oracle.format(1234.5));
  });
  it("never throws on an unknown code — deterministic fallback", () => {
    expect(formatCurrency(5, "ZZZ")).toBe("ZZZ 5.00");
  });
});

describe("catalogue + guards", () => {
  it("contains the majors and full GCC set", () => {
    for (const c of [
      "USD",
      "EUR",
      "GBP",
      "JPY",
      "KWD",
      "AED",
      "SAR",
      "QAR",
      "BHD",
      "OMR",
    ])
      expect(CURRENCY_CODES).toContain(c);
  });
  it("isCurrencyCode narrows correctly", () => {
    expect(isCurrencyCode("KWD")).toBe(true);
    expect(isCurrencyCode("ZZZ")).toBe(false);
    expect(isCurrencyCode(42)).toBe(false);
  });
  it("currencyLabel prefixes the code", () => {
    expect(currencyLabel("USD").startsWith("USD")).toBe(true);
  });
  it("currencyOf reads settings with a USD fallback", () => {
    expect(currencyOf({ currency: "KWD" })).toBe("KWD");
    expect(currencyOf({ currency: "nope" })).toBe("USD");
    expect(currencyOf(null)).toBe("USD");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/boards/currency.test.ts`
Expected: FAIL — cannot resolve `@/lib/boards/currency`.

- [ ] **Step 3: Implement the module**

```ts
// src/lib/boards/currency.ts
import { z } from "zod";

/**
 * Curated ISO 4217 codes offered by the currency column picker. Curated (not
 * the full ISO list) because Intl.NumberFormat throws on unknown codes — this
 * array is the validation boundary. Majors + full GCC + common regionals.
 * Extending = append here (schema, picker, and tests follow automatically).
 */
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
] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];
export const currencyCodeSchema = z.enum(CURRENCY_CODES);

export function isCurrencyCode(code: unknown): code is CurrencyCode {
  return (
    typeof code === "string" &&
    (CURRENCY_CODES as readonly string[]).includes(code)
  );
}

// Cells render in a virtualized hot path — memoize one formatter per code.
const formatters = new Map<CurrencyCode, Intl.NumberFormat>();
function formatterFor(code: CurrencyCode): Intl.NumberFormat {
  let f = formatters.get(code);
  if (!f) {
    f = new Intl.NumberFormat(undefined, { style: "currency", currency: code });
    formatters.set(code, f);
  }
  return f;
}

/**
 * Format an amount in the viewer's locale ("$1,234.50", "KD 1,234.500").
 * Accepts a plain string code so callers can pass raw jsonb settings; an
 * unknown code degrades to "CODE 12.00" instead of throwing (a malformed
 * stored row must never crash a board render).
 */
export function formatCurrency(amount: number, code: string): string {
  if (!isCurrencyCode(code)) return `${code} ${amount.toFixed(2)}`;
  return formatterFor(code).format(amount);
}

/** Minor-unit decimals for a code (USD→2, JPY→0, KWD→3) via Intl. */
export function currencyDecimals(code: CurrencyCode): number {
  return formatterFor(code).resolvedOptions().maximumFractionDigits ?? 2;
}

/** Round an entered amount to the code's minor units (commit-time normalization). */
export function roundToCurrency(amount: number, code: CurrencyCode): number {
  const factor = 10 ** currencyDecimals(code);
  return Math.round(amount * factor) / factor;
}

let displayNames: Intl.DisplayNames | null = null;
/** Picker label, e.g. "KWD — Kuwaiti Dinar". Falls back to the bare code. */
export function currencyLabel(code: CurrencyCode): string {
  try {
    displayNames ??= new Intl.DisplayNames(undefined, { type: "currency" });
    const name = displayNames.of(code);
    return name && name !== code ? `${code} — ${name}` : code;
  } catch {
    return code;
  }
}

/**
 * Read a currency column's code from its raw settings jsonb. USD fallback
 * keeps a malformed/legacy row renderable (defense in depth; the settings
 * schema requires a valid code at every write boundary).
 */
export function currencyOf(settings: unknown): CurrencyCode {
  const c = (settings as { currency?: unknown } | null)?.currency;
  return isCurrencyCode(c) ? c : "USD";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/boards/currency.test.ts`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/currency.ts src/lib/boards/currency.test.ts
git commit -m "feat(boards): currency catalogue + intl formatting lib

Pure module: curated ISO 4217 codes (majors + GCC), memoized
Intl.NumberFormat formatting with a non-throwing fallback, minor-unit
rounding, display-name labels, and a settings reader with USD fallback.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: validation schemas (settings + cell value)

**Files:**

- Modify: `src/lib/validations/boards.ts` (kind enum line 6–23; settings section ~line 71–124; cell-value section ~line 126–229)
- Test: `src/lib/validations/boards.test.ts` (append)

**Interfaces:**

- Consumes: `"currency"` in `ColumnKind` (Task 1); `currencyCodeSchema` (Task 2).
- Produces (exact, used by Tasks 4–8 and the existing server actions in `src/lib/boards/actions.ts` with zero changes there):
  - `columnKindSchema` includes `"currency"`
  - `currencySettingsSchema = baseColumnSettingsSchema.extend({ currency: currencyCodeSchema })` — non-strict extend, matching `numbersSettingsSchema`/`relationSettingsSchema`; carries optional `summary_aggregation`
  - `currencyValueSchema = z.object({ amount: z.number().finite() })`
  - `columnSettingsSchema("currency")` → `currencySettingsSchema`; `cellValueSchema("currency")` → `currencyValueSchema`

- [ ] **Step 1: Write the failing tests** (append to `src/lib/validations/boards.test.ts`, following its existing describe style)

```ts
import {
  currencySettingsSchema,
  currencyValueSchema,
  columnSettingsSchema,
  cellValueSchema,
  columnKindSchema,
} from "@/lib/validations/boards";

describe("currency column", () => {
  it("kind enum includes currency", () => {
    expect(columnKindSchema.safeParse("currency").success).toBe(true);
  });
  it("settings require a known ISO code", () => {
    expect(currencySettingsSchema.safeParse({ currency: "KWD" }).success).toBe(
      true,
    );
    expect(currencySettingsSchema.safeParse({ currency: "ZZZ" }).success).toBe(
      false,
    );
    expect(currencySettingsSchema.safeParse({}).success).toBe(false);
  });
  it("settings accept the shared summary_aggregation", () => {
    expect(
      currencySettingsSchema.safeParse({
        currency: "USD",
        summary_aggregation: "sum",
      }).success,
    ).toBe(true);
  });
  it("cell value is a finite amount", () => {
    expect(currencyValueSchema.safeParse({ amount: 1234.5 }).success).toBe(
      true,
    );
    expect(currencyValueSchema.safeParse({ amount: -20 }).success).toBe(true);
    expect(currencyValueSchema.safeParse({ amount: Infinity }).success).toBe(
      false,
    );
    expect(currencyValueSchema.safeParse({ amount: "12" }).success).toBe(false);
    expect(currencyValueSchema.safeParse({}).success).toBe(false);
  });
  it("dispatchers route the currency kind", () => {
    expect(columnSettingsSchema("currency")).toBe(currencySettingsSchema);
    expect(cellValueSchema("currency")).toBe(currencyValueSchema);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/validations/boards.test.ts`
Expected: FAIL — `currencySettingsSchema` not exported; dispatcher switches don't accept `"currency"`.

- [ ] **Step 3: Implement**

In `src/lib/validations/boards.ts`:

1. Import (top of file): `import { currencyCodeSchema } from "@/lib/boards/currency";`
2. Append `"currency"` to the `columnKindSchema` z.enum array (after `"percent"`).
3. After `numbersSettingsSchema` (~line 83) add:

```ts
// Currency column: fixed ISO 4217 code per column (never per cell) so sums
// are always single-currency — the summary-row feature depends on this.
// Stored snake_case in columns.settings jsonb, e.g. { "currency": "KWD" }.
export const currencySettingsSchema = baseColumnSettingsSchema.extend({
  currency: currencyCodeSchema,
});
```

4. In `columnSettingsSchema` add a case (before the empty-settings fallthrough group):

```ts
    case "currency":
      return currencySettingsSchema;
```

5. After `percentValueSchema` (~line 151) add:

```ts
// Currency cells store a plain decimal amount; the editor rounds to the
// column currency's minor units at commit (roundToCurrency), so stored
// values never carry sub-minor-unit precision. See spec §3.2.
export const currencyValueSchema = z.object({
  amount: z.number().finite(),
});
```

6. In `cellValueSchema` add:

```ts
    case "currency":
      return currencyValueSchema;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/validations/boards.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/boards.ts src/lib/validations/boards.test.ts
git commit -m "feat(boards): currency settings + cell value schemas

currencySettingsSchema requires a curated ISO 4217 code (per column,
never per cell); currencyValueSchema stores a finite decimal amount.
Existing createColumn/upsertCell/updateColumnSettings actions pick these
up through the columnSettingsSchema/cellValueSchema dispatchers unchanged.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: kind registry + column defaults

**Files:**

- Modify: `src/lib/boards/column-kinds.ts`
- Modify: `src/lib/boards/column-defaults.ts`
- Test: `src/lib/boards/column-kinds.test.ts`, `src/lib/boards/templates.test.ts` only if it asserts kind counts (check first), `src/components/boards/AddColumnMenu.test.tsx` (append)

**Interfaces:**

- Consumes: `ColumnKind` incl. `"currency"` (Tasks 1+3).
- Produces: `COLUMN_KIND_META.currency = { label: "Currency", Icon: Banknote, hasOptions: false }`; `COLUMN_KIND_ORDER` ends `[..., "percent", "currency"]`; `defaultColumn("currency")` → `{ name: "Currency", settings: { currency: "USD" } }`. Task 7's menu gating reads `column.kind === "currency"` directly (not `hasOptions`).

- [ ] **Step 1: Write the failing tests** (append; mirror the file's existing assertions)

```ts
// in src/lib/boards/column-kinds.test.ts
it("registers the currency kind", () => {
  expect(COLUMN_KIND_META.currency).toMatchObject({
    label: "Currency",
    hasOptions: false,
  });
  expect(COLUMN_KIND_ORDER).toContain("currency");
});
```

```ts
// in the defaultColumn suite (currently inside templates.test.ts or its own file — grep `defaultColumn(` in tests to confirm placement)
it("seeds a currency column with USD", () => {
  expect(defaultColumn("currency")).toEqual({
    name: "Currency",
    settings: { currency: "USD" },
  });
});
```

```tsx
// in src/components/boards/AddColumnMenu.test.tsx — mirror the existing "renders each kind" pattern
it("offers the currency kind", async () => {
  // ...open the menu the way the existing tests do...
  expect(await screen.findByText("Currency")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/boards/column-kinds.test.ts src/components/boards/AddColumnMenu.test.tsx`
Expected: FAIL — `COLUMN_KIND_META.currency` undefined (also a type error: the `Record<ColumnKind, KindMeta>` now misses `currency`).

- [ ] **Step 3: Implement**

In `src/lib/boards/column-kinds.ts`: add `Banknote` to the lucide-react import; add to `COLUMN_KIND_META`:

```ts
  currency: { label: "Currency", Icon: Banknote, hasOptions: false },
```

and append `"currency"` to `COLUMN_KIND_ORDER` (after `"percent"`).

In `src/lib/boards/column-defaults.ts`: add `currency: "Currency"` to `DEFAULT_NAME`, and in `defaultColumn` add before the return:

```ts
  } else if (kind === "currency") {
    // Zero-friction add: seed USD; "Change currency" in the column menu is
    // one click away (spec §5.1). Snake_case jsonb key per settings convention.
    settings = { currency: "USD" };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/boards/column-kinds.test.ts src/lib/boards/column-defaults.ts src/components/boards/AddColumnMenu.test.tsx src/lib/boards/templates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/column-kinds.ts src/lib/boards/column-defaults.ts src/lib/boards/column-kinds.test.ts src/components/boards/AddColumnMenu.test.tsx
git commit -m "feat(boards): register currency kind in menu + defaults

Currency appears in the add-column menu (Banknote icon) and new columns
seed { currency: \"USD\" } so they work immediately without a config
dialog — changing the code is a column-menu action (task 7).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: cell renderer + inline editor

**Files:**

- Modify: `src/components/boards/cells/index.tsx` (add `CurrencyCell` + `CellRenderer` case)
- Modify: `src/components/boards/cells/editors/index.tsx` (add `CurrencyEditor` + `CellEditor` case)
- Test: `src/components/boards/cells/cells.test.tsx` (append; follow its existing render-helpers)

**Interfaces:**

- Consumes: `formatCurrency`, `currencyOf`, `roundToCurrency` (Task 2); `{ amount: number }` value shape (Task 3).
- Produces: `CurrencyCell({ value: { amount: number } | null; settings: Settings })` and `CurrencyEditor(props: EditorProps<{ amount: number }>)`; both dispatched by the string-keyed `CellRenderer`/`CellEditor` switches, which `BoardTable`'s `EditableCell` already routes by `col.kind` — no `BoardTable` change needed for editing to work.

- [ ] **Step 1: Write the failing tests**

```tsx
// append to src/components/boards/cells/cells.test.tsx
describe("CurrencyCell", () => {
  const usd = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  });
  it("renders the formatted amount", () => {
    render(
      <CurrencyCell
        value={{ amount: 1234.5 }}
        settings={{ currency: "USD" }}
      />,
    );
    expect(screen.getByText(usd.format(1234.5))).toBeInTheDocument();
  });
  it("renders blank when empty or malformed", () => {
    const { container } = render(
      <CurrencyCell value={null} settings={{ currency: "USD" }} />,
    );
    expect(container.textContent).toBe("");
  });
  it("falls back to USD when settings are malformed", () => {
    render(<CurrencyCell value={{ amount: 2 }} settings={{}} />);
    expect(screen.getByText(usd.format(2))).toBeInTheDocument();
  });
});

describe("CurrencyEditor", () => {
  it("commits the rounded amount on Enter", async () => {
    const onCommit = vi.fn();
    render(
      <CurrencyEditor
        value={null}
        settings={{ currency: "USD" }}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText("Amount"), "10.126{Enter}");
    expect(onCommit).toHaveBeenCalledWith({ amount: 10.13 });
  });
  it("clears on empty commit and cancels on garbage", async () => {
    const onClear = vi.fn();
    const onCancel = vi.fn();
    const { unmount } = render(
      <CurrencyEditor
        value={{ amount: 5 }}
        settings={{ currency: "USD" }}
        onCommit={vi.fn()}
        onCancel={onCancel}
        onClear={onClear}
      />,
    );
    await userEvent.clear(screen.getByLabelText("Amount"));
    await userEvent.keyboard("{Enter}");
    expect(onClear).toHaveBeenCalled();
    unmount();
  });
  it("shows the currency code prefix", () => {
    render(
      <CurrencyEditor
        value={null}
        settings={{ currency: "KWD" }}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("KWD")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/components/boards/cells/cells.test.tsx`
Expected: FAIL — `CurrencyCell`/`CurrencyEditor` not exported.

- [ ] **Step 3: Implement the renderer** (`src/components/boards/cells/index.tsx`; import `formatCurrency, currencyOf` from `@/lib/boards/currency`)

After `PercentCell`:

```tsx
/**
 * Currency cell — the amount formatted in the column's currency (viewer
 * locale). Monochrome data surface (pulse-ui): no color, tabular numerals.
 */
export function CurrencyCell({
  value,
  settings,
}: {
  value: { amount: number } | null;
  settings: Settings;
}) {
  if (value == null || typeof value.amount !== "number")
    return <span className="text-sm" />;
  return (
    <span className="truncate text-sm tabular-nums">
      {formatCurrency(value.amount, currencyOf(settings))}
    </span>
  );
}
```

In `CellRenderer`'s switch (after `case "percent"`):

```tsx
    case "currency":
      return (
        <CurrencyCell
          value={value as { amount: number } | null}
          settings={settings}
        />
      );
```

- [ ] **Step 4: Implement the editor** (`src/components/boards/cells/editors/index.tsx`; import `currencyOf, roundToCurrency` from `@/lib/boards/currency`)

After `PercentEditor`:

```tsx
export function CurrencyEditor({
  value,
  settings,
  onCommit,
  onCancel,
  onClear,
}: EditorProps<{ amount: number }>) {
  const code = currencyOf(settings);
  const [raw, setRaw] = useState(value ? String(value.amount) : "");
  function commit() {
    const trimmed = raw.trim();
    // Emptying a previously-set cell clears it (deletes the row).
    if (trimmed === "") return (onClear ?? onCancel)();
    const n = Number(trimmed);
    if (Number.isNaN(n)) return onCancel();
    // Normalize to the currency's minor units (USD→2dp, JPY→0, KWD→3).
    onCommit({ amount: roundToCurrency(n, code) });
  }
  const onKey = useCommitKeys(commit, onCancel);
  return (
    <div className="flex h-8 items-center gap-1.5">
      <span className="text-muted-foreground shrink-0 text-xs">{code}</span>
      <Input
        type="number"
        autoFocus
        aria-label="Amount"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
        className="h-8 tabular-nums"
      />
    </div>
  );
}
```

In `CellEditor`'s switch (after `case "percent"`):

```tsx
    case "currency":
      return (
        <CurrencyEditor
          value={value as { amount: number } | null}
          settings={settings}
          onCommit={onCommit}
          onCancel={onCancel}
          onClear={onClear}
        />
      );
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/components/boards/cells/cells.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/cells/index.tsx src/components/boards/cells/editors/index.tsx src/components/boards/cells/cells.test.tsx
git commit -m "feat(boards): currency cell renderer + inline editor

CurrencyCell renders Intl-formatted amounts (tabular-nums, monochrome);
CurrencyEditor mirrors NumbersEditor ergonomics (enter/blur commit,
empty clears, NaN cancels) with a muted code prefix and rounds to the
currency's minor units at commit.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: aggregation, footer, and parent rollup

**Files:**

- Modify: `src/lib/boards/aggregation.ts` (`allowedAggregations`, `AggregateResult`, `num`, sum/avg/min/max branch, `isFilled`, `numericValues`, `identitiesOf`)
- Modify: `src/lib/boards/rollup.ts` (`RollupResult`, `rollupCell` signature + case)
- Modify: `src/components/boards/RollupCell.tsx` (render the new result kind)
- Modify: `src/components/boards/RollupValueCell.tsx:78-83` (thread the currency code)
- Modify: `src/components/boards/FooterCell.tsx` (`FooterCellProps.currency`, pass to `aggregate`, format in `FooterValue`)
- Modify: `src/components/boards/BoardTable.tsx:343-359` (thread `currency` into `<FooterCell>`)
- Test: `src/lib/boards/aggregation.test.ts`, `src/lib/boards/rollup.test.ts` (append)

**Interfaces:**

- Consumes: `formatCurrency` (Task 2); `{ amount }` shape (Task 3).
- Produces (Task 7 and the future summary-row feature rely on these exact shapes):
  - `allowedAggregations("currency")` → `["sum", "avg", "min", "max", ...COUNT_FAMILY]`
  - `AggregateResult` number variant becomes `{ kind: "number"; value: number; style?: "plain" | "percent" | "currency"; currency?: string }`
  - `aggregate(kind, aggId, values, options?, currency?: string)` — 5th optional param, attached to numeric results when `kind === "currency"`
  - `RollupResult` gains `{ kind: "currency"; total: number; currency: string }`; `rollupCell(kind, values, options?, currency?: string)` sums subitem amounts (money **sums**; contrast percent, which averages)
  - `FooterCellProps` gains `currency?: string`

- [ ] **Step 1: Write the failing tests**

```ts
// append to src/lib/boards/aggregation.test.ts
describe("currency aggregation", () => {
  const vals = [{ amount: 10.5 }, { amount: 20 }, null, { amount: -5 }];
  it("offers sum-first numeric aggregations", () => {
    expect(allowedAggregations("currency")).toEqual([
      "sum",
      "avg",
      "min",
      "max",
      "count",
      "count_filled",
      "count_empty",
      "count_unique",
    ]);
  });
  it("sums amounts and carries the currency style", () => {
    expect(aggregate("currency", "sum", vals, undefined, "KWD")).toEqual({
      kind: "number",
      value: 25.5,
      style: "currency",
      currency: "KWD",
    });
  });
  it("counts filled cells by amount presence", () => {
    expect(aggregate("currency", "count_filled", vals)).toEqual({
      kind: "number",
      value: 3,
    });
  });
});
```

```ts
// append to src/lib/boards/rollup.test.ts
describe("currency rollup", () => {
  it("sums subitem amounts with the column currency", () => {
    expect(
      rollupCell(
        "currency",
        [{ amount: 1.5 }, null, { amount: 2 }],
        undefined,
        "USD",
      ),
    ).toEqual({ kind: "currency", total: 3.5, currency: "USD" });
  });
  it("blanks when no filled amounts", () => {
    expect(rollupCell("currency", [null, {}], undefined, "USD")).toEqual({
      kind: "blank",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/boards/aggregation.test.ts src/lib/boards/rollup.test.ts`
Expected: FAIL (plus type errors on the exhaustive switches — this task closes them).

- [ ] **Step 3: Implement `aggregation.ts`**

1. `allowedAggregations`: add before the `status` case:

```ts
    case "currency":
      // Sum-first: a money column's natural summary is its total.
      return ["sum", "avg", "min", "max", ...COUNT_FAMILY];
```

2. `AggregateResult` number variant + helper:

```ts
  | {
      kind: "number";
      value: number;
      style?: "plain" | "percent" | "currency";
      currency?: string;
    }
```

```ts
const num = (
  value: number,
  style?: "percent" | "currency",
  currency?: string,
): AggregateResult => ({
  kind: "number",
  value,
  ...(style ? { style } : {}),
  ...(currency ? { currency } : {}),
});
```

3. `aggregate` gains the optional param — signature becomes:

```ts
export function aggregate(
  kind: ColumnKind,
  aggId: AggregationId,
  values: readonly unknown[],
  options?: readonly ColumnOption[],
  currency?: string,
): AggregateResult {
```

and in the `sum/avg/min/max` branch replace the style line and the four `num(...)` calls:

```ts
const style =
  kind === "percent" ? "percent" : kind === "currency" ? "currency" : undefined;
const code = kind === "currency" ? currency : undefined;
if (aggId === "sum")
  return num(
    nums.reduce((a, b) => a + b, 0),
    style,
    code,
  );
if (aggId === "min") return num(Math.min(...nums), style, code);
if (aggId === "max") return num(Math.max(...nums), style, code);
const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
return num(Math.round(avg * 100) / 100, style, code);
```

4. `isFilled`: add next to `percent`:

```ts
    case "currency":
      return typeof o.amount === "number" && Number.isFinite(o.amount);
```

5. `numericValues`: key selection becomes:

```ts
const key =
  kind === "rating"
    ? "rating"
    : kind === "percent"
      ? "percent"
      : kind === "currency"
        ? "amount"
        : "n";
```

6. `identitiesOf`: add `case "currency": return [String(o.amount)];` (keeps `count_unique` sensible).

- [ ] **Step 4: Implement `rollup.ts` + renderers**

`rollup.ts` — extend the result union and signature:

```ts
  | { kind: "currency"; total: number; currency: string }
```

```ts
export function rollupCell(
  kind: ColumnKind,
  values: readonly unknown[],
  options?: Options,
  currency?: string,
): RollupResult {
```

Add after the `percent` case:

```ts
    case "currency": {
      // Money SUMS on the collapsed parent (contrast percent, which averages).
      let total = 0;
      let any = false;
      for (const v of present) {
        const a = (v as { amount?: unknown }).amount;
        if (typeof a === "number" && Number.isFinite(a)) {
          total += a;
          any = true;
        }
      }
      return any
        ? { kind: "currency", total, currency: currency ?? "USD" }
        : { kind: "blank" };
    }
```

`RollupCell.tsx` — import `formatCurrency` from `@/lib/boards/currency`; add after the `number` case:

```tsx
    case "currency":
      return (
        <span className="text-muted-foreground text-sm tabular-nums">
          Σ {formatCurrency(result.total, result.currency)}
        </span>
      );
```

`RollupValueCell.tsx` — widen the settings read (lines 79–81) and pass the code:

```tsx
const settings = (col.settings ?? {}) as {
  options?: Parameters<typeof rollupCell>[2];
  currency?: string;
};
return (
  <div className={CELL_CLASS}>
    <RollupCell
      result={rollupCell(col.kind, values, settings.options, settings.currency)}
    />
  </div>
);
```

(Adjust to the file's actual JSX — the change is only the `settings` type and the 4th argument.)

- [ ] **Step 5: Implement `FooterCell.tsx` + `BoardTable.tsx` threading**

`FooterCell.tsx`:

1. `FooterCellProps` gains:

```ts
  /** ISO 4217 code when aggregateKind is currency (formats numeric results). */
  currency?: string;
```

2. Destructure `currency` in `FooterCell` and pass it: `aggregate(aggregateKind, current, values, options, currency)`.
3. `FooterValue` number case becomes:

```tsx
    case "number":
      return (
        <span className="text-foreground text-sm font-medium tabular-nums">
          {result.style === "currency" && result.currency
            ? formatCurrency(result.value, result.currency)
            : `${result.value}${result.style === "percent" ? "%" : ""}`}
        </span>
      );
```

(import `formatCurrency` from `@/lib/boards/currency`).

`BoardTable.tsx` (~line 351): thread the code from the **same settings object the existing `options` prop is derived from** (for mirror columns that is the target column's settings — keep the sources identical so a mirrored currency column formats correctly):

```tsx
            <FooterCell
              aggregateKind={aggregateKind}
              values={footerColumnValues(col, itemIds, cellMap, cache, nowMs)}
              options={options}
              currency={(settingsSource as { currency?: string } | null)?.currency}
              ...
```

where `settingsSource` is the local variable the footer already uses to read `options` (grep `options={options}` in `BoardTable.tsx` and reuse its origin).

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/boards/aggregation.test.ts src/lib/boards/rollup.test.ts src/components/boards/FooterCell.test.tsx src/components/boards/BoardTable.test.tsx`
Expected: PASS (existing suites unchanged; new suites green).

- [ ] **Step 7: Commit**

```bash
git add src/lib/boards/aggregation.ts src/lib/boards/rollup.ts src/components/boards/RollupCell.tsx src/components/boards/RollupValueCell.tsx src/components/boards/FooterCell.tsx src/components/boards/BoardTable.tsx src/lib/boards/aggregation.test.ts src/lib/boards/rollup.test.ts
git commit -m "feat(boards): currency aggregation, footer + parent rollup

Sum-first footer aggregations with currency-styled results, collapsed
parents sum subitem amounts, and formatted rendering threads the column
code through FooterCell/RollupCell. Summary-row (MVP item 2) consumes
these AggregateResult shapes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: "Change currency" dialog + header/table wiring

**Files:**

- Create: `src/components/boards/CurrencyDialog.tsx`
- Modify: `src/components/boards/ColumnHeader.tsx` (menu item + `onEditCurrency` prop)
- Modify: `src/components/boards/BoardTable.tsx` (dialog state + `ColumnHeaderControls` plumbing — mirror `onEditOptions`/`optionsFor` exactly; grep `onEditOptions` to find every pass-through, including the group-section header component)
- Test: `src/components/boards/ColumnHeader.test.tsx` (append), `src/components/boards/CurrencyDialog.test.tsx` (create)

**Interfaces:**

- Consumes: `CURRENCY_CODES`, `currencyLabel`, `currencyOf` (Task 2); `mutations.updateColumnSettings(columnId, settings)` from `use-board-mutations.ts` (existing); `COLUMN_KIND_META` (Task 4).
- Produces: `CurrencyDialog({ column, onSave })` where `onSave(settings: Record<string, unknown>)` receives the **merged** settings (existing keys preserved, `currency` replaced); dismissal is handled by the wrapping `<Dialog>` in `BoardTable`, so the component takes no `onCancel`. `ColumnHeader` prop `onEditCurrency?: () => void` shown only when `column.kind === "currency"`.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/boards/CurrencyDialog.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CurrencyDialog } from "@/components/boards/CurrencyDialog";

const column = {
  id: "c1",
  kind: "currency",
  name: "Budget",
  settings: { currency: "USD", summary_aggregation: "sum" },
} as never;

describe("CurrencyDialog", () => {
  it("saves the picked code, preserving other settings", async () => {
    const onSave = vi.fn();
    render(<CurrencyDialog column={column} onSave={onSave} />);
    await userEvent.type(
      screen.getByPlaceholderText("Search currencies…"),
      "kuwait",
    );
    await userEvent.click(await screen.findByText(/KWD/));
    expect(onSave).toHaveBeenCalledWith({
      currency: "KWD",
      summary_aggregation: "sum",
    });
  });
  it("states that amounts are not converted", () => {
    render(<CurrencyDialog column={column} onSave={vi.fn()} />);
    expect(screen.getByText("Amounts are not converted.")).toBeInTheDocument();
  });
});
```

```tsx
// append to src/components/boards/ColumnHeader.test.tsx (reuse its render helpers)
it("offers change currency for currency columns only", async () => {
  // render with a column of kind "currency" and onEditCurrency: vi.fn(),
  // open the column menu the way the existing menu tests do
  expect(await screen.findByText("Change currency")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/components/boards/CurrencyDialog.test.tsx src/components/boards/ColumnHeader.test.tsx`
Expected: FAIL — module/menu item missing.

- [ ] **Step 3: Implement `CurrencyDialog.tsx`**

```tsx
"use client";

import { Check } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { CacheColumn } from "@/lib/boards/cache";
import {
  CURRENCY_CODES,
  currencyLabel,
  currencyOf,
} from "@/lib/boards/currency";
import { cn } from "@/lib/utils";

/**
 * Body of the "Change currency" dialog for a currency column. Pure client
 * picker over the static curated code list (0 round-trips to open — spec §6);
 * only the save persists, via the existing updateColumnSettings action.
 * Amounts are never converted — the same numbers re-render in the new code.
 */
export function CurrencyDialog({
  column,
  onSave,
}: {
  column: CacheColumn;
  onSave: (settings: Record<string, unknown>) => void;
}) {
  const current = currencyOf(column.settings);
  return (
    <div className="flex flex-col gap-2">
      <Command>
        <CommandInput placeholder="Search currencies…" />
        <CommandList className="max-h-64">
          <CommandEmpty>No currency found.</CommandEmpty>
          <CommandGroup>
            {CURRENCY_CODES.map((code) => (
              <CommandItem
                key={code}
                value={currencyLabel(code)}
                onSelect={() =>
                  onSave({
                    ...((column.settings as Record<string, unknown>) ?? {}),
                    currency: code,
                  })
                }
              >
                <Check
                  className={cn(
                    "size-4",
                    code === current ? "opacity-100" : "opacity-0",
                  )}
                />
                {currencyLabel(code)}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
      <p className="text-muted-foreground text-xs">
        Amounts are not converted.
      </p>
    </div>
  );
}
```

(No `onCancel` prop: dismissal — Escape / outside click / the X — is owned entirely by the wrapping shadcn `<Dialog>`'s `onOpenChange` in `BoardTable`.)

- [ ] **Step 4: Wire `ColumnHeader.tsx`**

Add prop `onEditCurrency?: () => void;` to the props type (documented `// open the currency picker (currency kind only)`), and in the `DropdownMenuContent`, after the `hasOptions` item:

```tsx
{
  column.kind === "currency" && onEditCurrency && (
    <DropdownMenuItem onSelect={() => onEditCurrency()}>
      Change currency
    </DropdownMenuItem>
  );
}
```

- [ ] **Step 5: Wire `BoardTable.tsx`**

Mirror the `optionsFor`/`onEditOptions` plumbing (grep `onEditOptions` and `optionsFor` — every site gets a currency twin):

```tsx
const [currencyFor, setCurrencyFor] = useState<CacheColumn | null>(null);
```

- `columnControls` gains `onEditCurrency: (c) => setCurrencyFor(c),` (and the `ColumnHeaderControls` type + the intermediate group-header component that forwards `onEditOptions` gain the same optional field, forwarded to `ColumnHeader`).
- Alongside the existing `ColumnOptionsDialog` render block, add:

```tsx
<Dialog
  open={currencyFor !== null}
  onOpenChange={(open) => {
    if (!open) setCurrencyFor(null);
  }}
>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Change currency</DialogTitle>
      <DialogDescription>
        Pick the currency for “{currencyFor?.name}”.
      </DialogDescription>
    </DialogHeader>
    {currencyFor && (
      <CurrencyDialog
        column={currencyFor}
        onSave={(settings) => {
          mutations.updateColumnSettings(currencyFor.id, settings);
          setCurrencyFor(null);
        }}
      />
    )}
  </DialogContent>
</Dialog>
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/components/boards/CurrencyDialog.test.tsx src/components/boards/ColumnHeader.test.tsx src/components/boards/BoardTable.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/CurrencyDialog.tsx src/components/boards/ColumnHeader.tsx src/components/boards/BoardTable.tsx src/components/boards/CurrencyDialog.test.tsx src/components/boards/ColumnHeader.test.tsx
git commit -m "feat(boards): change-currency dialog in the column menu

Currency columns get a \"Change currency\" menu item opening a searchable
Command picker over the curated code list; saving merges settings
(preserving summary_aggregation) through updateColumnSettings. Amounts
are not converted — the dialog says so.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: peripheral kind-switches (kanban, codec, activity, AI, dashboards)

**Files:**

- Modify: `src/lib/boards/kanban-card.ts` (`META_KINDS`, `isCardCellEmpty`)
- Modify: `src/components/boards/KanbanBoard.tsx` (meta icon map only if `MetaIcon` switches on kind — grep `MetaIcon`; currency renders through the generic meta branch at line ~519, no percent-style special case needed)
- Modify: `src/lib/boards/spreadsheet/types.ts` (`ImportableKind` + `IMPORTABLE_KINDS`)
- Modify: `src/lib/boards/spreadsheet/cell-codec.ts` (`cellToText` + `textToCell`)
- Modify: `src/lib/collaboration/activity.ts` (value describer, next to its `case "numbers"` at line ~69)
- Modify: `src/lib/ai/board-snapshot.ts` (`isFilled` line ~41; numeric-stats branch line ~117)
- Modify: `src/lib/dashboards/list-rows.ts` (`formatCell` case) and `src/lib/dashboards/filter-meta.ts` (`operatorsForKind`, `valueControlFor`)
- Test: append to `src/lib/boards/kanban-card.test.ts`, `src/lib/boards/spreadsheet/cell-codec.test.ts`, `src/lib/dashboards/list-rows.test.ts`, `src/lib/dashboards/filter-meta.test.ts`

**Interfaces:**

- Consumes: `{ amount }` shape (Task 3), `formatCurrency`/`currencyOf` (Task 2).
- Produces: nothing new for other tasks — this closes every remaining kind dispatch so currency behaves like a numeric column across kanban, import/export, activity, AI snapshots, and dashboards.

- [ ] **Step 1: Write the failing tests**

```ts
// kanban-card.test.ts
it("surfaces currency in card meta and detects empties", () => {
  // build a currency CacheColumn like the file's existing fixtures
  expect(isCardCellEmpty("currency", { amount: 3 })).toBe(false);
  expect(isCardCellEmpty("currency", {})).toBe(true);
  expect(isCardCellEmpty("currency", null)).toBe(true);
});
```

```ts
// cell-codec.test.ts
describe("currency codec", () => {
  it("exports the raw amount", () => {
    expect(
      cellToText("currency", { amount: 1234.5 }, { currency: "USD" }),
    ).toBe("1234.5");
  });
  it("imports symbol/grouping-decorated strings", () => {
    expect(textToCell("currency", "$1,234.50", [])).toEqual({ amount: 1234.5 });
    expect(textToCell("currency", "-20", [])).toEqual({ amount: -20 });
    expect(textToCell("currency", "abc", [])).toBeNull();
  });
});
```

```ts
// list-rows.test.ts — add a currency DisplayColumn fixture like `num`
it("formats currency cells", () => {
  const oracle = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "KWD",
  });
  expect(formatCell(currencyCol, { amount: 2.5 })).toEqual({
    text: oracle.format(2.5),
  });
  expect(formatCell(currencyCol, null)).toEqual({ text: "—" });
});
```

```ts
// filter-meta.test.ts
it("currency filters like numbers", () => {
  expect(operatorsForKind("currency")).toEqual([
    "num_eq",
    "num_ne",
    "gt",
    "lt",
    "is_empty",
    "not_empty",
  ]);
  expect(valueControlFor("currency", "gt")).toBe("number");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/boards/kanban-card.test.ts src/lib/boards/spreadsheet/cell-codec.test.ts src/lib/dashboards/list-rows.test.ts src/lib/dashboards/filter-meta.test.ts`
Expected: FAIL on every new assertion.

- [ ] **Step 3: Implement each touchpoint**

`kanban-card.ts`:

```ts
const META_KINDS = new Set([
  "date",
  "people",
  "percent",
  "numbers",
  "currency",
]);
```

and in `isCardCellEmpty`:

```ts
    case "currency":
      return typeof v.amount !== "number";
```

`KanbanBoard.tsx`: check `MetaIcon` (grep it in the file). If it maps kinds to icons, add `currency` → `Banknote`; otherwise nothing — currency cells flow through the generic meta branch and render `CurrencyCell` via `CellRenderer`.

`spreadsheet/types.ts`: add `"currency"` to the `ImportableKind` union and `IMPORTABLE_KINDS` array (after `"percent"`).

`cell-codec.ts` — `cellToText` (raw number keeps Excel/CSV re-importable; formatted currency export belongs to MVP item 3):

```ts
      case "currency":
        return typeof v.amount === "number" ? String(v.amount) : "";
```

`textToCell`:

```ts
    case "currency": {
      // Accept symbol/grouping-decorated money strings: "$1,234.50" → 1234.5.
      const n = Number(trimmed.replace(/[^0-9.-]/g, ""));
      return Number.isFinite(n) && trimmed.replace(/[^0-9]/g, "") !== ""
        ? { amount: n }
        : null;
    }
```

`activity.ts` (next to `case "numbers"`, same shape):

```ts
    case "currency": {
      const v = value as { amount?: number };
      return v.amount != null ? String(v.amount) : null;
    }
```

`board-snapshot.ts` — `isFilled` gets its own case (the numbers/percent/rating group checks `o.n`, which is wrong for currency):

```ts
    case "currency":
      return typeof o.amount === "number" && Number.isFinite(o.amount);
```

and the numeric-stats branch reads the right key:

```ts
    } else if (
      col.kind === "numbers" ||
      col.kind === "percent" ||
      col.kind === "rating" ||
      col.kind === "currency"
    ) {
      const ns = cells.map((c) =>
        col.kind === "currency"
          ? (c.value as { amount: number }).amount
          : (c.value as { n: number }).n,
      );
```

`list-rows.ts` (`formatCell`, after `case "numbers"`; import `formatCurrency, currencyOf` from `@/lib/boards/currency` — check `DisplayColumn` for a `settings` field first; if it only carries `options`, extend `DisplayColumn` with `settings?: unknown` and populate it where columns are mapped in the dashboard page/query):

```ts
    case "currency":
      return typeof v.amount === "number"
        ? { text: formatCurrency(v.amount, currencyOf(column.settings)) }
        : EMPTY;
```

`filter-meta.ts`:

```ts
    case "numbers":
    case "currency":
      return ["num_eq", "num_ne", "gt", "lt", ...EMPTIES];
```

```ts
if (kind === "numbers" || kind === "currency") return "number";
```

Note: the dashboard filter _evaluator_ (grep `num_eq` outside `filter-meta.ts` to find it) reads the numeric cell key — extend it to read `amount` for currency columns the same way `numericValues` does in `aggregation.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/boards/kanban-card.test.ts src/lib/boards/spreadsheet/cell-codec.test.ts src/lib/dashboards/list-rows.test.ts src/lib/dashboards/filter-meta.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/kanban-card.ts src/components/boards/KanbanBoard.tsx src/lib/boards/spreadsheet/types.ts src/lib/boards/spreadsheet/cell-codec.ts src/lib/collaboration/activity.ts src/lib/ai/board-snapshot.ts src/lib/dashboards/list-rows.ts src/lib/dashboards/filter-meta.ts src/lib/boards/kanban-card.test.ts src/lib/boards/spreadsheet/cell-codec.test.ts src/lib/dashboards/list-rows.test.ts src/lib/dashboards/filter-meta.test.ts
git commit -m "feat(boards): currency across kanban, codec, activity, ai, dashboards

Currency behaves as a numeric kind everywhere: kanban card meta,
spreadsheet export (raw number) + import (symbol-tolerant parse),
activity descriptions, AI snapshot numeric stats, and dashboard
formatting/filtering.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: full gates, finish, and acceptance walkthrough

**Files:** none new — verification + merge.

**Interfaces:**

- Consumes: all previous tasks merged on `task/currency-column`.
- Produces: green `develop` with the feature merged; worktree/branch cleaned up.

- [ ] **Step 1: Run the full gate suite**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four pass. Known traps (memory notes): cold `typecheck` can fail on `cacheLife` until `pnpm build` generates `.next/types` — if so, run `pnpm build` first, then re-run; if `build` hits `module-not-found` after a rebase, `pnpm install` in the worktree and re-run.

- [ ] **Step 2: Finish the task**

Run from inside the worktree: `bash scripts/finish-task.sh`
Expected: rebases onto latest `develop`, re-runs gates against the merged state, merges `task/currency-column` into `develop`, pushes, removes the worktree, deletes the branch. If it stops on a real rebase conflict: resolve `git rebase develop`, re-run. If `git worktree remove` fails on lingering scratch files after the merge already pushed, verify `origin/develop` before treating it as a failure.

- [ ] **Step 3: Hand the user the "How to test this" walkthrough** (include in the closing message and the `/wrapup` session note)

1. Pull `develop` and run the app (`pnpm dev`), open any board's Main Table.
2. Click the `+` add-column button → pick **Currency** (banknote icon). A "Currency" column appears immediately.
3. Click a cell in it, type `1234.5`, press Enter → the cell shows `$1,234.50`.
4. Open the column's `⋯` menu → **Change currency** → search "kuwait" → pick **KWD — Kuwaiti Dinar**. All amounts re-render as KWD with 3 decimals (values unchanged; the dialog states "Amounts are not converted.").
5. In the same cell, enter `10.1266` → commits as `10.127` (KWD minor units).
6. In the column's footer, click the summary picker → **Sum** → the formatted total appears; add a second amount and watch it update with no page reload.
7. Add sub-items with amounts under a parent, collapse the parent → the collapsed cell shows `Σ` of the children, formatted.
8. Switch to Kanban view → cards show the formatted amount in their meta footer.
9. Board menu → export to Excel → the currency column exports raw numbers (formatting arrives with the "Formatted Excel export" feature).

---

## Self-review notes

- **Spec coverage:** §3.1→Task 1; §3.4→Task 2; §3.2/3.3→Task 3; §4 registry rows→Tasks 4–8 (each row named in a task's file list); §5 UX→Tasks 5+7; §6 perf budget→Global Constraints + Task 7 (picker is static, saves via existing actions); §7 tests→embedded per task; §8 units→Execution DAG. Templates row (§4): `templates.ts`/`template-payload.ts` switch on data, not exhaustively on `ColumnKind` — no change needed; covered by the Task 9 typecheck gate.
- **Type consistency:** `{ amount: number }`, `currency?: string` param position (5th in `aggregate`, 4th in `rollupCell`), `AggregateResult.currency`, `RollupResult` `{ kind: "currency"; total; currency }`, `FooterCellProps.currency`, `onEditCurrency` — names match across Tasks 3–8.
- **Deliberate scope cuts:** no formatted-currency Excel styling (MVP item 3 owns it, reading `columns.settings.currency`); no FX conversion; no org default currency (spec open question 1).
