# MCP Column Write-Metadata + File Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an external MCP agent discover every column's writable value shape (including status option ids) and attach a file it produced to an item or Files-column cell, with no human in the loop.

**Architecture:** `get_board` gains per-column `options` / `settings` / `writable` / `valueShape`, computed by a pure `describeColumn` that shares its option parsing with `/ask`'s board snapshot. Attachments gain two MCP tools — a signed-upload ticket and a finalizer that accepts either the uploaded path or a ≤128 KB inline base64 body — both delegating their guards to a `createAttachmentCore` extracted from the existing Server Action, following the `upsertCellCore` precedent.

**Tech Stack:** TypeScript (strict), Next.js 16 App Router, Zod, Supabase (`@supabase/supabase-js@2.108.1`, RLS-scoped bridged client), `@modelcontextprotocol/sdk`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-06-mcp-status-metadata-and-attachments-design.md`

## Global Constraints

- **Server Components by default; Server Actions for mutations.** Nothing here adds UI.
- **TypeScript strict; no `any`.** Structural test fakes cast through `as never` at exactly one place, matching `src/test/mcp-fake-client.ts`.
- **RLS is the security boundary.** Every MCP tool runs on the bridged client from `getRequestClient`. **Never** the service-role client. The only service-role use in this plan is inside the `.rls.integration.test.ts` fixture setup.
- **`getClient()` exactly once per handler invocation.** Each call charges the MCP rate limit and rotates the OAuth bridge secret (`src/lib/mcp/tools/shared.ts`). Never call it in a loop.
- **Reuse canonical modules.** `ActionResult` / `fail` from `src/lib/actions/result.ts`; option parsing from the new `src/lib/boards/column-options.ts`; path builders from `src/lib/collaboration/attachments-path.ts`. Grep before writing any helper.
- **Bucket ceiling is 52,428,800 bytes (50 MB)** — enforced by the `attachments` bucket, the `attachments.size_bytes` check constraint, and `SIZE` in `src/lib/validations/collaboration-actions.ts`. Do not restate it as a literal anywhere new; import or reference the existing constant.
- **Inline base64 cap is 131,072 decoded bytes (128 KB).**
- **Signed upload URL TTL is 7200s and is NOT configurable** — `createSignedUploadUrl(path, options?)` accepts only `{ upsert }` in `@supabase/storage-js@2.108.1`. Report it; never add a parameter for it.
- **No delete, archive, move, or download.** The MCP write surface stays additive.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` must pass before `finish-task.sh`.

## File Structure

| File                                                     | Responsibility                                                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/lib/boards/column-options.ts` (create)              | Pure, total `parseColumnOptions(settings)`. Single parser for `settings.options`.                                    |
| `src/lib/ai/board-snapshot.ts` (modify)                  | Rewired to `parseColumnOptions`. No behaviour change.                                                                |
| `src/lib/mcp/tools/column-meta.ts` (create)              | Pure `describeColumn` + the per-kind `VALUE_SHAPE` / `SETTINGS_KEYS` tables.                                         |
| `src/lib/mcp/tools/get-board.ts` (modify)                | Selects `settings`; maps columns through `describeColumn`.                                                           |
| `src/lib/collaboration/attachment-core.ts` (create)      | `resolveItemScope`, `attachmentPathPrefix`, `createAttachmentCore` — the guards + insert, client and actor injected. |
| `src/lib/collaboration/actions.ts` (modify)              | `createAttachment` becomes a thin cookie-bound wrapper over the core.                                                |
| `src/lib/mcp/tools/create-attachment-upload.ts` (create) | Mints the signed upload ticket.                                                                                      |
| `src/lib/mcp/tools/attach-file.ts` (create)              | Finalizes from `storagePath` or `contentBase64`.                                                                     |
| `src/lib/mcp/tools/register.ts` (modify)                 | Registers both tools.                                                                                                |
| `src/test/mcp-fake-client.ts` (modify)                   | Adds a Storage fake and an `attachments` insert chain.                                                               |

## Execution DAG

- **Batch 1 (parallel):** Task 1, Task 4, Task 5 — no unmet dependencies.
- **Batch 2 (parallel):** Task 2 (needs 1), Task 6 (needs 4, 5).
- **Batch 3 (parallel):** Task 3 (needs 2), Task 7 (needs 6).

**Critical path:** Task 4 → Task 6 → Task 7. Tasks 1→2→3 form an independent chain that can merge on its own without any attachment work.

Mapping to the spec's four-task DAG: spec T1 splits into plan Tasks 1–3, spec T2 → Task 4, spec T3 → Task 5, spec T4 → Tasks 6–7.

## Deviations from the spec

Three decisions made while planning that the spec does not say, recorded here so a reviewer can reject them rather than discover them in the diff.

1. **The ticket branch does NOT delete the object when registering fails.** The spec says "Both branches then insert the `attachments` row and, if the insert fails, remove the orphaned object." That is right for the inline branch, which uploaded the bytes itself. It is wrong for the ticket branch: the agent already spent the upload, and a transient insert failure is retryable with the same `storagePath` — deleting turns a retryable failure into lost work. Only the inline branch cleans up. Covered by the two opposing tests in Task 6, Step 5.

2. **`attach_file` reads the item twice, by design.** The spec estimates "at most 3 storage/db calls". The real count is 1 client + 1 scope read (to build the path prefix) + 1 storage call + `createAttachmentCore`'s own item read + an optional column read + the insert — 5 to 6. The second item read is not redundant: re-deriving tenancy from the item **is** the path-spoof guard, and making it skippable by passing in a caller-resolved scope would weaken the guard to an argument. All reads are single-row primary-key lookups. The spec's §5 estimate is superseded by this number.

3. **`create_attachment_upload` validates the Files column before minting a ticket.** The spec places the column check only in the core. Checking it up front means an agent never uploads bytes it will then be refused permission to register.

---

### Task 1: Shared column-option parsing

**Files:**

- Create: `src/lib/boards/column-options.ts`
- Create: `src/lib/boards/column-options.test.ts`
- Modify: `src/lib/ai/board-snapshot.ts:88-93`

**Interfaces:**

- Consumes: `optionSchema`, `ColumnOption` from `@/lib/validations/boards`.
- Produces: `parseColumnOptions(settings: unknown): ColumnOption[]` — where `ColumnOption` is `{ id: string; label: string; color: string }`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/boards/column-options.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseColumnOptions } from "./column-options";

describe("parseColumnOptions", () => {
  it("parses a well-formed options array", () => {
    expect(
      parseColumnOptions({
        options: [{ id: "s1", label: "Working on it", color: "amber" }],
      }),
    ).toEqual([{ id: "s1", label: "Working on it", color: "amber" }]);
  });

  it("returns [] for settings that carry no options", () => {
    expect(parseColumnOptions({})).toEqual([]);
    expect(parseColumnOptions({ currency: "KWD" })).toEqual([]);
  });

  it("returns [] for null, undefined, and non-object settings", () => {
    expect(parseColumnOptions(null)).toEqual([]);
    expect(parseColumnOptions(undefined)).toEqual([]);
    expect(parseColumnOptions("not an object")).toEqual([]);
    expect(parseColumnOptions(42)).toEqual([]);
  });

  // Documents EXISTING board-snapshot behaviour, deliberately preserved: the
  // array is parsed as a whole, so one malformed entry discards all of them
  // rather than silently returning a partial list an agent would trust.
  it("discards the whole array when any entry is malformed", () => {
    expect(
      parseColumnOptions({
        options: [
          { id: "s1", label: "Good", color: "amber" },
          { id: "s2", label: "Missing color" },
        ],
      }),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/boards/column-options.test.ts`
Expected: FAIL — `Failed to resolve import "./column-options"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/boards/column-options.ts`:

```ts
import { optionSchema, type ColumnOption } from "@/lib/validations/boards";

/**
 * Parse a column's `settings.options` into the canonical option list.
 *
 * Pure and TOTAL: any shape of input yields an array, never a throw, so one
 * hand-edited `settings` jsonb can never fail a whole board read. The array is
 * validated as a unit — one bad entry discards all of them, rather than
 * returning a partial list a caller would wrongly treat as complete.
 *
 * Callers: `buildBoardSnapshot` (`src/lib/ai/board-snapshot.ts`, projects to
 * `{id, label}` for /ask token economy) and `describeColumn`
 * (`src/lib/mcp/tools/column-meta.ts`, emits `color` too).
 */
export function parseColumnOptions(settings: unknown): ColumnOption[] {
  const raw =
    typeof settings === "object" && settings !== null
      ? (settings as { options?: unknown }).options
      : undefined;
  return optionSchema.array().safeParse(raw ?? []).data ?? [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/boards/column-options.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Rewire `board-snapshot.ts` to the shared parser**

In `src/lib/ai/board-snapshot.ts`, replace this block (currently at lines 88-93):

```ts
const opts =
  optionSchema
    .array()
    .safeParse((col.settings as { options?: unknown })?.options ?? []).data ??
  [];
```

with:

```ts
const opts = parseColumnOptions(col.settings);
```

Add the import `import { parseColumnOptions } from "@/lib/boards/column-options";` and **remove the now-unused `optionSchema` import** on line 1 — leaving it will fail `pnpm lint`. Change nothing else: `snapColumns` keeps projecting to `{id, label}`.

- [ ] **Step 6: Verify the snapshot suite still passes unchanged**

Run: `pnpm vitest run src/lib/ai/board-snapshot.test.ts && pnpm lint`
Expected: PASS, no lint errors. This is a pure refactor — if any snapshot assertion changes, the extraction is wrong; revert and re-check.

- [ ] **Step 7: Commit**

```bash
git add src/lib/boards/column-options.ts src/lib/boards/column-options.test.ts src/lib/ai/board-snapshot.ts
git commit -m "refactor(boards): extract parseColumnOptions as the single option parser"
```

---

### Task 2: `describeColumn` and the per-kind value-shape table

**Files:**

- Create: `src/lib/mcp/tools/column-meta.ts`
- Create: `src/lib/mcp/tools/column-meta.test.ts`

**Interfaces:**

- Consumes: `parseColumnOptions` from Task 1; `ColumnKind`, `columnKindSchema`, `cellValueSchema`, `ColumnOption` from `@/lib/validations/boards`.
- Produces:
  - `type ColumnDescription = { id: string; name: string; kind: ColumnKind; writable: boolean; valueShape: string | null; note?: string; options?: ColumnOption[]; settings?: Record<string, unknown> }`
  - `describeColumn(col: { id: string; name: string; kind: ColumnKind; settings: unknown }): ColumnDescription`

- [ ] **Step 1: Write the failing test**

Create `src/lib/mcp/tools/column-meta.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { columnKindSchema, cellValueSchema } from "@/lib/validations/boards";
import type { ColumnKind } from "@/lib/validations/boards";
import { describeColumn } from "./column-meta";

describe("describeColumn", () => {
  it("emits options with color for a status column", () => {
    expect(
      describeColumn({
        id: "c1",
        name: "Status",
        kind: "status",
        settings: {
          options: [{ id: "s1", label: "Working on it", color: "amber" }],
          summary_aggregation: "distribution",
        },
      }),
    ).toEqual({
      id: "c1",
      name: "Status",
      kind: "status",
      writable: true,
      valueShape: "{ optionId: string | null }",
      note: "optionId must be an id from this column's options[]",
      options: [{ id: "s1", label: "Working on it", color: "amber" }],
    });
  });

  it("omits internal settings keys and emits only the allow-list", () => {
    const desc = describeColumn({
      id: "c2",
      name: "Budget",
      kind: "currency",
      settings: {
        currency: "KWD",
        dirham_sign: true,
        summary_aggregation: "sum",
      },
    });
    expect(desc.settings).toEqual({ currency: "KWD" });
  });

  it("marks relation, mirror and files as not writable", () => {
    for (const kind of ["relation", "mirror", "files"] as const) {
      const desc = describeColumn({
        id: "c3",
        name: kind,
        kind,
        settings: {},
      });
      expect(desc.writable).toBe(false);
      expect(desc.valueShape).toBeNull();
    }
  });

  it("still emits relation wiring even though relation is not writable", () => {
    const desc = describeColumn({
      id: "c4",
      name: "Linked",
      kind: "relation",
      settings: { target_board_id: "b2", allow_multiple: true },
    });
    expect(desc.settings).toEqual({
      target_board_id: "b2",
      allow_multiple: true,
    });
  });

  it("degrades to the base description when settings are malformed", () => {
    expect(
      describeColumn({
        id: "c5",
        name: "Status",
        kind: "status",
        settings: "corrupt",
      }),
    ).toEqual({
      id: "c5",
      name: "Status",
      kind: "status",
      writable: true,
      valueShape: "{ optionId: string | null }",
      note: "optionId must be an id from this column's options[]",
    });
  });

  it("omits options and settings entirely when there are none", () => {
    const desc = describeColumn({
      id: "c6",
      name: "Title",
      kind: "text",
      settings: {},
    });
    expect(desc).not.toHaveProperty("options");
    expect(desc).not.toHaveProperty("settings");
  });
});

/**
 * ANTI-DRIFT GATE.
 *
 * `valueShape` is documentation an autonomous agent acts on, and a confidently
 * wrong hint is worse than no hint. These tests pin every advertised shape to
 * the REAL `cellValueSchema(kind)` — the same schema the MCP write path runs.
 * Change a value schema without changing its hint and this suite fails.
 */
const SAMPLES: Record<ColumnKind, { valid: unknown; invalid: unknown } | null> =
  {
    text: { valid: { text: "hello" }, invalid: { text: 5 } },
    status: { valid: { optionId: "s1" }, invalid: { optionId: 5 } },
    dropdown: { valid: { optionIds: ["s1"] }, invalid: { optionIds: "s1" } },
    people: { valid: { userIds: ["u1"] }, invalid: { userIds: "u1" } },
    date: { valid: { date: "2026-08-06" }, invalid: { date: "06/08/2026" } },
    numbers: { valid: { n: 42 }, invalid: { n: "42" } },
    checkbox: { valid: { checked: true }, invalid: { checked: "yes" } },
    rating: { valid: { rating: 4 }, invalid: { rating: 9 } },
    percent: { valid: { percent: 50 }, invalid: { percent: 101 } },
    currency: { valid: { amount: 12.5 }, invalid: { amount: "12.5" } },
    priority: { valid: { level: "critical" }, invalid: { level: "urgent" } },
    link: {
      valid: { url: "https://example.com" },
      invalid: { url: "javascript:alert(1)" },
    },
    email: { valid: { email: "a@b.com" }, invalid: { email: "nope" } },
    phone: { valid: { phone: "+965 1234" }, invalid: { phone: "" } },
    time_tracking: {
      valid: { estimateSeconds: 3600 },
      invalid: { estimateSeconds: -1 },
    },
    files: null,
    relation: null,
    mirror: null,
  };

describe("valueShape hints match the real cellValueSchema", () => {
  it("covers every ColumnKind with no gaps", () => {
    for (const kind of columnKindSchema.options) {
      expect(SAMPLES).toHaveProperty(kind);
    }
  });

  for (const kind of columnKindSchema.options) {
    it(`${kind}: hint is honest`, () => {
      const sample = SAMPLES[kind];
      const desc = describeColumn({
        id: "c",
        name: kind,
        kind,
        settings: {},
      });
      if (sample === null) {
        expect(desc.writable).toBe(false);
        expect(desc.valueShape).toBeNull();
        return;
      }
      expect(desc.writable).toBe(true);
      expect(desc.valueShape).toBeTruthy();
      expect(cellValueSchema(kind).safeParse(sample.valid).success).toBe(true);
      expect(cellValueSchema(kind).safeParse(sample.invalid).success).toBe(
        false,
      );
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/mcp/tools/column-meta.test.ts`
Expected: FAIL — `Failed to resolve import "./column-meta"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/mcp/tools/column-meta.ts`:

```ts
import type { ColumnKind, ColumnOption } from "@/lib/validations/boards";
import { parseColumnOptions } from "@/lib/boards/column-options";

/** One column as `get_board` describes it to an MCP agent. */
export type ColumnDescription = {
  id: string;
  name: string;
  kind: ColumnKind;
  /** False when the kind stores no `cell_values` row — a write can never succeed. */
  writable: boolean;
  /** Shape for `fields[].value` in create_item / update_item; null when not writable. */
  valueShape: string | null;
  /** Constraint the bare shape cannot express, e.g. "integer 1-5". */
  note?: string;
  options?: ColumnOption[];
  settings?: Record<string, unknown>;
};

/**
 * The value shape each kind accepts, mirroring `cellValueSchema(kind)` in
 * `@/lib/validations/boards`. Kept honest by the anti-drift suite in
 * `column-meta.test.ts` — update both together or the tests fail.
 *
 * `null` marks a kind whose content does NOT live in `cell_values`:
 * `relation` derives from `relation_links`, `mirror` is a read-only rollup, and
 * `files` derives from `attachments` (write it with `attach_file`). Their
 * schemas are `z.object({}).strict()` and, per their own comments, exist only
 * to keep the switch exhaustive — they are never used by `upsertCell`.
 */
const VALUE_SHAPE: Record<ColumnKind, string | null> = {
  text: "{ text: string }",
  status: "{ optionId: string | null }",
  dropdown: "{ optionIds: string[] }",
  people: "{ userIds: string[] }",
  date: '{ date: "YYYY-MM-DD", end?: "YYYY-MM-DD" }',
  numbers: "{ n: number }",
  checkbox: "{ checked: boolean }",
  rating: "{ rating: number }",
  percent: "{ percent: number }",
  currency: "{ amount: number }",
  priority: '{ level: "normal" | "critical" }',
  link: "{ url: string, text?: string }",
  email: "{ email: string }",
  phone: "{ phone: string }",
  time_tracking: "{ estimateSeconds: number }",
  files: null,
  relation: null,
  mirror: null,
};

/**
 * Extra guidance emitted as a separate `note` where the bare shape
 * under-specifies what the schema enforces. Kept OUT of `valueShape` so the
 * anti-drift test can pin shapes exactly, without prose interfering.
 */
const SHAPE_NOTE: Partial<Record<ColumnKind, string>> = {
  text: "max 20000 characters",
  status: "optionId must be an id from this column's options[]",
  dropdown: "ids must come from this column's options[]",
  rating: "integer 1-5",
  percent: "0-100",
  link: "url must be http or https",
  phone: "1-40 characters",
  time_tracking: "positive integer seconds",
  files: "use the attach_file tool",
  relation: "derived from linked items; not writable here",
  mirror: "read-only rollup",
};

/**
 * Settings keys surfaced per kind. A deliberate ALLOW-LIST, not the raw jsonb:
 * only keys that change how a value must be written are public. Internal keys
 * (`summary_aggregation`, `dirham_sign`, mirror wiring) stay internal so this
 * tool's contract is not pinned to the DB jsonb shape.
 */
const SETTINGS_KEYS: Partial<Record<ColumnKind, readonly string[]>> = {
  currency: ["currency"],
  numbers: ["unit", "precision"],
  relation: ["target_board_id", "allow_multiple"],
};

export function describeColumn(col: {
  id: string;
  name: string;
  kind: ColumnKind;
  settings: unknown;
}): ColumnDescription {
  const shape = VALUE_SHAPE[col.kind];
  const options =
    col.kind === "status" || col.kind === "dropdown"
      ? parseColumnOptions(col.settings)
      : [];

  const raw =
    typeof col.settings === "object" && col.settings !== null
      ? (col.settings as Record<string, unknown>)
      : {};
  const picked: Record<string, unknown> = {};
  for (const key of SETTINGS_KEYS[col.kind] ?? []) {
    if (raw[key] !== undefined) picked[key] = raw[key];
  }

  const note = SHAPE_NOTE[col.kind];

  return {
    id: col.id,
    name: col.name,
    kind: col.kind,
    writable: shape !== null,
    valueShape: shape,
    ...(note ? { note } : {}),
    ...(options.length ? { options } : {}),
    ...(Object.keys(picked).length ? { settings: picked } : {}),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/mcp/tools/column-meta.test.ts`
Expected: PASS — 6 `describeColumn` tests plus 19 anti-drift tests (1 coverage + 18 kinds).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/tools/column-meta.ts src/lib/mcp/tools/column-meta.test.ts
git commit -m "feat(mcp): add describeColumn with per-kind value-shape hints"
```

---

### Task 3: Wire column metadata into `get_board`

**Files:**

- Modify: `src/lib/mcp/tools/get-board.ts:23-28,36-47,54-62`
- Modify: `src/lib/mcp/tools/get-board.test.ts`

**Interfaces:**

- Consumes: `describeColumn`, `ColumnDescription` from Task 2.
- Produces: the `get_board` payload `{ board, columns: ColumnDescription[], groups }`.

- [ ] **Step 1: Update the existing test to the new contract**

In `src/lib/mcp/tools/get-board.test.ts`, the first test's `columns` fake currently returns `[{ id: "c1", name: "Status", kind: "status" }]`. Replace that stub row and its assertion:

```ts
if (table === "columns") {
  return {
    order: () =>
      Promise.resolve({
        data: [
          {
            id: "c1",
            name: "Status",
            kind: "status",
            settings: {
              options: [{ id: "s1", label: "Done", color: "green" }],
            },
          },
        ],
        error: null,
      }),
  };
}
```

and:

```ts
expect(parsed.columns).toEqual([
  {
    id: "c1",
    name: "Status",
    kind: "status",
    writable: true,
    valueShape: "{ optionId: string | null }",
    note: "optionId must be an id from this column's options[]",
    options: [{ id: "s1", label: "Done", color: "green" }],
  },
]);
```

Then add a regression test to the same `describe` block:

```ts
it("does not fail the whole call when one column has malformed settings", async () => {
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: () => {
          if (table === "boards") {
            return {
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: "b1", name: "Roadmap" },
                  error: null,
                }),
            };
          }
          if (table === "columns") {
            return {
              order: () =>
                Promise.resolve({
                  data: [
                    { id: "c1", name: "Broken", kind: "status", settings: 7 },
                    {
                      id: "c2",
                      name: "Title",
                      kind: "text",
                      settings: {},
                    },
                  ],
                  error: null,
                }),
            };
          }
          return {
            is: () => ({
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          };
        },
      }),
    }),
  };
  const result = await getBoardHandler(async () => client as never, {
    boardId: "b1",
  });
  expect(result.isError).toBeUndefined();
  const parsed = JSON.parse(result.content[0].text as string);
  expect(parsed.columns).toHaveLength(2);
  expect(parsed.columns[0]).not.toHaveProperty("options");
  expect(parsed.columns[1].kind).toBe("text");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/mcp/tools/get-board.test.ts`
Expected: FAIL — the first test's `toEqual` reports missing `writable` / `valueShape` / `options`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/mcp/tools/get-board.ts`, add the import:

```ts
import { describeColumn } from "./column-meta";
```

Change the columns select (line 25) from `.select("id, name, kind")` to:

```ts
      .select("id, name, kind, settings")
```

and map the result in the return block:

```ts
return {
  content: [
    {
      type: "text" as const,
      text: JSON.stringify({
        board,
        columns: (columns ?? []).map(describeColumn),
        groups: groups ?? [],
      }),
    },
  ],
};
```

Then widen the tool description so an agent knows the metadata is there — this is the only thing that makes the feature discoverable:

```ts
      description:
        "Get a board's metadata, columns, and groups. Each column reports " +
        "`writable`, a `valueShape` string for create_item/update_item field " +
        "values, `options` (status/dropdown: use an option's `id` as `optionId`), " +
        "and any settings that affect writes. Columns with `writable: false` " +
        "cannot be set via `fields` — use `attach_file` for `files` columns.",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/mcp/tools/ && pnpm typecheck`
Expected: PASS. `pnpm typecheck` matters here — `columns` is typed from the generated `Database` types, so a mis-typed `settings` (`Json`, not `unknown`) surfaces now. `describeColumn` accepts `settings: unknown`, which `Json` satisfies.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/tools/get-board.ts src/lib/mcp/tools/get-board.test.ts
git commit -m "feat(mcp): expose column options and write-shape metadata via get_board"
```

---

### Task 4: Extract `createAttachmentCore`

**Files:**

- Create: `src/lib/collaboration/attachment-core.ts`
- Create: `src/lib/collaboration/attachment-core.test.ts`
- Modify: `src/lib/collaboration/actions.ts:159-224`

**Interfaces:**

- Consumes: `fail`, `ActionResult` from `@/lib/actions/result`; `Database` from `@/types/database.types`.
- Produces:
  - `resolveItemScope(supabase, itemId): Promise<{ orgId: string; boardId: string } | null>`
  - `attachmentPathPrefix({ orgId, boardId, itemId, columnId? }): string`
  - `createAttachmentCore(supabase, input: CreateAttachmentCoreInput, actorId: string): Promise<ActionResult<{ attachmentId: string }>>`
  - `type CreateAttachmentCoreInput = { itemId: string; storagePath: string; fileName: string; mimeType: string; sizeBytes: number; columnId?: string }`

- [ ] **Step 1: Write the failing test**

Create `src/lib/collaboration/attachment-core.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { attachmentPathPrefix, createAttachmentCore } from "./attachment-core";

const ACTOR = "99999999-9999-4999-8999-999999999999";
const ITEM = "11111111-1111-4111-8111-111111111111";
const OK_ITEM = { data: { org_id: "o1", board_id: "b1" }, error: null };

/** Structural fake of the three call shapes the core touches. */
function makeClient(opts: {
  item?: { data: unknown; error: unknown };
  column?: { data: unknown };
  insert?: { data: unknown; error: unknown };
}) {
  const inserted: unknown[] = [];
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve(
              table === "items"
                ? (opts.item ?? OK_ITEM)
                : (opts.column ?? {
                    data: { id: "col1", kind: "files", board_id: "b1" },
                  }),
            ),
        }),
      }),
      insert: (row: unknown) => {
        inserted.push(row);
        return {
          select: () => ({
            single: () =>
              Promise.resolve(
                opts.insert ?? { data: { id: "a1" }, error: null },
              ),
          }),
        };
      },
    }),
  };
  return { client: client as never, inserted };
}

describe("attachmentPathPrefix", () => {
  it("nests the column id for a Files-column attachment", () => {
    expect(
      attachmentPathPrefix({
        orgId: "o1",
        boardId: "b1",
        itemId: "i1",
        columnId: "c1",
      }),
    ).toBe("o1/b1/i1/c1/");
  });

  it("omits the column segment for an item-level attachment", () => {
    expect(
      attachmentPathPrefix({ orgId: "o1", boardId: "b1", itemId: "i1" }),
    ).toBe("o1/b1/i1/");
  });
});

describe("createAttachmentCore", () => {
  const base = {
    itemId: ITEM,
    fileName: "report.csv",
    mimeType: "text/csv",
    sizeBytes: 120,
  };

  it("inserts the row with the injected actor as uploaded_by", async () => {
    const { client, inserted } = makeClient({});
    const res = await createAttachmentCore(
      client,
      { ...base, storagePath: `o1/b1/${ITEM}/abc-report.csv` },
      ACTOR,
    );
    expect(res).toEqual({ ok: true, data: { attachmentId: "a1" } });
    expect(inserted[0]).toEqual({
      org_id: "o1",
      board_id: "b1",
      item_id: ITEM,
      column_id: null,
      uploaded_by: ACTOR,
      storage_path: `o1/b1/${ITEM}/abc-report.csv`,
      file_name: "report.csv",
      mime_type: "text/csv",
      size_bytes: 120,
    });
  });

  it("rejects a storage path outside this item (path-spoof guard)", async () => {
    const { client, inserted } = makeClient({});
    const res = await createAttachmentCore(
      client,
      { ...base, storagePath: `other-org/b1/${ITEM}/abc-report.csv` },
      ACTOR,
    );
    expect(res).toEqual({
      ok: false,
      error: "Storage path does not match this item.",
    });
    expect(inserted).toHaveLength(0);
  });

  it("rejects a column that is not a files column on this item's board", async () => {
    const { client, inserted } = makeClient({
      column: { data: { id: "col1", kind: "text", board_id: "b1" } },
    });
    const res = await createAttachmentCore(
      client,
      {
        ...base,
        columnId: "col1",
        storagePath: `o1/b1/${ITEM}/col1/abc-report.csv`,
      },
      ACTOR,
    );
    expect(res).toEqual({ ok: false, error: "Invalid file column." });
    expect(inserted).toHaveLength(0);
  });

  it("returns a failure when the item is not visible", async () => {
    const { client } = makeClient({ item: { data: null, error: null } });
    const res = await createAttachmentCore(
      client,
      { ...base, storagePath: `o1/b1/${ITEM}/abc-report.csv` },
      ACTOR,
    );
    expect(res).toEqual({ ok: false, error: "Item not found." });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/collaboration/attachment-core.test.ts`
Expected: FAIL — `Failed to resolve import "./attachment-core"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/collaboration/attachment-core.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, type ActionResult } from "@/lib/actions/result";
import type { Database } from "@/types/database.types";

/** What registering an attachment needs, already parsed by the caller's Zod boundary. */
export type CreateAttachmentCoreInput = {
  itemId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  columnId?: string;
};

/** The item's denormalized tenancy, read under RLS. `null` when not visible. */
export async function resolveItemScope(
  supabase: SupabaseClient<Database>,
  itemId: string,
): Promise<{ orgId: string; boardId: string } | null> {
  const { data, error } = await supabase
    .from("items")
    .select("org_id, board_id")
    .eq("id", itemId)
    .maybeSingle();
  if (error || !data) return null;
  return { orgId: data.org_id, boardId: data.board_id };
}

/**
 * The only object-key prefix an attachment for this item may live under.
 * Files-column attachments nest the column id one level deeper. Pure.
 */
export function attachmentPathPrefix(input: {
  orgId: string;
  boardId: string;
  itemId: string;
  columnId?: string;
}): string {
  return input.columnId
    ? `${input.orgId}/${input.boardId}/${input.itemId}/${input.columnId}/`
    : `${input.orgId}/${input.boardId}/${input.itemId}/`;
}

/**
 * The single implementation of "register an attachment row" for the whole app:
 * re-derives org/board from the item under RLS, rejects any path outside this
 * org/board/item(/column) prefix, verifies a column-scoped attachment targets a
 * `files` column on the same board, and inserts.
 *
 * Both the Supabase client AND the actor are injected, which is the entire
 * point: a cookie-bound Server Action and a bearer-token MCP request produce
 * different clients and resolve their user differently, but must produce
 * identical side effects. This function therefore NEVER calls `supabase.auth.*`
 * — the same discipline as `upsertCellCore`
 * (`src/lib/boards/actions/cell-core.ts`), whose absence caused
 * `vault/decisions/2026-07-25-gotcha-60-server-action-side-effects-invisible-to-mcp.md`.
 *
 * The item re-read here is deliberately NOT skippable by passing in a scope the
 * caller already resolved: re-deriving tenancy from the item IS the path-spoof
 * guard. Storage RLS (`attachments_obj_insert`) is the second, independent
 * layer — an application bug alone cannot cross a tenant boundary.
 *
 * Callers: `createAttachment` (`./actions.ts`, cookie client) and
 * `attachFileHandler` (`src/lib/mcp/tools/attach-file.ts`, bridged OAuth client).
 */
export async function createAttachmentCore(
  supabase: SupabaseClient<Database>,
  input: CreateAttachmentCoreInput,
  actorId: string,
): Promise<ActionResult<{ attachmentId: string }>> {
  const scope = await resolveItemScope(supabase, input.itemId);
  if (!scope) return fail("Item not found.");

  const prefix = attachmentPathPrefix({
    orgId: scope.orgId,
    boardId: scope.boardId,
    itemId: input.itemId,
    columnId: input.columnId,
  });
  if (!input.storagePath.startsWith(prefix))
    return fail("Storage path does not match this item.");

  if (input.columnId) {
    const { data: col } = await supabase
      .from("columns")
      .select("id, kind, board_id")
      .eq("id", input.columnId)
      .maybeSingle();
    if (!col || col.board_id !== scope.boardId || col.kind !== "files")
      return fail("Invalid file column.");
  }

  const { data, error } = await supabase
    .from("attachments")
    .insert({
      org_id: scope.orgId,
      board_id: scope.boardId,
      item_id: input.itemId,
      column_id: input.columnId ?? null,
      uploaded_by: actorId,
      storage_path: input.storagePath,
      file_name: input.fileName,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
    })
    .select("id")
    .single();
  if (error || !data)
    return fail(error?.message ?? "Could not register attachment.");
  return { ok: true, data: { attachmentId: data.id } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/collaboration/attachment-core.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Repoint `createAttachment` at the core**

In `src/lib/collaboration/actions.ts`, replace the whole body of `createAttachment` (lines 159-224) after the auth block, so the function reads:

```ts
export async function createAttachment(input: {
  itemId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  columnId?: string;
}): Promise<ActionResult<{ attachmentId: string }>> {
  const parsed = createAttachmentSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  // Guards + insert live in the core so the MCP path produces identical side
  // effects; this wrapper contributes only the cookie client and the actor.
  return createAttachmentCore(supabase, parsed.data, user.id);
}
```

Add `import { createAttachmentCore } from "./attachment-core";` to the imports.

- [ ] **Step 6: Verify the existing action suite still passes**

Run: `pnpm vitest run src/lib/collaboration/ && pnpm typecheck && pnpm lint`
Expected: PASS with no assertion changes. This is a behaviour-preserving extraction — if an existing `createAttachment` test fails, the core diverged from the original; diff it against `git show HEAD:src/lib/collaboration/actions.ts` before changing any test.

- [ ] **Step 7: Commit**

```bash
git add src/lib/collaboration/attachment-core.ts src/lib/collaboration/attachment-core.test.ts src/lib/collaboration/actions.ts
git commit -m "refactor(attachments): extract createAttachmentCore with injected client and actor"
```

---

### Task 5: Teach the MCP fake client Storage and attachment inserts

**Files:**

- Modify: `src/test/mcp-fake-client.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `FakeClientSpec` gains `signedUpload`, `upload`, `info`, `remove`, `attachmentInsert`, `itemScope`, `fileColumn`; `FakeCalls` gains `storage: { op: string; bucket: string; path: string }[]` and `attachments: unknown[]`.

- [ ] **Step 1: Extend the spec and calls types**

In `src/test/mcp-fake-client.ts`, first **update the header comment** — it currently claims the handlers touch "only four call shapes", which this task makes untrue:

```ts
/**
 * Test-support fake for the MCP tool handlers' Supabase surface.
 *
 * The handlers in `src/lib/mcp/tools/` touch these call shapes:
 *   - `.rpc(fn, args)`                                            (create_item)
 *   - `.from(t).select(…).eq(…).maybeSingle()`                    (column + item reads)
 *   - `.from("items").update(…).eq(…).select(…).maybeSingle()`    (rename)
 *   - `.from("cell_values").upsert(row, opts).select("*").single()` (cell write —
 *     the core reads the written row back in the SAME request so a caller can
 *     patch a mounted board without a refetch)
 *   - `.from("attachments").insert(row).select("id").single()`    (attach_file)
 *   - `.storage.from(bucket).{createSignedUploadUrl,upload,info,remove}`
 *     (create_attachment_upload + attach_file)
 *
 * A structural fake of just those is safe and keeps the `as never` cast in one
 * place. Lives in `src/test/` beside `integration-auth.ts` / `integration-env.ts`
 * — outside vitest's `src/**` + `*.{test,spec}.{ts,tsx}` include glob, so it is
 * never collected as a suite.
 */
```

Add these types near the existing ones:

```ts
export type ItemScopeRow = { org_id: string; board_id: string } | null;
export type FileColumnRow = {
  id: string;
  kind: string;
  board_id: string;
} | null;
export type AttachmentInsertRow = { id: string } | null;
export type SignedUpload = {
  signedUrl: string;
  token: string;
  path: string;
} | null;
export type ObjectInfo = { size?: number; contentType?: string } | null;
```

Extend `FakeClientSpec`:

```ts
  /** The `items` org/board read in resolveItemScope / the attachment tools. */
  itemScope?: Queued<FakeResult<ItemScopeRow>>;
  /** The `columns` read that validates a Files-column target. */
  fileColumn?: Queued<FakeResult<FileColumnRow>>;
  /** The `attachments` insert result. */
  attachmentInsert?: FakeResult<AttachmentInsertRow>;
  /** `storage.from(b).createSignedUploadUrl(path)` result. */
  signedUpload?: FakeResult<SignedUpload>;
  /** `storage.from(b).upload(path, body, opts)` result. */
  upload?: { error: FakeError };
  /** `storage.from(b).info(path)` result. */
  info?: FakeResult<ObjectInfo>;
  /** `storage.from(b).remove(paths)` result. */
  remove?: { error: FakeError };
```

Extend `FakeCalls`:

```ts
  /** Every storage operation, in order. */
  storage: { op: string; bucket: string; path: string }[];
  /** Every attachments insert, in order. */
  attachments: unknown[];
```

- [ ] **Step 2: Implement the fakes**

Add defaults beside the existing `OK_*` constants:

```ts
const OK_ITEM_SCOPE: FakeResult<ItemScopeRow> = {
  data: { org_id: "o1", board_id: "b1" },
  error: null,
};
const OK_FILE_COLUMN: FakeResult<FileColumnRow> = {
  data: { id: "col1", kind: "files", board_id: "b1" },
  error: null,
};
const OK_ATTACHMENT: FakeResult<AttachmentInsertRow> = {
  data: { id: "a1" },
  error: null,
};
const OK_SIGNED: FakeResult<SignedUpload> = {
  data: {
    signedUrl: "https://example.test/upload/signed",
    token: "tok",
    path: "p",
  },
  error: null,
};
const OK_INFO: FakeResult<ObjectInfo> = {
  data: { size: 120, contentType: "text/csv" },
  error: null,
};
```

Initialize the two new `calls` arrays (`storage: []`, `attachments: []`) and add counters `let scopeReads = 0; let fileColumnReads = 0;`.

In the `from(table)` object, the `select()` read must now route `items` and `columns` by which tool is asking. Route on the **selected column list** rather than the table alone, since `writeCellValue` and the attachment core both read `items` and `columns` with different projections. Change `select` to capture its argument:

```ts
      select: (cols?: string) => {
        const read = () => {
          if (table === "columns") {
            return cols?.includes("kind, board_id")
              ? Promise.resolve(
                  dequeue(spec.fileColumn, OK_FILE_COLUMN, fileColumnReads++),
                )
              : Promise.resolve(dequeue(spec.column, OK_COLUMN, columnReads++));
          }
          if (table === "cell_values") {
            return Promise.resolve(
              dequeue(spec.priorCell, EMPTY_CELL, priorReads++),
            );
          }
          return cols?.includes("org_id")
            ? Promise.resolve(
                dequeue(spec.itemScope, OK_ITEM_SCOPE, scopeReads++),
              )
            : Promise.resolve(dequeue(spec.item, OK_ITEM, itemReads++));
        };
        type Chain = {
          eq: () => Chain;
          maybeSingle: () => Promise<
            FakeResult<
              ColumnRow | ItemRow | CellValueRow | ItemScopeRow | FileColumnRow
            >
          >;
        };
        const chain: Chain = { eq: () => chain, maybeSingle: () => read() };
        return chain;
      },
```

Replace `insert` so `attachments` returns a `.select().single()` chain while `notifications` keeps returning a bare promise:

```ts
      insert: (rows: unknown) => {
        if (table === "attachments") {
          calls.attachments.push(rows);
          return {
            select: () => ({
              single: () =>
                Promise.resolve(spec.attachmentInsert ?? OK_ATTACHMENT),
            }),
          };
        }
        calls.notifications.push(rows);
        return Promise.resolve(spec.notify ?? { error: null });
      },
```

Add a `storage` property to the `client` object, as a sibling of `rpc` and `from`:

```ts
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: (path: string) => {
          calls.storage.push({ op: "createSignedUploadUrl", bucket, path });
          return Promise.resolve(spec.signedUpload ?? OK_SIGNED);
        },
        upload: (path: string) => {
          calls.storage.push({ op: "upload", bucket, path });
          return Promise.resolve(spec.upload ?? { error: null });
        },
        info: (path: string) => {
          calls.storage.push({ op: "info", bucket, path });
          return Promise.resolve(spec.info ?? OK_INFO);
        },
        remove: (paths: string[]) => {
          calls.storage.push({
            op: "remove",
            bucket,
            path: paths[0] ?? "",
          });
          return Promise.resolve(spec.remove ?? { error: null });
        },
      }),
    },
```

- [ ] **Step 3: Run the existing MCP suites to prove nothing regressed**

Run: `pnpm vitest run src/lib/mcp/tools/ && pnpm typecheck`
Expected: PASS. The `select(cols)` routing change touches every existing handler test — if `create-item` or `update-item` tests fail, the `cols?.includes(...)` predicates are matching the wrong read; check the exact select strings in `cell-core.ts` (`"org_id, board_id, kind"`) and `attachment-core.ts` (`"org_id, board_id"`).

- [ ] **Step 4: Commit**

```bash
git add src/test/mcp-fake-client.ts
git commit -m "test(mcp): add Storage and attachments-insert support to the fake client"
```

---

### Task 6: The `create_attachment_upload` and `attach_file` tools

**Files:**

- Create: `src/lib/mcp/tools/create-attachment-upload.ts`
- Create: `src/lib/mcp/tools/attach-file.ts`
- Create: `src/lib/mcp/tools/attach-file.test.ts`
- Create: `src/lib/mcp/tools/create-attachment-upload.test.ts`
- Modify: `src/lib/mcp/tools/register.ts`

**Interfaces:**

- Consumes: `resolveItemScope`, `attachmentPathPrefix`, `createAttachmentCore` (Task 4); `makeFakeClient` (Task 5); `buildStoragePath`, `buildColumnFilePath` from `@/lib/collaboration/attachments-path`; `GetClient`, `ToolResult` from `./shared`.
- Produces:
  - `createAttachmentUploadHandler(getClient, input): Promise<ToolResult>` — no actor; it writes nothing
  - `attachFileHandler(getClient, input, actorId): Promise<ToolResult>`
  - `registerCreateAttachmentUploadTool(server, getClient)`, `registerAttachFileTool(server, getClient, actorId)`

- [ ] **Step 1: Write the failing test for the ticket tool**

Create `src/lib/mcp/tools/create-attachment-upload.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeFakeClient } from "@/test/mcp-fake-client";
import { createAttachmentUploadHandler } from "./create-attachment-upload";

const ITEM = "11111111-1111-4111-8111-111111111111";
const COLUMN = "22222222-2222-4222-8222-222222222222";

describe("createAttachmentUploadHandler", () => {
  it("mints a ticket under the item's org/board prefix", async () => {
    const { getClient, calls } = makeFakeClient({});
    const result = await createAttachmentUploadHandler(getClient, {
      itemId: ITEM,
      fileName: "report.csv",
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.storagePath.startsWith(`o1/b1/${ITEM}/`)).toBe(true);
    expect(parsed.expiresInSeconds).toBe(7200);
    expect(parsed.maxBytes).toBe(52_428_800);
    expect(parsed.uploadUrl).toBe("https://example.test/upload/signed");
    expect(calls.getClient).toBe(1);
    expect(calls.storage[0]?.op).toBe("createSignedUploadUrl");
    expect(calls.storage[0]?.bucket).toBe("attachments");
  });

  it("nests the column id for a Files-column attachment", async () => {
    const { getClient } = makeFakeClient({});
    const result = await createAttachmentUploadHandler(getClient, {
      itemId: ITEM,
      columnId: COLUMN,
      fileName: "report.csv",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.storagePath.startsWith(`o1/b1/${ITEM}/${COLUMN}/`)).toBe(
      true,
    );
  });

  it("errors when the item is not visible", async () => {
    const { getClient } = makeFakeClient({
      itemScope: { data: null, error: null },
    });
    const result = await createAttachmentUploadHandler(getClient, {
      itemId: ITEM,
      fileName: "report.csv",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Item not found.");
  });

  it("errors when the column is not a files column on this board", async () => {
    const { getClient } = makeFakeClient({
      fileColumn: {
        data: { id: COLUMN, kind: "text", board_id: "b1" },
        error: null,
      },
    });
    const result = await createAttachmentUploadHandler(getClient, {
      itemId: ITEM,
      columnId: COLUMN,
      fileName: "report.csv",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Invalid file column.");
  });

  it("surfaces a storage failure", async () => {
    const { getClient } = makeFakeClient({
      signedUpload: { data: null, error: { message: "denied" } },
    });
    const result = await createAttachmentUploadHandler(getClient, {
      itemId: ITEM,
      fileName: "report.csv",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("denied");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/mcp/tools/create-attachment-upload.test.ts`
Expected: FAIL — `Failed to resolve import "./create-attachment-upload"`.

- [ ] **Step 3: Implement the ticket tool**

Create `src/lib/mcp/tools/create-attachment-upload.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildColumnFilePath,
  buildStoragePath,
} from "@/lib/collaboration/attachments-path";
import { resolveItemScope } from "@/lib/collaboration/attachment-core";
import type { GetClient, ToolResult } from "./shared";

/** The `attachments` bucket ceiling, mirrored from the bucket + check constraint. */
const MAX_BYTES = 52_428_800;
/** Fixed by @supabase/storage-js: createSignedUploadUrl takes only { upsert }. */
const SIGNED_UPLOAD_TTL_SECONDS = 7200;

const createAttachmentUploadInput = {
  itemId: z.string().uuid(),
  columnId: z.string().uuid().optional(),
  fileName: z.string().trim().min(1).max(255),
};

function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Takes no `actorId`: minting a ticket writes nothing, so there is no side
 * effect to attribute. The actor is stamped by `attach_file`, which does the
 * insert. Do not add an unused parameter here for symmetry with the write
 * tools — `pnpm lint` rejects unused parameters.
 */
export async function createAttachmentUploadHandler(
  getClient: GetClient,
  input: { itemId: string; columnId?: string; fileName: string },
): Promise<ToolResult> {
  const supabase = await getClient();

  const scope = await resolveItemScope(supabase, input.itemId);
  if (!scope) return err("Item not found.");

  // Validate the column BEFORE minting a ticket, so an agent never uploads
  // bytes it will not be allowed to register.
  if (input.columnId) {
    const { data: col } = await supabase
      .from("columns")
      .select("id, kind, board_id")
      .eq("id", input.columnId)
      .maybeSingle();
    if (!col || col.board_id !== scope.boardId || col.kind !== "files")
      return err("Invalid file column.");
  }

  const storagePath = input.columnId
    ? buildColumnFilePath({
        orgId: scope.orgId,
        boardId: scope.boardId,
        itemId: input.itemId,
        columnId: input.columnId,
        fileName: input.fileName,
      })
    : buildStoragePath({
        orgId: scope.orgId,
        boardId: scope.boardId,
        itemId: input.itemId,
        fileName: input.fileName,
      });

  const { data, error } = await supabase.storage
    .from("attachments")
    .createSignedUploadUrl(storagePath);
  if (error || !data) return err(error?.message ?? "Could not create upload.");

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          uploadUrl: data.signedUrl,
          token: data.token,
          storagePath,
          expiresInSeconds: SIGNED_UPLOAD_TTL_SECONDS,
          maxBytes: MAX_BYTES,
        }),
      },
    ],
  };
}

export function registerCreateAttachmentUploadTool(
  server: McpServer,
  getClient: GetClient,
): void {
  server.registerTool(
    "create_attachment_upload",
    {
      title: "Create attachment upload",
      description:
        "Start a file upload for an item. Returns a signed `uploadUrl` valid " +
        "for 2 hours and the `storagePath` to pass to `attach_file` after you " +
        "PUT the bytes. Omit `columnId` for an item-level attachment; pass a " +
        "Files column's id to attach into that cell. Max 50 MB. For files " +
        "under 128 KB you can skip this and pass `contentBase64` to " +
        "`attach_file` directly.",
      inputSchema: createAttachmentUploadInput,
    },
    async (input) => createAttachmentUploadHandler(getClient, input),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/mcp/tools/create-attachment-upload.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing test for `attach_file`**

Create `src/lib/mcp/tools/attach-file.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeFakeClient } from "@/test/mcp-fake-client";
import { attachFileHandler } from "./attach-file";

const ACTOR = "99999999-9999-4999-8999-999999999999";
const ITEM = "11111111-1111-4111-8111-111111111111";
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

describe("attachFileHandler — inline base64 branch", () => {
  it("uploads, registers, and reports the decoded size", async () => {
    const { getClient, calls } = makeFakeClient({});
    const result = await attachFileHandler(
      getClient,
      {
        itemId: ITEM,
        fileName: "notes.txt",
        mimeType: "text/plain",
        contentBase64: b64("hello world"),
      },
      ACTOR,
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.attachmentId).toBe("a1");
    expect(parsed.sizeBytes).toBe(11);
    expect(calls.getClient).toBe(1);
    expect(calls.storage.map((s) => s.op)).toEqual(["upload"]);
    expect(calls.attachments).toHaveLength(1);
  });

  it("defaults a missing mimeType to application/octet-stream", async () => {
    const { getClient, calls } = makeFakeClient({});
    await attachFileHandler(
      getClient,
      { itemId: ITEM, fileName: "blob.bin", contentBase64: b64("x") },
      ACTOR,
    );
    expect(calls.attachments[0]).toMatchObject({
      mime_type: "application/octet-stream",
    });
  });

  it("rejects content over the 128 KB inline cap", async () => {
    const { getClient, calls } = makeFakeClient({});
    const result = await attachFileHandler(
      getClient,
      {
        itemId: ITEM,
        fileName: "big.bin",
        contentBase64: "A".repeat(200_000),
      },
      ACTOR,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("128 KB");
    expect(calls.storage).toHaveLength(0);
  });

  it("rejects empty content", async () => {
    const { getClient } = makeFakeClient({});
    const result = await attachFileHandler(
      getClient,
      { itemId: ITEM, fileName: "empty.txt", contentBase64: "" },
      ACTOR,
    );
    expect(result.isError).toBe(true);
  });

  it("removes the uploaded object when registering fails", async () => {
    const { getClient, calls } = makeFakeClient({
      attachmentInsert: { data: null, error: { message: "denied" } },
    });
    const result = await attachFileHandler(
      getClient,
      { itemId: ITEM, fileName: "notes.txt", contentBase64: b64("hi") },
      ACTOR,
    );
    expect(result.isError).toBe(true);
    expect(calls.storage.map((s) => s.op)).toEqual(["upload", "remove"]);
  });
});

describe("attachFileHandler — storagePath branch", () => {
  it("takes size and mime from Storage, not the caller", async () => {
    const { getClient, calls } = makeFakeClient({
      info: {
        data: { size: 4096, contentType: "application/pdf" },
        error: null,
      },
    });
    const result = await attachFileHandler(
      getClient,
      {
        itemId: ITEM,
        fileName: "spec.pdf",
        mimeType: "text/plain",
        storagePath: `o1/b1/${ITEM}/abc-spec.pdf`,
      },
      ACTOR,
    );
    expect(result.isError).toBeUndefined();
    expect(calls.attachments[0]).toMatchObject({
      size_bytes: 4096,
      mime_type: "application/pdf",
    });
  });

  it("rejects a path outside this item before touching Storage", async () => {
    const { getClient, calls } = makeFakeClient({});
    const result = await attachFileHandler(
      getClient,
      {
        itemId: ITEM,
        fileName: "spec.pdf",
        storagePath: `other-org/b1/${ITEM}/abc-spec.pdf`,
      },
      ACTOR,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      "Storage path does not match this item.",
    );
    expect(calls.storage).toHaveLength(0);
  });

  it("errors when the object is missing (PUT never landed)", async () => {
    const { getClient, calls } = makeFakeClient({
      info: { data: null, error: { message: "Object not found" } },
    });
    const result = await attachFileHandler(
      getClient,
      {
        itemId: ITEM,
        fileName: "spec.pdf",
        storagePath: `o1/b1/${ITEM}/abc-spec.pdf`,
      },
      ACTOR,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No uploaded object");
    expect(calls.attachments).toHaveLength(0);
  });

  it("errors when Storage reports no size", async () => {
    const { getClient } = makeFakeClient({
      info: { data: { contentType: "application/pdf" }, error: null },
    });
    const result = await attachFileHandler(
      getClient,
      {
        itemId: ITEM,
        fileName: "spec.pdf",
        storagePath: `o1/b1/${ITEM}/abc-spec.pdf`,
      },
      ACTOR,
    );
    expect(result.isError).toBe(true);
  });

  // A failed register here must NOT delete the agent's object: the bytes are
  // already uploaded and the agent can simply retry attach_file with the same
  // storagePath. Deleting would turn a retryable failure into lost work.
  it("does NOT remove the object when registering fails", async () => {
    const { getClient, calls } = makeFakeClient({
      attachmentInsert: { data: null, error: { message: "denied" } },
    });
    const result = await attachFileHandler(
      getClient,
      {
        itemId: ITEM,
        fileName: "spec.pdf",
        storagePath: `o1/b1/${ITEM}/abc-spec.pdf`,
      },
      ACTOR,
    );
    expect(result.isError).toBe(true);
    expect(calls.storage.map((s) => s.op)).toEqual(["info"]);
  });
});

describe("attachFileHandler — input guards", () => {
  it("rejects supplying both byte sources", async () => {
    const { getClient } = makeFakeClient({});
    const result = await attachFileHandler(
      getClient,
      {
        itemId: ITEM,
        fileName: "x.txt",
        storagePath: `o1/b1/${ITEM}/abc-x.txt`,
        contentBase64: b64("hi"),
      },
      ACTOR,
    );
    expect(result.isError).toBe(true);
  });

  it("rejects supplying neither byte source", async () => {
    const { getClient } = makeFakeClient({});
    const result = await attachFileHandler(
      getClient,
      { itemId: ITEM, fileName: "x.txt" },
      ACTOR,
    );
    expect(result.isError).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm vitest run src/lib/mcp/tools/attach-file.test.ts`
Expected: FAIL — `Failed to resolve import "./attach-file"`.

- [ ] **Step 7: Implement `attach_file`**

Create `src/lib/mcp/tools/attach-file.ts`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildColumnFilePath,
  buildStoragePath,
} from "@/lib/collaboration/attachments-path";
import {
  attachmentPathPrefix,
  createAttachmentCore,
  resolveItemScope,
} from "@/lib/collaboration/attachment-core";
import type { GetClient, ToolResult } from "./shared";

/** Decoded-bytes ceiling for the inline branch. Base64 costs ~1.37 tokens/byte,
 *  so 128 KB is ~44k tokens in one tool call — the point where a bigger file
 *  should go through create_attachment_upload instead. */
const MAX_INLINE_BYTES = 131_072;
const DEFAULT_MIME = "application/octet-stream";

const attachFileInput = {
  itemId: z.string().uuid(),
  columnId: z.string().uuid().optional(),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255).optional(),
  storagePath: z.string().min(1).max(1024).optional(),
  contentBase64: z.string().optional(),
};

type AttachFileInput = {
  itemId: string;
  columnId?: string;
  fileName: string;
  mimeType?: string;
  storagePath?: string;
  contentBase64?: string;
};

function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** Strict base64: `Buffer.from` silently ignores junk, which would let a
 *  malformed body through as a shorter file than the agent intended. */
function decodeBase64(raw: string): Buffer | null {
  const cleaned = raw.trim();
  if (cleaned.length === 0 || cleaned.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) return null;
  return Buffer.from(cleaned, "base64");
}

export async function attachFileHandler(
  getClient: GetClient,
  input: AttachFileInput,
  actorId: string,
): Promise<ToolResult> {
  const hasPath = input.storagePath !== undefined;
  const hasInline = input.contentBase64 !== undefined;
  if (hasPath === hasInline)
    return err(
      "Provide exactly one of `storagePath` (after uploading to a " +
        "create_attachment_upload URL) or `contentBase64` (files under 128 KB).",
    );

  const supabase = await getClient();

  const scope = await resolveItemScope(supabase, input.itemId);
  if (!scope) return err("Item not found.");

  const prefix = attachmentPathPrefix({
    orgId: scope.orgId,
    boardId: scope.boardId,
    itemId: input.itemId,
    columnId: input.columnId,
  });

  let storagePath: string;
  let sizeBytes: number;
  let mimeType: string;
  // Only the inline branch owns the bytes it wrote, so only it cleans up.
  let cleanupOnFailure = false;

  if (hasInline) {
    const bytes = decodeBase64(input.contentBase64 ?? "");
    if (!bytes || bytes.byteLength === 0)
      return err("`contentBase64` is empty or not valid base64.");
    if (bytes.byteLength > MAX_INLINE_BYTES)
      return err(
        `Inline content is ${bytes.byteLength} bytes; the limit is 128 KB. ` +
          "Use create_attachment_upload for larger files.",
      );

    storagePath = input.columnId
      ? buildColumnFilePath({
          orgId: scope.orgId,
          boardId: scope.boardId,
          itemId: input.itemId,
          columnId: input.columnId,
          fileName: input.fileName,
        })
      : buildStoragePath({
          orgId: scope.orgId,
          boardId: scope.boardId,
          itemId: input.itemId,
          fileName: input.fileName,
        });
    mimeType = input.mimeType ?? DEFAULT_MIME;
    sizeBytes = bytes.byteLength;

    const { error: upErr } = await supabase.storage
      .from("attachments")
      .upload(storagePath, bytes, { contentType: mimeType });
    if (upErr) return err(upErr.message);
    cleanupOnFailure = true;
  } else {
    storagePath = input.storagePath ?? "";
    // Guard before touching Storage so a spoofed path costs nothing.
    if (!storagePath.startsWith(prefix))
      return err("Storage path does not match this item.");

    const { data: info, error: infoErr } = await supabase.storage
      .from("attachments")
      .info(storagePath);
    if (infoErr || !info)
      return err(
        "No uploaded object at that storagePath. Upload the bytes to the " +
          "`uploadUrl` from create_attachment_upload first (tickets expire " +
          "after 2 hours).",
      );
    if (typeof info.size !== "number" || info.size <= 0)
      return err("Uploaded object reports no size.");
    sizeBytes = info.size;
    mimeType = info.contentType ?? input.mimeType ?? DEFAULT_MIME;
  }

  const registered = await createAttachmentCore(
    supabase,
    {
      itemId: input.itemId,
      columnId: input.columnId,
      storagePath,
      fileName: input.fileName,
      mimeType,
      sizeBytes,
    },
    actorId,
  );

  if (!registered.ok) {
    if (cleanupOnFailure) {
      await supabase.storage.from("attachments").remove([storagePath]);
    }
    return err(registered.error);
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          attachmentId: registered.data.attachmentId,
          storagePath,
          fileName: input.fileName,
          sizeBytes,
          mimeType,
        }),
      },
    ],
  };
}

export function registerAttachFileTool(
  server: McpServer,
  getClient: GetClient,
  actorId: string,
): void {
  server.registerTool(
    "attach_file",
    {
      title: "Attach file",
      description:
        "Attach a file to an item. Provide EITHER `contentBase64` (files under " +
        "128 KB, uploaded inline) OR `storagePath` returned by " +
        "create_attachment_upload after you PUT the bytes to its `uploadUrl`. " +
        "Omit `columnId` for an item-level attachment; pass a Files column's id " +
        "to attach into that cell. Size and type are read from storage, not " +
        "from you. Attachments cannot be deleted through this server.",
      inputSchema: attachFileInput,
    },
    async (input) => attachFileHandler(getClient, input, actorId),
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run src/lib/mcp/tools/attach-file.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 9: Register both tools**

In `src/lib/mcp/tools/register.ts`, add the imports:

```ts
import { registerCreateAttachmentUploadTool } from "./create-attachment-upload";
import { registerAttachFileTool } from "./attach-file";
```

and, inside `registerTools`, after `registerUpdateItemTool(server, getClient, actorId);`:

```ts
registerCreateAttachmentUploadTool(server, getClient);
registerAttachFileTool(server, getClient, actorId);
```

- [ ] **Step 10: Run the full gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/lib/mcp/tools/create-attachment-upload.ts src/lib/mcp/tools/create-attachment-upload.test.ts src/lib/mcp/tools/attach-file.ts src/lib/mcp/tools/attach-file.test.ts src/lib/mcp/tools/register.ts
git commit -m "feat(mcp): add create_attachment_upload and attach_file tools"
```

---

### Task 7: Cross-org RLS integration test for the attachment path

**Files:**

- Create: `src/lib/mcp/tools/attachments.rls.integration.test.ts`

**Interfaces:**

- Consumes: `createAttachmentUploadHandler`, `attachFileHandler` (Task 6); `loadIntegrationEnv`, `integrationTargetReady` from `@/test/integration-env`; `runTeardownSteps` from `@/test/teardown-steps`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the test**

Create `src/lib/mcp/tools/attachments.rls.integration.test.ts`. Mirror the fixture scaffolding of `src/lib/mcp/tools/cross-org-access.rls.integration.test.ts` — same `loadIntegrationEnv()` at module top, same `describe.skipIf(!integrationTargetReady())`, and the same **deferred dynamic import** of `@/lib/mcp/oauth/session-bridge` inside `beforeAll` (a static import resolves before `loadIntegrationEnv()` overrides `process.env` and bakes in vitest.setup.ts's placeholder URL). Read that file first and copy its `beforeAll`/`afterAll` structure verbatim, changing only the fixtures below.

Declare exactly these fixtures in the `describe` scope; the assertions below use them by name and will not compile otherwise:

```ts
let admin: ReturnType<typeof createClient<Database>>; // service-role, setup/teardown ONLY
let orgAUserId: string;
let orgAId: string;
let orgABoardId: string;
let orgAItemId: string;
let orgBId: string;
let orgBBoardId: string;
let orgBItemId: string;
/** Org A's bridged client, wrapped as a GetClient — the subject under test. */
let orgAGetClient: GetClient;
/** storagePaths created by the passing test, removed in afterAll. */
const createdPaths: string[] = [];
```

Build each org in `beforeAll` with the service-role `admin` client: create the user, org, membership, board, group, and one item, exactly as `cross-org-access.rls.integration.test.ts` does. Then mint org A's bridged client via `mintBridgeSecret` + `getBridgedClient` and wrap it:
`orgAGetClient = async () => orgAClient;`

Note `orgAId` and `orgABoardId` are used only to construct fixtures and to assert the successful path's prefix; if your setup does not need them, drop them rather than leaving unused bindings (`pnpm lint` will fail on them).

The four assertions that matter:

```ts
it("cannot mint an upload ticket for another org's item", async () => {
  const result = await createAttachmentUploadHandler(orgAGetClient, {
    itemId: orgBItemId,
    fileName: "steal.csv",
  });
  // RLS hides the item entirely from org A, so scope resolution fails.
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toBe("Item not found.");
});

it("cannot register an attachment onto another org's item", async () => {
  const result = await attachFileHandler(
    orgAGetClient,
    {
      itemId: orgBItemId,
      fileName: "steal.csv",
      contentBase64: Buffer.from("x", "utf8").toString("base64"),
    },
    orgAUserId,
  );
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toBe("Item not found.");
});

it("cannot register a path pointing at another org's storage prefix", async () => {
  const result = await attachFileHandler(
    orgAGetClient,
    {
      itemId: orgAItemId,
      fileName: "steal.csv",
      storagePath: `${orgBId}/${orgBBoardId}/${orgBItemId}/abc-steal.csv`,
    },
    orgAUserId,
  );
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toBe("Storage path does not match this item.");
});

it("attaches successfully within the caller's own org", async () => {
  const result = await attachFileHandler(
    orgAGetClient,
    {
      itemId: orgAItemId,
      fileName: "own.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from("mine", "utf8").toString("base64"),
    },
    orgAUserId,
  );
  expect(result.isError).toBeUndefined();
  const parsed = JSON.parse(result.content[0].text);
  expect(parsed.sizeBytes).toBe(4);
  createdPaths.push(parsed.storagePath);
});
```

The last test is the control: without it, all three negatives would still pass if the handlers were broken and always errored.

- [ ] **Step 2: Add storage teardown**

Track every `storagePath` the passing test creates in a `createdPaths: string[]`, and in `afterAll` remove the objects before the DB rows cascade, using the service-role `admin` client:

```ts
if (createdPaths.length > 0) {
  await admin.storage.from("attachments").remove(createdPaths);
}
```

Register it alongside the existing `runTeardownSteps` calls so a mid-suite failure still cleans up. **This matters:** the suite writes to the DEV project, which per `AGENTS.md` holds real, live, user-facing data — leaked test objects are real storage in a real tenant.

- [ ] **Step 3: Run the integration suite against DEV**

Run: `PULSE_TEST_DB=1 pnpm vitest run src/lib/mcp/tools/attachments.rls.integration.test.ts`
Expected: PASS (4 tests). Without `PULSE_TEST_DB` set, expect SKIPPED — confirm both, since a suite that silently skips in CI proves nothing.

- [ ] **Step 4: Commit**

```bash
git add src/lib/mcp/tools/attachments.rls.integration.test.ts
git commit -m "test(mcp): cross-org RLS coverage for the attachment tools"
```

---

## Closing the task

- [ ] Run the full gates from inside the worktree: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
- [ ] Run `scripts/finish-task.sh` (rebases onto latest `develop`, re-runs gates against the merged state, merges, pushes, removes the worktree and branch)
- [ ] Write the "How to test this" walkthrough — see below

## How to test this (manual acceptance)

There is no UI surface, so acceptance runs through an MCP client. With Hermes (or any OAuth-connected MCP client) pointed at the deployment:

1. Call `get_board` for a board that has a Status column. Confirm each column now carries `writable` and `valueShape`, and that the Status column lists `options` with `id`, `label`, and `color`.
2. Call `update_item` on an item from that board, setting the Status column to `{ "optionId": "<an id from step 1>" }`. Confirm it succeeds and the new status shows on the board in the browser.
3. Confirm a relation or mirror column reports `"writable": false` — and that attempting to write it still fails, now with the agent forewarned.
4. Call `attach_file` with `fileName: "test.txt"` and `contentBase64` of a short string. Open the item in the browser and confirm the file appears in its Files tab with the right name and size.
5. Call `create_attachment_upload` for a larger file, PUT the bytes to the returned `uploadUrl`, then call `attach_file` with the returned `storagePath`. Confirm it appears on the item and that the size shown matches the real file — not anything the client claimed.
6. Negative check: call `attach_file` with a `storagePath` from a different item. Expect `Storage path does not match this item.` and no new attachment.
