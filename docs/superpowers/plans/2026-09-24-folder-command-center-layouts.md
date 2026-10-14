# Folder Command Center Layouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each folder's command center configurable — which sections appear, in what order and width, what the KPI row measures, and which tabs exist — editable by hand, with an untouched folder rendering exactly as it does today.

**Architecture:** A new `folder_layouts` table holds one jsonb config per folder; an absent row means the `project` preset, which is today's layout, so nothing is backfilled and no existing folder changes. A pure `resolveLayout` turns the row (or its absence) into a validated config. `buildFolderPayload` reads it in wave A and uses it to decide whether `folder_burn` runs at all. `TabStrip` and the Overview canvas render from the config instead of hard-coded arrays. Edit mode is client draft state; one Server Action persists it with a `version` guard.

**Tech Stack:** Next.js 16 App Router (RSC + Server Actions), Supabase (Postgres + RLS), Zod, TypeScript strict, Vitest + Testing Library, Tailwind v4, shadcn primitives.

**Spec:** `docs/superpowers/specs/2026-09-24-folder-command-center-layouts-design.md`

## Global Constraints

- Server Components by default; Server Actions for all mutations. Confirm any Next.js API against `node_modules/next/dist/docs/`.
- Validate at boundaries with Zod. TypeScript strict; no `any`.
- RLS is the security boundary: default-deny, org-scoped. `folder_layouts` policies mirror `public.folders` exactly.
- Schema changes are versioned migrations minted **only** with `scripts/new-migration.sh <slug>`, applied to DEV through the `supabase-dev` MCP with the **same version + name**, then verified with `pnpm db:ledger-check`.
- In a task worktree `pnpm db:types` fails (`LegacyProjectNotLinkedError`) — regenerate types with the `supabase-dev` MCP `generate_typescript_types` and run the output through prettier.
- Reuse canonical modules: `ActionResult` / `fail` from `src/lib/actions/result.ts`; `typedRpc` from `src/lib/supabase/typed-rpc.ts`. Grep before writing any helper.
- Zero new server round-trips for in-page interactions: tab, stage, board **and edit-mode draft edits** are client state mirrored with `window.history.replaceState`. Never `<Link>`/`router.push` for them.
- `pnpm test` runs the unit, conformance and fixtures projects. Integration suites (`*.integration.test.ts`) run only via `pnpm test:integration` and skip cleanly without a `.env.test`.
- All four gates must pass before the branch is finished: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- Commits are authored as `Danijel Jovanovic <info@synapse-solutions.ai>`; stage explicitly by path, never `git add -A`.
- Implementers must NOT run `scripts/finish-task.sh`, merge, or push. The orchestrator does that.

## Execution DAG

| Batch | Tasks          | Why they can run together                                                                                                                                                                                                |
| ----- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Task 1, Task 2 | Task 1 is SQL + generated types; Task 2 is pure TypeScript with no DB dependency. Different files.                                                                                                                       |
| 2     | Task 3, Task 4 | Task 3 needs Task 1 (types) + Task 2 (schema); Task 4 needs Task 2 only. Task 3 touches `src/lib/folders/*`, Task 4 touches `src/components/folders/{TabStrip,command-center-state}` + `src/lib/validations/folders.ts`. |
| 3     | Task 5         | Needs Task 3's `payload.layout` and Task 4's tab ids.                                                                                                                                                                    |
| 4     | Task 6         | Needs Task 1 (table), Task 4 and Task 5 (render path to edit).                                                                                                                                                           |

Critical path: Task 1/2 → Task 3 → Task 5 → Task 6.

---

### Task 1: `folder_layouts` table, RLS and types

**Files:**

- Create: `supabase/migrations/<minted-stamp>_folder_layouts.sql`
- Create: `src/lib/folders/folder-layouts.rls.integration.test.ts`
- Modify: `src/types/database.types.ts` (generated — do not hand-edit)

**Interfaces:**

- Consumes: nothing.
- Produces: table `public.folder_layouts (folder_id uuid pk, org_id uuid, preset text, config jsonb, version integer, updated_by uuid, created_at timestamptz, updated_at timestamptz)`; `Tables<"folder_layouts">` in the generated types.

- [ ] **Step 1: Mint the migration file**

```bash
scripts/new-migration.sh folder_layouts
```

Note the printed path; `<stamp>` below is its version. Never hand-write a stamp.

- [ ] **Step 2: Write the SQL**

Write this into the minted file:

```sql
-- Per-folder command center layout (spec 1 of 3).
-- An ABSENT row means the `project` preset, i.e. today's layout. There is no
-- backfill: every existing folder keeps rendering exactly as it does now.
create table public.folder_layouts (
  folder_id  uuid primary key references public.folders(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  preset     text not null default 'project'
               check (preset in ('project', 'crm', 'support', 'blank')),
  config     jsonb not null,
  version    integer not null default 1 check (version > 0),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Bounds the hot-path read. The Zod schema enforces the same ceiling; this
  -- is the backstop for anything that reaches the table another way.
  constraint folder_layouts_config_size check (pg_column_size(config) <= 32768)
);

create index folder_layouts_org_id_idx on public.folder_layouts (org_id);

create trigger folder_layouts_set_updated_at
  before update on public.folder_layouts
  for each row execute function public.set_updated_at();

alter table public.folder_layouts enable row level security;

-- Mirrors public.folders: org-visible, org members write, and the folder the
-- row points at must belong to the same org as the row claims.
create policy "folder_layouts: read if member" on public.folder_layouts
  for select to authenticated
  using (org_id in (select public.auth_user_orgs()));

create policy "folder_layouts: insert if member" on public.folder_layouts
  for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and exists (
      select 1 from public.folders f
      where f.id = folder_layouts.folder_id and f.org_id = folder_layouts.org_id
    )
  );

create policy "folder_layouts: update if member" on public.folder_layouts
  for update to authenticated
  using (public.is_org_member(org_id))
  with check (
    public.is_org_member(org_id)
    and exists (
      select 1 from public.folders f
      where f.id = folder_layouts.folder_id and f.org_id = folder_layouts.org_id
    )
  );

create policy "folder_layouts: delete if member" on public.folder_layouts
  for delete to authenticated
  using (public.is_org_member(org_id));

grant select, insert, update, delete on public.folder_layouts to authenticated;
```

- [ ] **Step 3: Apply to DEV with the same version and name**

Use the `supabase-dev` MCP `apply_migration` tool with `name` = the minted filename's `<stamp>_folder_layouts` and the SQL above verbatim. Then:

```bash
pnpm db:ledger-check
```

Expected: no drift reported in either direction.

- [ ] **Step 4: Regenerate types**

Call the `supabase-dev` MCP `generate_typescript_types`, write the result to `src/types/database.types.ts`, then:

```bash
npx prettier --write src/types/database.types.ts
pnpm typecheck
```

Expected: typecheck passes and `folder_layouts` appears in the generated `Tables`.

- [ ] **Step 5: Write the RLS integration test**

Create `src/lib/folders/folder-layouts.rls.integration.test.ts`, following the provisioning shape of `src/lib/folders/folders.rls.integration.test.ts` (copy its `provisionUser` / `beforeAll` / `afterAll` scaffolding verbatim — same admin client, same `signInWithRetry`, same cleanup):

```ts
describe.skipIf(!integrationTargetReady())("RLS: folder layouts", () => {
  // ...same provisioning as folders.rls.integration.test.ts:
  // org A with aFolderId, org B with bFolderId, users aAnon / bAnon.

  it("a member can insert and read their org's layout", async () => {
    const { error } = await aAnon.from("folder_layouts").insert({
      folder_id: aFolderId,
      org_id: aOrgId,
      preset: "crm",
      config: {
        v: 1,
        tabs: [
          { id: "overview", label: "Overview", kind: "canvas", sections: [] },
        ],
      },
    });
    expect(error).toBeNull();
    const { data } = await aAnon
      .from("folder_layouts")
      .select("folder_id, preset")
      .eq("folder_id", aFolderId);
    expect(data).toEqual([{ folder_id: aFolderId, preset: "crm" }]);
  });

  it("another org cannot read or write that layout", async () => {
    const { data } = await bAnon
      .from("folder_layouts")
      .select("folder_id")
      .eq("folder_id", aFolderId);
    expect(data).toEqual([]);

    const { error } = await bAnon
      .from("folder_layouts")
      .update({ preset: "blank" })
      .eq("folder_id", aFolderId);
    // Cross-tenant update is invisible, not an error: zero rows match.
    expect(error).toBeNull();
    const { data: after } = await aAnon
      .from("folder_layouts")
      .select("preset")
      .eq("folder_id", aFolderId);
    expect(after?.[0]?.preset).toBe("crm");
  });

  it("a member cannot claim a folder that belongs to another org", async () => {
    const { error } = await aAnon.from("folder_layouts").insert({
      folder_id: bFolderId,
      org_id: aOrgId,
      config: { v: 1, tabs: [] },
    });
    expect(error).not.toBeNull();
  });

  it("deleting the folder cascades the layout away", async () => {
    await aAnon.from("folders").delete().eq("id", aFolderId);
    const { data } = await admin
      .from("folder_layouts")
      .select("folder_id")
      .eq("folder_id", aFolderId);
    expect(data).toEqual([]);
  });
});
```

- [ ] **Step 6: Run the integration suite and the conformance suite**

```bash
pnpm test:integration -- folder-layouts
pnpm test:conformance
```

Expected: the integration file skips cleanly without a `.env.test` (that is a pass, not a failure — say so in the report); with one present, all four cases pass. Conformance must pass: `anon-reachability.conformance.test.ts` probes tables dynamically, so an anon-reachable `folder_layouts` would fail it.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations src/types/database.types.ts src/lib/folders/folder-layouts.rls.integration.test.ts
git commit -m "feat(folders): folder_layouts table with org-scoped RLS"
```

---

### Task 2: Config schema, presets and `resolveLayout`

**Files:**

- Create: `src/lib/validations/folder-layout.ts`
- Create: `src/lib/validations/folder-layout.test.ts`
- Create: `src/lib/folders/presets.ts`
- Create: `src/lib/folders/layout.ts`
- Create: `src/lib/folders/layout.test.ts`

**Interfaces:**

- Consumes: nothing (pure TypeScript; no import of `server-only`, so client components can use it).
- Produces:
  - `KPI_KEYS`, `kpiKeySchema`, `type KpiKey`
  - `BUILTIN_PANELS`, `builtinPanelSchema`, `type BuiltinPanel`
  - `gridRectSchema`, `type GridRect = { x: number; y: number; w: number; h: number }`
  - `sectionSchema`, `type LayoutSection`
  - `tabSchema`, `type LayoutTab`
  - `folderLayoutConfigSchema`, `type FolderLayoutConfig`
  - `saveFolderLayoutSchema`
  - `PRESET_KEYS`, `type PresetKey`, `PRESETS: Record<PresetKey, FolderLayoutConfig>`, `DEFAULT_SECTION: Record<BuiltinPanel, LayoutSection>`
  - `type FolderLayoutRow = { preset: string; config: unknown; version: number }`
  - `type ResolvedLayout = { config: FolderLayoutConfig; preset: PresetKey; version: number }`
  - `resolveLayout(row: FolderLayoutRow | null): ResolvedLayout`
  - `layoutNeedsBurn(config: FolderLayoutConfig): boolean`
  - `canvasSections(config: FolderLayoutConfig, tabId: string): LayoutSection[]`

- [ ] **Step 1: Write the failing schema test**

Create `src/lib/validations/folder-layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { folderLayoutConfigSchema } from "./folder-layout";

const canvasTab = (sections: unknown[]) => ({
  id: "overview",
  label: "Overview",
  kind: "canvas",
  sections,
});
const kpis = {
  id: "kpis",
  type: "builtin",
  panel: "kpis",
  props: { cards: ["complete", "overdue"] },
  layout: { x: 0, y: 0, w: 12, h: 2 },
};

describe("folderLayoutConfigSchema", () => {
  it("accepts a minimal one-tab config", () => {
    const parsed = folderLayoutConfigSchema.safeParse({
      v: 1,
      tabs: [canvasTab([kpis])],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects duplicate tab ids", () => {
    const parsed = folderLayoutConfigSchema.safeParse({
      v: 1,
      tabs: [canvasTab([]), canvasTab([])],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects two tabs of the same singleton built-in kind", () => {
    const parsed = folderLayoutConfigSchema.safeParse({
      v: 1,
      tabs: [
        { id: "a", label: "Stages", kind: "stages" },
        { id: "b", label: "Phases", kind: "stages" },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects duplicate section ids inside one tab", () => {
    const parsed = folderLayoutConfigSchema.safeParse({
      v: 1,
      tabs: [canvasTab([kpis, { ...kpis }])],
    });
    expect(parsed.success).toBe(false);
  });

  it("requires cards on a kpis section and forbids props elsewhere", () => {
    expect(
      folderLayoutConfigSchema.safeParse({
        v: 1,
        tabs: [canvasTab([{ ...kpis, props: undefined }])],
      }).success,
    ).toBe(false);
    expect(
      folderLayoutConfigSchema.safeParse({
        v: 1,
        tabs: [
          canvasTab([
            {
              id: "burn",
              type: "builtin",
              panel: "burn",
              props: { cards: ["complete"] },
              layout: { x: 0, y: 0, w: 8, h: 4 },
            },
          ]),
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects sections on a non-canvas tab", () => {
    const parsed = folderLayoutConfigSchema.safeParse({
      v: 1,
      tabs: [
        { id: "stages", label: "Stages", kind: "stages", sections: [kpis] },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("enforces the bounds: 6 tabs, 24 sections, 6 KPI cards, 24-char label", () => {
    const many = (n: number, f: (i: number) => unknown) =>
      Array.from({ length: n }, (_, i) => f(i));
    expect(
      folderLayoutConfigSchema.safeParse({
        v: 1,
        tabs: many(7, (i) => ({
          id: `t${i}`,
          label: `T${i}`,
          kind: "canvas",
          sections: [],
        })),
      }).success,
    ).toBe(false);
    expect(
      folderLayoutConfigSchema.safeParse({
        v: 1,
        tabs: [canvasTab(many(25, (i) => ({ ...kpis, id: `s${i}` })))],
      }).success,
    ).toBe(false);
    expect(
      folderLayoutConfigSchema.safeParse({
        v: 1,
        tabs: [
          canvasTab([
            {
              ...kpis,
              props: {
                cards: [
                  "complete",
                  "gap",
                  "overdue",
                  "dueThisWeek",
                  "blocked",
                  "stale",
                  "complete",
                ],
              },
            },
          ]),
        ],
      }).success,
    ).toBe(false);
    expect(
      folderLayoutConfigSchema.safeParse({
        v: 1,
        tabs: [
          {
            id: "overview",
            label: "x".repeat(25),
            kind: "canvas",
            sections: [],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts a widget section so spec 2 needs no config migration", () => {
    const parsed = folderLayoutConfigSchema.safeParse({
      v: 1,
      tabs: [
        canvasTab([
          {
            id: "w1",
            type: "widget",
            widgetId: "8f1d6b3e-3f4a-4a9e-9a7c-1c2d3e4f5a6b",
            layout: { x: 0, y: 0, w: 4, h: 4 },
          },
        ]),
      ],
    });
    expect(parsed.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm test:unit -- folder-layout
```

Expected: FAIL — `Cannot find module './folder-layout'`.

- [ ] **Step 3: Write the schema**

Create `src/lib/validations/folder-layout.ts`:

```ts
import { z } from "zod";

/** KPI cards the built-in `kpis` section can show. Spec 1 keeps the existing
 *  closed set; column-derived metrics arrive in spec 2 as widget sections. */
export const KPI_KEYS = [
  "complete",
  "gap",
  "overdue",
  "dueThisWeek",
  "blocked",
  "stale",
] as const;
export const kpiKeySchema = z.enum(KPI_KEYS);
export type KpiKey = z.infer<typeof kpiKeySchema>;

export const BUILTIN_PANELS = [
  "kpis",
  "burn",
  "boardStatus",
  "attention",
  "intelligence",
  "milestones",
] as const;
export const builtinPanelSchema = z.enum(BUILTIN_PANELS);
export type BuiltinPanel = z.infer<typeof builtinPanelSchema>;

export const TAB_KINDS = ["canvas", "stages", "boards", "people"] as const;
export const tabKindSchema = z.enum(TAB_KINDS);
export type TabKind = z.infer<typeof tabKindSchema>;

/** Singleton tabs: hideable, never duplicated. */
const SINGLETON_KINDS = ["stages", "boards", "people"] as const;

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);
const label = z.string().trim().min(1).max(24);

/** 12-column rect, same math as `GridRect` in `src/lib/dashboards/cache.ts`.
 *  Spec 1 renders from `x`/`w` (CSS Grid column placement) and stores `y`/`h`
 *  untouched so spec 2's widget canvas inherits a complete rect. */
export const gridRectSchema = z.object({
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(200),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(20),
});
export type GridRect = z.infer<typeof gridRectSchema>;

const builtinSectionSchema = z.object({
  id: slug,
  type: z.literal("builtin"),
  panel: builtinPanelSchema,
  title: label.optional(),
  props: z.object({ cards: z.array(kpiKeySchema).min(1).max(6) }).optional(),
  layout: gridRectSchema,
});

const widgetSectionSchema = z.object({
  id: slug,
  type: z.literal("widget"),
  widgetId: z.string().uuid(),
  layout: gridRectSchema,
});

export const sectionSchema = z.discriminatedUnion("type", [
  builtinSectionSchema,
  widgetSectionSchema,
]);
export type LayoutSection = z.infer<typeof sectionSchema>;

export const tabSchema = z.object({
  id: slug,
  label,
  kind: tabKindSchema,
  sections: z.array(sectionSchema).max(24).optional(),
});
export type LayoutTab = z.infer<typeof tabSchema>;

export const folderLayoutConfigSchema = z
  .object({ v: z.literal(1), tabs: z.array(tabSchema).min(1).max(6) })
  .superRefine((cfg, ctx) => {
    const ids = new Set<string>();
    const kinds = new Set<string>();
    for (const tab of cfg.tabs) {
      if (ids.has(tab.id))
        ctx.addIssue({
          code: "custom",
          message: `Duplicate tab id: ${tab.id}`,
        });
      ids.add(tab.id);
      if ((SINGLETON_KINDS as readonly string[]).includes(tab.kind)) {
        if (kinds.has(tab.kind))
          ctx.addIssue({
            code: "custom",
            message: `Duplicate ${tab.kind} tab`,
          });
        kinds.add(tab.kind);
      }
      if (tab.kind !== "canvas" && tab.sections && tab.sections.length > 0)
        ctx.addIssue({
          code: "custom",
          message: "Only canvas tabs hold sections",
        });
      const sectionIds = new Set<string>();
      for (const s of tab.sections ?? []) {
        if (sectionIds.has(s.id))
          ctx.addIssue({
            code: "custom",
            message: `Duplicate section id: ${s.id}`,
          });
        sectionIds.add(s.id);
        if (s.type !== "builtin") continue;
        if (s.panel === "kpis" && !s.props)
          ctx.addIssue({
            code: "custom",
            message: "kpis section needs props.cards",
          });
        if (s.panel !== "kpis" && s.props)
          ctx.addIssue({
            code: "custom",
            message: `${s.panel} section takes no props`,
          });
      }
    }
  });
export type FolderLayoutConfig = z.infer<typeof folderLayoutConfigSchema>;

/** Input to the one mutation. `version` is the optimistic-concurrency token the
 *  client read with the payload; 0 means "no row yet, insert". */
export const saveFolderLayoutSchema = z.object({
  folderId: z.string().uuid(),
  version: z.number().int().min(0),
  preset: z.enum(["project", "crm", "support", "blank"]),
  config: folderLayoutConfigSchema,
});
```

- [ ] **Step 4: Run the schema test**

```bash
pnpm test:unit -- folder-layout
```

Expected: PASS, all eight cases.

- [ ] **Step 5: Write the failing presets/resolve test**

Create `src/lib/folders/layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { folderLayoutConfigSchema } from "@/lib/validations/folder-layout";
import { PRESETS, PRESET_KEYS } from "./presets";
import { canvasSections, layoutNeedsBurn, resolveLayout } from "./layout";

describe("presets", () => {
  it("every preset is a valid config", () => {
    for (const key of PRESET_KEYS)
      expect(folderLayoutConfigSchema.safeParse(PRESETS[key]).success).toBe(
        true,
      );
  });

  it("the project preset is today's layout: six KPIs and all six panels", () => {
    const sections = canvasSections(PRESETS.project, "overview");
    expect(
      sections.map((s) => (s.type === "builtin" ? s.panel : "widget")),
    ).toEqual([
      "kpis",
      "burn",
      "boardStatus",
      "attention",
      "intelligence",
      "milestones",
    ]);
    const kpis = sections[0];
    expect(kpis.type === "builtin" && kpis.props?.cards).toEqual([
      "complete",
      "gap",
      "overdue",
      "dueThisWeek",
      "blocked",
      "stale",
    ]);
    expect(PRESETS.project.tabs.map((t) => t.id)).toEqual([
      "overview",
      "stages",
      "boards",
      "people",
    ]);
  });

  it("the crm preset drops burn and milestones and renames the stages tab", () => {
    const panels = canvasSections(PRESETS.crm, "overview").map((s) =>
      s.type === "builtin" ? s.panel : "widget",
    );
    expect(panels).not.toContain("burn");
    expect(panels).not.toContain("milestones");
    expect(PRESETS.crm.tabs.find((t) => t.kind === "stages")?.label).toBe(
      "Pipeline",
    );
  });
});

describe("resolveLayout", () => {
  it("falls back to the project preset when there is no row", () => {
    const resolved = resolveLayout(null);
    expect(resolved.config).toEqual(PRESETS.project);
    expect(resolved.preset).toBe("project");
    expect(resolved.version).toBe(0);
  });

  it("falls back to the row's own preset when the config is invalid", () => {
    const resolved = resolveLayout({
      preset: "crm",
      config: { v: 1, tabs: "nope" },
      version: 4,
    });
    expect(resolved.config).toEqual(PRESETS.crm);
    expect(resolved.version).toBe(4);
  });

  it("falls back to project when the preset column is also unknown", () => {
    const resolved = resolveLayout({ preset: "wat", config: null, version: 2 });
    expect(resolved.config).toEqual(PRESETS.project);
    expect(resolved.preset).toBe("project");
  });

  it("returns the stored config when it is valid", () => {
    const config = {
      v: 1,
      tabs: [{ id: "overview", label: "Deals", kind: "canvas", sections: [] }],
    };
    const resolved = resolveLayout({ preset: "blank", config, version: 7 });
    expect(resolved.config.tabs[0].label).toBe("Deals");
    expect(resolved.version).toBe(7);
  });
});

describe("layoutNeedsBurn", () => {
  const cfg = (tabs: unknown[]) =>
    folderLayoutConfigSchema.parse({ v: 1, tabs });
  const burnSection = {
    id: "burn",
    type: "builtin",
    panel: "burn",
    layout: { x: 0, y: 0, w: 8, h: 4 },
  };

  it("is true when a burn section is present", () => {
    expect(
      layoutNeedsBurn(
        cfg([{ id: "o", label: "O", kind: "canvas", sections: [burnSection] }]),
      ),
    ).toBe(true);
  });

  it("is true when a stages tab is present even with no burn section", () => {
    expect(
      layoutNeedsBurn(
        cfg([
          { id: "o", label: "O", kind: "canvas", sections: [] },
          { id: "stages", label: "Pipeline", kind: "stages" },
        ]),
      ),
    ).toBe(true);
  });

  it("is false only when neither is present", () => {
    expect(
      layoutNeedsBurn(
        cfg([{ id: "o", label: "O", kind: "canvas", sections: [] }]),
      ),
    ).toBe(false);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

```bash
pnpm test:unit -- folders/layout
```

Expected: FAIL — `Cannot find module './presets'`.

- [ ] **Step 7: Write the presets**

Create `src/lib/folders/presets.ts`:

```ts
import type {
  BuiltinPanel,
  FolderLayoutConfig,
  LayoutSection,
} from "@/lib/validations/folder-layout";

export const PRESET_KEYS = ["project", "crm", "support", "blank"] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

const section = (
  panel: BuiltinPanel,
  layout: { x: number; y: number; w: number; h: number },
  props?: LayoutSection extends { props?: infer P } ? P : never,
): LayoutSection => ({
  id: panel.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
  type: "builtin",
  panel,
  ...(props ? { props } : {}),
  layout,
});

/** Default rect + props for a panel the user adds back from the Sections sheet.
 *  `y` is rewritten on save by the draft reducer; `x`/`w` are the real content. */
export const DEFAULT_SECTION: Record<BuiltinPanel, LayoutSection> = {
  kpis: section(
    "kpis",
    { x: 0, y: 0, w: 12, h: 2 },
    {
      cards: ["complete", "gap", "overdue", "dueThisWeek", "blocked", "stale"],
    },
  ),
  burn: section("burn", { x: 0, y: 2, w: 8, h: 4 }),
  boardStatus: section("boardStatus", { x: 8, y: 2, w: 4, h: 4 }),
  attention: section("attention", { x: 0, y: 6, w: 8, h: 5 }),
  intelligence: section("intelligence", { x: 8, y: 6, w: 4, h: 3 }),
  milestones: section("milestones", { x: 8, y: 9, w: 4, h: 2 }),
};

const pick = (...panels: BuiltinPanel[]): LayoutSection[] =>
  panels.map((p) => DEFAULT_SECTION[p]);

const STAGES_TAB = { id: "stages", label: "Stages", kind: "stages" } as const;
const BOARDS_TAB = { id: "boards", label: "Boards", kind: "boards" } as const;
const PEOPLE_TAB = { id: "people", label: "People", kind: "people" } as const;

/**
 * `project` is today's layout, exactly: the six KPI cards in their current
 * order, burn + status-by-board on one row, attention with intelligence and
 * milestones stacked in the right column, and the four current tabs.
 */
export const PRESETS: Record<PresetKey, FolderLayoutConfig> = {
  project: {
    v: 1,
    tabs: [
      {
        id: "overview",
        label: "Overview",
        kind: "canvas",
        sections: pick(
          "kpis",
          "burn",
          "boardStatus",
          "attention",
          "intelligence",
          "milestones",
        ),
      },
      STAGES_TAB,
      BOARDS_TAB,
      PEOPLE_TAB,
    ],
  },
  crm: {
    v: 1,
    tabs: [
      {
        id: "overview",
        label: "Overview",
        kind: "canvas",
        sections: [
          {
            ...DEFAULT_SECTION.kpis,
            props: { cards: ["complete", "overdue", "dueThisWeek"] },
          },
          { ...DEFAULT_SECTION.attention, layout: { x: 0, y: 2, w: 8, h: 5 } },
          {
            ...DEFAULT_SECTION.boardStatus,
            layout: { x: 8, y: 2, w: 4, h: 4 },
          },
          {
            ...DEFAULT_SECTION.intelligence,
            layout: { x: 8, y: 7, w: 4, h: 3 },
          },
        ],
      },
      { ...STAGES_TAB, label: "Pipeline" },
      BOARDS_TAB,
    ],
  },
  support: {
    v: 1,
    tabs: [
      {
        id: "overview",
        label: "Overview",
        kind: "canvas",
        sections: [
          {
            ...DEFAULT_SECTION.kpis,
            props: { cards: ["overdue", "dueThisWeek", "blocked", "stale"] },
          },
          { ...DEFAULT_SECTION.attention, layout: { x: 0, y: 2, w: 8, h: 5 } },
          {
            ...DEFAULT_SECTION.boardStatus,
            layout: { x: 8, y: 2, w: 4, h: 4 },
          },
        ],
      },
      BOARDS_TAB,
      PEOPLE_TAB,
    ],
  },
  blank: {
    v: 1,
    tabs: [
      { id: "overview", label: "Overview", kind: "canvas", sections: [] },
      BOARDS_TAB,
    ],
  },
};
```

If the `section()` helper's `props` typing fights TypeScript strict, inline the
objects instead — the presets are data, and a literal is clearer than a clever
constructor. Do not introduce `any`.

- [ ] **Step 8: Write `resolveLayout`**

Create `src/lib/folders/layout.ts`:

```ts
import {
  folderLayoutConfigSchema,
  type FolderLayoutConfig,
  type LayoutSection,
} from "@/lib/validations/folder-layout";
import { PRESETS, PRESET_KEYS, type PresetKey } from "./presets";

export type FolderLayoutRow = {
  preset: string;
  config: unknown;
  version: number;
};

export type ResolvedLayout = {
  config: FolderLayoutConfig;
  preset: PresetKey;
  version: number;
};

const isPresetKey = (v: string): v is PresetKey =>
  (PRESET_KEYS as readonly string[]).includes(v);

/**
 * Row (or its absence) to a config that always renders.
 *
 * A malformed config must NEVER fail the folder page — same degradation
 * posture the folder RPC panels use for a failed read. An unparseable config
 * falls back to the row's own preset, and an unknown preset to `project`,
 * which is today's layout. `version: 0` means "no row yet": the save action
 * inserts rather than updates.
 */
export function resolveLayout(row: FolderLayoutRow | null): ResolvedLayout {
  if (!row) return { config: PRESETS.project, preset: "project", version: 0 };
  const preset = isPresetKey(row.preset) ? row.preset : "project";
  const parsed = folderLayoutConfigSchema.safeParse(row.config);
  return {
    config: parsed.success ? parsed.data : PRESETS[preset],
    preset,
    version: row.version,
  };
}

/** Sections of one canvas tab, in render order. Empty for a non-canvas tab. */
export function canvasSections(
  config: FolderLayoutConfig,
  tabId: string,
): LayoutSection[] {
  const tab = config.tabs.find((t) => t.id === tabId);
  return tab?.kind === "canvas" ? (tab.sections ?? []) : [];
}

/**
 * Whether `folder_burn` must run. TWO consumers, not one: the Overview's burn
 * section AND the Stages tab's own chart (`tabs/Stages.tsx`). Gating on the
 * section alone would leave a folder that kept its stages tab rendering a
 * permanently failed chart.
 */
export function layoutNeedsBurn(config: FolderLayoutConfig): boolean {
  return config.tabs.some(
    (t) =>
      t.kind === "stages" ||
      (t.sections ?? []).some(
        (s) => s.type === "builtin" && s.panel === "burn",
      ),
  );
}
```

- [ ] **Step 9: Run both test files**

```bash
pnpm test:unit -- folder-layout folders/layout
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/validations/folder-layout.ts src/lib/validations/folder-layout.test.ts src/lib/folders/presets.ts src/lib/folders/layout.ts src/lib/folders/layout.test.ts
git commit -m "feat(folders): layout config schema, presets and resolveLayout"
```

---

### Task 3: Payload wiring and the burn gate

**Files:**

- Modify: `src/lib/folders/queries.ts` (add `getFolderLayoutRow`)
- Modify: `src/lib/folders/payload.ts`
- Modify: `src/lib/folders/types.ts` (`FolderPayload.layout`)
- Modify: `src/lib/folders/fixture.ts`
- Modify: `src/lib/folders/payload.test.ts`
- Modify: `src/lib/folders/queries.test.ts`

**Interfaces:**

- Consumes: `resolveLayout`, `layoutNeedsBurn`, `ResolvedLayout`, `FolderLayoutRow` (Task 2); `Tables<"folder_layouts">` (Task 1).
- Produces: `FolderPayload.layout: ResolvedLayout`; `getFolderLayoutRow(supabase, folderId): Promise<FolderLayoutRow | null>`.

- [ ] **Step 1: Write the failing payload tests**

Append to `src/lib/folders/payload.test.ts` (keep the existing `order`-log mocks; add `getFolderLayoutRow` to the `./queries` mock and a `./layout` passthrough). New cases:

```ts
it("reads the layout in wave A, alongside head/rollup/attention", async () => {
  await buildFolderPayload(client, "f1", "u1");
  // Every wave-A read starts before any of them ends.
  const firstEnd = order.findIndex((e) => e.startsWith("end:"));
  expect(order.slice(0, firstEnd)).toContain("start:layout");
});

it("skips folder_burn when the layout needs neither a burn section nor a stages tab", async () => {
  vi.mocked(getFolderLayoutRow).mockResolvedValueOnce({
    preset: "blank",
    config: {
      v: 1,
      tabs: [
        { id: "overview", label: "Overview", kind: "canvas", sections: [] },
      ],
    },
    version: 3,
  });
  const payload = await buildFolderPayload(client, "f1", "u1");
  expect(resolveFolderBurn).not.toHaveBeenCalled();
  expect(payload?.burn).toBeNull();
});

it("still runs folder_burn when the layout has a stages tab but no burn section", async () => {
  vi.mocked(getFolderLayoutRow).mockResolvedValueOnce({
    preset: "crm",
    config: {
      v: 1,
      tabs: [
        { id: "overview", label: "Overview", kind: "canvas", sections: [] },
        { id: "stages", label: "Pipeline", kind: "stages" },
      ],
    },
    version: 3,
  });
  await buildFolderPayload(client, "f1", "u1");
  expect(resolveFolderBurn).toHaveBeenCalledTimes(1);
});

it("returns the project preset when the folder has no layout row", async () => {
  vi.mocked(getFolderLayoutRow).mockResolvedValueOnce(null);
  const payload = await buildFolderPayload(client, "f1", "u1");
  expect(payload?.layout.preset).toBe("project");
  expect(payload?.layout.version).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm test:unit -- folders/payload
```

Expected: FAIL — `getFolderLayoutRow` is not exported.

- [ ] **Step 3: Add the read**

In `src/lib/folders/queries.ts`, below `getFolderHead`:

```ts
/**
 * The folder's layout row. A primary-key lookup on `folder_layouts`; `null`
 * means "never customized", which `resolveLayout` turns into the project
 * preset — today's layout. A read error is treated the same as absence and
 * logged, because a layout must never be the reason a folder page fails.
 */
export async function getFolderLayoutRow(
  supabase: DB,
  folderId: string,
): Promise<FolderLayoutRow | null> {
  const { data, error } = await supabase
    .from("folder_layouts")
    .select("preset, config, version")
    .eq("folder_id", folderId)
    .maybeSingle();
  if (error) {
    console.error("folder_layouts read failed", error.message);
    return null;
  }
  return data
    ? { preset: data.preset, config: data.config, version: data.version }
    : null;
}
```

Import `FolderLayoutRow` from `./layout`.

- [ ] **Step 4: Wire the payload**

In `src/lib/folders/payload.ts`, move `resolveFolderBurn` into wave B behind the gate:

```ts
const [head, layoutRow, rollup, attention] = await Promise.all([
  getFolderHead(supabase, folderId),
  getFolderLayoutRow(supabase, folderId),
  resolveFolderRollup(supabase, folderId),
  resolveFolderAttention(supabase, folderId, ATTENTION_LIMIT),
]);
if (!head) return null;
const layout = resolveLayout(layoutRow);
// Wave B. `folder_burn` joins the briefs/members wave instead of wave A: it is
// needed only when the layout has a burn section or a stages tab, and the
// briefs read already waited on `head`, so a project folder pays nothing.
const [briefs, members, burn] = await Promise.all([
  listLatestBriefs(supabase, head.boards, userId),
  listOrgMembersCached(head.folder.orgId),
  layoutNeedsBurn(layout.config)
    ? resolveFolderBurn(supabase, folderId)
    : Promise.resolve(null),
]);
```

and in the returned object: `burn: burn && burn.ok ? burn.rows : null,` plus `layout,`.

In `src/lib/folders/types.ts` add to `FolderPayload`:

```ts
/** Resolved per-folder command center layout. Absent row = project preset. */
layout: ResolvedLayout;
```

importing `ResolvedLayout` from `./layout`.

- [ ] **Step 5: Update the fixture**

In `src/lib/folders/fixture.ts`, add `layout: resolveLayout(null)` to the returned `folderFixture()` payload, and export a helper the component tests need:

```ts
/** A fixture payload whose layout is a named preset — for tests that assert a
 *  CRM folder hides burn and milestones. */
export function folderFixtureWithPreset(preset: PresetKey): FolderPayload {
  return {
    ...folderFixture(),
    layout: { config: PRESETS[preset], preset, version: 1 },
  };
}
```

- [ ] **Step 6: Run the suite**

```bash
pnpm test:unit -- folders
pnpm typecheck
```

Expected: PASS. Every existing folder test still passes untouched except the fixture addition — if one needs editing, stop and report it: a default folder's data changed, which is a bug in this task.

- [ ] **Step 7: Commit**

```bash
git add src/lib/folders/queries.ts src/lib/folders/payload.ts src/lib/folders/types.ts src/lib/folders/fixture.ts src/lib/folders/payload.test.ts src/lib/folders/queries.test.ts
git commit -m "feat(folders): read the layout in wave A and gate folder_burn on it"
```

---

### Task 4: Config-driven tabs

**Files:**

- Modify: `src/components/folders/TabStrip.tsx`
- Modify: `src/components/folders/command-center-state.ts`
- Modify: `src/lib/validations/folders.ts`
- Modify: `src/components/folders/command-center-state.test.tsx`
- Create: `src/components/folders/TabStrip.test.tsx`

**Interfaces:**

- Consumes: `LayoutTab`, `TabKind`, `FolderLayoutConfig` (Task 2).
- Produces:
  - `useCommandCenterState(tabIds: string[])` returning `{ tab: string; stage; board; setTab(id: string); setStage; setBoard }` — `tab` is always one of `tabIds`, falling back to `tabIds[0]`.
  - `TabStrip` props `{ tabs: LayoutTab[]; tab: string; counts: TabCounts; disabled?: boolean; onChange(id: string): void }` with `type TabCounts = { stages: number; boards: number; people: number | null; overloaded: number }` (unchanged shape).

- [ ] **Step 1: Write the failing state test**

Add to `src/components/folders/command-center-state.test.tsx`:

```ts
it("falls back to the first configured tab when ?tab= names an unknown id", () => {
  params.current = new URLSearchParams("tab=nope");
  const { result } = renderHook(() =>
    useCommandCenterState(["overview", "pipeline"]),
  );
  expect(result.current.tab).toBe("overview");
});

it("accepts any configured tab id, not just the legacy four", () => {
  params.current = new URLSearchParams("tab=pipeline");
  const { result } = renderHook(() =>
    useCommandCenterState(["overview", "pipeline"]),
  );
  expect(result.current.tab).toBe("pipeline");
});

it("writes the tab id with replaceState and never navigates", () => {
  const { result } = renderHook(() =>
    useCommandCenterState(["overview", "pipeline"]),
  );
  act(() => result.current.setTab("pipeline"));
  expect(window.location.search).toBe("?tab=pipeline");
  expect(routerPush).not.toHaveBeenCalled();
});

it("drops the param entirely for the first tab, keeping bare links clean", () => {
  const { result } = renderHook(() =>
    useCommandCenterState(["overview", "pipeline"]),
  );
  act(() => result.current.setTab("pipeline"));
  act(() => result.current.setTab("overview"));
  expect(window.location.search).toBe("");
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm test:unit -- command-center-state
```

Expected: FAIL — `useCommandCenterState` takes no argument yet.

- [ ] **Step 3: Rewrite the tab half of the hook**

In `src/components/folders/command-center-state.ts`, replace `parseTab` and the `tab`/`setTab` logic (leave `stage`/`board` untouched):

```ts
/**
 * `?tab=` now carries a TAB ID from the folder's layout config, not a fixed
 * enum — a CRM folder's "pipeline" is as valid as "overview". Unknown ids fall
 * back to the first configured tab, so a deep link to a tab someone removed
 * still renders. Preset tab ids are exactly the legacy slugs, so existing
 * links keep working.
 */
export function parseTab(v: string | null, tabIds: string[]): string {
  return v !== null && tabIds.includes(v) ? v : (tabIds[0] ?? "overview");
}

export function useCommandCenterState(tabIds: string[]) {
  const params = useSearchParams();
  const tab = parseTab(params.get("tab"), tabIds);
  // ...stage/board unchanged...
  const first = tabIds[0];
  const setTab = useCallback(
    (t: string) => {
      write((url) => {
        if (t === first) url.searchParams.delete("tab");
        else url.searchParams.set("tab", t);
      });
    },
    [first],
  );
```

In `src/lib/validations/folders.ts`, replace `commandTabSchema` with a slug schema used by the tab-scoped actions, keeping the legacy values valid:

```ts
/** A tab id from a folder's layout config. The four preset ids (overview,
 *  stages, boards, people) are the legacy enum values, so old deep links and
 *  any server-side use keep parsing. */
export const commandTabSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);
```

Then fix every consumer the compiler flags (`HeaderActions` takes `tab: string`; its Export-PDF guard becomes "the active tab is a canvas tab", passed in as a boolean prop `canExport`).

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm test:unit -- command-center-state
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Write the failing TabStrip test**

Create `src/components/folders/TabStrip.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PRESETS } from "@/lib/folders/presets";
import { TabStrip } from "./TabStrip";

const counts = { stages: 3, boards: 2, people: 4, overloaded: 0 };

describe("TabStrip", () => {
  it("renders one tab per configured tab, in config order, with its label", () => {
    render(
      <TabStrip
        tabs={PRESETS.crm.tabs}
        tab="overview"
        counts={counts}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getAllByRole("tab").map((t) => t.textContent?.trim()),
    ).toEqual([
      "Overview",
      expect.stringContaining("Pipeline"),
      expect.stringContaining("Boards"),
    ]);
    expect(
      screen.queryByRole("tab", { name: /People/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps counts keyed by tab KIND, not by id", () => {
    render(
      <TabStrip
        tabs={PRESETS.crm.tabs}
        tab="overview"
        counts={counts}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("tab", { name: /Pipeline/ }).textContent).toContain(
      "3",
    );
  });

  it("reports the clicked tab's id", () => {
    const onChange = vi.fn();
    render(
      <TabStrip
        tabs={PRESETS.crm.tabs}
        tab="overview"
        counts={counts}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Pipeline/ }));
    expect(onChange).toHaveBeenCalledWith("stages");
  });
});
```

- [ ] **Step 6: Run to verify it fails, then make TabStrip config-driven**

```bash
pnpm test:unit -- TabStrip
```

Expected: FAIL — `tabs` is not a prop.

Replace the module-level `TABS` array with the `tabs` prop and key `countFor` off `tab.kind` instead of `tab.id`:

```tsx
export function TabStrip({
  tabs,
  tab,
  counts,
  disabled = false,
  onChange,
}: {
  tabs: LayoutTab[];
  tab: string;
  counts: TabCounts;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  const countFor = (kind: TabKind): { n: number | null; red: boolean } => {
    if (kind === "stages") return { n: counts.stages, red: false };
    if (kind === "boards") return { n: counts.boards, red: false };
    if (kind === "people")
      return {
        n: counts.overloaded > 0 ? counts.overloaded : counts.people,
        red: counts.overloaded > 0,
      };
    return { n: null, red: false };
  };
  // ...map over `tabs`; keep the existing roving-tablist markup, the
  // `pointer-coarse:min-h-11` target and the `disabled && tab.kind !== "canvas"`
  // rule (an empty folder still lets you sit on a canvas tab).
}
```

- [ ] **Step 7: Run the folder component suite**

```bash
pnpm test:unit -- folders
```

Expected: PASS. `CommandCenter.test.tsx` asserts `getByRole("tab", { name: /Overview/ }).className` — that must still hold, since the preset's first tab is labelled "Overview".

- [ ] **Step 8: Commit**

```bash
git add src/components/folders/TabStrip.tsx src/components/folders/TabStrip.test.tsx src/components/folders/command-center-state.ts src/components/folders/command-center-state.test.tsx src/lib/validations/folders.ts src/components/folders/HeaderActions.tsx
git commit -m "feat(folders): render the tab strip from the layout config"
```

---

### Task 5: Section rendering — extract panels, render from config

**Files:**

- Create: `src/components/folders/panels/KpisPanel.tsx`
- Create: `src/components/folders/panels/BurnPanel.tsx`
- Create: `src/components/folders/panels/BoardStatusPanel.tsx`
- Create: `src/components/folders/panels/AttentionPanel.tsx`
- Create: `src/components/folders/panels/IntelligencePanel.tsx`
- Create: `src/components/folders/panels/MilestonesPanel.tsx`
- Create: `src/components/folders/panels/Panel.tsx` (the shared `Panel`/`Failed` shells, moved out of `Overview.tsx`)
- Create: `src/components/folders/SectionGrid.tsx`
- Create: `src/components/folders/SectionGrid.test.tsx`
- Modify: `src/components/folders/tabs/Overview.tsx` (becomes a thin renderer)
- Modify: `src/components/folders/CommandCenter.tsx`
- Modify: `src/components/folders/tabs/Overview.test.tsx` (only if a panel's props change shape)

**Interfaces:**

- Consumes: `canvasSections`, `LayoutSection`, `KpiKey` (Task 2); `payload.layout` (Task 3); tab id from `useCommandCenterState` (Task 4).
- Produces:
  - `SectionGrid({ sections, render }: { sections: LayoutSection[]; render: (s: LayoutSection) => ReactNode })`
  - `KpisPanel({ cards, rows, todayISO })` where `cards: KpiKey[]`
  - Each other panel keeps the props its current JSX block reads, now as an explicit component.

`Overview.tsx` is 384 lines and every panel is inline. This task splits it because it is the file being changed — one panel per file, each independently testable, and spec 2 drops widget sections into the same `SectionGrid` without touching them.

- [ ] **Step 1: Write the failing SectionGrid test**

Create `src/components/folders/SectionGrid.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PRESETS } from "@/lib/folders/presets";
import { canvasSections } from "@/lib/folders/layout";
import { SectionGrid } from "./SectionGrid";

describe("SectionGrid", () => {
  it("renders sections in config order", () => {
    render(
      <SectionGrid
        sections={canvasSections(PRESETS.project, "overview")}
        render={(s) => <div data-testid="section">{s.id}</div>}
      />,
    );
    expect(screen.getAllByTestId("section").map((n) => n.textContent)).toEqual([
      "kpis",
      "burn",
      "board-status",
      "attention",
      "intelligence",
      "milestones",
    ]);
  });

  it("places each section on the 12-column grid from x and w", () => {
    render(
      <SectionGrid
        sections={canvasSections(PRESETS.project, "overview")}
        render={(s) => <div>{s.id}</div>}
      />,
    );
    const cells = screen.getAllByTestId("section-cell");
    // burn: x 0, w 8 → column 1 span 8. boardStatus: x 8, w 4 → column 9 span 4.
    expect(cells[1].style.getPropertyValue("--col")).toBe("1 / span 8");
    expect(cells[2].style.getPropertyValue("--col")).toBe("9 / span 4");
  });

  it("renders nothing for an empty section list", () => {
    const { container } = render(
      <SectionGrid sections={[]} render={() => null} />,
    );
    expect(
      container.querySelectorAll("[data-testid='section-cell']"),
    ).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm test:unit -- SectionGrid
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write SectionGrid**

Create `src/components/folders/SectionGrid.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import type { LayoutSection } from "@/lib/validations/folder-layout";

/**
 * The Overview canvas: a 12-column CSS Grid at `lg`, one stacked column below.
 *
 * Explicit COLUMN placement with automatic rows is what reproduces today's
 * layout exactly — an 8-span followed by two 4-spans puts the second 4-span in
 * the right-hand column of the NEXT row (Intelligence above Next milestones),
 * while row heights stay content-sized. Absolutely-positioned react-grid-layout
 * would have fixed the row heights and broken the small-screen stack; `y`/`h`
 * are carried in the config for spec 2's widget canvas, not read here.
 *
 * The column is passed as a CSS custom property so the placement can be
 * responsive — inline styles cannot carry a media query, Tailwind arbitrary
 * properties can.
 */
export function SectionGrid({
  sections,
  render,
}: {
  sections: LayoutSection[];
  render: (section: LayoutSection) => ReactNode;
}) {
  if (sections.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {sections.map((s) => (
        <div
          key={s.id}
          data-testid="section-cell"
          data-section-id={s.id}
          className="min-w-0 lg:[grid-column:var(--col)]"
          style={
            {
              "--col": `${s.layout.x + 1} / span ${s.layout.w}`,
            } as React.CSSProperties
          }
        >
          {render(s)}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm test:unit -- SectionGrid
```

Expected: PASS.

- [ ] **Step 5: Extract the six panels verbatim**

Move each existing JSX block out of `Overview.tsx` into its own file under `src/components/folders/panels/`, changing **no markup, no class names and no copy**. `Panel` and `Failed` move to `panels/Panel.tsx` and are imported by each. The KPI panel additionally takes the card list:

```tsx
// panels/KpisPanel.tsx
const CARD: Record<KpiKey, (k: Kpis) => ReactNode> = {
  complete: (k) => (/* the existing <KpiCard label="Complete" .../> block */),
  gap: (k) => (/* existing */),
  overdue: (k) => (/* existing */),
  dueThisWeek: (k) => (/* existing */),
  blocked: (k) => (/* existing */),
  stale: (k) => (/* existing */),
};

/** The KPI row. `cards` is the folder's chosen subset, in its chosen order —
 *  the grid stays 6-up at xl so a 3-card CRM row doesn't stretch. */
export function KpisPanel({ cards, rows, todayISO, onRetry, failed }: KpisPanelProps) {
  const k = computeKpis(rows, todayISO);
  if (failed) return <Failed onRetry={onRetry} />;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {cards.map((key) => <Fragment key={key}>{CARD[key](k)}</Fragment>)}
    </div>
  );
}
```

- [ ] **Step 6: Make Overview render from the section list**

`Overview.tsx` becomes the renderer — it keeps computing the derived data it already computes (`boardSummaries`, `burnSeries`, attention slicing, `nextMilestones`) and dispatches per section:

```tsx
export function OverviewTab({
  payload,
  rows,
  stages,
  stage,
  board,
  sections,
  widgets,
  onRetry,
}: OverviewTabProps) {
  // ...existing derivations unchanged...
  return (
    <div className="flex flex-col gap-4" data-print-root>
      <SectionGrid
        sections={sections}
        render={(s) => {
          if (s.type !== "builtin") return null; // widget sections: spec 2
          switch (s.panel) {
            case "kpis":
              return (
                <KpisPanel
                  cards={s.props?.cards ?? []}
                  rows={rows}
                  todayISO={payload.todayISO}
                  failed={payload.rollup === null}
                  onRetry={onRetry}
                />
              );
            case "burn":
              return (
                <BurnPanel
                  title={s.title}
                  board={board}
                  burn={burn}
                  anyDue={anyDue}
                  onRetry={onRetry}
                />
              );
            case "boardStatus":
              return (
                <BoardStatusPanel
                  title={s.title}
                  boards={boards}
                  failed={payload.rollup === null}
                  onRetry={onRetry}
                />
              );
            case "attention":
              return (
                <AttentionPanel
                  title={s.title}
                  attention={attention}
                  caption={attentionCaption}
                  onRetry={onRetry}
                />
              );
            case "intelligence":
              return payload.briefs.length > 0 ? (
                <IntelligencePanel title={s.title} briefs={payload.briefs} />
              ) : null;
            case "milestones":
              return (
                <MilestonesPanel title={s.title} milestones={milestones} />
              );
          }
        }}
      />
      {widgets ? (
        <div id="widgets" className="scroll-mt-20">
          {widgets}
        </div>
      ) : null}
    </div>
  );
}
```

The `kicker` each `Panel` shows ("02", "03", …) becomes the section's **position in the rendered list**, so a folder that hides the burn panel doesn't show a gap in the numbering.

In `CommandCenter.tsx`: call `useCommandCenterState(payload.layout.config.tabs.map((t) => t.id))`, pass `tabs={payload.layout.config.tabs}` to `TabStrip`, look the active tab up by id, and switch on its **kind** (`canvas` → `OverviewTab` with `sections={canvasSections(payload.layout.config, activeTab.id)}`; `stages`/`boards`/`people` → the existing tabs, unchanged).

- [ ] **Step 7: Write the config-driven render test**

Add to `src/components/folders/CommandCenter.test.tsx`:

```tsx
it("renders a CRM folder without the burn chart or milestones, with a Pipeline tab", () => {
  render(wrap({ payload: folderFixtureWithPreset("crm") }));
  expect(screen.queryByTestId("burn-chart")).not.toBeInTheDocument();
  expect(screen.queryByText("Next milestones")).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /Pipeline/ })).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: /People/ })).not.toBeInTheDocument();
});

it("shows only the KPI cards the layout selects, in order", () => {
  render(wrap({ payload: folderFixtureWithPreset("crm") }));
  const labels = screen.getAllByTestId("kpi-label").map((n) => n.textContent);
  expect(labels).toEqual(["Complete", "Overdue", "Due this week"]);
});

it("never navigates when switching tabs", () => {
  render(wrap({ payload: folderFixture() }));
  fireEvent.click(screen.getByRole("tab", { name: /Boards/ }));
  expect(routerPush).not.toHaveBeenCalled();
  expect(routerRefresh).not.toHaveBeenCalled();
});
```

If `KpiCard` has no `data-testid="kpi-label"` on its label element, add it in `src/components/folders/charts/KpiCard.tsx` — a test id, no visual change.

- [ ] **Step 8: Run the full unit suite**

```bash
pnpm test:unit -- folders
pnpm typecheck && pnpm lint
```

Expected: PASS, with **no edits** to `Overview.test.tsx`'s existing assertions beyond the props a moved panel now takes. An existing assertion that genuinely has to change means a default folder's render changed — stop and report it.

- [ ] **Step 9: Commit**

```bash
git add src/components/folders/panels src/components/folders/SectionGrid.tsx src/components/folders/SectionGrid.test.tsx src/components/folders/tabs/Overview.tsx src/components/folders/tabs/Overview.test.tsx src/components/folders/CommandCenter.tsx src/components/folders/CommandCenter.test.tsx src/components/folders/charts/KpiCard.tsx
git commit -m "feat(folders): render overview sections from the layout config"
```

---

### Task 6: Edit mode and `saveFolderLayout`

**Files:**

- Create: `src/lib/folders/layout-actions.ts`
- Create: `src/lib/folders/layout-actions.test.ts`
- Create: `src/components/folders/edit/use-layout-draft.ts`
- Create: `src/components/folders/edit/use-layout-draft.test.ts`
- Create: `src/components/folders/edit/CustomizeBar.tsx`
- Create: `src/components/folders/edit/SectionsSheet.tsx`
- Create: `src/components/folders/edit/SectionChrome.tsx`
- Create: `src/components/folders/edit/KpiPicker.tsx`
- Create: `src/components/folders/edit/CustomizeBar.test.tsx`
- Modify: `src/components/folders/CommandCenter.tsx`
- Modify: `src/components/folders/HeaderActions.tsx`
- Modify: `src/components/folders/command-center-state.ts` (add `edit`)

**Interfaces:**

- Consumes: `saveFolderLayoutSchema`, `PRESETS`, `DEFAULT_SECTION`, `BUILTIN_PANELS`, `KPI_KEYS` (Task 2); `payload.layout` (Task 3); `SectionGrid` (Task 5).
- Produces:
  - `saveFolderLayout(input): Promise<ActionResult<{ version: number }>>`
  - `useLayoutDraft(initial: FolderLayoutConfig)` returning `{ config, dirty, hide(id), move(id, dir), setWidth(id, w), rename(id, label), setCards(id, cards), addSection(panel), renameTab(id, label), hideTab(id), moveTab(id, dir), reset(preset), revert() }`

- [ ] **Step 1: Write the failing action test**

Create `src/lib/folders/layout-actions.test.ts`, mirroring the mocking style of `src/lib/folders/actions.test.ts` (mock `@/lib/supabase/server`, `@/lib/auth/session`, `@/lib/org/active`):

```ts
it("rejects a config that fails validation before touching the database", async () => {
  const res = await saveFolderLayout({
    folderId: FOLDER,
    version: 1,
    preset: "crm",
    config: { v: 1, tabs: [] },
  });
  expect(res.ok).toBe(false);
  expect(upsert).not.toHaveBeenCalled();
});

it("inserts when version is 0 and returns the new version", async () => {
  insert.mockResolvedValueOnce({ data: { version: 1 }, error: null });
  const res = await saveFolderLayout({
    folderId: FOLDER,
    version: 0,
    preset: "project",
    config: PRESETS.project,
  });
  expect(res).toEqual({ ok: true, data: { version: 1 } });
});

it("refuses a stale version instead of clobbering", async () => {
  update.mockResolvedValueOnce({ data: null, error: null }); // no row matched
  const res = await saveFolderLayout({
    folderId: FOLDER,
    version: 3,
    preset: "crm",
    config: PRESETS.crm,
  });
  expect(res).toEqual({
    ok: false,
    error: "This layout changed — reload the page and try again.",
  });
});

it("maps a missing or cross-tenant folder to the canonical gone message", async () => {
  insert.mockResolvedValueOnce({
    data: null,
    error: { code: "23503", message: "fk" },
  });
  const res = await saveFolderLayout({
    folderId: FOLDER,
    version: 0,
    preset: "project",
    config: PRESETS.project,
  });
  expect(res).toEqual({ ok: false, error: FOLDER_GONE_ERROR });
});

it("does not invalidate the folders nav cache", async () => {
  insert.mockResolvedValueOnce({ data: { version: 1 }, error: null });
  await saveFolderLayout({
    folderId: FOLDER,
    version: 0,
    preset: "project",
    config: PRESETS.project,
  });
  expect(updateTag).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm test:unit -- layout-actions
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the action**

Create `src/lib/folders/layout-actions.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { fail, type ActionResult } from "@/lib/actions/result";
import { saveFolderLayoutSchema } from "@/lib/validations/folder-layout";
import { FOLDER_GONE_ERROR } from "./types";

const STALE = "This layout changed — reload the page and try again.";

/**
 * The command center's ONE mutation. Everything else in edit mode is client
 * draft state.
 *
 * Concurrency is last-write-wins guarded by `version`: the update matches on
 * the version the client read, so a second editor's save fails loudly instead
 * of silently overwriting. `version: 0` means the folder has no row yet.
 *
 * No `updateTag(foldersTag(orgId))`: nothing cached holds the layout —
 * `buildFolderPayload` reads it uncached on the request's RLS client — so
 * invalidating that tag would only evict the sidebar nav cache on every save.
 * The client calls `router.refresh()`.
 */
export async function saveFolderLayout(input: {
  folderId: string;
  version: number;
  preset: string;
  config: unknown;
}): Promise<ActionResult<{ version: number }>> {
  const parsed = saveFolderLayoutSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid layout");
  const user = await getUser();
  if (!user) return fail("You must be signed in.");
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");

  const supabase = await createClient();
  const { folderId, version, preset, config } = parsed.data;

  if (version === 0) {
    const { data, error } = await supabase
      .from("folder_layouts")
      .insert({
        folder_id: folderId,
        org_id: org.id,
        preset,
        config,
        updated_by: user.id,
      })
      .select("version")
      .maybeSingle();
    if (error || !data) return fail(FOLDER_GONE_ERROR);
    return { ok: true, data: { version: data.version } };
  }

  const { data, error } = await supabase
    .from("folder_layouts")
    .update({ preset, config, version: version + 1, updated_by: user.id })
    .eq("folder_id", folderId)
    .eq("version", version)
    .select("version")
    .maybeSingle();
  if (error) return fail(FOLDER_GONE_ERROR);
  if (!data) return fail(STALE);
  return { ok: true, data: { version: data.version } };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm test:unit -- layout-actions
```

Expected: PASS, all five cases.

- [ ] **Step 5: Write the failing draft-reducer test**

Create `src/components/folders/edit/use-layout-draft.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { folderLayoutConfigSchema } from "@/lib/validations/folder-layout";
import { PRESETS } from "@/lib/folders/presets";
import { useLayoutDraft } from "./use-layout-draft";

const panels = (config: {
  tabs: { sections?: { type: string; panel?: string }[] }[];
}) =>
  (config.tabs[0].sections ?? []).map((s) =>
    s.type === "builtin" ? s.panel : "widget",
  );

const draft = () => renderHook(() => useLayoutDraft(PRESETS.project));

describe("useLayoutDraft", () => {
  it("starts clean and hides a section by removing it from the tab", () => {
    const { result } = draft();
    expect(result.current.dirty).toBe(false);
    act(() => result.current.hide("burn"));
    expect(panels(result.current.config)).not.toContain("burn");
    expect(result.current.dirty).toBe(true);
  });

  it("moves a section up without disturbing the rest of the order", () => {
    const { result } = draft();
    act(() => result.current.move("burn", "up"));
    expect(panels(result.current.config)).toEqual([
      "burn",
      "kpis",
      "boardStatus",
      "attention",
      "intelligence",
      "milestones",
    ]);
  });

  it("is a no-op when moving the first section up or the last one down", () => {
    const { result } = draft();
    act(() => result.current.move("kpis", "up"));
    expect(panels(result.current.config)).toEqual([
      "kpis",
      "burn",
      "boardStatus",
      "attention",
      "intelligence",
      "milestones",
    ]);
    expect(result.current.dirty).toBe(false);
  });

  it("re-adds a hidden panel with its default rect", () => {
    const { result } = draft();
    act(() => result.current.hide("burn"));
    act(() => result.current.addSection("burn"));
    const added = (result.current.config.tabs[0].sections ?? []).find(
      (s) => s.type === "builtin" && s.panel === "burn",
    );
    expect(added?.layout.w).toBe(8);
  });

  it("sets a section width and changes nothing else about it", () => {
    const { result } = draft();
    act(() => result.current.setWidth("attention", 12));
    const section = (result.current.config.tabs[0].sections ?? []).find(
      (s) => s.id === "attention",
    );
    expect(section?.layout).toEqual({ x: 0, y: 6, w: 12, h: 5 });
  });

  it("trims a rename and rejects an empty one", () => {
    const { result } = draft();
    act(() => result.current.rename("attention", "  Open risks  "));
    const section = (result.current.config.tabs[0].sections ?? []).find(
      (s) => s.id === "attention",
    );
    expect(section?.type === "builtin" && section.title).toBe("Open risks");
    act(() => result.current.rename("attention", "   "));
    const after = (result.current.config.tabs[0].sections ?? []).find(
      (s) => s.id === "attention",
    );
    expect(after?.type === "builtin" && after.title).toBe("Open risks");
  });

  it("sets the KPI card list in the chosen order and refuses an empty list", () => {
    const { result } = draft();
    act(() => result.current.setCards("kpis", ["overdue", "complete"]));
    const kpis = (result.current.config.tabs[0].sections ?? [])[0];
    expect(kpis.type === "builtin" && kpis.props?.cards).toEqual([
      "overdue",
      "complete",
    ]);
    act(() => result.current.setCards("kpis", []));
    const after = (result.current.config.tabs[0].sections ?? [])[0];
    expect(after.type === "builtin" && after.props?.cards).toEqual([
      "overdue",
      "complete",
    ]);
  });

  it("hides a tab but never the last remaining one", () => {
    const { result } = draft();
    act(() => result.current.hideTab("people"));
    expect(result.current.config.tabs.map((t) => t.id)).toEqual([
      "overview",
      "stages",
      "boards",
    ]);
    act(() => result.current.hideTab("stages"));
    act(() => result.current.hideTab("boards"));
    act(() => result.current.hideTab("overview"));
    expect(result.current.config.tabs).toHaveLength(1);
  });

  it("reset(preset) replaces the whole config and stays dirty", () => {
    const { result } = draft();
    act(() => result.current.reset("crm"));
    expect(result.current.config).toEqual(PRESETS.crm);
    expect(result.current.dirty).toBe(true);
  });

  it("revert() restores the initial config and clears dirty", () => {
    const { result } = draft();
    act(() => result.current.hide("burn"));
    act(() => result.current.revert());
    expect(result.current.config).toEqual(PRESETS.project);
    expect(result.current.dirty).toBe(false);
  });

  it("leaves a schema-valid config after any sequence of edits", () => {
    const { result } = draft();
    act(() => result.current.hide("burn"));
    act(() => result.current.move("attention", "up"));
    act(() => result.current.setWidth("attention", 12));
    act(() => result.current.rename("attention", "Open risks"));
    act(() => result.current.setCards("kpis", ["overdue", "blocked"]));
    act(() => result.current.renameTab("stages", "Pipeline"));
    act(() => result.current.hideTab("people"));
    act(() => result.current.addSection("burn"));
    expect(
      folderLayoutConfigSchema.safeParse(result.current.config).success,
    ).toBe(true);
  });
});
```

The last case is the load-bearing one: **every draft operation must leave a config the schema accepts**, because the action rejects anything else — a draft that can produce an invalid config turns Save into a dead button.

- [ ] **Step 6: Run to verify it fails, then write the reducer**

```bash
pnpm test:unit -- use-layout-draft
```

`useLayoutDraft` is a `useReducer` over `FolderLayoutConfig` with the operations listed in the Interfaces block. It is pure client state — **no server calls**. Section ids for re-added panels come from `DEFAULT_SECTION[panel].id`; if that id is already taken (a panel re-added twice can't happen, but a widget could collide in spec 2), suffix `-2`.

- [ ] **Step 7: Build the edit UI**

- `command-center-state.ts` gains `edit: boolean` + `setEdit(on: boolean)`, written to `?edit=1` with the same `replaceState` helper.
- `HeaderActions` gains a **Customize** button that calls `setEdit(true)`.
- `SectionChrome` wraps each rendered section in edit mode: drag handle, Move up / Move down buttons (keyboard-accessible — the drag is an enhancement, not the only path), width control (Full / Two-thirds / One-third → `w` 12 / 8 / 4), rename, hide.
- `SectionsSheet` lists `BUILTIN_PANELS` not currently in the active canvas tab, each with an Add button, plus the tab list with rename / hide / reorder.
- `KpiPicker` renders `KPI_KEYS` as checkboxes with Move up / Move down, capped at 6 and refusing to drop below 1.
- `CustomizeBar` is the sticky footer: `Reset to preset ▾` (the four `PRESET_KEYS`), Cancel (`revert()` then `setEdit(false)`), Save (calls `saveFolderLayout`, then on success `router.refresh()` and `setEdit(false)`; on failure `showMutationError` from `src/lib/ui/mutation-toast.ts`).

Styling goes through the `pulse-ui` and `frontend-design` skills before writing any of these components — load them first (working agreement #3).

- [ ] **Step 8: Write the edit-mode component test**

Create `src/components/folders/edit/CustomizeBar.test.tsx` plus cases in `CommandCenter.test.tsx`:

```tsx
it("entering edit mode makes no server call", () => {
  render(wrap({ payload: folderFixture() }));
  fireEvent.click(screen.getByRole("button", { name: "Customize" }));
  expect(routerRefresh).not.toHaveBeenCalled();
  expect(saveFolderLayout).not.toHaveBeenCalled();
  expect(window.location.search).toBe("?edit=1");
});

it("hiding a section and moving one are local until Save", () => {
  // click Hide on the burn section, then Move up on attention
  expect(screen.queryByTestId("burn-chart")).not.toBeInTheDocument();
  expect(saveFolderLayout).not.toHaveBeenCalled();
});

it("Save sends the edited config once and refreshes", async () => {
  // …
  expect(saveFolderLayout).toHaveBeenCalledTimes(1);
  const sent = vi.mocked(saveFolderLayout).mock.calls[0][0];
  expect(sent.config.tabs[0].sections.map((s) => s.panel)).not.toContain(
    "burn",
  );
  expect(routerRefresh).toHaveBeenCalledTimes(1);
});

it("Cancel restores the original layout and leaves edit mode", () => {
  /* burn chart is back, ?edit= gone */
});

it("a stale save surfaces the error and stays in edit mode", async () => {
  vi.mocked(saveFolderLayout).mockResolvedValueOnce({
    ok: false,
    error: "This layout changed — reload the page and try again.",
  });
  // expect the toast text, and that edit mode is still on so the work isn't lost
});
```

- [ ] **Step 9: Run every gate**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four pass. Report the actual counts (tests passed, build routes) — never claim green without the output.

- [ ] **Step 10: Commit**

```bash
git add src/lib/folders/layout-actions.ts src/lib/folders/layout-actions.test.ts src/components/folders/edit src/components/folders/CommandCenter.tsx src/components/folders/CommandCenter.test.tsx src/components/folders/HeaderActions.tsx src/components/folders/command-center-state.ts
git commit -m "feat(folders): customize mode for the command center layout"
```

---

## Manual test walkthrough (for the closing message and the wrapup note)

1. Pull `develop`, run `pnpm dev`, open any folder at `/folders/<id>`. It must look **exactly** as it did before — six KPI cards, burn chart, four tabs.
2. Click **Customize** in the header. The URL gains `?edit=1`; section chrome appears.
3. Hide **Planned vs completed** and **Next milestones**; move **Needs attention** to the top; set its width to Full.
4. Open the KPI picker and keep only Complete, Overdue, Due this week.
5. Rename the **Stages** tab to **Pipeline**; hide the **People** tab. Nothing has hit the server yet — the network tab stays quiet.
6. Click **Save**. The page refreshes once and keeps the new layout.
7. Reload the page: the layout persists. Open the same folder in another browser profile signed in as another member of the org: they see the same layout.
8. Click **Customize → Reset to preset → Project**, Save. The folder is back to the original layout.
9. Open a second folder: it is still the default. Layouts are per folder.

## Self-review notes

- **Spec coverage:** §4 table → Task 1. §4.1 schema → Task 2. §4.2 presets → Task 2. §5 read path and burn gate → Task 3. §5 mutation → Task 6. §6 editing → Task 6. §7 tabs → Task 4. §8 tests → every task's test steps plus the gate run in Task 6 Step 9. §9 units → the Execution DAG above.
- **Deliberate deferral:** widget sections parse but render `null` (Task 5 Step 6). That is spec 2, and the schema already carries them so no config migration is needed.
- **Watch item for the implementer of Task 5:** the `kicker` numbers on panels are positional, so hiding a panel must not leave a numbering gap.
