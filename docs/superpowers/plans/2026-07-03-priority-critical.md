# Priority Field + Auto-Critical Flagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `priority` board column kind (Normal / Critical, user-editable) whose displayed
state auto-escalates to Critical — derived at render time, never stored — when 2 or more items
depend on the item.

**Architecture:** One additive enum migration adds the `priority` column kind; the kind then rides
the existing compiler-enforced registries (Zod, kind meta, renderer, editor, codec, aggregation).
The auto-Critical signal is a pure client derivation from `BoardCache.dependencies` (already in
every board payload), mirroring the overdue-tint precedent (`src/lib/boards/overdue.ts`): a
memoized `Map<predecessorId, dependentCount>` built once per dependencies change, threaded into
cells as a `dependents` prop the way `overdue` already is. Nothing auto is written to the DB.

**Tech Stack:** Next.js 16 (App Router) + Supabase (Postgres enum migration), Zod 4, Tailwind v4
semantic tokens (pulse-ui), Vitest + Testing Library, lucide-react.

**Spec:** `docs/superpowers/specs/2026-07-03-priority-critical-design.md` — read it first; its
"Precedence" section is normative.

## Global Constraints

- **Migration version slot is fixed: `20260703110000`** — reserved per
  `vault/decisions/2026-07-03-gotcha-43-parallel-branch-migration-version-collision.md` (the
  parallel health-summary branch may mint other `202607031xxxxx` versions; this branch creates
  exactly one migration, `20260703110000_priority_enum.sql`, and no other).
- **Manual-apply gate:** the agent cannot apply migrations (classifier denies `db push` /
  `apply_migration`). The user applies the SQL in the Supabase SQL editor; only then run
  `pnpm db:types`. This branch owns the schema change so it DOES regenerate types (gotcha-43
  rule 2); a union with sibling unmerged enum values in the regenerated file is expected and
  accepted.
- **Never hand-edit `src/types/database.types.ts`.**
- Cell value shape: `{ "level": "normal" | "critical" }`. Threshold: `dependents >= 2`, direct
  successors only. Precedence: manual Critical → Critical; `dependents >= 2` → Critical (auto)
  even over manual Normal; stored value is never mutated by the rule.
- pulse-ui: semantic tokens only (`bg-status-red`, `text-muted-foreground`); no raw Tailwind
  colors; state never conveyed by color alone (label text + `title`/`aria-label` on the auto
  pill).
- Commits: lowercase conventional subject, descriptive body, trailer
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Stage by explicit path only.
- Gates before finish: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

### Task 1: `priority` enum migration + regenerated types

**Files:**

- Create: `supabase/migrations/20260703110000_priority_enum.sql`
- Regenerate: `src/types/database.types.ts` (via `pnpm db:types` — never by hand)

**Interfaces:**

- Consumes: nothing (first task).
- Produces: DB enum value `priority` on `public.column_kind`; regenerated
  `Database["public"]["Enums"]["column_kind"]` including `"priority"` — Task 2's
  `columnKindSchema` addition typechecks only after this lands.

- [ ] **Step 1: Write the migration file**

```sql
-- MVP Final item 5: add the priority column kind (Normal / Critical).
-- Enum-only migration: ALTER TYPE ... ADD VALUE is additive and must not be
-- referenced by later statements in the same transaction. Mirrors
-- 20260623000000_percent_enum.sql and 20260703090000_currency_enum.sql.
-- Priority cells store { "level": "normal" | "critical" } jsonb; the
-- auto-Critical (>= 2 dependents) state is DERIVED at render time from
-- item_dependencies already in the board payload and is never persisted
-- (spec: docs/superpowers/specs/2026-07-03-priority-critical-design.md).
-- Version slot 20260703110000 reserved per gotcha-43 (parallel-branch
-- migration version collision).
alter type public.column_kind add value if not exists 'priority';
```

- [ ] **Step 2: Ask the user to apply it (manual gate)**

Post the SQL and ask the user to run it against the dev project (hjqca… — note the
`.mcp.json` labels are inverted; see memory `supabase-env-labels-inverted`). Wait for
confirmation. Verify with a read-only check (allowed):
`select unnest(enum_range(null::public.column_kind));` should include `priority`.

- [ ] **Step 3: Regenerate types**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` diff shows `"priority"` added to the `column_kind`
union. If sibling-branch enum values also appear (gotcha-41), keep them — planned artifact.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260703110000_priority_enum.sql src/types/database.types.ts
git commit -m "feat(boards): add priority column kind enum" \
  -m "Additive column_kind enum value for MVP item 5 (priority field). Cells store { level: normal|critical }; the auto-critical display state is derived at render time from dependency counts and never persisted. Version slot 20260703110000 reserved per gotcha-43." \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Validation + kind registries (compiler-forced sweep)

**Files:**

- Modify: `src/lib/validations/boards.ts` (columnKindSchema, priorityValueSchema,
  columnSettingsSchema switch, cellValueSchema switch)
- Modify: `src/lib/boards/column-kinds.ts` (COLUMN_KIND_META, COLUMN_KIND_ORDER)
- Modify: `src/lib/boards/column-defaults.ts` (DEFAULT_NAME)
- Test: `src/lib/validations/boards.test.ts`, `src/lib/boards/column-defaults.test.ts`,
  `src/lib/boards/column-kinds.test.ts`

**Interfaces:**

- Consumes: `ColumnKind` including `"priority"` (Task 1's regenerated types).
- Produces: `priorityValueSchema` (zod object `{ level: z.enum(["normal","critical"]) }`),
  exported from `@/lib/validations/boards`; `cellValueSchema("priority")` → that schema;
  `columnSettingsSchema("priority")` → `emptySettingsSchema`; Add-column metadata
  `{ label: "Priority", Icon: Flag, hasOptions: false }`; `defaultColumn("priority")` →
  `{ name: "Priority", settings: {} }`. Later tasks import the value type as
  `{ level: "normal" | "critical" }`.

- [ ] **Step 1: Write failing tests**

In `src/lib/validations/boards.test.ts` (append to the existing describe structure):

```ts
import {
  priorityValueSchema,
  cellValueSchema,
  columnKindSchema,
  columnSettingsSchema,
} from "./boards";

describe("priority column kind", () => {
  it("is a known column kind", () => {
    expect(columnKindSchema.safeParse("priority").success).toBe(true);
  });
  it("accepts normal and critical levels", () => {
    expect(priorityValueSchema.safeParse({ level: "normal" }).success).toBe(
      true,
    );
    expect(priorityValueSchema.safeParse({ level: "critical" }).success).toBe(
      true,
    );
  });
  it("rejects unknown levels and junk", () => {
    expect(priorityValueSchema.safeParse({ level: "urgent" }).success).toBe(
      false,
    );
    expect(priorityValueSchema.safeParse({}).success).toBe(false);
    expect(
      cellValueSchema("priority").safeParse({ level: "high" }).success,
    ).toBe(false);
  });
  it("uses empty settings (fixed vocabulary, no options)", () => {
    expect(columnSettingsSchema("priority").safeParse({}).success).toBe(true);
    expect(
      columnSettingsSchema("priority").safeParse({ options: [] }).success,
    ).toBe(false); // strict: no options array on priority
  });
});
```

In `src/lib/boards/column-defaults.test.ts`:

```ts
it("defaults a priority column", () => {
  expect(defaultColumn("priority")).toEqual({ name: "Priority", settings: {} });
});
```

In `src/lib/boards/column-kinds.test.ts`:

```ts
it("registers priority in the add-column menu", () => {
  expect(COLUMN_KIND_META.priority).toMatchObject({
    label: "Priority",
    hasOptions: false,
  });
  expect(COLUMN_KIND_ORDER).toContain("priority");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/validations/boards.test.ts src/lib/boards/column-defaults.test.ts src/lib/boards/column-kinds.test.ts`
Expected: FAIL — `priorityValueSchema` not exported; enum parse fails; meta key missing.

- [ ] **Step 3: Implement**

`src/lib/validations/boards.ts` — add `"priority"` to the `columnKindSchema` z.enum array;
add after `percentValueSchema`:

```ts
// Priority cells store a fixed two-level value. The auto-critical (>= 2
// dependents) state is derived at render time (src/lib/boards/priority.ts)
// and is NEVER stored — this schema is only the manual value.
export const priorityValueSchema = z.object({
  level: z.enum(["normal", "critical"]),
});
export type PriorityValue = z.infer<typeof priorityValueSchema>;
```

Add `case "priority": return priorityValueSchema;` to `cellValueSchema` and move
`"priority"` into the `emptySettingsSchema` group of `columnSettingsSchema` (alongside
`percent`).

`src/lib/boards/column-kinds.ts` — import `Flag` from lucide-react; add
`priority: { label: "Priority", Icon: Flag, hasOptions: false },` to `COLUMN_KIND_META` and
`"priority"` to the end of `COLUMN_KIND_ORDER`.

`src/lib/boards/column-defaults.ts` — add `priority: "Priority",` to `DEFAULT_NAME` (no
settings branch — falls through to `{}`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/validations/boards.test.ts src/lib/boards/column-defaults.test.ts src/lib/boards/column-kinds.test.ts`
Expected: PASS. Also run `pnpm typecheck` — it will FAIL on the not-yet-updated exhaustive
switches (`aggregation.ts`, `cell-codec.ts`, `rollup.ts`): that is Task 3's and Task 8's work.
If executing tasks in parallel waves, expect green typecheck only at the end of wave 2 (see
Execution DAG); within this task only the three test files above must pass.

- [ ] **Step 5: Add the minimal exhaustive-switch stubs so typecheck stays green at this commit**

To keep every commit green (repo rule), include the _neutral_ cases the compiler forces, which
Task 8 then upgrades with real behavior + tests:

`src/lib/boards/aggregation.ts` (`allowedAggregations`):

```ts
    case "priority":
      return ["distribution", ...COUNT_FAMILY];
```

`src/lib/boards/rollup.ts` (`rollupCell` switch — count levels into a fixed-segment
distribution; colors match the seeded option palette reds/grays):

```ts
    case "priority": {
      let critical = 0;
      let normal = 0;
      for (const v of present) {
        const level = (v as { level?: unknown }).level;
        if (level === "critical") critical += 1;
        else if (level === "normal") normal += 1;
      }
      if (critical + normal === 0) return { kind: "blank" };
      return {
        kind: "distribution",
        total: critical + normal,
        segments: [
          ...(critical > 0
            ? [{ id: "critical", label: "Critical", color: "#e2445c", count: critical }]
            : []),
          ...(normal > 0
            ? [{ id: "normal", label: "Normal", color: "#c4c4c4", count: normal }]
            : []),
        ],
      };
    }
```

`src/lib/boards/spreadsheet/cell-codec.ts` (`cellToText` switch):

```ts
      case "priority":
        return (value as { level?: unknown }).level === "critical"
          ? "Critical"
          : (value as { level?: unknown }).level === "normal"
            ? "Normal"
            : "";
```

(Import-side `textToCell` takes `ImportableKind`, unchanged until Task 8.)

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/validations/boards.ts src/lib/validations/boards.test.ts \
  src/lib/boards/column-kinds.ts src/lib/boards/column-kinds.test.ts \
  src/lib/boards/column-defaults.ts src/lib/boards/column-defaults.test.ts \
  src/lib/boards/aggregation.ts src/lib/boards/rollup.ts \
  src/lib/boards/spreadsheet/cell-codec.ts
git commit -m "feat(boards): register priority kind in validation and column registries" \
  -m "Adds priorityValueSchema ({ level: normal|critical }), empty settings, add-column meta (Flag icon), default name, and the compiler-forced neutral cases in aggregation, rollup, and the spreadsheet codec. Auto-critical derivation lands separately in src/lib/boards/priority.ts." \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Derived-priority helper (pure module)

**Files:**

- Create: `src/lib/boards/priority.ts`
- Test: `src/lib/boards/priority.test.ts`

**Interfaces:**

- Consumes: `CacheDependency` type from `@/lib/boards/cache` (existing; no Task 1/2 output —
  this task is fully parallel with them).
- Produces:
  - `AUTO_CRITICAL_MIN_DEPENDENTS: number` (= 2)
  - `buildDependentsCountMap(dependencies: readonly Pick<CacheDependency, "predecessor_id">[]): Map<string, number>`
  - `effectivePriority(value: unknown, dependents: number): { level: "normal" | "critical"; auto: boolean }`
    Tasks 4–7 and 9 import these exact names from `@/lib/boards/priority`.

- [ ] **Step 1: Write failing tests** (`src/lib/boards/priority.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import {
  AUTO_CRITICAL_MIN_DEPENDENTS,
  buildDependentsCountMap,
  effectivePriority,
} from "./priority";

const dep = (predecessor_id: string) => ({ predecessor_id });

describe("buildDependentsCountMap", () => {
  it("counts direct dependents per predecessor", () => {
    const map = buildDependentsCountMap([dep("a"), dep("a"), dep("b")]);
    expect(map.get("a")).toBe(2);
    expect(map.get("b")).toBe(1);
    expect(map.get("zzz")).toBeUndefined();
  });
  it("is empty for no edges", () => {
    expect(buildDependentsCountMap([]).size).toBe(0);
  });
});

describe("effectivePriority", () => {
  it("threshold is 2", () => {
    expect(AUTO_CRITICAL_MIN_DEPENDENTS).toBe(2);
  });
  it("is normal by default (unset, 0/1 dependents)", () => {
    expect(effectivePriority(null, 0)).toEqual({
      level: "normal",
      auto: false,
    });
    expect(effectivePriority(null, 1)).toEqual({
      level: "normal",
      auto: false,
    });
  });
  it("auto-escalates at 2+ dependents", () => {
    expect(effectivePriority(null, 2)).toEqual({
      level: "critical",
      auto: true,
    });
    expect(effectivePriority(null, 3)).toEqual({
      level: "critical",
      auto: true,
    });
  });
  it("manual critical wins and is not marked auto", () => {
    expect(effectivePriority({ level: "critical" }, 0)).toEqual({
      level: "critical",
      auto: false,
    });
    expect(effectivePriority({ level: "critical" }, 5)).toEqual({
      level: "critical",
      auto: false,
    });
  });
  it("auto overrides manual normal for display", () => {
    expect(effectivePriority({ level: "normal" }, 2)).toEqual({
      level: "critical",
      auto: true,
    });
  });
  it("self-clears back to the stored value when dependents drop", () => {
    expect(effectivePriority({ level: "normal" }, 1)).toEqual({
      level: "normal",
      auto: false,
    });
  });
  it("treats malformed values as unset", () => {
    expect(effectivePriority({ level: "urgent" }, 0)).toEqual({
      level: "normal",
      auto: false,
    });
    expect(effectivePriority("critical", 0)).toEqual({
      level: "normal",
      auto: false,
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/boards/priority.test.ts`
Expected: FAIL — module `./priority` not found.

- [ ] **Step 3: Implement** (`src/lib/boards/priority.ts`)

```ts
// Pure render-time priority derivation. Spec (priority-critical, 2026-07-03):
// effective = critical iff stored.level === "critical" OR >= 2 direct
// dependents; the stored value is never mutated by the rule (self-clearing,
// like the overdue tint — zero schema, 0 extra round-trips, gotcha-09).
import type { CacheDependency } from "@/lib/boards/cache";

/** Direct dependents required before an item auto-reads Critical. */
export const AUTO_CRITICAL_MIN_DEPENDENTS = 2;

/**
 * One O(E) pass over the board's dependency edges → predecessor id → count of
 * direct successors. Memoize on `cache.dependencies` at the call site so
 * per-row lookups are O(1).
 */
export function buildDependentsCountMap(
  dependencies: readonly Pick<CacheDependency, "predecessor_id">[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const d of dependencies) {
    map.set(d.predecessor_id, (map.get(d.predecessor_id) ?? 0) + 1);
  }
  return map;
}

/**
 * Displayed priority for a cell. `auto: true` only when the dependents
 * threshold (not a manual Critical) caused the escalation — it drives the
 * distinguishing icon + "Critical (auto)" label.
 */
export function effectivePriority(
  value: unknown,
  dependents: number,
): { level: "normal" | "critical"; auto: boolean } {
  const stored =
    typeof value === "object" && value !== null
      ? (value as { level?: unknown }).level
      : undefined;
  if (stored === "critical") return { level: "critical", auto: false };
  if (dependents >= AUTO_CRITICAL_MIN_DEPENDENTS)
    return { level: "critical", auto: true };
  return { level: "normal", auto: false };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/lib/boards/priority.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/priority.ts src/lib/boards/priority.test.ts
git commit -m "feat(boards): derived auto-critical priority helper" \
  -m "Pure render-time derivation from the board payload's dependency edges: buildDependentsCountMap (one O(E) pass) + effectivePriority (manual critical wins; >= 2 direct dependents auto-escalates over manual normal; self-clearing). Overdue-tint precedent — nothing persisted." \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `PriorityCell` renderer + `CellRenderer` dispatch

**Files:**

- Modify: `src/components/boards/cells/index.tsx` (new `PriorityCell`, `CellRenderer` case +
  `dependents?: number` prop)
- Test: `src/components/boards/cells/cells.test.tsx`

**Interfaces:**

- Consumes: `effectivePriority` from `@/lib/boards/priority` (Task 3); `"priority"` kind
  (Task 2).
- Produces: `PriorityCell({ value, settings, dependents })` exported from
  `@/components/boards/cells`; `CellRenderer` accepts optional `dependents?: number` (used only
  by the priority case — Tasks 6/7 pass it).

- [ ] **Step 1: Write failing tests** (append to `cells.test.tsx`, following its existing
      render-helper conventions)

```tsx
describe("PriorityCell", () => {
  it("renders a red Critical pill for a manual critical value", () => {
    render(
      <CellRenderer
        kind="priority"
        value={{ level: "critical" }}
        settings={{}}
        dependents={0}
      />,
    );
    const pill = screen.getByText("Critical");
    expect(pill.closest("span")).toHaveClass("bg-status-red");
    expect(screen.queryByLabelText(/auto/i)).not.toBeInTheDocument();
  });
  it("renders the auto variant with count explanation at 2+ dependents", () => {
    render(
      <CellRenderer
        kind="priority"
        value={null}
        settings={{}}
        dependents={3}
      />,
    );
    const pill = screen.getByLabelText(
      "Critical (auto) — 3 items depend on this",
    );
    expect(pill).toHaveTextContent("Critical");
  });
  it("auto overrides an explicit normal", () => {
    render(
      <CellRenderer
        kind="priority"
        value={{ level: "normal" }}
        settings={{}}
        dependents={2}
      />,
    );
    expect(screen.getByText("Critical")).toBeInTheDocument();
  });
  it("renders explicit normal as quiet text", () => {
    render(
      <CellRenderer
        kind="priority"
        value={{ level: "normal" }}
        settings={{}}
        dependents={1}
      />,
    );
    const el = screen.getByText("Normal");
    expect(el).toHaveClass("text-muted-foreground");
  });
  it("renders blank when unset and below threshold", () => {
    const { container } = render(
      <CellRenderer
        kind="priority"
        value={null}
        settings={{}}
        dependents={1}
      />,
    );
    expect(container).not.toHaveTextContent("Critical");
    expect(container).not.toHaveTextContent("Normal");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/components/boards/cells/cells.test.tsx`
Expected: FAIL — priority kind falls through `CellRenderer`'s `default: return null`.

- [ ] **Step 3: Implement** (in `src/components/boards/cells/index.tsx`)

Add import `import { Network } from "lucide-react";` (extend the existing lucide import),
`import { effectivePriority } from "@/lib/boards/priority";`, then:

```tsx
/**
 * Priority cell — fixed Normal/Critical vocabulary. Critical is the earned
 * red (status token, never raw color); the auto variant (>= 2 dependents,
 * derived render-time — see @/lib/boards/priority) adds a small network icon
 * and a title/aria explanation so "auto" never reads as a stuck manual value.
 */
export function PriorityCell({
  value,
  dependents = 0,
}: {
  value: { level: "normal" | "critical" } | null;
  settings: Settings;
  /** Direct dependents of this item (derived at the row-render site). */
  dependents?: number;
}) {
  const { level, auto } = effectivePriority(value, dependents);
  if (level === "critical") {
    const label = auto
      ? `Critical (auto) — ${dependents} items depend on this`
      : "Critical";
    return (
      <span
        aria-label={label}
        title={label}
        className="bg-status-red inline-flex max-w-full items-center gap-1 truncate rounded-md px-2.5 py-0.5 text-xs font-medium text-white"
      >
        {auto && <Network className="size-3 shrink-0" aria-hidden />}
        Critical
      </span>
    );
  }
  // Explicit Normal reads as quiet metadata; unset stays blank (no per-row noise).
  if (value?.level === "normal")
    return <span className="text-muted-foreground text-sm">Normal</span>;
  return <span className="text-sm" />;
}
```

In `CellRenderer`: add `dependents?: number` to the props (JSDoc: "Priority cells only:
direct dependents of the item — see @/lib/boards/priority.") and the case:

```tsx
    case "priority":
      return (
        <PriorityCell
          value={value as { level: "normal" | "critical" } | null}
          settings={settings}
          dependents={dependents}
        />
      );
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/components/boards/cells/cells.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/cells/index.tsx src/components/boards/cells/cells.test.tsx
git commit -m "feat(boards): priority cell renderer with derived auto-critical state" \
  -m "PriorityCell renders the earned status-red pill for effective-critical (auto variant carries a network icon plus a title/aria count explanation), quiet muted text for explicit normal, and blank when unset. CellRenderer gains an optional dependents prop threaded like the date overdue flag." \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `PriorityEditor` + `CellEditor` dispatch

**Files:**

- Modify: `src/components/boards/cells/editors/index.tsx` (new `PriorityEditor`, `CellEditor`
  case + `dependents?: number` passthrough)
- Test: `src/components/boards/cells/editors/editors.test.tsx`

**Interfaces:**

- Consumes: `EditorProps<V>` + `PopoverSurface` + `ClearOptionButton` (existing in the file);
  `effectivePriority` / `AUTO_CRITICAL_MIN_DEPENDENTS` (Task 3); `"priority"` kind (Task 2).
- Produces: `PriorityEditor(props: EditorProps<{ level: "normal" | "critical" }> & { dependents?: number })`;
  `CellEditor` accepts and forwards `dependents?: number`. Commit shape is exactly
  `{ level: "normal" | "critical" }` (Task 6's upsert path validates it against
  `priorityValueSchema`).

- [ ] **Step 1: Write failing tests** (append to `editors.test.tsx` using its existing
      user-event conventions)

```tsx
describe("PriorityEditor", () => {
  it("commits critical", async () => {
    const onCommit = vi.fn();
    render(
      <CellEditor
        kind="priority"
        value={null}
        settings={{}}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("option", { name: /critical/i }));
    expect(onCommit).toHaveBeenCalledWith({ level: "critical" });
  });
  it("commits normal", async () => {
    const onCommit = vi.fn();
    render(
      <CellEditor
        kind="priority"
        value={{ level: "critical" }}
        settings={{}}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("option", { name: /normal/i }));
    expect(onCommit).toHaveBeenCalledWith({ level: "normal" });
  });
  it("clears via the clear affordance", async () => {
    const onClear = vi.fn();
    render(
      <CellEditor
        kind="priority"
        value={{ level: "normal" }}
        settings={{}}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onClear={onClear}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onClear).toHaveBeenCalled();
  });
  it("explains the auto state when 2+ items depend on the item", () => {
    render(
      <CellEditor
        kind="priority"
        value={{ level: "normal" }}
        settings={{}}
        dependents={4}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/auto-critical: 4 items depend on this item/i),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/components/boards/cells/editors/editors.test.tsx`
Expected: FAIL — `CellEditor` has no priority case.

- [ ] **Step 3: Implement**

Add `import { effectivePriority, AUTO_CRITICAL_MIN_DEPENDENTS } from "@/lib/boards/priority";`
then, after `StatusEditor`:

```tsx
export function PriorityEditor({
  value,
  onCommit,
  onCancel,
  onClear,
  dependents = 0,
}: EditorProps<{ level: "normal" | "critical" }> & { dependents?: number }) {
  const { auto } = effectivePriority(value, dependents);
  const selected = value?.level ?? null;
  const rows: { level: "critical" | "normal"; label: string; pill: string }[] =
    [
      {
        level: "critical",
        label: "Critical",
        pill: "bg-status-red text-white",
      },
      {
        level: "normal",
        label: "Normal",
        pill: "bg-muted text-muted-foreground",
      },
    ];
  return (
    <PopoverSurface label="Select priority" onCancel={onCancel}>
      {rows.map((r) => (
        <button
          key={r.level}
          type="button"
          role="option"
          aria-selected={selected === r.level}
          onClick={() => onCommit({ level: r.level })}
          className={cn(
            "focus-visible:ring-ring inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium transition-opacity focus-visible:ring-2 focus-visible:outline-none",
            r.pill,
            selected === r.level
              ? "opacity-100"
              : "opacity-60 hover:opacity-90",
          )}
        >
          {r.label}
        </button>
      ))}
      <ClearOptionButton onClear={() => (onClear ?? onCancel)()} />
      {auto && (
        <p className="text-muted-foreground px-2 py-1 text-xs">
          Auto-critical: {dependents} items depend on this item. A manual Normal
          is kept but overridden while {AUTO_CRITICAL_MIN_DEPENDENTS}+
          dependents exist.
        </p>
      )}
    </PopoverSurface>
  );
}
```

In `CellEditor`: add `dependents?: number` to its props and the case:

```tsx
    case "priority":
      return (
        <PriorityEditor
          value={value as { level: "normal" | "critical" } | null}
          settings={settings}
          onCommit={onCommit as (v: { level: "normal" | "critical" }) => void}
          onCancel={onCancel}
          onClear={onClear}
          dependents={dependents}
        />
      );
```

(Match the file's existing per-case casting style exactly — look at the `status` case first.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/components/boards/cells/editors/editors.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/cells/editors/index.tsx src/components/boards/cells/editors/editors.test.tsx
git commit -m "feat(boards): priority cell editor with auto-state explanation" \
  -m "Two fixed options (Critical red pill preview, Normal muted) on the shared PopoverSurface plus the standard clear affordance. When the derived auto-critical state is active the popover explains that a manual Normal is kept but overridden while 2+ dependents exist." \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: BoardTable wiring (dependents map threading)

**Files:**

- Modify: `src/components/boards/BoardTable.tsx` (memoized map + `dependents` prop into
  `EditableCell` → `CellRenderer`/`CellEditor` at both the item-row and subitem-row render
  sites — the same two sites that thread `overdue`, near lines 1814 and 1928; `EditableCell`
  itself is near line 2085)
- Test: `src/components/boards/BoardTable.priority.test.tsx` (new file, modeled on
  `BoardTable.overdue.test.tsx`)

**Interfaces:**

- Consumes: `buildDependentsCountMap` (Task 3); `CellRenderer`/`CellEditor` `dependents` prop
  (Tasks 4/5); `controls.cache.dependencies` (existing BoardCache).
- Produces: user-visible table behavior — this is the integration point; nothing downstream
  imports from it.

- [ ] **Step 1: Write failing test** (`BoardTable.priority.test.tsx`)

Copy the fixture scaffolding style of `BoardTable.overdue.test.tsx` (same board/cache builders).
Fixture: a board with one `priority` column; items A, B, C, D; dependencies B→A and C→A
(A has 2 dependents), D with a stored `{ level: "critical" }` cell and 0 dependents.

```tsx
it("auto-flags an item with 2+ dependents in its priority cell", () => {
  renderBoardTableWithFixture(); // per the overdue test's helper pattern
  expect(
    screen.getByLabelText("Critical (auto) — 2 items depend on this"),
  ).toBeInTheDocument();
});

it("shows a plain critical pill for a manual value without dependents", () => {
  renderBoardTableWithFixture();
  // D's pill: label text without the auto explanation
  const pills = screen.getAllByText("Critical");
  expect(pills.length).toBeGreaterThanOrEqual(2);
  expect(screen.getByTitle("Critical")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/components/boards/BoardTable.priority.test.tsx`
Expected: FAIL — no auto pill (dependents never threaded, defaults to 0).

- [ ] **Step 3: Implement**

At the table's row-render scope (next to the existing `todayISO` overdue snapshot near line
1688, and again for the subitem row component near line 1864 — or lift once to the shared
parent if both sites can reach it; prefer the smallest change consistent with how `todayISO`
is handled):

```tsx
import { buildDependentsCountMap } from "@/lib/boards/priority";

const dependentsByItem = useMemo(
  () => buildDependentsCountMap(controls.cache.dependencies),
  [controls.cache.dependencies],
);
```

Then on the `EditableCell` usages (both row sites), alongside the existing `overdue={…}`:

```tsx
dependents={
  column.kind === "priority" ? (dependentsByItem.get(item.id) ?? 0) : undefined
}
```

(subitem site uses `sub.id`). `EditableCell` adds `dependents?: number` to its props (JSDoc:
"Priority cells only") and forwards it to both `CellRenderer` (line ~2256) and `CellEditor`.

- [ ] **Step 4: Run to verify pass, plus the existing table suites**

Run: `pnpm vitest run src/components/boards/BoardTable.priority.test.tsx src/components/boards/BoardTable.test.tsx src/components/boards/BoardTable.overdue.test.tsx`
Expected: PASS (no regression in the overdue threading you touched adjacent to).

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/BoardTable.tsx src/components/boards/BoardTable.priority.test.tsx
git commit -m "feat(boards): thread dependency counts into priority cells in the table" \
  -m "Builds the dependents map once per cache.dependencies change (memoized O(E) pass) and passes per-item counts into EditableCell -> CellRenderer/CellEditor for priority columns only, at both the item-row and subitem-row sites — the overdue-flag threading pattern." \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Kanban card pill

**Files:**

- Modify: `src/lib/boards/kanban-card.ts` (`PILL_KINDS` + `isCardCellEmpty` priority case with
  an optional `dependents` param)
- Modify: `src/components/boards/KanbanBoard.tsx` (memoized map; pass `dependents` to the
  empty-check and the pill `CellRenderer` — pill render site near line 493)
- Test: `src/lib/boards/kanban-card.test.ts`, `src/components/boards/KanbanBoard.test.tsx`

**Interfaces:**

- Consumes: `buildDependentsCountMap`/`effectivePriority` (Task 3); `CellRenderer.dependents`
  (Task 4).
- Produces: `isCardCellEmpty(kind: string, value: unknown, dependents?: number): boolean` —
  signature gains the optional third param (all existing call sites unaffected).

- [ ] **Step 1: Write failing tests**

`src/lib/boards/kanban-card.test.ts`:

```ts
it("surfaces priority in the pill zone", () => {
  const cols = [
    col({ id: "p", kind: "priority" }),
    col({ id: "s", kind: "status" }),
  ];
  const { pills } = selectCardColumns(cols, "s");
  expect(pills.map((c) => c.id)).toContain("p");
});

describe("isCardCellEmpty(priority)", () => {
  it("is empty when unset/normal and below threshold (cards show only critical)", () => {
    expect(isCardCellEmpty("priority", null, 1)).toBe(true);
    expect(isCardCellEmpty("priority", { level: "normal" }, 0)).toBe(true);
  });
  it("is present when manually critical or auto-critical", () => {
    expect(isCardCellEmpty("priority", { level: "critical" }, 0)).toBe(false);
    expect(isCardCellEmpty("priority", null, 2)).toBe(false);
  });
});
```

`KanbanBoard.test.tsx` (append, reusing its fixture builders): a board grouped by status with
a priority column, item A with 2 dependents → the card shows the auto pill; item B unset with
0 dependents → no "Normal"/"Critical" text on its card.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/boards/kanban-card.test.ts src/components/boards/KanbanBoard.test.tsx`
Expected: FAIL — priority not in `PILL_KINDS`; `isCardCellEmpty` returns false-by-default for
unknown kinds.

- [ ] **Step 3: Implement**

`kanban-card.ts`: add `"priority"` to `PILL_KINDS`; extend the function:

```ts
import { effectivePriority } from "@/lib/boards/priority";

export function isCardCellEmpty(
  kind: string,
  value: unknown,
  /** Priority cells only: direct dependents of the item. */
  dependents = 0,
): boolean {
  if (kind === "priority")
    // Cards surface priority only when it is effectively Critical — an
    // explicit Normal or unset cell renders nothing (scannability).
    return effectivePriority(value, dependents).level !== "critical";
  if (value == null) return true;
  // …existing switch unchanged…
}
```

(Note `value == null` must not short-circuit the priority case — an unset cell with 2+
dependents is NOT empty. Order the priority branch first, as shown.)

`KanbanBoard.tsx`: memoize `const dependentsByItem = useMemo(() => buildDependentsCountMap(cache.dependencies), [cache.dependencies]);`
at the same level as `cellMap`; thread the per-item count into the card component (a
`dependents: number` prop alongside `members`); in the card, use it in the pill filter
(`!isCardCellEmpty(c.kind, cellOf(c), dependents)`) and pass
`dependents={col.kind === "priority" ? dependents : undefined}` on the pill `CellRenderer`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/lib/boards/kanban-card.test.ts src/components/boards/KanbanBoard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/kanban-card.ts src/lib/boards/kanban-card.test.ts \
  src/components/boards/KanbanBoard.tsx src/components/boards/KanbanBoard.test.tsx
git commit -m "feat(boards): critical priority pill on kanban cards" \
  -m "Priority joins the card pill zone but renders only when effectively critical (manual or >= 2 dependents) — explicit normal and unset cells stay silent for scannability. isCardCellEmpty gains an optional dependents param; KanbanBoard memoizes the dependents map from the cached dependency edges." \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Spreadsheet import/export + summary aggregation tests

**Files:**

- Modify: `src/lib/boards/spreadsheet/types.ts` (`ImportableKind` union + `IMPORTABLE_KINDS`)
- Modify: `src/lib/boards/spreadsheet/cell-codec.ts` (`textToCell` priority case; `cellToText`
  case landed in Task 2 step 5)
- Test: `src/lib/boards/spreadsheet/cell-codec.test.ts` (or the file's existing codec test
  home), `src/lib/boards/spreadsheet/types.test.ts`, `src/lib/boards/rollup.test.ts`,
  `src/lib/boards/aggregation.test.ts`

**Interfaces:**

- Consumes: `"priority"` in `ColumnKind` (Task 1/2); the Task 2 step-5 neutral cases
  (this task pins them with tests and adds the import side).
- Produces: `textToCell("priority", raw, options)` → `{ level } | null`; `IMPORTABLE_KINDS`
  contains `"priority"` (ImportDialog's kind picker lists it automatically; the
  `types.test.ts` length assertion moves 12 → 13).

- [ ] **Step 1: Write failing tests**

`types.test.ts`: change `toHaveLength(12)` → `toHaveLength(13)` and add
`expect(IMPORTABLE_KINDS).toContain("priority");`

Codec tests:

```ts
describe("priority codec", () => {
  it("exports stored levels as labels", () => {
    expect(cellToText("priority", { level: "critical" }, null)).toBe(
      "Critical",
    );
    expect(cellToText("priority", { level: "normal" }, null)).toBe("Normal");
    expect(cellToText("priority", {}, null)).toBe("");
  });
  it("imports labels case-insensitively, rejecting junk", () => {
    expect(textToCell("priority", "Critical", [])).toEqual({
      level: "critical",
    });
    expect(textToCell("priority", "  normal ", [])).toEqual({
      level: "normal",
    });
    expect(textToCell("priority", "urgent", [])).toBeNull();
    expect(textToCell("priority", "", [])).toBeNull();
  });
});
```

`rollup.test.ts`:

```ts
it("rolls priority up as a fixed-segment distribution", () => {
  const r = rollupCell("priority", [
    { level: "critical" },
    { level: "critical" },
    { level: "normal" },
  ]);
  expect(r).toEqual({
    kind: "distribution",
    total: 3,
    segments: [
      { id: "critical", label: "Critical", color: "#e2445c", count: 2 },
      { id: "normal", label: "Normal", color: "#c4c4c4", count: 1 },
    ],
  });
});
```

`aggregation.test.ts`:

```ts
it("offers distribution + count family for priority", () => {
  expect(allowedAggregations("priority")).toEqual([
    "distribution",
    "count",
    "count_filled",
    "count_empty",
    "count_unique",
  ]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/boards/spreadsheet src/lib/boards/rollup.test.ts src/lib/boards/aggregation.test.ts`
Expected: import-side tests FAIL (`textToCell` default → null is correct for junk but
`"priority"` is not yet an `ImportableKind`, so it does not typecheck / parse); the Task 2
stubs make export/rollup/aggregation tests pass immediately — they exist here to pin behavior.

- [ ] **Step 3: Implement the import side**

`types.ts`: add `| "priority"` to `ImportableKind` and `"priority"` to `IMPORTABLE_KINDS`.

`cell-codec.ts` `textToCell` switch (before `default`):

```ts
    case "priority": {
      const lower = trimmed.toLowerCase();
      if (lower === "critical") return { level: "critical" };
      if (lower === "normal") return { level: "normal" };
      return null;
    }
```

Note: `rollupCell` derives the summary-footer `distribution` for `aggregate()` too (the
`distribution` aggregation delegates to it), so the footer summary comes free with the Task 2
stub — the tests here pin that. The stored value is what exports/aggregates; the derived auto
state deliberately does not (spec open question 5).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/lib/boards/spreadsheet src/lib/boards/rollup.test.ts src/lib/boards/aggregation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/spreadsheet/types.ts src/lib/boards/spreadsheet/types.test.ts \
  src/lib/boards/spreadsheet/cell-codec.ts src/lib/boards/spreadsheet/cell-codec.test.ts \
  src/lib/boards/rollup.test.ts src/lib/boards/aggregation.test.ts
git commit -m "feat(boards): priority in spreadsheet codec, rollup, and summary aggregation" \
  -m "Export renders stored levels as Critical/Normal labels; import parses them case-insensitively (priority joins ImportableKind, 12 -> 13). Rollup and the summary footer show a fixed two-segment distribution over stored values — the derived auto state intentionally stays render-only." \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9 (OPTIONAL — droppable without touching anything else): Gantt name-rail critical dot

Spec open question 2: cut this task freely if the owner wants maximum restraint.

**Files:**

- Modify: `src/components/boards/GanttBoard.tsx` (row name rail — the row component starting
  near line 754 already receives `dependencies: CacheDependency[]`)
- Test: `src/components/boards/GanttBoard.test.tsx`

**Interfaces:**

- Consumes: `buildDependentsCountMap`/`effectivePriority` (Task 3); the board's first
  `priority`-kind column + its cell values from `cache` (existing props/scope).
- Produces: visual only; nothing downstream.

- [ ] **Step 1: Write failing test** (append to `GanttBoard.test.tsx` fixtures): an item with
      two successors renders `screen.getByTitle("Critical (auto) — 2 items depend on this")` in its
      name rail; an item with one successor does not.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/components/boards/GanttBoard.test.tsx`
Expected: FAIL — no such title.

- [ ] **Step 3: Implement**

Where GanttBoard already memoizes dependency lookups (~line 322–349), add the dependents map
(`buildDependentsCountMap(cache.dependencies)`), resolve the board's first priority column
(`cache.columns.find((c) => c.kind === "priority")`) and its cell per row, and in the name
rail render, when `effectivePriority(cellValue, dependents).level === "critical"`:

```tsx
<span
  title={label} /* same label strings as PriorityCell */
  className="bg-status-red inline-block size-1.5 shrink-0 rounded-full"
>
  <span className="sr-only">{label}</span>
</span>
```

A dot, not a badge — the descoped health design died on Gantt badge scope; stay minimal. The
dot renders when EITHER a priority column's stored value or the dependents threshold makes the
item effective-critical; boards with no priority column still show it for auto (>= 2
dependents) items — the signal is about the dependency graph the view is drawing. (If review
prefers column-gated only, drop the no-column branch — one conditional.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/components/boards/GanttBoard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/GanttBoard.tsx src/components/boards/GanttBoard.test.tsx
git commit -m "feat(boards): critical priority dot on gantt name rail" \
  -m "Minimal effective-critical marker (status-red dot + sr-only/title text) where dependencies are actually drawn. Deliberately not the descoped health badge/ring machinery." \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Full gates + finish

**Files:** none new.

**Interfaces:**

- Consumes: all previous tasks merged on `task/priority-critical`.
- Produces: the merged feature on `develop`.

- [ ] **Step 1: Run all four gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS. Known traps: cold `pnpm typecheck` can fail on `cacheLife` before a build
generates `.next/types` (memory: `finish-task-typecheck-before-build-cachelife`) — run build
first if hit; a stale worktree `node_modules` after rebase needs `pnpm install`
(memory: `finish-task-build-fails-worktree-stale-deps`).

- [ ] **Step 2: Verify in the running app** (per the `verify` discipline)

Add a Priority column on a dev board via the Add-column menu; set one item Critical (pill);
draw two dependencies onto another item in Timeline view and confirm its priority cell reads
"Critical (auto) — 2 items depend on this" back in the Table; delete one dependency and
confirm the pill self-clears.

- [ ] **Step 3: Finish the task**

Run: `scripts/finish-task.sh` from inside the worktree. It rebases onto latest `develop`,
re-runs gates against the merged state, merges into `develop`, pushes, and removes the
worktree + branch. Sequencing note (gotcha-43): if the health-summary branch is also open
with a migration, coordinate merge order — the LAST DB-bearing branch to merge re-runs
`pnpm db:types` and commits the union.

- [ ] **Step 4: Hand the user the "How to test this" walkthrough** (in the closing message and
      the `/wrapup` session note): pull `develop` → open any board → Add column → Priority →
      set Normal/Critical from the cell popover → in Timeline view, drag two dependency edges onto
      one predecessor → back in Table view its Priority cell shows the auto Critical pill with the
      dependents tooltip → remove a dependency → the pill clears back to the stored value.

---

## Execution DAG (working agreement #6)

**Dependency edges** (from the Interfaces blocks):

- Task 2 ← Task 1 (regenerated `ColumnKind` type)
- Task 3 ← nothing (pure helper on existing cache types)
- Task 4 ← Tasks 2, 3 · Task 5 ← Tasks 2, 3
- Task 6 ← Tasks 4, 5 (renderer + editor `dependents` props)
- Task 7 ← Tasks 3, 4 · Task 8 ← Tasks 1, 2 · Task 9 ← Task 3 (+ kind lookup from Task 2)
- Task 10 ← all of 1–8 (and 9 if kept)

**Parallel batches** (each batch = one wave of concurrent agents when ≥2 tasks;
`superpowers:dispatching-parallel-agents` / parallel subagent-driven-development):

| Wave | Tasks               | Note                                                                        |
| ---- | ------------------- | --------------------------------------------------------------------------- |
| 0    | **1**, **3**        | 1 blocks on the user's manual migration apply; 3 is pure and runs meanwhile |
| 1    | **2**               | short compiler-forced sweep                                                 |
| 2    | **4**, **5**, **8** | disjoint files (renderer / editors / codec+lib)                             |
| 3    | **6**, **7**, **9** | disjoint files (BoardTable / Kanban / Gantt); 9 droppable                   |
| 4    | **10**              | gates + finish, serial                                                      |

Waves 2 and 3 are intra-branch (same worktree): dispatch parallel subagents only because the
file sets are disjoint; commits are per-task by explicit path.

**Critical path:** 1 → 2 → 4 → 6 → 10 (the migration's manual-apply gate is the only
human-blocking step; everything after wave 1 is bounded by the two UI-wiring hops).
