# Board Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user create a board pre-populated from a built-in catalog of four templates (Blank, Sprint planning, Content calendar, Sales CRM), each seeding columns + groups + example items, via a picker in the sidebar "New board" flow.

**Architecture:** A static, typed TS catalog (`src/lib/boards/templates.ts`) is the single source of truth — it drives both the picker cards and the seed payload. A `createBoardFromTemplate` Server Action **mints all uuids** (groups, columns, status/dropdown options, items), resolves date offsets to concrete ISO dates, and assembles a fully-formed jsonb payload. A new atomic `create_board_from_template` RPC (security definer, membership-checked) creates the board + Main Table view and bulk-inserts the payload scoped to the org. (This refines spec §5: uuid-minting lives in the action, so the RPC is a straight atomic bulk-insert with no plpgsql ref-mapping loops.)

**Tech Stack:** Next.js 16 Server Actions, Supabase (plpgsql RPC, RLS), Zod, Vitest (unit + live-RLS integration), Playwright (e2e), shadcn/ui + Tailwind v4.

---

## File structure

- **Create** `src/lib/boards/templates.ts` — the typed catalog: types, four `BoardTemplate`s, `BOARD_TEMPLATES`, `getTemplate(id)`.
- **Create** `src/lib/boards/templates.test.ts` — catalog-integrity unit test.
- **Modify** `src/lib/validations/board-actions.ts` — add `createBoardFromTemplateSchema`.
- **Modify** `src/lib/boards/actions.ts` — add `createBoardFromTemplate` Server Action + `buildTemplatePayload` helper.
- **Modify** `src/lib/boards/actions.test.ts` — unit-test the payload assembly + offset resolution.
- **Create** `supabase/migrations/<ts>_create_board_from_template.sql` — the RPC + grant.
- **Modify** `src/types/database.types.ts` — regenerated (do not hand-edit).
- **Create** `src/lib/boards/templates.rls.integration.test.ts` — live RLS integration.
- **Create** `src/components/boards/NewBoardDialog.tsx` — the picker dialog (extracted from `BoardsNav`).
- **Create** `src/components/boards/NewBoardDialog.test.tsx` — component test.
- **Modify** `src/components/boards/BoardsNav.tsx` — render `<NewBoardDialog>`; drop the inline name-only dialog + its `createBoard` import/state.
- **Create** `e2e/board-templates.spec.ts` — happy-path e2e.

---

## Task 1: Template catalog module

**Files:**

- Create: `src/lib/boards/templates.ts`
- Test: `src/lib/boards/templates.test.ts`

- [ ] **Step 1: Write the failing integrity test**

```ts
// src/lib/boards/templates.test.ts
import { describe, it, expect } from "vitest";
import { BOARD_TEMPLATES, getTemplate } from "@/lib/boards/templates";
import { columnKindSchema } from "@/lib/validations/boards";

describe("board templates catalog", () => {
  it("has four templates with unique ids incl. 'blank'", () => {
    const ids = BOARD_TEMPLATES.map((t) => t.id);
    expect(ids).toContain("blank");
    expect(new Set(ids).size).toBe(ids.length);
    expect(BOARD_TEMPLATES).toHaveLength(4);
  });

  it("uses only valid Pulse column kinds", () => {
    for (const t of BOARD_TEMPLATES)
      for (const c of t.columns)
        expect(columnKindSchema.safeParse(c.kind).success).toBe(true);
  });

  it("every column ref + group ref is unique within a template", () => {
    for (const t of BOARD_TEMPLATES) {
      const cols = t.columns.map((c) => c.ref);
      const grps = t.groups.map((g) => g.ref);
      expect(new Set(cols).size).toBe(cols.length);
      expect(new Set(grps).size).toBe(grps.length);
    }
  });

  it("only status/dropdown columns carry options; numbers may carry settings", () => {
    for (const t of BOARD_TEMPLATES)
      for (const c of t.columns) {
        if (c.options) expect(["status", "dropdown"]).toContain(c.kind);
        if (c.options)
          expect(new Set(c.options.map((o) => o.ref)).size).toBe(
            c.options.length,
          );
      }
  });

  it("every item references a real group, and every cell a real column + option", () => {
    for (const t of BOARD_TEMPLATES) {
      const groupRefs = new Set(t.groups.map((g) => g.ref));
      const colByRef = new Map(t.columns.map((c) => [c.ref, c]));
      for (const item of t.items) {
        expect(groupRefs.has(item.groupRef)).toBe(true);
        for (const [colRef, value] of Object.entries(item.cells)) {
          const col = colByRef.get(colRef);
          expect(col, `${t.id}:${colRef}`).toBeDefined();
          const optRefs = new Set((col!.options ?? []).map((o) => o.ref));
          if ("optionRef" in value)
            expect(optRefs.has(value.optionRef)).toBe(true);
          if ("optionRefs" in value)
            for (const r of value.optionRefs) expect(optRefs.has(r)).toBe(true);
        }
      }
    }
  });

  it("getTemplate returns by id and undefined for unknown", () => {
    expect(getTemplate("blank")?.id).toBe("blank");
    expect(getTemplate("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm test src/lib/boards/templates.test.ts`
Expected: FAIL — cannot resolve `@/lib/boards/templates`.

- [ ] **Step 3: Create the catalog module**

```ts
// src/lib/boards/templates.ts
import type { ColumnKind } from "@/lib/validations/boards";

export type TemplateOption = { ref: string; label: string; color: string };

export type TemplateColumn = {
  ref: string;
  kind: ColumnKind;
  name: string;
  options?: TemplateOption[]; // status / dropdown only
  settings?: { unit?: string; precision?: number }; // numbers only
};

export type TemplateGroup = { ref: string; name: string; color: string };

export type TemplateCellValue =
  | { optionRef: string } // status   -> { optionId }
  | { optionRefs: string[] } // dropdown -> { optionIds }
  | { dateOffset: number; endOffset?: number } // date -> { date, end? }
  | { n: number } // numbers -> { n }
  | { text: string }; // text -> { text }

export type TemplateItem = {
  groupRef: string;
  name: string;
  cells: Record<string, TemplateCellValue>; // keyed by column ref
};

export type BoardTemplate = {
  id: string;
  name: string;
  icon: string; // lucide key, mapped in the picker
  description: string;
  columns: TemplateColumn[];
  groups: TemplateGroup[];
  items: TemplateItem[];
};

// Shared status palette (Monday-ish hexes used elsewhere in the app).
const C = {
  green: "#00c875",
  amber: "#fdab3d",
  red: "#e2445c",
  grey: "#c4c4c4",
  slate: "#808080",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  sky: "#38bdf8",
  pink: "#ec4899",
  teal: "#14b8a6",
  orange: "#f97316",
};

export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    id: "blank",
    name: "Blank board",
    icon: "board",
    description: "Status, Owner and Date to start from scratch.",
    groups: [{ ref: "g1", name: "Group 1", color: C.indigo }],
    columns: [
      {
        ref: "c_status",
        kind: "status",
        name: "Status",
        options: [
          { ref: "working", label: "Working on it", color: C.amber },
          { ref: "stuck", label: "Stuck", color: C.red },
          { ref: "done", label: "Done", color: C.green },
          { ref: "notstarted", label: "Not started", color: C.grey },
        ],
      },
      { ref: "c_owner", kind: "people", name: "Owner" },
      { ref: "c_date", kind: "date", name: "Date" },
    ],
    items: [],
  },
  {
    id: "sprints",
    name: "Sprint planning",
    icon: "rocket",
    description: "Backlog / In Sprint / Done with points & progress.",
    groups: [
      { ref: "g_backlog", name: "Backlog", color: C.slate },
      { ref: "g_sprint", name: "In Sprint", color: C.indigo },
      { ref: "g_done", name: "Done", color: C.green },
    ],
    columns: [
      {
        ref: "c_status",
        kind: "status",
        name: "Status",
        options: [
          { ref: "working", label: "Working on it", color: C.amber },
          { ref: "stuck", label: "Stuck", color: C.red },
          { ref: "done", label: "Done", color: C.green },
          { ref: "notstarted", label: "Not started", color: C.grey },
        ],
      },
      { ref: "c_owner", kind: "people", name: "Owner" },
      {
        ref: "c_points",
        kind: "numbers",
        name: "Points",
        settings: { unit: " pts" },
      },
      {
        ref: "c_progress",
        kind: "numbers",
        name: "Progress",
        settings: { unit: "%" },
      },
      { ref: "c_sprint", kind: "date", name: "Sprint" },
    ],
    items: [
      {
        groupRef: "g_sprint",
        name: "Build onboarding flow",
        cells: {
          c_status: { optionRef: "working" },
          c_points: { n: 8 },
          c_progress: { n: 40 },
          c_sprint: { dateOffset: 0, endOffset: 14 },
        },
      },
      {
        groupRef: "g_sprint",
        name: "Fix flaky tests",
        cells: {
          c_status: { optionRef: "stuck" },
          c_points: { n: 3 },
          c_progress: { n: 10 },
          c_sprint: { dateOffset: 0, endOffset: 14 },
        },
      },
      {
        groupRef: "g_backlog",
        name: "Research auth providers",
        cells: {
          c_status: { optionRef: "notstarted" },
          c_points: { n: 5 },
          c_progress: { n: 0 },
        },
      },
      {
        groupRef: "g_done",
        name: "Ship settings page",
        cells: {
          c_status: { optionRef: "done" },
          c_points: { n: 5 },
          c_progress: { n: 100 },
        },
      },
    ],
  },
  {
    id: "content",
    name: "Content calendar",
    icon: "megaphone",
    description: "Ideas / Writing / Published with channel & publish date.",
    groups: [
      { ref: "g_ideas", name: "Ideas", color: C.violet },
      { ref: "g_progress", name: "In Progress", color: C.amber },
      { ref: "g_published", name: "Published", color: C.green },
    ],
    columns: [
      {
        ref: "c_stage",
        kind: "status",
        name: "Stage",
        options: [
          { ref: "idea", label: "Idea", color: C.violet },
          { ref: "writing", label: "Writing", color: C.amber },
          { ref: "review", label: "Review", color: C.sky },
          { ref: "published", label: "Published", color: C.green },
        ],
      },
      { ref: "c_writer", kind: "people", name: "Writer" },
      {
        ref: "c_channel",
        kind: "dropdown",
        name: "Channel",
        options: [
          { ref: "blog", label: "Blog", color: C.indigo },
          { ref: "social", label: "Social", color: C.pink },
          { ref: "email", label: "Email", color: C.teal },
          { ref: "video", label: "Video", color: C.orange },
        ],
      },
      { ref: "c_publish", kind: "date", name: "Publish" },
      { ref: "c_draft", kind: "text", name: "Draft" },
    ],
    items: [
      {
        groupRef: "g_progress",
        name: "Dark mode design deep-dive",
        cells: {
          c_stage: { optionRef: "writing" },
          c_channel: { optionRefs: ["blog"] },
          c_publish: { dateOffset: 5 },
        },
      },
      {
        groupRef: "g_progress",
        name: "Launch thread",
        cells: {
          c_stage: { optionRef: "review" },
          c_channel: { optionRefs: ["social"] },
          c_publish: { dateOffset: 2 },
        },
      },
      {
        groupRef: "g_ideas",
        name: "Customer story: Acme",
        cells: {
          c_stage: { optionRef: "idea" },
          c_channel: { optionRefs: ["blog"] },
          c_publish: { dateOffset: 20 },
        },
      },
      {
        groupRef: "g_published",
        name: "Weekly newsletter #42",
        cells: {
          c_stage: { optionRef: "published" },
          c_channel: { optionRefs: ["email"] },
          c_publish: { dateOffset: -2 },
        },
      },
    ],
  },
  {
    id: "crm",
    name: "Sales CRM",
    icon: "dashboard",
    description: "Leads / Negotiation / Won with deal size & priority.",
    groups: [
      { ref: "g_leads", name: "Leads", color: C.sky },
      { ref: "g_play", name: "In Play", color: C.amber },
      { ref: "g_closed", name: "Closed", color: C.green },
    ],
    columns: [
      {
        ref: "c_stage",
        kind: "status",
        name: "Stage",
        options: [
          { ref: "lead", label: "Lead", color: C.sky },
          { ref: "negotiation", label: "Negotiation", color: C.amber },
          { ref: "won", label: "Won", color: C.green },
          { ref: "lost", label: "Lost", color: C.red },
        ],
      },
      { ref: "c_rep", kind: "people", name: "Rep" },
      {
        ref: "c_deal",
        kind: "numbers",
        name: "Deal size",
        settings: { unit: "$" },
      },
      {
        ref: "c_priority",
        kind: "status",
        name: "Priority",
        options: [
          { ref: "hot", label: "Hot", color: C.red },
          { ref: "warm", label: "Warm", color: C.amber },
          { ref: "cold", label: "Cold", color: C.slate },
        ],
      },
      { ref: "c_close", kind: "date", name: "Close date" },
    ],
    items: [
      {
        groupRef: "g_play",
        name: "Acme Corp — Platform",
        cells: {
          c_stage: { optionRef: "negotiation" },
          c_deal: { n: 48000 },
          c_priority: { optionRef: "hot" },
          c_close: { dateOffset: 12 },
        },
      },
      {
        groupRef: "g_play",
        name: "Northwind — Teams",
        cells: {
          c_stage: { optionRef: "negotiation" },
          c_deal: { n: 22000 },
          c_priority: { optionRef: "warm" },
          c_close: { dateOffset: 25 },
        },
      },
      {
        groupRef: "g_leads",
        name: "Globex — Trial",
        cells: {
          c_stage: { optionRef: "lead" },
          c_deal: { n: 9000 },
          c_priority: { optionRef: "cold" },
          c_close: { dateOffset: 40 },
        },
      },
      {
        groupRef: "g_closed",
        name: "Initech — Renewal",
        cells: {
          c_stage: { optionRef: "won" },
          c_deal: { n: 31000 },
          c_priority: { optionRef: "hot" },
          c_close: { dateOffset: -3 },
        },
      },
    ],
  },
];

export function getTemplate(id: string): BoardTemplate | undefined {
  return BOARD_TEMPLATES.find((t) => t.id === id);
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm test src/lib/boards/templates.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/templates.ts src/lib/boards/templates.test.ts
git commit -m "feat(templates): board-template catalog + integrity tests"
```

---

## Task 2: Action input validation schema

**Files:**

- Modify: `src/lib/validations/board-actions.ts`

- [ ] **Step 1: Add the schema**

Append after `createBoardSchema` (line 9):

```ts
export const createBoardFromTemplateSchema = z.object({
  workspaceId: uuid,
  templateId: z.string().min(1),
  name,
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/validations/board-actions.ts
git commit -m "feat(templates): add createBoardFromTemplate input schema"
```

---

## Task 3: `createBoardFromTemplate` Server Action

**Files:**

- Modify: `src/lib/boards/actions.ts`
- Test: `src/lib/boards/actions.test.ts`

The action mints uuids, resolves date offsets, and assembles the RPC payload. Export `buildTemplatePayload` so it is unit-testable without Supabase.

- [ ] **Step 1: Write the failing unit test**

Append to `src/lib/boards/actions.test.ts`:

```ts
import { buildTemplatePayload } from "@/lib/boards/actions";
import { getTemplate } from "@/lib/boards/templates";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("buildTemplatePayload", () => {
  it("blank: 1 group, 3 columns, 0 items; all ids are uuids", () => {
    const p = buildTemplatePayload(getTemplate("blank")!);
    expect(p.groups).toHaveLength(1);
    expect(p.columns).toHaveLength(3);
    expect(p.items).toHaveLength(0);
    expect(p.groups[0].id).toMatch(UUID_RE);
    expect(p.columns.every((c) => UUID_RE.test(c.id))).toBe(true);
    expect(p.groups[0].position).toBe(0);
  });

  it("status column carries options with minted uuid ids", () => {
    const p = buildTemplatePayload(getTemplate("blank")!);
    const status = p.columns.find((c) => c.kind === "status")!;
    const opts = (status.settings as { options: { id: string }[] }).options;
    expect(opts).toHaveLength(4);
    expect(opts.every((o) => UUID_RE.test(o.id))).toBe(true);
  });

  it("resolves a status cell to the matching minted optionId", () => {
    const p = buildTemplatePayload(getTemplate("sprints")!);
    const status = p.columns.find((c) => c.name === "Status")!;
    const doneId = (
      status.settings as { options: { id: string; label: string }[] }
    ).options.find((o) => o.label === "Done")!.id;
    const shipItem = p.items.find((i) => i.name === "Ship settings page")!;
    const statusCell = shipItem.cells.find((c) => c.columnId === status.id)!;
    expect(statusCell.value).toEqual({ optionId: doneId });
  });

  it("resolves a date range cell to ISO start + end", () => {
    const p = buildTemplatePayload(getTemplate("sprints")!);
    const sprintCol = p.columns.find((c) => c.name === "Sprint")!;
    const item = p.items.find((i) => i.name === "Build onboarding flow")!;
    const cell = item.cells.find((c) => c.columnId === sprintCol.id)!;
    const v = cell.value as { date: string; end: string };
    expect(v.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(v.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(v.end > v.date).toBe(true);
  });

  it("resolves dropdown, numbers and text cells", () => {
    const p = buildTemplatePayload(getTemplate("content")!);
    const channel = p.columns.find((c) => c.name === "Channel")!;
    const item = p.items.find((i) => i.name === "Launch thread")!;
    const cell = item.cells.find((c) => c.columnId === channel.id)!;
    const ids = (cell.value as { optionIds: string[] }).optionIds;
    expect(ids).toHaveLength(1);
    expect(UUID_RE.test(ids[0])).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm test src/lib/boards/actions.test.ts`
Expected: FAIL — `buildTemplatePayload` not exported.

- [ ] **Step 3: Implement the helper + action**

Add to the imports block in `src/lib/boards/actions.ts`:

```ts
import { createBoardFromTemplateSchema } from "@/lib/validations/board-actions";
import { getTemplate, type BoardTemplate } from "@/lib/boards/templates";
```

Add these exports (place `buildTemplatePayload` above `createBoard`, and the action just after `createBoard`):

```ts
/** Fully-resolved seed payload handed to the create_board_from_template RPC. */
export type TemplatePayload = {
  groups: { id: string; name: string; color: string; position: number }[];
  columns: {
    id: string;
    kind: string;
    name: string;
    settings: Json;
    position: number;
  }[];
  items: {
    id: string;
    groupId: string;
    name: string;
    position: number;
    cells: { columnId: string; value: Json }[];
  }[];
};

function isoFromToday(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/**
 * Turn a code-defined BoardTemplate into a fully-resolved seed payload:
 * mints uuids for groups/columns/options/items, builds kind-shaped cell
 * values, and resolves date offsets to concrete ISO dates. Pure + exported
 * for unit testing (no Supabase).
 */
export function buildTemplatePayload(template: BoardTemplate): TemplatePayload {
  const groupId = new Map<string, string>();
  const columnId = new Map<string, string>();
  // optionId maps are per-column: columnRef -> (optionRef -> uuid)
  const optionId = new Map<string, Map<string, string>>();

  const groups = template.groups.map((g, i) => {
    const id = crypto.randomUUID();
    groupId.set(g.ref, id);
    return { id, name: g.name, color: g.color, position: i };
  });

  const columns = template.columns.map((c, i) => {
    const id = crypto.randomUUID();
    columnId.set(c.ref, id);
    let settings: Json = {};
    if (c.options) {
      const m = new Map<string, string>();
      const options = c.options.map((o) => {
        const oid = crypto.randomUUID();
        m.set(o.ref, oid);
        return { id: oid, label: o.label, color: o.color };
      });
      optionId.set(c.ref, m);
      settings = { options };
    } else if (c.settings) {
      settings = { ...c.settings } as Json;
    }
    return { id, kind: c.kind, name: c.name, settings, position: i };
  });

  const items = template.items.map((item, i) => {
    const cells = Object.entries(item.cells).map(([colRef, tv]) => {
      const col = template.columns.find((c) => c.ref === colRef)!;
      let value: Json;
      switch (col.kind) {
        case "status":
          value = {
            optionId: optionId
              .get(colRef)!
              .get((tv as { optionRef: string }).optionRef)!,
          };
          break;
        case "dropdown":
          value = {
            optionIds: (tv as { optionRefs: string[] }).optionRefs.map(
              (r) => optionId.get(colRef)!.get(r)!,
            ),
          };
          break;
        case "date": {
          const d = tv as { dateOffset: number; endOffset?: number };
          value =
            d.endOffset === undefined
              ? { date: isoFromToday(d.dateOffset) }
              : {
                  date: isoFromToday(d.dateOffset),
                  end: isoFromToday(d.endOffset),
                };
          break;
        }
        case "numbers":
          value = { n: (tv as { n: number }).n };
          break;
        case "text":
          value = { text: (tv as { text: string }).text };
          break;
        default:
          value = {};
      }
      return { columnId: columnId.get(colRef)!, value };
    });
    return {
      id: crypto.randomUUID(),
      groupId: groupId.get(item.groupRef)!,
      name: item.name,
      position: i,
      cells,
    };
  });

  return { groups, columns, items };
}

/** Create a board pre-populated from a built-in template via an atomic RPC. */
export async function createBoardFromTemplate(input: {
  workspaceId: string;
  templateId: string;
  name: string;
}): Promise<ActionResult<{ boardId: string }>> {
  const parsed = createBoardFromTemplateSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const template = getTemplate(parsed.data.templateId);
  if (!template) return fail("Unknown template.");

  const payload = buildTemplatePayload(template);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_board_from_template", {
    p_workspace_id: parsed.data.workspaceId,
    p_name: parsed.data.name,
    p_template: payload as unknown as Json,
  });
  if (error || !data) return fail(error?.message ?? "Could not create board.");

  revalidatePath("/", "layout");
  return { ok: true, data: { boardId: data.id } };
}
```

- [ ] **Step 4: Run the unit test, verify it passes**

Run: `pnpm test src/lib/boards/actions.test.ts`
Expected: PASS. (The `supabase.rpc("create_board_from_template", …)` call will not typecheck until Task 4 regenerates types — that is expected; the unit test only exercises `buildTemplatePayload`. If `pnpm typecheck` is run now it will error on the unknown RPC name; that resolves in Task 4.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/actions.ts src/lib/boards/actions.test.ts
git commit -m "feat(templates): createBoardFromTemplate action + payload builder"
```

---

## Task 4: `create_board_from_template` RPC migration

**Files:**

- Create: `supabase/migrations/<timestamp>_create_board_from_template.sql`
- Modify (generated): `src/types/database.types.ts`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260618120000_create_board_from_template.sql` (use the actual current UTC timestamp for the filename prefix):

```sql
-- create_board_from_template: atomically create a board + Main Table view and
-- bulk-insert a fully-resolved template payload (groups/columns/items/cells).
-- The caller (createBoardFromTemplate server action) mints all uuids and shapes
-- cell values; this function only enforces membership, derives org_id, and
-- inserts. Mirrors create_board's auth/membership guards.
create or replace function public.create_board_from_template(
  p_workspace_id uuid,
  p_name text,
  p_template jsonb
) returns public.boards
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org_id uuid;
  v_board  public.boards;
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

  insert into public.boards (org_id, workspace_id, name, position, created_by)
  values (v_org_id, p_workspace_id, p_name, 0, v_uid)
  returning * into v_board;

  insert into public.groups (id, org_id, board_id, name, color, position)
  select (g->>'id')::uuid, v_org_id, v_board.id, g->>'name', g->>'color',
         (g->>'position')::double precision
  from jsonb_array_elements(coalesce(p_template->'groups', '[]'::jsonb)) as g;

  insert into public.columns (id, org_id, board_id, kind, name, settings, position)
  select (c->>'id')::uuid, v_org_id, v_board.id, (c->>'kind')::public.column_kind,
         c->>'name', coalesce(c->'settings', '{}'::jsonb),
         (c->>'position')::double precision
  from jsonb_array_elements(coalesce(p_template->'columns', '[]'::jsonb)) as c;

  insert into public.items (id, org_id, board_id, group_id, name, position)
  select (i->>'id')::uuid, v_org_id, v_board.id, (i->>'groupId')::uuid,
         i->>'name', (i->>'position')::double precision
  from jsonb_array_elements(coalesce(p_template->'items', '[]'::jsonb)) as i;

  insert into public.cell_values (org_id, board_id, item_id, column_id, value)
  select v_org_id, v_board.id, (i->>'id')::uuid, (cell->>'columnId')::uuid,
         cell->'value'
  from jsonb_array_elements(coalesce(p_template->'items', '[]'::jsonb)) as i
  cross join lateral jsonb_array_elements(coalesce(i->'cells', '[]'::jsonb)) as cell;

  insert into public.board_views (org_id, board_id, kind, name, config, position)
  values (v_org_id, v_board.id, 'table', 'Main Table', '{}'::jsonb, 0);

  return v_board;
end; $$;

grant execute on function public.create_board_from_template(uuid, text, jsonb)
  to authenticated;
```

- [ ] **Step 2: Apply the migration (requires per-session authorization from Danijel)**

This project is cloud-native with no local stack. With Danijel's explicit OK for this session:

Run: `pnpm supabase db push --linked`
Expected: the new migration applies cleanly.

- [ ] **Step 3: Regenerate types**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` updated; `create_board_from_template` appears under `Functions`. Note the known PostHog telemetry-line leak — filter `'"_tag"'` before prettier if present (see north-star §3 manual gates).

- [ ] **Step 4: Typecheck (now the action's `.rpc(...)` resolves)**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/ src/types/database.types.ts
git commit -m "feat(templates): create_board_from_template RPC + regenerated types"
```

---

## Task 5: Live RLS integration test

**Files:**

- Create: `src/lib/boards/templates.rls.integration.test.ts`

Mirror `src/lib/boards/columns.rls.integration.test.ts` for provisioning. The test calls the RPC directly via the anon client (signed-in user) — the same payload shape `buildTemplatePayload` produces.

- [ ] **Step 1: Write the integration test**

```ts
// src/lib/boards/templates.rls.integration.test.ts
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Json } from "@/types/database.types";
import { buildTemplatePayload } from "@/lib/boards/actions";
import { getTemplate } from "@/lib/boards/templates";

config({ path: ".env.local", override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

describe.skipIf(!SERVICE_ROLE_KEY)("RLS: create_board_from_template", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];
  let anonA: SupabaseClient<Database>;
  let workspaceA: string;
  let anonB: SupabaseClient<Database>; // a different org
  let workspaceA_seenByB: string;

  async function provision(label: string) {
    const email = `rls-tmpl-${randomUUID()}@example.com`;
    const { data: created } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    const id = created.user!.id;
    createdUserIds.push(id);
    const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await anon.auth.signInWithPassword({ email, password: PASSWORD });
    const { data: org } = await anon.rpc("create_organization", {
      p_name: `Org ${label}`,
      p_slug: `rls-t-${label}-${randomUUID().slice(0, 8)}`,
    });
    const orgId = (org as { id: string }).id;
    const { data: ws } = await anon
      .from("workspaces")
      .insert({ org_id: orgId, name: `WS ${label}`, created_by: id })
      .select("id")
      .single();
    return { anon, workspaceId: (ws as { id: string }).id };
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const a = await provision("A");
    anonA = a.anon;
    workspaceA = a.workspaceId;
    workspaceA_seenByB = a.workspaceId;
    const b = await provision("B");
    anonB = b.anon;
  });

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  });

  it("a member seeds a full board (groups, columns, items, cells, view)", async () => {
    const payload = buildTemplatePayload(getTemplate("sprints")!);
    const { data: board, error } = await anonA.rpc(
      "create_board_from_template",
      {
        p_workspace_id: workspaceA,
        p_name: "Sprint board",
        p_template: payload as unknown as Json,
      },
    );
    expect(error).toBeNull();
    const boardId = (board as { id: string }).id;

    const { count: groups } = await anonA
      .from("groups")
      .select("*", { count: "exact", head: true })
      .eq("board_id", boardId);
    expect(groups).toBe(3);

    const { count: columns } = await anonA
      .from("columns")
      .select("*", { count: "exact", head: true })
      .eq("board_id", boardId);
    expect(columns).toBe(5);

    const { count: items } = await anonA
      .from("items")
      .select("*", { count: "exact", head: true })
      .eq("board_id", boardId);
    expect(items).toBe(4);

    const { count: cells } = await anonA
      .from("cell_values")
      .select("*", { count: "exact", head: true })
      .eq("board_id", boardId);
    expect(cells).toBeGreaterThanOrEqual(12);

    const { data: views } = await anonA
      .from("board_views")
      .select("kind,name")
      .eq("board_id", boardId);
    expect(views).toEqual([{ kind: "table", name: "Main Table" }]);
  });

  it("a non-member is denied (42501) on another org's workspace", async () => {
    const payload = buildTemplatePayload(getTemplate("blank")!);
    const { error } = await anonB.rpc("create_board_from_template", {
      p_workspace_id: workspaceA_seenByB,
      p_name: "Sneaky",
      p_template: payload as unknown as Json,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `pnpm test src/lib/boards/templates.rls.integration.test.ts`
Expected: PASS (2 tests) when `.env.local` secrets are present; skipped otherwise.

- [ ] **Step 3: Commit**

```bash
git add src/lib/boards/templates.rls.integration.test.ts
git commit -m "test(templates): live RLS integration for create_board_from_template"
```

---

## Task 6: New-board picker dialog

**Files:**

- Create: `src/components/boards/NewBoardDialog.tsx`
- Test: `src/components/boards/NewBoardDialog.test.tsx`
- Modify: `src/components/boards/BoardsNav.tsx`

**UI skills:** before writing the component, load the **pulse-ui** and **frontend-design** skills (mandatory for UI work) and follow Pulse's monochromatic + single-accent tokens.

- [ ] **Step 1: Write the failing component test**

```tsx
// src/components/boards/NewBoardDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const createBoardFromTemplate = vi.fn();
vi.mock("@/lib/boards/actions", () => ({
  createBoardFromTemplate: (...args: unknown[]) =>
    createBoardFromTemplate(...args),
}));

import { NewBoardDialog } from "@/components/boards/NewBoardDialog";

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  createBoardFromTemplate.mockReset();
  createBoardFromTemplate.mockResolvedValue({
    ok: true,
    data: { boardId: "b1" },
  });
});

describe("NewBoardDialog", () => {
  it("opens, shows a card per template, and creates from the chosen one", async () => {
    render(<NewBoardDialog workspaceId="ws1" />);
    fireEvent.click(screen.getByRole("button", { name: /new board/i }));

    // four template cards
    expect(screen.getByText("Blank board")).toBeInTheDocument();
    expect(screen.getByText("Sprint planning")).toBeInTheDocument();
    expect(screen.getByText("Content calendar")).toBeInTheDocument();
    expect(screen.getByText("Sales CRM")).toBeInTheDocument();

    // pick Sprint planning, then submit
    fireEvent.click(screen.getByText("Sprint planning"));
    fireEvent.click(screen.getByRole("button", { name: /create board/i }));

    await waitFor(() =>
      expect(createBoardFromTemplate).toHaveBeenCalledWith({
        workspaceId: "ws1",
        templateId: "sprints",
        name: "Sprint planning",
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/boards/b1"));
  });

  it("defaults to the Blank template", async () => {
    render(<NewBoardDialog workspaceId="ws1" />);
    fireEvent.click(screen.getByRole("button", { name: /new board/i }));
    fireEvent.click(screen.getByRole("button", { name: /create board/i }));
    await waitFor(() =>
      expect(createBoardFromTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ templateId: "blank" }),
      ),
    );
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm test src/components/boards/NewBoardDialog.test.tsx`
Expected: FAIL — cannot resolve `@/components/boards/NewBoardDialog`.

- [ ] **Step 3: Implement the dialog**

```tsx
// src/components/boards/NewBoardDialog.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, Rocket, Megaphone, BarChart3, Plus } from "lucide-react";
import { createBoardFromTemplate } from "@/lib/boards/actions";
import { BOARD_TEMPLATES } from "@/lib/boards/templates";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  board: LayoutGrid,
  rocket: Rocket,
  megaphone: Megaphone,
  dashboard: BarChart3,
};

export function NewBoardDialog({ workspaceId }: { workspaceId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState("blank");
  const [name, setName] = useState("Blank board");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function pick(id: string, defaultName: string) {
    setTemplateId(id);
    setName(defaultName);
  }

  function submit() {
    if (!workspaceId) return;
    setError(null);
    startTransition(async () => {
      const res = await createBoardFromTemplate({
        workspaceId,
        templateId,
        name,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.push(`/boards/${res.data.boardId}`);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="New board"
          className="size-6"
        >
          <Plus className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New board</DialogTitle>
          <DialogDescription>
            Pick a template to start from, then name your board.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          {BOARD_TEMPLATES.map((t) => {
            const Icon = ICONS[t.icon] ?? LayoutGrid;
            const selected = t.id === templateId;
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={selected}
                onClick={() => pick(t.id, t.name)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors",
                  selected
                    ? "border-primary bg-accent"
                    : "border-border hover:bg-accent/50",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="size-4" />
                  {t.name}
                </span>
                <span className="text-muted-foreground text-xs">
                  {t.description}
                </span>
              </button>
            );
          })}
        </div>

        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="board-name">Board name</Label>
            <Input
              id="board-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sprint backlog"
            />
          </div>
          {error ? (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? "Creating…" : "Create board"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run the component test, verify it passes**

Run: `pnpm test src/components/boards/NewBoardDialog.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire `NewBoardDialog` into `BoardsNav` and remove the old inline dialog**

In `src/components/boards/BoardsNav.tsx`:

1. Remove the now-unused imports/state: `createBoard`, `useState`/`useTransition` (if unused elsewhere in the file after this change — `useState` is only used for `open`/`name`/`error`, `useTransition` only for the submit), `Dialog*`, `Input`, `Label`, and the `submit()` function and its state (`open`, `name`, `error`, `isPending`, `workspaceId`). Keep `useRouter`/`useParams` (still used for active-board highlighting) and `Tooltip*`.
2. Add the import:

```tsx
import { NewBoardDialog } from "@/components/boards/NewBoardDialog";
```

3. Replace the entire `<Dialog open={open} …>…</Dialog>` block in the header row (lines ~86–134) with:

```tsx
<NewBoardDialog workspaceId={workspaces[0]?.id} />
```

- [ ] **Step 6: Typecheck + lint to confirm no dangling references**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS (no unused imports/vars in `BoardsNav.tsx`).

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/NewBoardDialog.tsx src/components/boards/NewBoardDialog.test.tsx src/components/boards/BoardsNav.tsx
git commit -m "feat(templates): board-template picker dialog in the sidebar"
```

---

## Task 7: e2e happy path

**Files:**

- Create: `e2e/board-templates.spec.ts`

Model the auth/setup on `e2e/boards.spec.ts` (service-role pre-confirmed user → UI login). After login, open the New-board dialog, pick "Sprint planning", create, and assert the seeded board renders.

- [ ] **Step 1: Write the e2e spec**

```ts
// e2e/board-templates.spec.ts
import * as dotenv from "dotenv";
import * as path from "node:path";

dotenv.config({
  path: path.resolve(process.cwd(), ".env.local"),
  override: true,
});

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasSecrets = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);
const PASSWORD = "Test-Password-123!";

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

test.describe("Board templates", () => {
  test.skip(!hasSecrets, "Supabase secrets not available — skipping");

  let createdUserId: string | null = null;
  let testEmail: string;

  test.beforeAll(async () => {
    testEmail = `${unique("e2e-tmpl")}@example.com`;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data } = await admin.auth.admin.createUser({
      email: testEmail,
      password: PASSWORD,
      email_confirm: true,
    });
    createdUserId = data.user!.id;
  });

  test.afterAll(async () => {
    if (!createdUserId) return;
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await admin.auth.admin.deleteUser(createdUserId);
  });

  test("create a Sprint planning board from a template", async ({ page }) => {
    // Log in through the UI.
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /sign in|log in/i }).click();

    // New users land in onboarding which creates a default org + workspace;
    // wait until the app shell with the Boards section is reachable.
    await page.waitForURL(/\/(onboarding|boards|$)/);

    // Open the New-board dialog from the sidebar.
    await page.getByRole("button", { name: /new board/i }).click();

    // Pick the Sprint planning template and create.
    await page.getByText("Sprint planning").click();
    await page.getByRole("button", { name: /create board/i }).click();

    // Land on the new board and see the seeded structure.
    await page.waitForURL(/\/boards\/[0-9a-f-]+/);
    await expect(page.getByText("Backlog")).toBeVisible();
    await expect(page.getByText("In Sprint")).toBeVisible();
    await expect(page.getByText("Build onboarding flow")).toBeVisible();
  });
});
```

> Note: if the onboarding flow requires manual org/workspace creation steps, the executing agent should follow `e2e/boards.spec.ts`'s exact post-login sequence to reach a workspace before opening the dialog. Adjust selectors to match the real login form labels.

- [ ] **Step 2: Run the e2e spec**

Run: `pnpm exec playwright test e2e/board-templates.spec.ts`
Expected: PASS when secrets present; skipped otherwise.

- [ ] **Step 3: Commit**

```bash
git add e2e/board-templates.spec.ts
git commit -m "test(templates): e2e create board from Sprint planning template"
```

---

## Task 8: Full gate + push

- [ ] **Step 1: Run the full verification gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS. Confirm the new unit + integration + component tests are included and green.

- [ ] **Step 2: Advisor parity check**

Confirm `create_board_from_template` pins `search_path = ''` (it does in the migration). If the Supabase advisors/MCP are available this session, run them and confirm no new function-search-path warning.

- [ ] **Step 3: Push to develop**

```bash
git push origin develop
```

- [ ] **Step 4: Wrap-up**

Run `/wrapup` to log a session note in `vault/sessions/` and bump `vault/00-north-star.md` (mark the templates slice of Phase 8 done; next = ⌘K polish).

---

## Self-review notes

- **Spec coverage:** §3 catalog → Task 1; §3 kind mapping → encoded in catalog (progress/timeline/link/priority mapped to numbers/date/text/status); §4 action → Task 3; §5 RPC → Task 4 (uuid-minting moved to the action — a faithful refinement, noted in Architecture); §6 picker → Task 6; §7 testing (catalog integrity, action unit, live RLS, component, e2e) → Tasks 1/3/5/6/7. Data-fetching budget (0 round-trips while picking; one mutation on create) is satisfied by the client-state picker + single RPC.
- **People cells** seed empty per spec — no people values appear in any template's `cells`, so no people-notification fan-out is triggered (that path lives only in `upsertCell`).
- **`create_board` untouched** — still used by existing tests and the columns integration test; the new path is additive.
- **Type consistency:** `buildTemplatePayload`'s `TemplatePayload` shape (`groups[].id/name/color/position`, `columns[].id/kind/name/settings/position`, `items[].id/groupId/name/position/cells[].columnId/value`) is exactly what the RPC's `jsonb_array_elements` reads (`->>'id'`, `->>'groupId'`, `->'settings'`, `->'value'`, etc.). Cell value shapes match `cellValueSchema` (status `{optionId}`, dropdown `{optionIds}`, date `{date,end?}`, numbers `{n}`, text `{text}`).

```

```
