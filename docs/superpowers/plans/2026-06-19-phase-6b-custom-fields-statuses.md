# Phase 6b — Custom Fields & Statuses — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users edit Status/Dropdown option sets after creation, and add six Monday-style column kinds (Checkbox, Rating, Link, Email, Phone, Files), reusing the existing discriminated-union/switch column system.

**Architecture:** Three independent unit-groups over one spec. G1 (option editing) is pure UI + two server actions + one `SECURITY DEFINER` RPC over the existing `columns.settings` JSONB — no schema change. G2 (five scalar kinds) extends the Zod value-schema union + per-kind cell renderer/editor switches, driven by TypeScript exhaustiveness. G3 (Files column) extends the Phase-4c `attachments` table with a `column_id` (reusing the bucket, RLS, signed-URL minting, and `FilePreviewLightbox`) and folds a bounded board-scoped attachments query into the board payload.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), React 19, TypeScript strict, Zod, Supabase (Postgres + RLS + Storage + Realtime), TanStack Query board cache, `@dnd-kit`, shadcn/Tailwind v4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-19-phase-6b-custom-fields-statuses-design.md`

---

## ⚠️ Coordination note (shared `develop` checkout)

A **concurrent org-admin session** is actively editing `BoardTable.tsx`, `KanbanBoard.tsx`, `CalendarBoard.tsx`, `GanttBoard.tsx`, `src/types/database.types.ts`, and adding migration `20260619200000_org_admin_platform_console.sql`. This plan touches several of the same files (`database.types.ts`, `BoardTable.tsx`, the view components, `queries.ts`, `cache.ts`, migrations).

- **Migration timestamps in this plan are `20260619240000` / `20260619240001`** — strictly after the concluded admin session's migrations (which already used `…210000`, `…220000`, `…230000`) so the ledger stays ordered.
- Per working agreement #1: when ≥2 tasks in a batch mutate files in parallel, run them in **git worktrees** (`superpowers:using-git-worktrees`). Stage by path on commit (never `git add -A`) — see the recent shared-index collision.
- Re-run `pnpm db:types` only after **both** this plan's migrations and the admin migration have applied, to avoid a partial type regen.

---

## File Structure

**Created**

- `supabase/migrations/20260619240000_column_kinds_6b.sql` — enum extension (6 `ADD VALUE`).
- `supabase/migrations/20260619240001_files_column_and_option_delete.sql` — `attachments.column_id` + index + `delete_column_option` RPC.
- `src/lib/boards/column-kinds.ts` — `COLUMN_KIND_META` map (label/icon/hasOptions) for the Add menu.
- `src/lib/boards/option-colors.ts` — `OPTION_COLORS` fixed swatch palette + `nextOptionColor`.
- `src/lib/boards/option-edit.ts` — pure option-list reducers (add/rename/recolor/reorder/remove) + `countOptionUsage`.
- `src/components/boards/ColumnOptionsDialog.tsx` — the Status/Dropdown option editor dialog.
- `src/components/boards/cells/FilesCell.tsx` — Files cell renderer (icon row + overflow).
- Test files alongside each (see tasks).

**Modified**

- `src/lib/validations/boards.ts` — `columnKindSchema` + value/settings schemas for 6 kinds.
- `src/lib/validations/board-actions.ts` — `updateColumnSettingsSchema`, `removeColumnOptionSchema`, `createColumnSchema` (unchanged), `createAttachmentSchema` extension lives in collaboration-actions.
- `src/lib/validations/collaboration-actions.ts` — `createAttachmentSchema` gains optional `columnId`.
- `src/lib/boards/column-defaults.ts` — `DEFAULT_NAME` + `defaultColumn` cases.
- `src/lib/boards/actions.ts` — `updateColumnSettings`, `removeColumnOption`.
- `src/lib/boards/rollup.ts` — `rollupCell` cases for the new kinds.
- `src/lib/boards/cache.ts` — `BoardCache.attachments` + `prependAttachment`/`removeAttachment`/`replaceColumn` reuse.
- `src/lib/boards/queries.ts` — `getBoardPayload` attachments query + `BoardPayload.attachments`.
- `src/lib/boards/use-board-mutations.ts` — `updateColumnSettings`, `removeColumnOption`, `uploadColumnFile`, `deleteColumnFile` mutations.
- `src/lib/collaboration/actions.ts` — `createAttachment` optional `columnId` + path guard.
- `src/components/boards/cells/index.tsx` — renderers for checkbox/rating/link/email/phone + `CellRenderer` cases.
- `src/components/boards/cells/editors/index.tsx` — editors for checkbox/rating/link/email/phone + `CellEditor` cases.
- `src/components/boards/AddColumnMenu.tsx` — read `COLUMN_KIND_META`.
- `src/components/boards/ColumnHeader.tsx` — "Edit labels" menu item (status/dropdown only).
- `src/components/boards/BoardTable.tsx` — wire `ColumnOptionsDialog`; Files cell in `EditableCell`.
- `src/components/boards/KanbanBoard.tsx` / `CalendarBoard.tsx` / `GanttBoard.tsx` — read-only cases for new kinds (only if they switch exhaustively on `kind`).

---

## Execution DAG (working-agreement §6)

**Dependency edges** (Task → depends on):

- T1 enum migration → —
- T2 files/RPC migration → —
- T3 types regen → T1, T2
- T4 value/settings schemas → T3
- T5 meta + defaults + colors → T3
- T6 action schemas → T3
- T7 G1 actions → T4, T6, T2
- T8 G1 mutations+cache → T7
- T9 ColumnOptionsDialog → T5, T8, T10helpers(option-edit) _(T10a below)_
- T10a option-edit reducers → T4
- T10 ColumnHeader + BoardTable wiring → T9
- T11 G2 renderers → T4
- T12 G2 editors → T4
- T13 G2 rollup cases → T4
- T14 AddColumnMenu → T5
- T15 G3 createAttachment → T6
- T16 G3 payload+cache → T3
- T17 G3 Files cell + mutations → T15, T16, T11, T12
- T18 view wiring → T11, T12

**Parallel batches (waves of concurrent agents):**

- **Wave 0 (serial foundation):** T1 → T2 → T3. _(migrations then types; the wall-clock floor)_
- **Wave 1 (parallel ×4):** T4 · T5 · T6 · T10a. _(all only need T3 / each other-free)_
- **Wave 2 (parallel ×7):** T7 · T11 · T12 · T13 · T14 · T15 · T16. _(independent files; worktree-isolate the BoardTable/cells/queries/cache writers)_
- **Wave 3 (parallel ×3):** T8 · T17 · T18.
- **Wave 4:** T9.
- **Wave 5:** T10 + final integration e2e.

**Critical path:** T1→T2→T3→T7→T8→T9→T10 (G1 chain) ≈ the longest; G3's T3→T16→T17 is shorter. Wall-clock floor ≈ 7 sequential tasks.

---

## Task 1: Migration — extend the `column_kind` enum

**Files:**

- Create: `supabase/migrations/20260619240000_column_kinds_6b.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Phase 6b: six new column kinds. Enum ADD VALUE is committed in its own
-- migration (no statement in this file USES the new values), so the values are
-- available to later migrations/runtime once this commits. (PG15: ADD VALUE is
-- txn-safe; the value just can't be used in the SAME txn.)
alter type public.column_kind add value if not exists 'checkbox';
alter type public.column_kind add value if not exists 'rating';
alter type public.column_kind add value if not exists 'link';
alter type public.column_kind add value if not exists 'email';
alter type public.column_kind add value if not exists 'phone';
alter type public.column_kind add value if not exists 'files';
```

- [ ] **Step 2: Apply to cloud (with explicit user authorization)**

Run: `supabase db push --linked` (or apply via the Supabase MCP). Expected: migration applies; no error.

- [ ] **Step 3: Verify the enum**

Run (MCP `execute_sql` or psql):

```sql
select enumlabel from pg_enum e
join pg_type t on t.oid = e.enumtypid
where t.typname = 'column_kind' order by e.enumsortorder;
```

Expected: includes `text, status, people, date, numbers, dropdown, checkbox, rating, link, email, phone, files`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260619240000_column_kinds_6b.sql
git commit -m "feat(db): add 6 column kinds to column_kind enum"
```

---

## Task 2: Migration — `attachments.column_id` + index + `delete_column_option` RPC

**Files:**

- Create: `supabase/migrations/20260619240001_files_column_and_option_delete.sql`

- [ ] **Step 1: Write the migration**

```sql
-- (a) Column-scope attachments for the Files column kind. Item-panel
-- attachments (Phase 4c) keep column_id NULL; Files-cell attachments set both
-- item_id and column_id.
alter table public.attachments
  add column column_id uuid references public.columns (id) on delete cascade;

create index attachments_item_column_idx
  on public.attachments (item_id, column_id)
  where column_id is not null;

-- (b) Atomic option delete: remove an option from a status/dropdown column's
-- settings AND clear every cell that referenced it, returning the cleared count.
-- SECURITY DEFINER + org-member guard; pinned search_path.
create or replace function public.delete_column_option(
  p_column_id uuid,
  p_option_id text
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_org_id uuid;
  v_kind   public.column_kind;
  v_count  integer := 0;
begin
  select org_id, kind into v_org_id, v_kind
  from public.columns where id = p_column_id;
  if v_org_id is null then
    raise exception 'Column not found';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'Not authorized';
  end if;

  if v_kind = 'status' then
    -- count, then delete referencing cells (clearing = remove the row,
    -- matching clearCell semantics).
    select count(*) into v_count
    from public.cell_values
    where column_id = p_column_id and value->>'optionId' = p_option_id;

    delete from public.cell_values
    where column_id = p_column_id and value->>'optionId' = p_option_id;

  elsif v_kind = 'dropdown' then
    select count(*) into v_count
    from public.cell_values
    where column_id = p_column_id and value->'optionIds' ? p_option_id;

    -- strip the id from each array
    update public.cell_values
    set value = jsonb_set(
      value, '{optionIds}',
      coalesce((
        select jsonb_agg(e)
        from jsonb_array_elements_text(value->'optionIds') e
        where e <> p_option_id
      ), '[]'::jsonb)
    )
    where column_id = p_column_id and value->'optionIds' ? p_option_id;

    -- drop now-empty cells
    delete from public.cell_values
    where column_id = p_column_id and value->'optionIds' = '[]'::jsonb;

  else
    raise exception 'Column kind % has no options', v_kind;
  end if;

  -- remove the option from settings.options
  update public.columns
  set settings = jsonb_set(
    settings, '{options}',
    coalesce((
      select jsonb_agg(o)
      from jsonb_array_elements(settings->'options') o
      where o->>'id' <> p_option_id
    ), '[]'::jsonb)
  )
  where id = p_column_id;

  return v_count;
end;
$$;

revoke all on function public.delete_column_option(uuid, text) from public;
grant execute on function public.delete_column_option(uuid, text) to authenticated;
```

- [ ] **Step 2: Apply to cloud (with explicit user authorization)**

Run: `supabase db push --linked`. Expected: applies cleanly.

- [ ] **Step 3: Run advisors**

Use the Supabase MCP `get_advisors` (security + performance). Expected: no new warnings; the function pins `search_path = ''` (no "function search path mutable" lint).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260619240001_files_column_and_option_delete.sql
git commit -m "feat(db): attachments.column_id + delete_column_option RPC"
```

---

## Task 3: Regenerate database types

**Files:**

- Modify: `src/types/database.types.ts`

- [ ] **Step 1: Regenerate (after BOTH 6b migrations + the admin migration are applied)**

Run: `pnpm db:types`
Note: `pnpm db:types` can leak a PostHog telemetry line — if present, remove the stray `"_tag"` line before prettier (see vault gotcha).

- [ ] **Step 2: Verify the enum + column type**

Confirm `Database["public"]["Enums"]["column_kind"]` now includes the six new values, and `attachments` Row has `column_id: string | null`.

Run: `pnpm typecheck` — Expected: PASS (no consumers yet rely on the new values).

- [ ] **Step 3: Commit**

```bash
git add src/types/database.types.ts
git commit -m "chore(db): regenerate types for 6b column kinds + attachments.column_id"
```

---

## Task 4: Validation — value + settings schemas for the six kinds

**Files:**

- Modify: `src/lib/validations/boards.ts`
- Test: `src/lib/validations/boards.test.ts` (create if absent)

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { cellValueSchema, columnSettingsSchema } from "./boards";

describe("6b cell value schemas", () => {
  it("checkbox accepts a boolean", () => {
    expect(
      cellValueSchema("checkbox").safeParse({ checked: true }).success,
    ).toBe(true);
    expect(
      cellValueSchema("checkbox").safeParse({ checked: "yes" }).success,
    ).toBe(false);
  });
  it("rating is an int 1..5", () => {
    expect(cellValueSchema("rating").safeParse({ rating: 5 }).success).toBe(
      true,
    );
    expect(cellValueSchema("rating").safeParse({ rating: 0 }).success).toBe(
      false,
    );
    expect(cellValueSchema("rating").safeParse({ rating: 6 }).success).toBe(
      false,
    );
  });
  it("link requires a valid url, label optional", () => {
    expect(
      cellValueSchema("link").safeParse({ url: "https://a.com" }).success,
    ).toBe(true);
    expect(
      cellValueSchema("link").safeParse({ url: "https://a.com", text: "A" })
        .success,
    ).toBe(true);
    expect(
      cellValueSchema("link").safeParse({ url: "not-a-url" }).success,
    ).toBe(false);
  });
  it("email validates format", () => {
    expect(
      cellValueSchema("email").safeParse({ email: "a@b.com" }).success,
    ).toBe(true);
    expect(cellValueSchema("email").safeParse({ email: "nope" }).success).toBe(
      false,
    );
  });
  it("phone is a non-empty trimmed string", () => {
    expect(
      cellValueSchema("phone").safeParse({ phone: "+1 555" }).success,
    ).toBe(true);
    expect(cellValueSchema("phone").safeParse({ phone: "" }).success).toBe(
      false,
    );
  });
  it("new kinds use empty settings", () => {
    for (const k of [
      "checkbox",
      "rating",
      "link",
      "email",
      "phone",
      "files",
    ] as const) {
      expect(columnSettingsSchema(k).safeParse({}).success).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/validations/boards.test.ts`
Expected: FAIL — `cellValueSchema("checkbox")` is currently a non-exhaustive switch (returns `undefined`).

- [ ] **Step 3: Extend `boards.ts`**

Add to the `columnKindSchema` enum array: `"checkbox", "rating", "link", "email", "phone", "files"`.

Add value schemas after `numbersValueSchema`:

```typescript
export const checkboxValueSchema = z.object({ checked: z.boolean() });
export const ratingValueSchema = z.object({
  rating: z.number().int().min(1).max(5),
});
export const linkValueSchema = z.object({
  url: z.string().url(),
  text: z.string().optional(),
});
export const emailValueSchema = z.object({ email: z.string().email() });
export const phoneValueSchema = z.object({
  phone: z.string().trim().min(1).max(40),
});
// Files store no cell_values row (content derives from attachments); this case
// exists only to keep the switch exhaustive and is never used by upsertCell.
export const filesValueSchema = z.object({}).strict();
```

Add cases to `cellValueSchema`:

```typescript
    case "checkbox":
      return checkboxValueSchema;
    case "rating":
      return ratingValueSchema;
    case "link":
      return linkValueSchema;
    case "email":
      return emailValueSchema;
    case "phone":
      return phoneValueSchema;
    case "files":
      return filesValueSchema;
```

Add cases to `columnSettingsSchema` (all empty):

```typescript
    case "checkbox":
    case "rating":
    case "link":
    case "email":
    case "phone":
    case "files":
      return emptySettingsSchema;
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm vitest run src/lib/validations/boards.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/boards.ts src/lib/validations/boards.test.ts
git commit -m "feat(boards): zod value+settings schemas for 6 new column kinds"
```

---

## Task 5: Kind metadata, defaults, and option colors

**Files:**

- Create: `src/lib/boards/column-kinds.ts`
- Create: `src/lib/boards/option-colors.ts`
- Modify: `src/lib/boards/column-defaults.ts`
- Test: `src/lib/boards/column-defaults.test.ts` (create if absent)

- [ ] **Step 1: Write failing test for defaults**

```typescript
import { describe, it, expect } from "vitest";
import { defaultColumn } from "./column-defaults";

describe("defaultColumn — 6b kinds", () => {
  it("new scalar kinds get empty settings + a default name", () => {
    for (const k of [
      "checkbox",
      "rating",
      "link",
      "email",
      "phone",
      "files",
    ] as const) {
      const { name, settings } = defaultColumn(k);
      expect(name.length).toBeGreaterThan(0);
      expect(settings).toEqual({});
    }
  });
  it("status still seeds options", () => {
    expect(
      (defaultColumn("status").settings as { options: unknown[] }).options,
    ).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/boards/column-defaults.test.ts`
Expected: FAIL — `DEFAULT_NAME` is missing the new keys (TS) / runtime `undefined` name.

- [ ] **Step 3: Extend `column-defaults.ts`**

Add to `DEFAULT_NAME`:

```typescript
  checkbox: "Checkbox",
  rating: "Rating",
  link: "Link",
  email: "Email",
  phone: "Phone",
  files: "Files",
```

No change to `defaultColumn`'s body — the new kinds fall through to `settings = {}`.

- [ ] **Step 4: Create `option-colors.ts`**

```typescript
/** Fixed Monday-style swatch palette for status/dropdown options. No custom hex. */
export const OPTION_COLORS = [
  "#00c875",
  "#fdab3d",
  "#e2445c",
  "#579bfc",
  "#a25ddc",
  "#037f4c",
  "#ff642e",
  "#9d99b9",
  "#0086c0",
  "#bb3354",
  "#ffcb00",
  "#784bd1",
  "#66ccff",
  "#7f5347",
  "#333333",
] as const;

/** The next palette color not already used (falls back to the first). */
export function nextOptionColor(used: readonly string[]): string {
  return OPTION_COLORS.find((c) => !used.includes(c)) ?? OPTION_COLORS[0];
}
```

- [ ] **Step 5: Create `column-kinds.ts`**

```typescript
import {
  Type,
  CircleDot,
  Users,
  Calendar,
  Hash,
  Tags,
  CheckSquare,
  Star,
  Link as LinkIcon,
  Mail,
  Phone,
  Paperclip,
} from "lucide-react";
import type { ColumnKind } from "@/lib/validations/boards";

export type KindMeta = {
  label: string;
  Icon: typeof Type;
  hasOptions: boolean;
};

/** Single source of truth for the Add-column menu + option-aware UI gating. */
export const COLUMN_KIND_META: Record<ColumnKind, KindMeta> = {
  text: { label: "Text", Icon: Type, hasOptions: false },
  status: { label: "Status", Icon: CircleDot, hasOptions: true },
  people: { label: "People", Icon: Users, hasOptions: false },
  date: { label: "Date", Icon: Calendar, hasOptions: false },
  numbers: { label: "Numbers", Icon: Hash, hasOptions: false },
  dropdown: { label: "Dropdown", Icon: Tags, hasOptions: true },
  checkbox: { label: "Checkbox", Icon: CheckSquare, hasOptions: false },
  rating: { label: "Rating", Icon: Star, hasOptions: false },
  link: { label: "Link", Icon: LinkIcon, hasOptions: false },
  email: { label: "Email", Icon: Mail, hasOptions: false },
  phone: { label: "Phone", Icon: Phone, hasOptions: false },
  files: { label: "Files", Icon: Paperclip, hasOptions: false },
};

/** Stable order for the Add-column menu. */
export const COLUMN_KIND_ORDER: ColumnKind[] = [
  "text",
  "status",
  "people",
  "date",
  "numbers",
  "dropdown",
  "checkbox",
  "rating",
  "link",
  "email",
  "phone",
  "files",
];
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm vitest run src/lib/boards/column-defaults.test.ts && pnpm typecheck`
Expected: PASS (the `Record<ColumnKind, …>` maps fail typecheck if any kind is missing — that's the exhaustiveness guard).

- [ ] **Step 7: Commit**

```bash
git add src/lib/boards/column-kinds.ts src/lib/boards/option-colors.ts src/lib/boards/column-defaults.ts src/lib/boards/column-defaults.test.ts
git commit -m "feat(boards): COLUMN_KIND_META, OPTION_COLORS, defaults for new kinds"
```

---

## Task 6: Action schemas (settings + option-delete + attachment columnId)

**Files:**

- Modify: `src/lib/validations/board-actions.ts`
- Modify: `src/lib/validations/collaboration-actions.ts`
- Test: `src/lib/validations/board-actions.test.ts` (create if absent)

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import {
  updateColumnSettingsSchema,
  removeColumnOptionSchema,
} from "./board-actions";

const UUID = "11111111-1111-1111-1111-111111111111";

describe("6b action schemas", () => {
  it("updateColumnSettings accepts an object settings", () => {
    expect(
      updateColumnSettingsSchema.safeParse({
        columnId: UUID,
        settings: { options: [] },
      }).success,
    ).toBe(true);
  });
  it("removeColumnOption needs a columnId + optionId", () => {
    expect(
      removeColumnOptionSchema.safeParse({ columnId: UUID, optionId: "abc" })
        .success,
    ).toBe(true);
    expect(
      removeColumnOptionSchema.safeParse({ columnId: UUID, optionId: "" })
        .success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/validations/board-actions.test.ts` — Expected: FAIL (exports missing).

- [ ] **Step 3: Add schemas to `board-actions.ts`**

```typescript
// Settings are validated structurally here (JSON object); the kind-specific
// shape is enforced server-side via columnSettingsSchema(kind).
export const updateColumnSettingsSchema = z.object({
  columnId: uuid,
  settings: z.record(z.string(), z.unknown()),
});
export const removeColumnOptionSchema = z.object({
  columnId: uuid,
  optionId: z.string().min(1),
});
```

- [ ] **Step 4: Extend `createAttachmentSchema` in `collaboration-actions.ts`**

```typescript
export const createAttachmentSchema = z.object({
  itemId: z.string().uuid(),
  columnId: z.string().uuid().optional(), // set for Files-column attachments
  storagePath: STORAGE_PATH,
  fileName: FILE_NAME,
  mimeType: MIME,
  sizeBytes: SIZE,
});
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm vitest run src/lib/validations/board-actions.test.ts && pnpm typecheck` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/validations/board-actions.ts src/lib/validations/board-actions.test.ts src/lib/validations/collaboration-actions.ts
git commit -m "feat(validation): updateColumnSettings/removeColumnOption + attachment columnId"
```

---

## Task 7: G1 server actions — `updateColumnSettings` + `removeColumnOption`

**Files:**

- Modify: `src/lib/boards/actions.ts`
- Test: `src/lib/boards/columns-settings.rls.integration.test.ts` (create)

- [ ] **Step 1: Write the failing integration test** (skips without `SUPABASE_SERVICE_ROLE_KEY`)

```typescript
import { describe, it, expect } from "vitest";
// Reuse the project's integration harness helpers (see columns.rls.integration.test.ts):
import { withOrgBoard, asMember } from "@/test/integration-helpers";

const RUN = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
(RUN ? describe : describe.skip)("delete_column_option RPC", () => {
  it("removes the option and clears referencing status cells", async () => {
    await withOrgBoard(async ({ board, member }) => {
      // create a status column with a known option + an item whose cell uses it
      const { column, optionId, itemId } = await seedStatusCell(board, member);
      const cleared = await asMember(member).rpc("delete_column_option", {
        p_column_id: column.id,
        p_option_id: optionId,
      });
      expect(cleared.data).toBe(1);
      const cell = await asMember(member)
        .from("cell_values")
        .select("*")
        .eq("item_id", itemId)
        .eq("column_id", column.id)
        .maybeSingle();
      expect(cell.data).toBeNull(); // cell cleared
      const col = await asMember(member)
        .from("columns")
        .select("settings")
        .eq("id", column.id)
        .single();
      expect(
        (col.data!.settings as { options: { id: string }[] }).options.some(
          (o) => o.id === optionId,
        ),
      ).toBe(false); // option gone
    });
  });
  it("rejects a non-member (RLS/guard fails closed)", async () => {
    await withOrgBoard(async ({ board, outsider }) => {
      const { column, optionId } = await seedStatusCell(board, board.owner);
      const res = await asMember(outsider).rpc("delete_column_option", {
        p_column_id: column.id,
        p_option_id: optionId,
      });
      expect(res.error).toBeTruthy();
    });
  });
});
```

> The plan's executor adapts `withOrgBoard`/`asMember`/`seedStatusCell` to the repo's existing integration harness (mirror `columns.rls.integration.test.ts`). The behavioral assertions above are the contract.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/boards/columns-settings.rls.integration.test.ts`
Expected: FAIL (or skip if no service-role key locally — then verify via MCP `execute_sql` per Step 4).

- [ ] **Step 3: Implement the actions in `actions.ts`**

```typescript
export async function updateColumnSettings(input: {
  columnId: string;
  settings: Record<string, unknown>;
}): Promise<ActionResult> {
  const parsed = updateColumnSettingsSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { data: col } = await supabase
    .from("columns")
    .select("board_id, kind")
    .eq("id", parsed.data.columnId)
    .maybeSingle();
  if (!col) return fail("Column not found.");
  // Validate the kind-specific shape before persisting.
  const shape = columnSettingsSchema(col.kind);
  const settingsParsed = shape.safeParse(parsed.data.settings);
  if (!settingsParsed.success)
    return fail(settingsParsed.error.issues[0]?.message ?? "Invalid settings");
  const { error } = await supabase
    .from("columns")
    .update({ settings: settingsParsed.data as Tables<"columns">["settings"] })
    .eq("id", parsed.data.columnId);
  if (error) return fail(error.message);
  revalidatePath(`/boards/${col.board_id}`);
  return { ok: true, data: undefined };
}

export async function removeColumnOption(input: {
  columnId: string;
  optionId: string;
}): Promise<ActionResult<{ clearedCells: number }>> {
  const parsed = removeColumnOptionSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const boardId = await columnBoardId(supabase, parsed.data.columnId);
  if (!boardId) return fail("Column not found.");
  const { data, error } = await supabase.rpc("delete_column_option", {
    p_column_id: parsed.data.columnId,
    p_option_id: parsed.data.optionId,
  });
  if (error) return fail(error.message);
  revalidatePath(`/boards/${boardId}`);
  return { ok: true, data: { clearedCells: data ?? 0 } };
}
```

Add imports at top: `updateColumnSettingsSchema, removeColumnOptionSchema` from board-actions; `columnSettingsSchema` from `@/lib/validations/boards`.

- [ ] **Step 4: Verify**

Run integration test (or MCP `execute_sql` calling the RPC as a member). Expected: PASS / cleared count correct, settings updated, non-member rejected. Run `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/actions.ts src/lib/boards/columns-settings.rls.integration.test.ts
git commit -m "feat(boards): updateColumnSettings + removeColumnOption actions"
```

---

## Task 8: G1 cache + mutations

**Files:**

- Modify: `src/lib/boards/use-board-mutations.ts`
- Test: `src/lib/boards/use-board-mutations.test.ts` (extend existing if present; else assert via the optimistic helper)

- [ ] **Step 1: Write failing test** (optimistic settings patch)

```typescript
import { describe, it, expect } from "vitest";
import { replaceColumn } from "./cache";

describe("optimistic option edit", () => {
  it("replaceColumn swaps settings.options", () => {
    const cache = {
      columns: [
        { id: "c1", position: 0, settings: { options: [] }, kind: "status" },
      ],
      cellValues: [],
      groups: [],
      items: [],
      board: {},
      dependencies: [],
    } as any;
    const next = replaceColumn(cache, {
      ...cache.columns[0],
      settings: { options: [{ id: "o1", label: "A", color: "#000" }] },
    });
    expect((next.columns[0].settings as any).options).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it passes for `replaceColumn`** (it already exists) — this confirms the cache primitive; the new code is the mutations:

Run: `pnpm vitest run src/lib/boards/use-board-mutations.test.ts` — Expected: PASS for the cache assertion.

- [ ] **Step 3: Add the two mutations** (mirror `renameColumnMutation`)

```typescript
const updateColumnSettingsMutation = useMutation<
  unknown,
  Error,
  { columnId: string; settings: Record<string, unknown> },
  Ctx
>({
  mutationFn: async (vars) => {
    const res = await updateColumnSettings(vars);
    if (!res.ok) throw new Error(res.error);
    return res;
  },
  onMutate: async (vars) => {
    await qc.cancelQueries({ queryKey: key });
    return optimisticColumn(vars.columnId, { settings: vars.settings });
  },
  onError: (_e, _v, ctx) => {
    if (ctx?.previous) qc.setQueryData(key, ctx.previous);
  },
});

const removeColumnOptionMutation = useMutation<
  unknown,
  Error,
  { columnId: string; optionId: string },
  Ctx
>({
  mutationFn: async (vars) => {
    const res = await removeColumnOption(vars);
    if (!res.ok) throw new Error(res.error);
    return res;
  },
  onMutate: async (vars) => {
    await qc.cancelQueries({ queryKey: key });
    const previous = qc.getQueryData<BoardCache>(key);
    if (previous) {
      const col = previous.columns.find((c) => c.id === vars.columnId);
      const opts = (
        (col?.settings as { options?: { id: string }[] })?.options ?? []
      ).filter((o) => o.id !== vars.optionId);
      let next = col
        ? replaceColumn(previous, {
            ...col,
            settings: { ...(col.settings as object), options: opts },
          })
        : previous;
      // also drop referencing cell values locally (status + dropdown)
      next = {
        ...next,
        cellValues: next.cellValues
          .map((cv) =>
            cv.column_id === vars.columnId
              ? stripOption(cv, vars.optionId)
              : cv,
          )
          .filter((cv): cv is typeof cv => cv !== null),
      };
      qc.setQueryData(key, next);
    }
    return { previous };
  },
  onError: (_e, _v, ctx) => {
    if (ctx?.previous) qc.setQueryData(key, ctx.previous);
  },
});
```

Add a local pure helper near the mutations:

```typescript
/** Remove an option id from a cell value; return null if the cell becomes empty. */
function stripOption(
  cv: CacheCellValue,
  optionId: string,
): CacheCellValue | null {
  const v = cv.value as { optionId?: string | null; optionIds?: string[] };
  if (v?.optionId !== undefined) return v.optionId === optionId ? null : cv;
  if (v?.optionIds) {
    const left = v.optionIds.filter((id) => id !== optionId);
    return left.length ? { ...cv, value: { optionIds: left } } : null;
  }
  return cv;
}
```

Expose both from the hook's returned object as `updateColumnSettings(columnId, settings)` and `removeColumnOption(columnId, optionId)` wrappers (mirror how `renameColumn`/`resizeColumn` are surfaced).

Add imports: `updateColumnSettings, removeColumnOption` from `@/lib/boards/actions`.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm vitest run src/lib/boards/use-board-mutations.test.ts && pnpm typecheck` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/use-board-mutations.ts src/lib/boards/use-board-mutations.test.ts
git commit -m "feat(boards): optimistic mutations for option edit + delete"
```

---

## Task 9: `ColumnOptionsDialog` + color swatch popover

**Files:**

- Create: `src/lib/boards/option-edit.ts` (pure reducers — also Task 10a; build here if not yet done)
- Create: `src/components/boards/ColumnOptionsDialog.tsx`
- Test: `src/lib/boards/option-edit.test.ts`, `src/components/boards/ColumnOptionsDialog.test.tsx`

- [ ] **Step 1: Write failing reducer tests** (`option-edit.test.ts`)

```typescript
import { describe, it, expect } from "vitest";
import {
  addOption,
  renameOption,
  recolorOption,
  reorderOptions,
  removeOption,
  countOptionUsage,
} from "./option-edit";

const base = [
  { id: "a", label: "A", color: "#000" },
  { id: "b", label: "B", color: "#111" },
];

describe("option-edit reducers", () => {
  it("addOption appends with a fresh palette color", () => {
    const next = addOption(base);
    expect(next).toHaveLength(3);
    expect(next[2].label).toBe("New label");
  });
  it("renameOption + recolorOption are immutable", () => {
    expect(renameOption(base, "a", "Z")[0].label).toBe("Z");
    expect(recolorOption(base, "a", "#abcdef")[0].color).toBe("#abcdef");
    expect(base[0].label).toBe("A");
  });
  it("reorderOptions moves an item", () => {
    expect(reorderOptions(base, 0, 1).map((o) => o.id)).toEqual(["b", "a"]);
  });
  it("removeOption drops by id", () => {
    expect(removeOption(base, "a").map((o) => o.id)).toEqual(["b"]);
  });
  it("countOptionUsage counts status + dropdown cells", () => {
    const cells = [
      { column_id: "c", value: { optionId: "a" } },
      { column_id: "c", value: { optionIds: ["a", "b"] } },
      { column_id: "c", value: { optionId: "b" } },
    ] as any;
    expect(countOptionUsage(cells, "c", "a")).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run src/lib/boards/option-edit.test.ts` → FAIL.

- [ ] **Step 3: Implement `option-edit.ts`**

```typescript
import type { ColumnOption } from "@/lib/validations/boards";
import { nextOptionColor } from "./option-colors";

export function addOption(opts: readonly ColumnOption[]): ColumnOption[] {
  return [
    ...opts,
    {
      id: crypto.randomUUID(),
      label: "New label",
      color: nextOptionColor(opts.map((o) => o.color)),
    },
  ];
}
export function renameOption(
  opts: readonly ColumnOption[],
  id: string,
  label: string,
): ColumnOption[] {
  return opts.map((o) => (o.id === id ? { ...o, label } : o));
}
export function recolorOption(
  opts: readonly ColumnOption[],
  id: string,
  color: string,
): ColumnOption[] {
  return opts.map((o) => (o.id === id ? { ...o, color } : o));
}
export function reorderOptions(
  opts: readonly ColumnOption[],
  from: number,
  to: number,
): ColumnOption[] {
  const next = [...opts];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
export function removeOption(
  opts: readonly ColumnOption[],
  id: string,
): ColumnOption[] {
  return opts.filter((o) => o.id !== id);
}

type CellLike = { column_id: string; value: unknown };
/** How many cells on `columnId` reference `optionId` (status + dropdown). Pure, from cache. */
export function countOptionUsage(
  cells: readonly CellLike[],
  columnId: string,
  optionId: string,
): number {
  let n = 0;
  for (const c of cells) {
    if (c.column_id !== columnId) continue;
    const v = c.value as { optionId?: string | null; optionIds?: string[] };
    if (v?.optionId === optionId) n++;
    else if (v?.optionIds?.includes(optionId)) n++;
  }
  return n;
}
```

- [ ] **Step 4: Verify reducers** — `pnpm vitest run src/lib/boards/option-edit.test.ts` → PASS.

- [ ] **Step 5: Write the dialog component test** (`ColumnOptionsDialog.test.tsx`)

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColumnOptionsDialog } from "./ColumnOptionsDialog";

const column = { id: "c1", kind: "status", name: "Status", settings: { options: [{ id: "a", label: "Done", color: "#0c8" }] } } as any;

describe("ColumnOptionsDialog", () => {
  it("saving emits the edited options", () => {
    const onSave = vi.fn();
    render(<ColumnOptionsDialog open column={column} usageOf={() => 0} onSave={onSave} onRemoveOption={vi.fn()} onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add option/i }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ options: expect.arrayContaining([expect.objectContaining({ label: "New label" })]) }));
  });
  it("deleting an in-use option asks to confirm", () => {
    const onRemoveOption = vi.fn();
    render(<ColumnOptionsDialog open column={column} usageOf={() => 3} onSave={vi.fn()} onRemoveOption={onRemoveOption} onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /remove Done/i }));
    expect(screen.getByText(/3 items use/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run to verify failure** — FAIL (component missing).

- [ ] **Step 7: Implement `ColumnOptionsDialog.tsx`**

Build with shadcn `Dialog`, `Popover` (swatch grid from `OPTION_COLORS`), `Input` (inline label), `@dnd-kit` `SortableContext` with `CSS.Translate.toString` only (per gotcha-20), `AlertDialog` for in-use delete. Local state seeded from `column.settings.options`; non-destructive edits accumulate locally and emit via `onSave(settings)` (→ `updateColumnSettings` mutation); a remove with `usageOf(optionId) > 0` opens the confirm then calls `onRemoveOption(optionId)` (→ `removeColumnOption` mutation), else removes locally.

Props:

```typescript
export function ColumnOptionsDialog({
  open,
  column,
  usageOf,
  onSave,
  onRemoveOption,
  onOpenChange,
}: {
  open: boolean;
  column: CacheColumn;
  usageOf: (optionId: string) => number;
  onSave: (settings: { options: ColumnOption[] }) => void;
  onRemoveOption: (optionId: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  /* … */
}
```

Use the reducers from `option-edit.ts` for every mutation of local state. Each option row: swatch button → `OPTION_COLORS` popover; label `Input`; `GripVertical` drag handle; remove `×` (aria-label `remove ${label}`). Header "Add option" button (aria-label `Add option`). Footer "Save".

- [ ] **Step 8: Run tests + typecheck**

Run: `pnpm vitest run src/components/boards/ColumnOptionsDialog.test.tsx && pnpm typecheck` — Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/boards/option-edit.ts src/lib/boards/option-edit.test.ts src/components/boards/ColumnOptionsDialog.tsx src/components/boards/ColumnOptionsDialog.test.tsx
git commit -m "feat(boards): ColumnOptionsDialog + pure option-edit reducers"
```

---

## Task 10: Wire "Edit labels" into `ColumnHeader` + `BoardTable`

**Files:**

- Modify: `src/components/boards/ColumnHeader.tsx`
- Modify: `src/components/boards/BoardTable.tsx`
- Test: `src/components/boards/ColumnHeader.test.tsx` (extend)

- [ ] **Step 1: Write failing test** — "Edit labels" appears only for status/dropdown

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColumnHeader } from "./ColumnHeader";

function open(kind: string) {
  const onEditOptions = vi.fn();
  render(<ColumnHeader column={{ id: "c", name: "X", kind, settings: {}, position: 0 } as any} width={180} onRename={vi.fn()} onDelete={vi.fn()} onResize={vi.fn()} onResizeEnd={vi.fn()} onEditOptions={onEditOptions} />);
  fireEvent.click(screen.getByRole("button", { name: /column menu/i }));
  return onEditOptions;
}
describe("ColumnHeader edit-labels affordance", () => {
  it("shows for status", () => { open("status"); expect(screen.getByText(/edit labels/i)).toBeInTheDocument(); });
  it("hidden for text", () => { open("text"); expect(screen.queryByText(/edit labels/i)).toBeNull(); });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Add the prop + menu item to `ColumnHeader.tsx`**

Add `onEditOptions?: () => void` to props. Import `COLUMN_KIND_META`. Inside `DropdownMenuContent`, above "Rename":

```tsx
{
  COLUMN_KIND_META[column.kind].hasOptions && onEditOptions && (
    <DropdownMenuItem onSelect={() => onEditOptions()}>
      Edit labels
    </DropdownMenuItem>
  );
}
```

- [ ] **Step 4: Wire it in `BoardTable.tsx`**

Add local state `const [optionsFor, setOptionsFor] = useState<CacheColumn | null>(null);`. In the `columns.map`, pass `onEditOptions={() => setOptionsFor(col)}`. Render once near the table root:

```tsx
{
  optionsFor && (
    <ColumnOptionsDialog
      open
      column={optionsFor}
      usageOf={(optionId) =>
        countOptionUsage(cache.cellValues, optionsFor.id, optionId)
      }
      onSave={(settings) => {
        mutations.updateColumnSettings(optionsFor.id, settings);
      }}
      onRemoveOption={(optionId) =>
        mutations.removeColumnOption(optionsFor.id, optionId)
      }
      onOpenChange={(o) => {
        if (!o) setOptionsFor(null);
      }}
    />
  );
}
```

Imports: `ColumnOptionsDialog`, `countOptionUsage`.

- [ ] **Step 5: Run tests + typecheck + lint**

Run: `pnpm vitest run src/components/boards/ColumnHeader.test.tsx && pnpm typecheck && pnpm lint` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/ColumnHeader.tsx src/components/boards/BoardTable.tsx src/components/boards/ColumnHeader.test.tsx
git commit -m "feat(boards): edit-labels menu opens ColumnOptionsDialog"
```

---

## Task 11: G2 cell renderers (Checkbox, Rating, Link, Email, Phone)

**Files:**

- Modify: `src/components/boards/cells/index.tsx`
- Test: `src/components/boards/cells/cells.test.tsx` (create/extend)

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CellRenderer } from "./index";

describe("6b cell renderers", () => {
  it("checkbox shows checked state", () => {
    render(<CellRenderer kind="checkbox" value={{ checked: true }} settings={{}} />);
    expect(screen.getByLabelText(/checked/i)).toBeInTheDocument();
  });
  it("rating shows N filled stars", () => {
    render(<CellRenderer kind="rating" value={{ rating: 3 }} settings={{}} />);
    expect(screen.getByLabelText(/3 of 5/i)).toBeInTheDocument();
  });
  it("link renders an anchor with the label", () => {
    render(<CellRenderer kind="link" value={{ url: "https://a.com", text: "Site" }} settings={{}} />);
    const a = screen.getByRole("link", { name: "Site" });
    expect(a).toHaveAttribute("href", "https://a.com");
    expect(a).toHaveAttribute("target", "_blank");
  });
  it("email renders a mailto", () => {
    render(<CellRenderer kind="email" value={{ email: "a@b.com" }} settings={{}} />);
    expect(screen.getByRole("link", { name: "a@b.com" })).toHaveAttribute("href", "mailto:a@b.com");
  });
  it("phone renders a tel", () => {
    render(<CellRenderer kind="phone" value={{ phone: "+1555" }} settings={{}} />);
    expect(screen.getByRole("link", { name: "+1555" })).toHaveAttribute("href", "tel:+1555");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `CellRenderer` hits `default: return null` → FAIL.

- [ ] **Step 3: Add the five renderers + `CellRenderer` cases in `cells/index.tsx`**

```tsx
import { Check, Star } from "lucide-react";

export function CheckboxCell({
  value,
}: {
  value: { checked: boolean } | null;
  settings: Settings;
}) {
  const checked = value?.checked ?? false;
  return (
    <span
      aria-label={checked ? "checked" : "unchecked"}
      className="flex items-center"
    >
      <span
        className={`flex size-4 items-center justify-center rounded border ${checked ? "bg-primary border-primary" : "border-muted-foreground/40"}`}
      >
        {checked && <Check className="text-primary-foreground size-3" />}
      </span>
    </span>
  );
}

export function RatingCell({
  value,
}: {
  value: { rating: number } | null;
  settings: Settings;
}) {
  const r = value?.rating ?? 0;
  return (
    <span aria-label={`${r} of 5`} className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`size-3.5 ${i <= r ? "fill-current text-amber-400" : "text-muted-foreground/30"}`}
        />
      ))}
    </span>
  );
}

export function LinkCell({
  value,
}: {
  value: { url: string; text?: string } | null;
  settings: Settings;
}) {
  if (!value?.url) return <span className="text-sm" />;
  return (
    <a
      href={value.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="text-primary truncate text-sm underline-offset-2 hover:underline"
    >
      {value.text || value.url}
    </a>
  );
}

export function EmailCell({
  value,
}: {
  value: { email: string } | null;
  settings: Settings;
}) {
  if (!value?.email) return <span className="text-sm" />;
  return (
    <a
      href={`mailto:${value.email}`}
      onClick={(e) => e.stopPropagation()}
      className="text-primary truncate text-sm hover:underline"
    >
      {value.email}
    </a>
  );
}

export function PhoneCell({
  value,
}: {
  value: { phone: string } | null;
  settings: Settings;
}) {
  if (!value?.phone) return <span className="text-sm" />;
  return (
    <a
      href={`tel:${value.phone}`}
      onClick={(e) => e.stopPropagation()}
      className="text-primary truncate text-sm hover:underline"
    >
      {value.phone}
    </a>
  );
}
```

Add to `CellRenderer`'s switch (before `default`):

```tsx
    case "checkbox":
      return <CheckboxCell value={value as { checked: boolean } | null} settings={settings} />;
    case "rating":
      return <RatingCell value={value as { rating: number } | null} settings={settings} />;
    case "link":
      return <LinkCell value={value as { url: string; text?: string } | null} settings={settings} />;
    case "email":
      return <EmailCell value={value as { email: string } | null} settings={settings} />;
    case "phone":
      return <PhoneCell value={value as { phone: string } | null} settings={settings} />;
```

(The `files` renderer is added in Task 17. Until then `files` falls to `default: return null`.)

- [ ] **Step 4: Run tests + typecheck** — `pnpm vitest run src/components/boards/cells/cells.test.tsx && pnpm typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/cells/index.tsx src/components/boards/cells/cells.test.tsx
git commit -m "feat(boards): cell renderers for checkbox/rating/link/email/phone"
```

---

## Task 12: G2 cell editors (Checkbox, Rating, Link, Email, Phone)

**Files:**

- Modify: `src/components/boards/cells/editors/index.tsx`
- Test: `src/components/boards/cells/editors/editors.test.tsx` (create/extend)

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CellEditor } from "./index";

describe("6b cell editors", () => {
  it("checkbox commits toggled value", () => {
    const onCommit = vi.fn();
    render(<CellEditor kind="checkbox" value={{ checked: false }} settings={{}} onCommit={onCommit} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onCommit).toHaveBeenCalledWith({ checked: true });
  });
  it("rating commits the clicked star; reclicking same clears", () => {
    const onCommit = vi.fn(); const onClear = vi.fn();
    render(<CellEditor kind="rating" value={{ rating: 3 }} settings={{}} onCommit={onCommit} onClear={onClear} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /4 stars/i }));
    expect(onCommit).toHaveBeenCalledWith({ rating: 4 });
    fireEvent.click(screen.getByRole("button", { name: /3 stars/i }));
    expect(onClear).toHaveBeenCalled();
  });
  it("link rejects invalid url on commit", () => {
    const onCommit = vi.fn();
    render(<CellEditor kind="link" value={null} settings={{}} onCommit={onCommit} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(/valid url/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `CellEditor` returns null for these kinds → FAIL.

- [ ] **Step 3: Implement editors + `CellEditor` cases** (reuse `EditorProps`, `PopoverSurface`, `Input`, `useCommitKeys`)

```tsx
import { Star } from "lucide-react";

export function CheckboxEditor({
  value,
  onCommit,
}: EditorProps<{ checked: boolean }>) {
  const checked = value?.checked ?? false;
  // Render as an immediately-actionable control; toggling commits + closes.
  return (
    <div className="flex h-8 items-center px-1">
      <input
        type="checkbox"
        aria-label="Toggle"
        checked={checked}
        autoFocus
        onChange={() => onCommit({ checked: !checked })}
        className="size-4"
      />
    </div>
  );
}

export function RatingEditor({
  value,
  onCommit,
  onClear,
  onCancel,
}: EditorProps<{ rating: number }>) {
  const current = value?.rating ?? 0;
  return (
    <PopoverSurface label="Set rating" onCancel={onCancel}>
      <div className="flex items-center gap-1 p-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            aria-label={`${i} stars`}
            onClick={() =>
              i === current ? (onClear ?? onCancel)() : onCommit({ rating: i })
            }
          >
            <Star
              className={`size-5 ${i <= current ? "fill-current text-amber-400" : "text-muted-foreground/40"}`}
            />
          </button>
        ))}
      </div>
    </PopoverSurface>
  );
}

function TextLikeEditor({
  label,
  initial,
  validate,
  build,
  onCommit,
  onCancel,
}: {
  label: string;
  initial: string;
  validate: (s: string) => string | null; // returns error or null
  build: (s: string) => unknown;
  onCommit: (v: unknown) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const commit = () => {
    const e = validate(s);
    if (e) {
      setErr(e);
      return;
    }
    onCommit(build(s));
  };
  const onKey = useCommitKeys(commit, onCancel);
  return (
    <div className="flex flex-col gap-1">
      <Input
        autoFocus
        aria-label={label}
        value={s}
        onChange={(e) => {
          setS(e.target.value);
          setErr(null);
        }}
        onKeyDown={onKey}
        className="h-8"
      />
      {err && <span className="text-destructive text-xs">{err}</span>}
      <button type="button" className="self-end text-xs" onClick={commit}>
        Save
      </button>
    </div>
  );
}

export function LinkEditor({
  value,
  onCommit,
  onCancel,
}: EditorProps<{ url: string; text?: string }>) {
  const [url, setUrl] = useState(value?.url ?? "");
  const [text, setText] = useState(value?.text ?? "");
  const [err, setErr] = useState<string | null>(null);
  const commit = () => {
    try {
      new URL(url);
    } catch {
      setErr("Enter a valid URL");
      return;
    }
    onCommit({ url, ...(text ? { text } : {}) });
  };
  return (
    <PopoverSurface label="Edit link" onCancel={onCancel}>
      <div className="flex w-56 flex-col gap-1 p-1">
        <Input
          autoFocus
          aria-label="URL"
          placeholder="https://…"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setErr(null);
          }}
          className="h-8"
        />
        <Input
          aria-label="Label"
          placeholder="Label (optional)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-8"
        />
        {err && <span className="text-destructive text-xs">{err}</span>}
        <button type="button" className="self-end text-xs" onClick={commit}>
          Save
        </button>
      </div>
    </PopoverSurface>
  );
}

export function EmailEditor({
  value,
  onCommit,
  onCancel,
}: EditorProps<{ email: string }>) {
  return (
    <TextLikeEditor
      label="Email"
      initial={value?.email ?? ""}
      onCommit={onCommit}
      onCancel={onCancel}
      validate={(s) =>
        /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? null : "Enter a valid email"
      }
      build={(s) => ({ email: s })}
    />
  );
}

export function PhoneEditor({
  value,
  onCommit,
  onCancel,
}: EditorProps<{ phone: string }>) {
  return (
    <TextLikeEditor
      label="Phone"
      initial={value?.phone ?? ""}
      onCommit={onCommit}
      onCancel={onCancel}
      validate={(s) => (s.trim().length ? null : "Enter a phone number")}
      build={(s) => ({ phone: s.trim() })}
    />
  );
}
```

Add to `CellEditor`'s switch (before `default`):

```tsx
    case "checkbox":
      return <CheckboxEditor value={value as { checked: boolean } | null} settings={settings} onCommit={onCommit} onCancel={onCancel} onClear={onClear} />;
    case "rating":
      return <RatingEditor value={value as { rating: number } | null} settings={settings} onCommit={onCommit} onCancel={onCancel} onClear={onClear} />;
    case "link":
      return <LinkEditor value={value as { url: string; text?: string } | null} settings={settings} onCommit={onCommit} onCancel={onCancel} onClear={onClear} />;
    case "email":
      return <EmailEditor value={value as { email: string } | null} settings={settings} onCommit={onCommit} onCancel={onCancel} onClear={onClear} />;
    case "phone":
      return <PhoneEditor value={value as { phone: string } | null} settings={settings} onCommit={onCommit} onCancel={onCancel} onClear={onClear} />;
```

(`files` editor is added in Task 17.)

- [ ] **Step 4: Run tests + typecheck** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/cells/editors/index.tsx src/components/boards/cells/editors/editors.test.tsx
git commit -m "feat(boards): cell editors for checkbox/rating/link/email/phone"
```

---

## Task 13: Rollup cases for new kinds

**Files:**

- Modify: `src/lib/boards/rollup.ts`
- Test: `src/lib/boards/rollup.test.ts` (extend)

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { rollupCell } from "./rollup";

describe("rollupCell — 6b kinds", () => {
  it("checkbox counts checked over present", () => {
    const r = rollupCell("checkbox", [
      { checked: true },
      { checked: false },
      { checked: true },
    ]);
    expect(r).toEqual({ kind: "checkbox", checked: 2, total: 3 });
  });
  it("rating averages", () => {
    const r = rollupCell("rating", [{ rating: 4 }, { rating: 2 }]);
    expect(r).toEqual({ kind: "rating", average: 3 });
  });
  it("link/email/phone/files are blank", () => {
    for (const k of ["link", "email", "phone", "files"] as const) {
      expect(rollupCell(k, [{ url: "https://a.com" }])).toEqual({
        kind: "blank",
      });
    }
  });
});
```

- [ ] **Step 2: Run to verify failure** — non-exhaustive switch → FAIL/typecheck error.

- [ ] **Step 3: Extend `RollupResult` + `rollupCell`**

Add to the `RollupResult` union:

```typescript
  | { kind: "checkbox"; checked: number; total: number }
  | { kind: "rating"; average: number }
```

Add cases to the `switch` (before the closing brace):

```typescript
    case "checkbox": {
      let checked = 0;
      for (const v of present) if ((v as { checked?: boolean }).checked) checked++;
      return { kind: "checkbox", checked, total: present.length };
    }
    case "rating": {
      let sum = 0, n = 0;
      for (const v of present) {
        const r = (v as { rating?: number }).rating;
        if (typeof r === "number") { sum += r; n++; }
      }
      return n ? { kind: "rating", average: Math.round((sum / n) * 10) / 10 } : { kind: "blank" };
    }
    case "link":
    case "email":
    case "phone":
    case "files":
      return { kind: "blank" };
```

- [ ] **Step 4: Update `RollupCell` renderer** (`src/components/boards/cells/RollupCell.tsx` or wherever `RollupResult` is consumed) to handle the two new variants (`checkbox` → "✓ 2/3", `rating` → "★ 3.0"). Add a small test asserting the rendered text.

- [ ] **Step 5: Run tests + typecheck** — PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/boards/rollup.ts src/lib/boards/rollup.test.ts src/components/boards/cells/RollupCell.tsx
git commit -m "feat(boards): rollups for checkbox + rating; blank for link/email/phone/files"
```

---

## Task 14: `AddColumnMenu` reads `COLUMN_KIND_META`

**Files:**

- Modify: `src/components/boards/AddColumnMenu.tsx`
- Test: `src/components/boards/AddColumnMenu.test.tsx` (create)

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AddColumnMenu } from "./AddColumnMenu";

describe("AddColumnMenu", () => {
  it("lists all kinds incl. the new ones and emits the kind", () => {
    const onAdd = vi.fn();
    render(<AddColumnMenu onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: /add column/i }));
    for (const label of ["Checkbox", "Rating", "Link", "Email", "Phone", "Files"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByText("Rating"));
    expect(onAdd).toHaveBeenCalledWith("rating");
  });
});
```

- [ ] **Step 2: Run to verify failure** — only 6 old kinds listed → FAIL.

- [ ] **Step 3: Refactor `AddColumnMenu.tsx`** to map `COLUMN_KIND_ORDER`/`COLUMN_KIND_META`:

```tsx
import { Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ColumnKind } from "@/lib/validations/boards";
import { COLUMN_KIND_META, COLUMN_KIND_ORDER } from "@/lib/boards/column-kinds";

export function AddColumnMenu({
  onAdd,
}: {
  onAdd: (kind: ColumnKind) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Add column"
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-full w-11 shrink-0 items-center justify-center border-l"
        >
          <Plus className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-auto">
        {COLUMN_KIND_ORDER.map((kind) => {
          const { label, Icon } = COLUMN_KIND_META[kind];
          return (
            <DropdownMenuItem key={kind} onSelect={() => onAdd(kind)}>
              <Icon className="size-4" /> {label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Run tests + typecheck** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/AddColumnMenu.tsx src/components/boards/AddColumnMenu.test.tsx
git commit -m "feat(boards): AddColumnMenu lists all kinds via COLUMN_KIND_META"
```

---

## Task 15: G3 — `createAttachment` accepts `columnId`

**Files:**

- Modify: `src/lib/collaboration/actions.ts`
- Test: `src/lib/collaboration/attachments-column.rls.integration.test.ts` (create)

- [ ] **Step 1: Write failing integration test** (skips without service-role key)

```typescript
import { describe, it, expect } from "vitest";
import { withOrgBoard, asMember } from "@/test/integration-helpers";

const RUN = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
(RUN ? describe : describe.skip)("createAttachment with columnId", () => {
  it("registers a column-scoped attachment; rejects a foreign path", async () => {
    await withOrgBoard(
      async ({ board, member, item, filesColumn, uploadObject }) => {
        const path = `${board.org_id}/${board.id}/${item.id}/${filesColumn.id}/${crypto.randomUUID()}-a.png`;
        await uploadObject(path); // direct-to-Storage as member
        const ok = await createAttachmentAs(member, {
          itemId: item.id,
          columnId: filesColumn.id,
          storagePath: path,
          fileName: "a.png",
          mimeType: "image/png",
          sizeBytes: 10,
        });
        expect(ok.ok).toBe(true);
        const bad = await createAttachmentAs(member, {
          itemId: item.id,
          columnId: filesColumn.id,
          storagePath: `${crypto.randomUUID()}/x`,
          fileName: "a.png",
          mimeType: "image/png",
          sizeBytes: 10,
        });
        expect(bad.ok).toBe(false);
      },
    );
  });
});
```

- [ ] **Step 2: Run to verify failure** — `columnId` not yet accepted → FAIL.

- [ ] **Step 3: Extend `createAttachment`**

Add `columnId?: string` to the input type. After resolving `item`:

```typescript
// Files-column attachments include the column segment in the path.
const prefix = parsed.data.columnId
  ? `${item.org_id}/${item.board_id}/${parsed.data.itemId}/${parsed.data.columnId}/`
  : `${item.org_id}/${item.board_id}/${parsed.data.itemId}/`;
if (!parsed.data.storagePath.startsWith(prefix))
  return fail("Storage path does not match this item.");

// If a columnId is given, it must be a files column on this item's board.
if (parsed.data.columnId) {
  const { data: col } = await supabase
    .from("columns")
    .select("id, kind, board_id")
    .eq("id", parsed.data.columnId)
    .maybeSingle();
  if (!col || col.board_id !== item.board_id || col.kind !== "files")
    return fail("Invalid file column.");
}
```

Add `column_id: parsed.data.columnId ?? null` to the `.insert({…})` object.

- [ ] **Step 4: Verify** (integration or MCP) + `pnpm typecheck`. Re-run `get_advisors` is not needed (no DDL).

- [ ] **Step 5: Commit**

```bash
git add src/lib/collaboration/actions.ts src/lib/collaboration/attachments-column.rls.integration.test.ts
git commit -m "feat(attachments): createAttachment accepts a Files-column columnId"
```

---

## Task 16: G3 — board payload + cache carry attachments

**Files:**

- Modify: `src/lib/boards/queries.ts`
- Modify: `src/lib/boards/cache.ts`
- Test: `src/lib/boards/cache.test.ts` (extend)

- [ ] **Step 1: Write failing cache tests**

```typescript
import { describe, it, expect } from "vitest";
import { prependColumnFile, removeColumnFile, filesForCell } from "./cache";

const A = (over: object) => ({
  id: "a1",
  item_id: "i1",
  column_id: "c1",
  file_name: "x.png",
  mime_type: "image/png",
  size_bytes: 1,
  storage_path: "p",
  created_at: "",
  org_id: "o",
  board_id: "b",
  uploaded_by: "u",
  update_id: null,
  ...over,
});

describe("board cache attachments", () => {
  const base = { attachments: [] } as any;
  it("prepend + remove", () => {
    const one = prependColumnFile(base, A({}));
    expect(one.attachments).toHaveLength(1);
    expect(removeColumnFile(one, "a1").attachments).toHaveLength(0);
  });
  it("filesForCell filters by item+column", () => {
    const c = { attachments: [A({}), A({ id: "a2", column_id: "c2" })] } as any;
    expect(filesForCell(c, "i1", "c1").map((a: any) => a.id)).toEqual(["a1"]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — helpers missing → FAIL.

- [ ] **Step 3: Extend `cache.ts`**

Add `attachments: CacheAttachment[]` to `BoardCache` (type `CacheAttachment = Tables<"attachments">`). Add helpers:

```typescript
export function prependColumnFile(
  cache: BoardCache,
  a: CacheAttachment,
): BoardCache {
  if (cache.attachments.some((x) => x.id === a.id)) return cache;
  return { ...cache, attachments: [a, ...cache.attachments] };
}
export function removeColumnFile(cache: BoardCache, id: string): BoardCache {
  return {
    ...cache,
    attachments: cache.attachments.filter((a) => a.id !== id),
  };
}
export function filesForCell(
  cache: BoardCache,
  itemId: string,
  columnId: string,
): CacheAttachment[] {
  return cache.attachments.filter(
    (a) => a.item_id === itemId && a.column_id === columnId,
  );
}
```

- [ ] **Step 4: Extend `getBoardPayload` in `queries.ts`**

Add `attachments: Attachment[]` to `BoardPayload`. Add a 7th query to the `Promise.all`:

```typescript
      supabase
        .from("attachments")
        .select("*")
        .eq("board_id", boardId)
        .not("column_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(200),
```

Destructure it and return `attachments: attachmentsRes.data ?? []`.

- [ ] **Step 5: Thread payload → cache** wherever `BoardPayload` hydrates `BoardCache` (the board cache initializer) — include `attachments: payload.attachments`.

- [ ] **Step 6: Run tests + typecheck** — `pnpm vitest run src/lib/boards/cache.test.ts && pnpm typecheck` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/boards/queries.ts src/lib/boards/cache.ts src/lib/boards/cache.test.ts
git commit -m "feat(boards): board payload + cache carry Files-column attachments"
```

---

## Task 17: G3 — Files cell (renderer + upload editor + mutations)

**Files:**

- Create: `src/components/boards/cells/FilesCell.tsx`
- Modify: `src/components/boards/cells/index.tsx` (CellRenderer `files` case)
- Modify: `src/components/boards/cells/editors/index.tsx` (CellEditor `files` case)
- Modify: `src/lib/boards/use-board-mutations.ts` (`uploadColumnFile`, `deleteColumnFile`)
- Modify: `src/components/boards/BoardTable.tsx` (pass attachments + handlers into the Files cell)
- Test: `src/components/boards/cells/FilesCell.test.tsx`

- [ ] **Step 1: Write failing renderer test**

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FilesCell } from "./FilesCell";

const att = (over: object) => ({ id: "a1", file_name: "x.png", mime_type: "image/png", ...over }) as any;

describe("FilesCell", () => {
  it("shows file count and an overflow when >3", () => {
    render(<FilesCell files={[att({}), att({ id: "a2" }), att({ id: "a3" }), att({ id: "a4" })]} previewUrls={{}} onOpen={() => {}} onUpload={() => {}} />);
    expect(screen.getByLabelText(/4 files/i)).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
  });
  it("empty shows only an add affordance", () => {
    render(<FilesCell files={[]} previewUrls={{}} onOpen={() => {}} onUpload={() => {}} />);
    expect(screen.getByRole("button", { name: /add file/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement `FilesCell.tsx`** (icon row via `fileKind`, overflow `+N`, thumbnail for previewable images, hover "＋" file input → `onUpload(file)`, click a chip → `onOpen(index)`):

```tsx
import { useRef } from "react";
import { FileText, Film, Paperclip, Plus } from "lucide-react";
import type { Tables } from "@/types/database.types";
import { fileKind } from "@/lib/collaboration/attachments-format";

type A = Tables<"attachments">;
const MAX = 3;

export function FilesCell({
  files,
  previewUrls,
  onOpen,
  onUpload,
}: {
  files: readonly A[];
  previewUrls: Record<string, string>;
  onOpen: (index: number) => void;
  onUpload: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const shown = files.slice(0, MAX);
  const overflow = files.length - shown.length;
  return (
    <span
      aria-label={`${files.length} files`}
      className="flex items-center gap-1"
    >
      {shown.map((a, i) => {
        const url = previewUrls[a.id];
        const k = fileKind(a.mime_type, a.file_name);
        return (
          <button
            key={a.id}
            type="button"
            title={a.file_name}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(i);
            }}
            className="border-border flex size-6 items-center justify-center overflow-hidden rounded border"
          >
            {k === "image" && url ? (
              <img src={url} alt="" className="size-full object-cover" />
            ) : k === "video" ? (
              <Film className="size-3.5" />
            ) : (
              <FileText className="size-3.5" />
            )}
          </button>
        );
      })}
      {overflow > 0 && (
        <span className="text-muted-foreground text-xs">+{overflow}</span>
      )}
      <button
        type="button"
        aria-label={files.length ? "Add file" : "Add file"}
        onClick={(e) => {
          e.stopPropagation();
          input.current?.click();
        }}
        className="text-muted-foreground hover:text-foreground"
      >
        {files.length ? (
          <Plus className="size-3.5" />
        ) : (
          <Paperclip className="size-3.5" />
        )}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          for (const f of Array.from(e.target.files ?? [])) onUpload(f);
          e.currentTarget.value = "";
        }}
      />
    </span>
  );
}
```

- [ ] **Step 4: Add the `files` case to `CellRenderer`** — the Files cell needs per-cell data, so `BoardTable`'s `EditableCell` renders it directly (not via the generic `CellRenderer`). In `EditableCell`, special-case `column.kind === "files"`:

```tsx
if (column.kind === "files") {
  const files = filesForCell(cache, item.id, column.id);
  return (
    <div className="flex h-full items-center border-l px-3">
      <FilesCell
        files={files}
        previewUrls={controls.filePreviewUrls}
        onOpen={(i) => controls.openFilesLightbox(files, i)}
        onUpload={(f) => controls.uploadColumnFile(item.id, column.id, f)}
      />
    </div>
  );
}
```

(`files` therefore never enters the editing/`CellEditor` path; add a `case "files": return null;` to both `CellRenderer` and `CellEditor` switches to keep them exhaustive.)

- [ ] **Step 5: Add `uploadColumnFile` + `deleteColumnFile` mutations** in `use-board-mutations.ts` — client-direct upload to the `attachments` bucket at `${org}/${board}/${item}/${column}/${uuid}-${name}`, then `createAttachment({ itemId, columnId, … })`, optimistic `prependColumnFile`; delete via `deleteAttachment` + optimistic `removeColumnFile`. Mirror the FilesTab upload flow (Phase 4c). Provide `controls.openFilesLightbox` using the existing `FilePreviewLightbox` (mint preview URLs via `getAttachmentPreviewUrls`).

- [ ] **Step 6: Run tests + typecheck + lint** — `pnpm vitest run src/components/boards/cells/FilesCell.test.tsx && pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/cells/FilesCell.tsx src/components/boards/cells/index.tsx src/components/boards/cells/editors/index.tsx src/lib/boards/use-board-mutations.ts src/components/boards/BoardTable.tsx
git commit -m "feat(boards): Files column cell — icons, upload, preview"
```

---

## Task 18: Non-Table view wiring for new kinds

**Files:**

- Modify (only if they switch exhaustively on `kind`): `src/components/boards/KanbanBoard.tsx`, `CalendarBoard.tsx`, `GanttBoard.tsx`
- Test: extend each view's existing test if a switch changed

- [ ] **Step 1: Check for exhaustive kind switches**

Run: `grep -n "case \"numbers\"\|switch (.*kind" src/components/boards/KanbanBoard.tsx src/components/boards/CalendarBoard.tsx src/components/boards/GanttBoard.tsx`
If a view renders cell content via `CellRenderer`, it already handles the new kinds (Task 11/17) — **no change needed**. Only edit views that have their OWN `kind` switch.

- [ ] **Step 2: Add read-only/no-op cases** where a local switch exists, so the new kinds render via `CellRenderer` (or are skipped for grouping/date mapping). The new kinds are **not** group-by/date sources. Add a test asserting a board with a checkbox/rating column renders the Kanban without crashing.

- [ ] **Step 3: Run tests + typecheck** — PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/boards/KanbanBoard.tsx src/components/boards/CalendarBoard.tsx src/components/boards/GanttBoard.tsx
git commit -m "feat(boards): non-Table views tolerate the new column kinds"
```

---

## Final integration & gate

- [ ] **e2e** (`e2e/custom-fields.spec.ts`): create a Status column → Edit labels → rename + recolor an option → assert the board cell reflects it; add a Rating column → set 4 stars → reload → still 4; add a Files column → upload an image → see the thumbnail → open the lightbox → close → delete the file.
- [ ] **Run the full gate:**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all green.

- [ ] **Advisors:** MCP `get_advisors` (security + performance) clean after both migrations.
- [ ] **Request review** (`superpowers:requesting-code-review`) — whole-branch.

---

## Self-Review (author checklist — completed)

**Spec coverage:**

- G1 option editing → T6 (schemas), T7 (actions + RPC), T8 (mutations), T9 (dialog + reducers), T10 (wiring). Destructive delete-and-clear → T2 RPC + T7 + T9 confirm. Color picker → T5 `OPTION_COLORS` + T9. ✓
- G2 five kinds → T1 (enum), T4 (value/settings), T5 (defaults/meta), T11 (renderers), T12 (editors), T13 (rollups), T14 (add menu). ✓
- G3 Files → T2 (`column_id` + index), T15 (action), T16 (payload+cache), T17 (cell+upload+preview). ✓
- Perf budget (§6): option edits/scalars 0 round-trips (cache); Files = one bounded board query (T16, `limit 200`, `attachments_item_column_idx`). ✓
- Execution DAG (§7) → the DAG section with waves + critical path. ✓
- Testing (§5) → unit (T4/T5/T9/T13), integration (T7/T15), component (T9/T11/T12/T17), e2e (final). ✓

**Placeholder scan:** integration-harness helpers (`withOrgBoard`/`asMember`) are named as "adapt to existing harness" with explicit behavioral contracts — not placeholders for the behavior. RollupCell renderer text (T13 Step 4) and view switches (T18) are conditional on what the executor finds; each names the exact assertion. No `TODO`/`TBD`.

**Type consistency:** `updateColumnSettings(columnId, settings)`, `removeColumnOption(columnId, optionId)`, `clearedCells`, `COLUMN_KIND_META`/`COLUMN_KIND_ORDER`, `OPTION_COLORS`/`nextOptionColor`, `prependColumnFile`/`removeColumnFile`/`filesForCell`, `filesForCell(cache, itemId, columnId)` — names match across tasks. The RPC `delete_column_option(p_column_id, p_option_id)` and its action wrapper agree. ✓
