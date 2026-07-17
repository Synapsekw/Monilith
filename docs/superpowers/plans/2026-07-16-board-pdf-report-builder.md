# Board PDF Report Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a per-board Report Builder that composes a saved, reusable report configuration and exports it as a polished PDF (Editorial look, landscape/all-columns table default, AI-assisted narrative).

**Architecture:** One pure React component tree (`ReportDocument` + blocks, styled with a self-contained CSS string) is the single render surface. The builder renders it **client-side into an iframe** for live preview (zero server round-trips on edits); the export server action renders the **same tree** with `renderToStaticMarkup` and feeds it to headless Chromium (`playwright-core` + `@sparticuz/chromium`) to produce PDF bytes, returned as `{ base64, mime, fileName }` and downloaded exactly like the existing xlsx/csv export. Report configs live in a new `reports` table (org- + board-scoped, RLS). Board data is read once via the existing `getBoardPayload`; the summary/spotlight can be AI-drafted through the existing `runAi` gateway with entitlement gating and a graceful manual fallback.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), TypeScript strict, Zod, Supabase (Postgres + RLS), Vitest + Testing Library, `react-dom/server`, `playwright-core`, `@sparticuz/chromium`, Anthropic via the in-repo AI gateway.

---

## Spec

Source spec: `docs/superpowers/specs/2026-07-16-board-pdf-report-builder-design.md`. Read it first.

## Conventions (read before starting)

- **Server Components by default; Server Actions for all mutations.** Confirm any Next API against `node_modules/next/dist/docs/`.
- **Action results:** import `ActionResult` + `fail` from `@/lib/actions/result`. Success is constructed inline: `return { ok: true, data }`. There is **no** `ok()` helper.
- **Validate at boundaries with Zod.** No `any`.
- **RLS is the security boundary.** Every new table carries a denormalized `org_id` and single-check policies via `public.is_org_member(org_id)`.
- **Migrations** are minted only via `scripts/new-migration.sh <slug>`, applied to DEV via the `supabase-dev` MCP with the **same version+name**, then `pnpm db:types` — migration + regenerated types committed together.
- **Commit identity** is auto-pinned in the worktree. Stage by path (`git add <paths>`), never `git add -A`.
- **This is worktree work.** Start it with `scripts/start-task.sh board-pdf-reports` and build inside `.claude/worktrees/board-pdf-reports` (see Task 0).

## File Structure

New files:

| Path                                                         | Responsibility                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/<stamp>_reports_table.sql`              | `reports` table + indexes + RLS                                                                         |
| `src/lib/reports/config.ts`                                  | Zod schema + TS types for report config; `defaultReportConfig()`                                        |
| `src/lib/reports/config.test.ts`                             | Config schema unit tests                                                                                |
| `src/lib/reports/shape.ts`                                   | Pure board→report shaping: `shapeReport`, `computeKpis`, `computeGroupSummaries`                        |
| `src/lib/reports/shape.test.ts`                              | Shaping unit tests                                                                                      |
| `src/lib/boards/people-names.ts`                             | `resolvePeopleNames(payload)` extracted from `spreadsheet-actions.ts` (shared)                          |
| `src/lib/reports/pdf.ts`                                     | `renderHtmlToPdf(html, opts)` — headless Chromium engine                                                |
| `src/lib/reports/pdf.test.ts`                                | PDF engine smoke test                                                                                   |
| `src/lib/reports/queries.ts`                                 | `getReport`, `listReports` (RLS-scoped, bounded)                                                        |
| `src/lib/reports/access.ts`                                  | `assertReportBoardAccess(boardId)` shared authorization helper                                          |
| `src/lib/reports/actions.ts`                                 | `createReport`, `saveReport`, `deleteReport`, `exportReportPdf` server actions                          |
| `src/lib/reports/actions.integration.test.ts`                | Action integration tests (PULSE_TEST_DB-gated)                                                          |
| `src/lib/reports/report-css.ts`                              | The self-contained CSS string for the report surface                                                    |
| `src/lib/reports/ai-draft-schema.ts`                         | JSON Schema + Zod for `{ summary, highlights, risks }`                                                  |
| `src/lib/reports/ai-draft.ts`                                | `draftReportNarrative(...)` (adapter structured call)                                                   |
| `src/lib/reports/ai-actions.ts`                              | `draftReportNarrativeAction` server action (entitlement-gated)                                          |
| `src/lib/reports/ai-draft.test.ts`                           | AI draft unit tests (mocked adapter)                                                                    |
| `src/components/reports/ReportDocument.tsx`                  | Pure composer: renders enabled blocks in order from config + model                                      |
| `src/components/reports/ReportDocument.test.tsx`             | Render tests (`renderToStaticMarkup`)                                                                   |
| `src/components/reports/blocks/*.tsx`                        | One pure component per block (cover, summary, kpis, table, group-summaries, spotlight, notes, appendix) |
| `src/components/reports/ReportBuilder.tsx`                   | Client two-pane builder (state, save, export, AI)                                                       |
| `src/components/reports/SectionRail.tsx`                     | Left rail: toggle/reorder/options                                                                       |
| `src/components/reports/PreviewPane.tsx`                     | Right pane: live iframe render of `ReportDocument`                                                      |
| `src/app/(app)/boards/[boardId]/reports/page.tsx`            | Reports list (RSC)                                                                                      |
| `src/app/(app)/boards/[boardId]/reports/[reportId]/page.tsx` | Builder page (RSC shell → client `ReportBuilder`)                                                       |

Modified files:

| Path                                    | Change                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/lib/boards/spreadsheet-actions.ts` | Import `resolvePeopleNames` from the new shared module instead of the local private copy |
| `src/components/boards/BoardHeader.tsx` | Add a "Report" action linking to `/boards/[boardId]/reports`                             |
| `package.json`                          | Add `playwright-core`, `@sparticuz/chromium` deps                                        |

---

## Task 0: Create the worktree

**Files:** none (environment setup)

- [ ] **Step 1: Cut the task worktree from latest develop**

Run: `scripts/start-task.sh board-pdf-reports`
Expected: creates `.claude/worktrees/board-pdf-reports` on `task/board-pdf-reports`, runs `pnpm install`, symlinks `.env.local`.

- [ ] **Step 2: Re-root the session into the worktree**

Use `EnterWorktree({ path: ".claude/worktrees/board-pdf-reports" })` so all subsequent paths and subagents operate on the one branch. All file paths below are relative to the worktree root.

- [ ] **Step 3: Sanity-check the gates run in the worktree**

Run: `pnpm typecheck`
Expected: PASS (clean baseline before any changes).

---

## Task 1: `reports` table migration

**Files:**

- Create: `supabase/migrations/<stamp>_reports_table.sql`
- Modify: `src/types/database.types.ts` (regenerated)

- [ ] **Step 1: Mint the migration file**

Run: `scripts/new-migration.sh reports_table`
Expected: prints `✓ created supabase/migrations/<stamp>_reports_table.sql` and next-step hints. Note the exact `<stamp>` and filename.

- [ ] **Step 2: Write the migration SQL**

Replace the stub body of the created file with (keep the minted header comment lines):

```sql
create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  board_id    uuid not null references public.boards (id) on delete cascade,
  name        text not null default 'Status Report',
  config      jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index reports_org_board_idx on public.reports (org_id, board_id);

alter table public.reports enable row level security;

-- Org-scoped: any member of the owning org can read/write the board's reports.
-- Board-level (owner/editor/viewer) refinement is enforced in the action layer.
create policy "reports_select_member" on public.reports
  for select using (public.is_org_member(org_id));
create policy "reports_insert_member" on public.reports
  for insert with check (public.is_org_member(org_id));
create policy "reports_update_member" on public.reports
  for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy "reports_delete_member" on public.reports
  for delete using (public.is_org_member(org_id));
```

- [ ] **Step 3: Apply to DEV via the supabase-dev MCP**

Use `mcp__supabase-dev__apply_migration` with `name` = the exact `<stamp>_reports_table` (same version+name as the file) and `query` = the SQL above.
Then verify with `mcp__supabase-dev__list_migrations` — confirm the new row is present and matches the filename. If drift, run `scripts/reconcile-migration-version.sh`.

- [ ] **Step 4: Regenerate types**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` now contains a `reports` row type under `public.Tables`. Confirm:

Run: `grep -n "reports:" src/types/database.types.ts | head`
Expected: a match inside the `Tables` block.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_reports_table.sql src/types/database.types.ts
git commit -m "feat(reports): add reports table with org-scoped RLS"
```

---

## Task 2: Report config schema

**Files:**

- Create: `src/lib/reports/config.ts`
- Test: `src/lib/reports/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/reports/config.test.ts
import { describe, expect, it } from "vitest";
import {
  reportConfigSchema,
  defaultReportConfig,
  REPORT_CONFIG_VERSION,
} from "@/lib/reports/config";

describe("report config", () => {
  it("defaultReportConfig parses and has all 8 block types once", () => {
    const cfg = defaultReportConfig();
    const parsed = reportConfigSchema.parse(cfg);
    const types = parsed.blocks.map((b) => b.type);
    expect(new Set(types).size).toBe(8);
    expect(parsed.v).toBe(REPORT_CONFIG_VERSION);
  });

  it("fills block option defaults", () => {
    const parsed = reportConfigSchema.parse({
      blocks: [{ type: "table", enabled: true, options: {} }],
    });
    const table = parsed.blocks[0];
    expect(table.type).toBe("table");
    if (table.type === "table") {
      expect(table.options.orientation).toBe("landscape");
      expect(table.options.columnIds).toBeNull();
    }
  });

  it("rejects an unknown block type", () => {
    const r = reportConfigSchema.safeParse({
      blocks: [{ type: "charts", enabled: true, options: {} }],
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/reports/config.test.ts`
Expected: FAIL — cannot resolve `@/lib/reports/config`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/reports/config.ts
import { z } from "zod";

export const REPORT_CONFIG_VERSION = 1 as const;

export const blockTypeSchema = z.enum([
  "cover",
  "summary",
  "kpis",
  "table",
  "group_summaries",
  "spotlight",
  "notes",
  "appendix",
]);
export type BlockType = z.infer<typeof blockTypeSchema>;

const coverOptions = z.object({
  showLogo: z.boolean().default(true),
  preparedFor: z.string().max(200).default(""),
  preparedBy: z.string().max(200).default(""),
  dateRangeLabel: z.string().max(120).default(""),
});
const summaryOptions = z.object({
  text: z.string().max(8000).default(""),
  aiGenerated: z.boolean().default(false),
});
const tableOptions = z.object({
  orientation: z.enum(["landscape", "portrait"]).default("landscape"),
  // null = include all columns (the default per the spec)
  columnIds: z.array(z.string()).nullable().default(null),
});
const spotlightOptions = z.object({
  itemIds: z.array(z.string()).default([]),
});
const notesOptions = z.object({
  text: z.string().max(8000).default(""),
});
const noOptions = z.object({});

export const blockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("cover"),
    enabled: z.boolean().default(true),
    options: coverOptions.default({}),
  }),
  z.object({
    type: z.literal("summary"),
    enabled: z.boolean().default(true),
    options: summaryOptions.default({}),
  }),
  z.object({
    type: z.literal("kpis"),
    enabled: z.boolean().default(true),
    options: noOptions.default({}),
  }),
  z.object({
    type: z.literal("table"),
    enabled: z.boolean().default(true),
    options: tableOptions.default({}),
  }),
  z.object({
    type: z.literal("group_summaries"),
    enabled: z.boolean().default(true),
    options: noOptions.default({}),
  }),
  z.object({
    type: z.literal("spotlight"),
    enabled: z.boolean().default(false),
    options: spotlightOptions.default({}),
  }),
  z.object({
    type: z.literal("notes"),
    enabled: z.boolean().default(false),
    options: notesOptions.default({}),
  }),
  z.object({
    type: z.literal("appendix"),
    enabled: z.boolean().default(false),
    options: noOptions.default({}),
  }),
]);
export type ReportBlock = z.infer<typeof blockSchema>;

export const reportConfigSchema = z.object({
  v: z.literal(REPORT_CONFIG_VERSION).default(REPORT_CONFIG_VERSION),
  title: z.string().max(200).default("Status Report"),
  blocks: z.array(blockSchema).default([]),
});
export type ReportConfig = z.infer<typeof reportConfigSchema>;

export function defaultReportConfig(): ReportConfig {
  return reportConfigSchema.parse({
    blocks: [
      { type: "cover" },
      { type: "summary" },
      { type: "kpis" },
      { type: "table" },
      { type: "group_summaries" },
      { type: "spotlight" },
      { type: "notes" },
      { type: "appendix" },
    ],
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/reports/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/config.ts src/lib/reports/config.test.ts
git commit -m "feat(reports): report config zod schema"
```

---

## Task 3: PDF engine (headless Chromium) — de-risking spike

This runs early to validate `@sparticuz/chromium` on our deploy before anything depends on it.

**Files:**

- Modify: `package.json`
- Create: `src/lib/reports/pdf.ts`
- Test: `src/lib/reports/pdf.test.ts`

- [ ] **Step 1: Add the deps**

Run: `pnpm add playwright-core @sparticuz/chromium`
Expected: both added to `dependencies` in `package.json`.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/reports/pdf.test.ts
import { describe, expect, it } from "vitest";
import { renderHtmlToPdf } from "@/lib/reports/pdf";

// Chromium is heavy; only runs when explicitly enabled (spike + local).
const RUN = process.env.PULSE_PDF_TEST === "1";

describe.skipIf(!RUN)("renderHtmlToPdf", () => {
  it("produces non-empty PDF bytes with a %PDF header", async () => {
    const html = "<!doctype html><html><body><h1>Hello</h1></body></html>";
    const bytes = await renderHtmlToPdf(html, { landscape: true });
    expect(bytes.length).toBeGreaterThan(1000);
    // PDF files start with the ASCII bytes "%PDF"
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
  }, 60_000);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/reports/pdf.test.ts`
Expected: FAIL — cannot resolve `@/lib/reports/pdf` (the `describe.skipIf` still needs the import to resolve).

- [ ] **Step 4: Write the implementation**

```ts
// src/lib/reports/pdf.ts
import "server-only";
import chromium from "@sparticuz/chromium";
import { chromium as playwright } from "playwright-core";

export type PdfOptions = { landscape: boolean };

/**
 * Render a self-contained HTML document to PDF bytes via headless Chromium.
 * Uses setContent (not navigation) so no auth/cookies need to reach the browser.
 */
export async function renderHtmlToPdf(
  html: string,
  opts: PdfOptions,
): Promise<Buffer> {
  const executablePath = await chromium.executablePath();
  const browser = await playwright.launch({
    args: chromium.args,
    executablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      landscape: opts.landscape,
      printBackground: true,
      margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 5: Run the smoke test with Chromium enabled**

Run: `PULSE_PDF_TEST=1 pnpm vitest run src/lib/reports/pdf.test.ts`
Expected: PASS. **This is the go/no-go for the spike.** If Chromium cannot launch in our environment, STOP and consult the spec's documented fallback (browser `window.print()` on the preview iframe) before continuing — only the engine layer (this task + Task 8's byte path) changes; the rest of the plan is unaffected.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/reports/pdf.ts src/lib/reports/pdf.test.ts
git commit -m "feat(reports): headless-chromium pdf engine + smoke test"
```

---

## Task 4: Reports data layer (queries + access + CRUD actions)

**Files:**

- Create: `src/lib/reports/access.ts`
- Create: `src/lib/reports/queries.ts`
- Create: `src/lib/reports/actions.ts`
- Test: `src/lib/reports/actions.integration.test.ts`

Depends on: Task 1 (table/types), Task 2 (config schema).

- [ ] **Step 1: Write the access helper**

```ts
// src/lib/reports/access.ts
import "server-only";
import { getBoardAccess } from "@/lib/boards/queries";

/** Returns the caller's access level for a board, or null if none. */
export async function reportBoardAccess(boardId: string) {
  return getBoardAccess(boardId);
}

/** True if the caller may edit reports for the board (owner/editor). */
export function canEditReports(
  access: "owner" | "editor" | "viewer" | null,
): boolean {
  return access === "owner" || access === "editor";
}
```

- [ ] **Step 2: Write the queries**

```ts
// src/lib/reports/queries.ts
import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { reportConfigSchema, type ReportConfig } from "@/lib/reports/config";

export type ReportRow = {
  id: string;
  orgId: string;
  boardId: string;
  name: string;
  config: ReportConfig;
  updatedAt: string;
};

function rowToReport(row: {
  id: string;
  org_id: string;
  board_id: string;
  name: string;
  config: unknown;
  updated_at: string;
}): ReportRow {
  return {
    id: row.id,
    orgId: row.org_id,
    boardId: row.board_id,
    name: row.name,
    // Tolerate legacy/partial configs by re-parsing with defaults.
    config: reportConfigSchema.parse(row.config ?? {}),
    updatedAt: row.updated_at,
  };
}

export const getReport = cache(
  async (reportId: string): Promise<ReportRow | null> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("reports")
      .select("id, org_id, board_id, name, config, updated_at")
      .eq("id", reportId)
      .maybeSingle();
    return data ? rowToReport(data) : null;
  },
);

export async function listReports(boardId: string): Promise<ReportRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reports")
    .select("id, org_id, board_id, name, config, updated_at")
    .eq("board_id", boardId)
    .order("updated_at", { ascending: false })
    .limit(100);
  return (data ?? []).map(rowToReport);
}
```

- [ ] **Step 3: Write the CRUD actions**

```ts
// src/lib/reports/actions.ts
"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/org/active";
import { type ActionResult, fail } from "@/lib/actions/result";
import { reportConfigSchema, defaultReportConfig } from "@/lib/reports/config";
import { reportBoardAccess, canEditReports } from "@/lib/reports/access";

const createSchema = z.object({
  boardId: z.string().uuid(),
  name: z.string().min(1).max(200),
});

export async function createReport(input: {
  boardId: string;
  name: string;
}): Promise<ActionResult<{ id: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const access = await reportBoardAccess(parsed.data.boardId);
  if (!canEditReports(access))
    return fail("You can't create reports on this board.");

  const user = await requireUser();
  const orgId = await getActiveOrgId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reports")
    .insert({
      org_id: orgId,
      board_id: parsed.data.boardId,
      name: parsed.data.name,
      config: defaultReportConfig(),
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return fail("Could not create the report.");
  return { ok: true, data: { id: data.id } };
}

const saveSchema = z.object({
  reportId: z.string().uuid(),
  boardId: z.string().uuid(),
  name: z.string().min(1).max(200),
  config: reportConfigSchema,
});

export async function saveReport(input: unknown): Promise<ActionResult<void>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const access = await reportBoardAccess(parsed.data.boardId);
  if (!canEditReports(access)) return fail("You can't edit this report.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("reports")
    .update({
      name: parsed.data.name,
      config: parsed.data.config,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.reportId);
  if (error) return fail("Could not save the report.");
  return { ok: true, data: undefined };
}

export async function deleteReport(input: {
  reportId: string;
  boardId: string;
}): Promise<ActionResult<void>> {
  const parsed = z
    .object({ reportId: z.string().uuid(), boardId: z.string().uuid() })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid");

  const access = await reportBoardAccess(parsed.data.boardId);
  if (!canEditReports(access)) return fail("You can't delete this report.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("reports")
    .delete()
    .eq("id", parsed.data.reportId);
  if (error) return fail("Could not delete the report.");
  return { ok: true, data: undefined };
}
```

- [ ] **Step 4: Write the integration test**

```ts
// src/lib/reports/actions.integration.test.ts
import { beforeAll, describe, expect, it } from "vitest";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";

// DB-touching: opt in with PULSE_TEST_DB=1 against DEV (see integration-env).
describe.skipIf(!integrationTargetReady())("reports actions", () => {
  beforeAll(() => loadIntegrationEnv());

  it("createReport rejects a caller without board edit access", async () => {
    // Arrange a board the caller cannot edit (see existing board integration
    // fixtures for the seed helper), then:
    const { createReport } = await import("@/lib/reports/actions");
    const res = await createReport({
      boardId: "00000000-0000-0000-0000-000000000000",
      name: "Nope",
    });
    expect(res.ok).toBe(false);
  });
});
```

> Note: flesh the integration test out against the repo's existing board seed/fixture helpers (grep `*.integration.test.ts` under `src/lib/boards`). The gate check + the access-denied assertion are the required minimum; add a happy-path create→save→list→delete once a seeded board id is available.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run src/lib/reports/actions.integration.test.ts`
Expected: PASS (suite skips unless `PULSE_TEST_DB=1`; the access-denied case runs when enabled).

- [ ] **Step 6: Commit**

```bash
git add src/lib/reports/access.ts src/lib/reports/queries.ts src/lib/reports/actions.ts src/lib/reports/actions.integration.test.ts
git commit -m "feat(reports): reports queries + CRUD server actions"
```

---

## Task 5: Board→report shaping (pure, isomorphic)

Pure functions usable on both client (preview) and server (PDF). No server-only imports.

**Files:**

- Create: `src/lib/boards/people-names.ts`
- Modify: `src/lib/boards/spreadsheet-actions.ts`
- Create: `src/lib/reports/shape.ts`
- Test: `src/lib/reports/shape.test.ts`

Depends on: nothing structural (uses existing board types + `cell-codec`).

- [ ] **Step 1: Extract `resolvePeopleNames` to a shared module**

Create `src/lib/boards/people-names.ts` by moving the existing private `resolvePeopleNames` body out of `src/lib/boards/spreadsheet-actions.ts` verbatim (it reads people display names for a `BoardPayload`), exported:

```ts
// src/lib/boards/people-names.ts
import "server-only";
import type { BoardPayload } from "@/lib/boards/queries";
// ...move the exact implementation currently in spreadsheet-actions.ts here...
export async function resolvePeopleNames(
  payload: BoardPayload,
): Promise<Map<string, string>> {
  /* moved verbatim */
  return new Map();
}
```

Then in `src/lib/boards/spreadsheet-actions.ts`, delete the local function and add:

```ts
import { resolvePeopleNames } from "@/lib/boards/people-names";
```

- [ ] **Step 2: Write the failing shaping test**

```ts
// src/lib/reports/shape.test.ts
import { describe, expect, it } from "vitest";
import { computeKpis, shapeReport } from "@/lib/reports/shape";
import type { BoardPayload } from "@/lib/boards/queries";

function fixture(): BoardPayload {
  return {
    board: { id: "b1", name: "Board", org_id: "o1" } as BoardPayload["board"],
    groups: [
      {
        id: "g1",
        board_id: "b1",
        name: "Design",
        color: "#8ea2eb",
        position: 1,
      } as BoardPayload["groups"][number],
    ],
    columns: [
      {
        id: "c1",
        board_id: "b1",
        kind: "status",
        name: "Status",
        settings: { options: [{ id: "s1", label: "Done", color: "#22c55e" }] },
        position: 1,
      } as BoardPayload["columns"][number],
    ],
    items: [
      {
        id: "i1",
        board_id: "b1",
        group_id: "g1",
        parent_id: null,
        name: "Item A",
        position: 1,
      } as BoardPayload["items"][number],
      {
        id: "i2",
        board_id: "b1",
        group_id: "g1",
        parent_id: null,
        name: "Item B",
        position: 2,
      } as BoardPayload["items"][number],
    ],
    cellValues: [
      {
        item_id: "i1",
        column_id: "c1",
        value: "s1",
      } as BoardPayload["cellValues"][number],
    ],
    views: [],
    dependencies: [],
    attachments: [],
    timeEntries: [],
    relationLinks: [],
    mirrorTargetCells: [],
    mirrorTargetColumns: [],
  };
}

describe("shapeReport", () => {
  it("groups items and resolves a status cell to display text", () => {
    const model = shapeReport(fixture(), new Map());
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0].rows).toHaveLength(2);
    expect(model.groups[0].rows[0].cells.get("c1")).toBe("Done");
  });

  it("computeKpis counts items and % complete off the status column", () => {
    const kpis = computeKpis(fixture(), new Map());
    expect(kpis.itemCount).toBe(2);
    expect(kpis.percentComplete).toBe(50); // 1 of 2 is "Done"
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/reports/shape.test.ts`
Expected: FAIL — cannot resolve `@/lib/reports/shape`.

- [ ] **Step 4: Write the implementation**

```ts
// src/lib/reports/shape.ts
import type { BoardPayload, Column, Group, Item } from "@/lib/boards/queries";
import type { ColumnKind } from "@/lib/validations/boards";
import { cellToText } from "@/lib/boards/spreadsheet/cell-codec";

export type ReportRow = {
  item: Item;
  cells: Map<string, string>;
  subitems: ReportRow[];
};
export type ReportGroup = { group: Group; rows: ReportRow[] };
export type ReportModel = { columns: Column[]; groups: ReportGroup[] };

export type Kpis = {
  itemCount: number;
  percentComplete: number; // 0..100, rounded
  overdueCount: number;
  statusTally: { label: string; count: number }[];
};

const DONE_LABELS = new Set(["done", "complete", "completed", "closed"]);

function cellLookup(payload: BoardPayload): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const cv of payload.cellValues)
    map.set(`${cv.item_id}:${cv.column_id}`, cv.value);
  return map;
}

function firstStatusColumn(columns: Column[]): Column | undefined {
  return columns.find((c) => c.kind === "status");
}

function isDone(
  payload: BoardPayload,
  itemId: string,
  statusCol: Column | undefined,
): boolean {
  if (!statusCol) return false;
  const lookup = cellLookup(payload);
  const raw = lookup.get(`${itemId}:${statusCol.id}`);
  const label = cellToText(
    statusCol.kind as ColumnKind,
    raw,
    statusCol.settings,
  )
    .trim()
    .toLowerCase();
  return DONE_LABELS.has(label);
}

export function shapeReport(
  payload: BoardPayload,
  peopleNames: Map<string, string>,
): ReportModel {
  const lookup = cellLookup(payload);
  const columns = [...payload.columns].sort((a, b) => a.position - b.position);
  const resolvePerson = (id: string) => peopleNames.get(id) ?? null;

  const buildRow = (item: Item): ReportRow => {
    const cells = new Map<string, string>();
    for (const col of columns) {
      const raw = lookup.get(`${item.id}:${col.id}`);
      cells.set(
        col.id,
        cellToText(col.kind as ColumnKind, raw, col.settings, resolvePerson),
      );
    }
    const subitems = payload.items
      .filter((c) => c.parent_id === item.id)
      .sort((a, b) => a.position - b.position)
      .map(buildRow);
    return { item, cells, subitems };
  };

  const groups = [...payload.groups]
    .sort((a, b) => a.position - b.position)
    .map((group) => ({
      group,
      rows: payload.items
        .filter((i) => i.group_id === group.id && i.parent_id === null)
        .sort((a, b) => a.position - b.position)
        .map(buildRow),
    }));

  return { columns, groups };
}

export function computeKpis(
  payload: BoardPayload,
  peopleNames: Map<string, string>,
): Kpis {
  const topLevel = payload.items.filter((i) => i.parent_id === null);
  const statusCol = firstStatusColumn(payload.columns);
  const doneCount = topLevel.filter((i) =>
    isDone(payload, i.id, statusCol),
  ).length;

  const tally = new Map<string, number>();
  if (statusCol) {
    const lookup = cellLookup(payload);
    for (const i of topLevel) {
      const label =
        cellToText(
          statusCol.kind as ColumnKind,
          lookup.get(`${i.id}:${statusCol.id}`),
          statusCol.settings,
          (id) => peopleNames.get(id) ?? null,
        ).trim() || "—";
      tally.set(label, (tally.get(label) ?? 0) + 1);
    }
  }

  // Overdue: a date column value in the past on an item that is not done.
  const dateCol = payload.columns.find((c) => c.kind === "date");
  let overdue = 0;
  if (dateCol) {
    const lookup = cellLookup(payload);
    const today = new Date().toISOString().slice(0, 10);
    for (const i of topLevel) {
      const v = lookup.get(`${i.id}:${dateCol.id}`);
      const iso = typeof v === "string" ? v.slice(0, 10) : "";
      if (iso && iso < today && !isDone(payload, i.id, statusCol)) overdue += 1;
    }
  }

  return {
    itemCount: topLevel.length,
    percentComplete: topLevel.length
      ? Math.round((doneCount / topLevel.length) * 100)
      : 0,
    overdueCount: overdue,
    statusTally: [...tally.entries()].map(([label, count]) => ({
      label,
      count,
    })),
  };
}

export type GroupSummary = {
  group: Group;
  count: number;
  percentComplete: number;
};

export function computeGroupSummaries(payload: BoardPayload): GroupSummary[] {
  const statusCol = firstStatusColumn(payload.columns);
  return [...payload.groups]
    .sort((a, b) => a.position - b.position)
    .map((group) => {
      const rows = payload.items.filter(
        (i) => i.group_id === group.id && i.parent_id === null,
      );
      const done = rows.filter((i) => isDone(payload, i.id, statusCol)).length;
      return {
        group,
        count: rows.length,
        percentComplete: rows.length
          ? Math.round((done / rows.length) * 100)
          : 0,
      };
    });
}
```

> `computeKpis` reads `new Date()` — that's fine in app runtime (this is not a Workflow script). Do not import `shape.ts` into a Workflow.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/reports/shape.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Confirm the extraction didn't break the spreadsheet export**

Run: `pnpm typecheck && pnpm vitest run src/lib/boards`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/boards/people-names.ts src/lib/boards/spreadsheet-actions.ts src/lib/reports/shape.ts src/lib/reports/shape.test.ts
git commit -m "feat(reports): pure board->report shaping + shared people-names"
```

---

## Task 6: Report document + block components + CSS

Pure presentational React. No hooks, no fetching. Renders identically on client and via `renderToStaticMarkup`.

**Files:**

- Create: `src/lib/reports/report-css.ts`
- Create: `src/components/reports/blocks/CoverBlock.tsx`, `SummaryBlock.tsx`, `KpisBlock.tsx`, `TableBlock.tsx`, `GroupSummariesBlock.tsx`, `SpotlightBlock.tsx`, `NotesBlock.tsx`, `AppendixBlock.tsx`
- Create: `src/components/reports/ReportDocument.tsx`
- Test: `src/components/reports/ReportDocument.test.tsx`

Depends on: Task 2 (config types), Task 5 (shaping types).

- [ ] **Step 1: Write the CSS string**

```ts
// src/lib/reports/report-css.ts
// Self-contained: NOT app Tailwind, so the same markup renders identically in
// the preview iframe and in headless Chromium via setContent.
export const REPORT_CSS = `
  :root { --peri:#5866c4; --ink:#1a1c22; --muted:#8a8f9c; --line:#e7e8ee; }
  * { box-sizing: border-box; }
  body { margin:0; color:var(--ink); background:#fff; font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; }
  .r-section { padding:0 4mm 8mm; }
  .r-kicker { font-size:9px; letter-spacing:.16em; text-transform:uppercase; color:var(--muted); }
  .r-cover { text-align:center; padding:40mm 10mm; page-break-after:always; }
  .r-cover h1 { font-size:26px; margin:12px 0 6px; letter-spacing:-.01em; }
  .r-accent { width:40px; height:2px; background:var(--peri); margin:14px auto; }
  .r-kpis { display:flex; gap:10px; }
  .r-kpi { flex:1; text-align:center; padding:12px 6px; border:1px solid var(--line); border-radius:8px; }
  .r-kpi .n { font-size:26px; font-weight:700; color:var(--peri); line-height:1; }
  .r-kpi .l { font-size:9px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin-top:4px; }
  table.r-table { width:100%; border-collapse:collapse; font-size:11px; }
  table.r-table th { text-align:left; font-size:8px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); border-bottom:1.5px solid #d7dae2; padding:5px 7px; }
  table.r-table td { padding:5px 7px; border-bottom:1px solid var(--line); }
  .r-group-head { font-weight:700; font-size:12px; margin:10px 0 6px; }
  .r-record { border:1px solid var(--line); border-radius:8px; padding:10px 12px; margin-bottom:10px; }
  .r-record .nm { font-weight:700; margin-bottom:6px; }
  .r-kv { display:grid; grid-template-columns:auto 1fr; gap:3px 10px; font-size:11px; }
  .r-kv .k { color:var(--muted); text-transform:uppercase; font-size:8px; letter-spacing:.04em; }
  .r-narrative { white-space:pre-wrap; }
  @page { size: A4 landscape; }
`;
```

- [ ] **Step 2: Write the failing render test**

```tsx
// src/components/reports/ReportDocument.test.tsx
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportDocument } from "@/components/reports/ReportDocument";
import { defaultReportConfig } from "@/lib/reports/config";
import type { ReportModel } from "@/lib/reports/shape";

const model: ReportModel = { columns: [], groups: [] };

describe("ReportDocument", () => {
  it("renders the cover title and skips disabled blocks", () => {
    const config = defaultReportConfig();
    config.title = "Q3 Launch";
    const html = renderToStaticMarkup(
      <ReportDocument
        config={config}
        model={model}
        kpis={{
          itemCount: 0,
          percentComplete: 0,
          overdueCount: 0,
          statusTally: [],
        }}
        groupSummaries={[]}
        boardName="Marketing"
        orgName="Acme"
      />,
    );
    expect(html).toContain("Q3 Launch");
  });

  it("renders nothing for an empty block list", () => {
    const html = renderToStaticMarkup(
      <ReportDocument
        config={{ v: 1, title: "T", blocks: [] }}
        model={model}
        kpis={{
          itemCount: 0,
          percentComplete: 0,
          overdueCount: 0,
          statusTally: [],
        }}
        groupSummaries={[]}
        boardName="B"
        orgName="O"
      />,
    );
    expect(html).not.toContain("r-cover");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/components/reports/ReportDocument.test.tsx`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 4: Write the block components**

```tsx
// src/components/reports/blocks/CoverBlock.tsx
import type { ReportBlock } from "@/lib/reports/config";
export function CoverBlock({
  title,
  boardName,
  orgName,
  options,
}: {
  title: string;
  boardName: string;
  orgName: string;
  options: Extract<ReportBlock, { type: "cover" }>["options"];
}) {
  return (
    <section className="r-cover">
      {options.preparedFor ? (
        <div className="r-kicker">
          Prepared for {options.preparedFor}
          {options.dateRangeLabel ? ` · ${options.dateRangeLabel}` : ""}
        </div>
      ) : null}
      <h1>{title}</h1>
      <div className="r-accent" />
      <div style={{ color: "var(--muted)", fontSize: 12 }}>
        {boardName}
        {options.preparedBy ? ` · Prepared by ${options.preparedBy}` : ""}
        {options.showLogo ? ` · ${orgName}` : ""}
      </div>
    </section>
  );
}
```

```tsx
// src/components/reports/blocks/SummaryBlock.tsx
import type { ReportBlock } from "@/lib/reports/config";
export function SummaryBlock({
  options,
}: {
  options: Extract<ReportBlock, { type: "summary" }>["options"];
}) {
  if (!options.text.trim()) return null;
  return (
    <section className="r-section">
      <div className="r-kicker">Executive summary</div>
      <p className="r-narrative">{options.text}</p>
    </section>
  );
}
```

```tsx
// src/components/reports/blocks/KpisBlock.tsx
import type { Kpis } from "@/lib/reports/shape";
export function KpisBlock({ kpis }: { kpis: Kpis }) {
  return (
    <section className="r-section">
      <div className="r-kpis">
        <div className="r-kpi">
          <div className="n">{kpis.itemCount}</div>
          <div className="l">Items</div>
        </div>
        <div className="r-kpi">
          <div className="n">{kpis.percentComplete}%</div>
          <div className="l">Complete</div>
        </div>
        <div className="r-kpi">
          <div className="n">{kpis.overdueCount}</div>
          <div className="l">Overdue</div>
        </div>
      </div>
    </section>
  );
}
```

```tsx
// src/components/reports/blocks/TableBlock.tsx
import type { ReportBlock } from "@/lib/reports/config";
import type { ReportModel } from "@/lib/reports/shape";
export function TableBlock({
  model,
  options,
}: {
  model: ReportModel;
  options: Extract<ReportBlock, { type: "table" }>["options"];
}) {
  // null columnIds = all columns (spec default). Otherwise the curated subset.
  const columns = options.columnIds
    ? model.columns.filter((c) => options.columnIds!.includes(c.id))
    : model.columns;
  return (
    <section className="r-section">
      {model.groups.map((g) => (
        <div key={g.group.id}>
          <div className="r-group-head" style={{ color: g.group.color }}>
            {g.group.name}
          </div>
          <table className="r-table">
            <thead>
              <tr>
                <th>Item</th>
                {columns.map((c) => (
                  <th key={c.id}>{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.item.id}>
                  <td>{r.item.name}</td>
                  {columns.map((c) => (
                    <td key={c.id}>{r.cells.get(c.id) ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
```

> **Overflow policy (spec):** v1 lets the table shrink to fit the landscape page width via CSS (`font-size` on `.r-table` and `table-layout:fixed` can be added if real boards overflow). If a board is wider than landscape can hold at the floor font size, the curated-columns option (`columnIds`) is the escape hatch. Tune thresholds against real boards during Task 10; do not add continuation-page logic unless a real board needs it (YAGNI).

```tsx
// src/components/reports/blocks/GroupSummariesBlock.tsx
import type { GroupSummary } from "@/lib/reports/shape";
export function GroupSummariesBlock({
  summaries,
}: {
  summaries: GroupSummary[];
}) {
  return (
    <section className="r-section">
      <div className="r-kicker">Group summaries</div>
      <table className="r-table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Items</th>
            <th>Complete</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((s) => (
            <tr key={s.group.id}>
              <td>{s.group.name}</td>
              <td>{s.count}</td>
              <td>{s.percentComplete}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

```tsx
// src/components/reports/blocks/SpotlightBlock.tsx
import type { ReportBlock } from "@/lib/reports/config";
import type { ReportModel } from "@/lib/reports/shape";
export function SpotlightBlock({
  model,
  options,
}: {
  model: ReportModel;
  options: Extract<ReportBlock, { type: "spotlight" }>["options"];
}) {
  const byId = new Map(
    model.groups.flatMap((g) => g.rows).map((r) => [r.item.id, r]),
  );
  const rows = options.itemIds
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r));
  if (!rows.length) return null;
  return (
    <section className="r-section">
      <div className="r-kicker">Spotlight</div>
      {rows.map((r) => (
        <div key={r.item.id} className="r-record">
          <div className="nm">{r.item.name}</div>
          <div className="r-kv">
            {model.columns.map((c) => (
              <>
                <div key={`${c.id}-k`} className="k">
                  {c.name}
                </div>
                <div key={`${c.id}-v`}>{r.cells.get(c.id) ?? ""}</div>
              </>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
```

```tsx
// src/components/reports/blocks/NotesBlock.tsx
import type { ReportBlock } from "@/lib/reports/config";
export function NotesBlock({
  options,
}: {
  options: Extract<ReportBlock, { type: "notes" }>["options"];
}) {
  if (!options.text.trim()) return null;
  return (
    <section className="r-section">
      <div className="r-kicker">Notes</div>
      <p className="r-narrative">{options.text}</p>
    </section>
  );
}
```

```tsx
// src/components/reports/blocks/AppendixBlock.tsx
import type { ReportModel } from "@/lib/reports/shape";
export function AppendixBlock({ model }: { model: ReportModel }) {
  return (
    <section className="r-section">
      <div className="r-kicker">Appendix — full data</div>
      <table className="r-table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Item</th>
            {model.columns.map((c) => (
              <th key={c.id}>{c.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.groups.flatMap((g) =>
            g.rows.map((r) => (
              <tr key={r.item.id}>
                <td>{g.group.name}</td>
                <td>{r.item.name}</td>
                {model.columns.map((c) => (
                  <td key={c.id}>{r.cells.get(c.id) ?? ""}</td>
                ))}
              </tr>
            )),
          )}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 5: Write the composer**

```tsx
// src/components/reports/ReportDocument.tsx
import type { ReportConfig } from "@/lib/reports/config";
import type { GroupSummary, Kpis, ReportModel } from "@/lib/reports/shape";
import { CoverBlock } from "./blocks/CoverBlock";
import { SummaryBlock } from "./blocks/SummaryBlock";
import { KpisBlock } from "./blocks/KpisBlock";
import { TableBlock } from "./blocks/TableBlock";
import { GroupSummariesBlock } from "./blocks/GroupSummariesBlock";
import { SpotlightBlock } from "./blocks/SpotlightBlock";
import { NotesBlock } from "./blocks/NotesBlock";
import { AppendixBlock } from "./blocks/AppendixBlock";

export type ReportDocumentProps = {
  config: ReportConfig;
  model: ReportModel;
  kpis: Kpis;
  groupSummaries: GroupSummary[];
  boardName: string;
  orgName: string;
};

export function ReportDocument(props: ReportDocumentProps) {
  const { config, model, kpis, groupSummaries, boardName, orgName } = props;
  return (
    <div className="r-doc">
      {config.blocks
        .filter((b) => b.enabled)
        .map((block, i) => {
          switch (block.type) {
            case "cover":
              return (
                <CoverBlock
                  key={i}
                  title={config.title}
                  boardName={boardName}
                  orgName={orgName}
                  options={block.options}
                />
              );
            case "summary":
              return <SummaryBlock key={i} options={block.options} />;
            case "kpis":
              return <KpisBlock key={i} kpis={kpis} />;
            case "table":
              return (
                <TableBlock key={i} model={model} options={block.options} />
              );
            case "group_summaries":
              return <GroupSummariesBlock key={i} summaries={groupSummaries} />;
            case "spotlight":
              return (
                <SpotlightBlock key={i} model={model} options={block.options} />
              );
            case "notes":
              return <NotesBlock key={i} options={block.options} />;
            case "appendix":
              return <AppendixBlock key={i} model={model} />;
          }
        })}
    </div>
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/components/reports/ReportDocument.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/reports/report-css.ts src/components/reports/
git commit -m "feat(reports): report document + block components + css"
```

---

## Task 7: Builder UI (two-pane, live preview, save)

**Files:**

- Create: `src/components/reports/PreviewPane.tsx`
- Create: `src/components/reports/SectionRail.tsx`
- Create: `src/components/reports/ReportBuilder.tsx`
- Create: `src/app/(app)/boards/[boardId]/reports/[reportId]/page.tsx`
- Test: `src/components/reports/SectionRail.test.tsx`

Depends on: Task 4 (actions/queries), Task 6 (ReportDocument). **UI work — load the `pulse-ui` and `frontend-design` skills before styling the builder chrome (the rail/toolbar, not the report surface).**

- [ ] **Step 1: Write the live preview pane**

The preview renders the shared `ReportDocument` into an iframe document with the CSS injected — client-side, so config edits reflect instantly with zero server round-trips.

```tsx
// src/components/reports/PreviewPane.tsx
"use client";
import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReportDocument, type ReportDocumentProps } from "./ReportDocument";
import { REPORT_CSS } from "@/lib/reports/report-css";

export function PreviewPane(props: ReportDocumentProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const rootRef = useRef<Root | null>(null);

  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    if (!doc.getElementById("r-css")) {
      doc.head.innerHTML = `<style id="r-css">${REPORT_CSS}</style>`;
      const mount = doc.createElement("div");
      mount.id = "r-root";
      doc.body.appendChild(mount);
      rootRef.current = createRoot(mount);
    }
    rootRef.current?.render(<ReportDocument {...props} />);
  });

  useEffect(() => () => rootRef.current?.unmount(), []);

  return (
    <iframe
      ref={iframeRef}
      title="Report preview"
      style={{ width: "100%", height: "100%", border: 0, background: "#fff" }}
    />
  );
}
```

- [ ] **Step 2: Write the section rail with a pure reducer + test**

Put the reorder/toggle logic in exported pure helpers so they're unit-testable without the DOM.

```tsx
// src/components/reports/SectionRail.tsx
"use client";
import type { ReportConfig, ReportBlock } from "@/lib/reports/config";

export function toggleBlock(config: ReportConfig, index: number): ReportConfig {
  const blocks = config.blocks.map((b, i) =>
    i === index ? { ...b, enabled: !b.enabled } : b,
  );
  return { ...config, blocks };
}

export function moveBlock(
  config: ReportConfig,
  from: number,
  to: number,
): ReportConfig {
  if (to < 0 || to >= config.blocks.length) return config;
  const blocks = [...config.blocks];
  const [moved] = blocks.splice(from, 1);
  blocks.splice(to, 0, moved);
  return { ...config, blocks };
}

const LABELS: Record<ReportBlock["type"], string> = {
  cover: "Cover",
  summary: "Executive summary",
  kpis: "Key metrics",
  table: "Board table",
  group_summaries: "Group summaries",
  spotlight: "Item spotlight",
  notes: "Notes",
  appendix: "Appendix",
};

export function SectionRail({
  config,
  onChange,
}: {
  config: ReportConfig;
  onChange: (next: ReportConfig) => void;
}) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {config.blocks.map((b, i) => (
        <li
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 0",
          }}
        >
          <input
            type="checkbox"
            checked={b.enabled}
            onChange={() => onChange(toggleBlock(config, i))}
            aria-label={`Toggle ${LABELS[b.type]}`}
          />
          <span style={{ flex: 1 }}>{LABELS[b.type]}</span>
          <button
            type="button"
            onClick={() => onChange(moveBlock(config, i, i - 1))}
            aria-label={`Move ${LABELS[b.type]} up`}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onChange(moveBlock(config, i, i + 1))}
            aria-label={`Move ${LABELS[b.type]} down`}
          >
            ↓
          </button>
        </li>
      ))}
    </ul>
  );
}
```

```tsx
// src/components/reports/SectionRail.test.tsx
import { describe, expect, it } from "vitest";
import { moveBlock, toggleBlock } from "@/components/reports/SectionRail";
import { defaultReportConfig } from "@/lib/reports/config";

describe("SectionRail helpers", () => {
  it("toggleBlock flips enabled at the index", () => {
    const cfg = defaultReportConfig();
    const before = cfg.blocks[0].enabled;
    expect(toggleBlock(cfg, 0).blocks[0].enabled).toBe(!before);
  });
  it("moveBlock reorders and clamps at bounds", () => {
    const cfg = defaultReportConfig();
    const moved = moveBlock(cfg, 0, 1);
    expect(moved.blocks[1].type).toBe(cfg.blocks[0].type);
    expect(moveBlock(cfg, 0, -1)).toBe(cfg); // no-op past the top
  });
});
```

- [ ] **Step 3: Run the rail test**

Run: `pnpm vitest run src/components/reports/SectionRail.test.tsx`
Expected: FAIL first (module missing) → after Step 2 files exist, PASS (2 tests).

- [ ] **Step 4: Write the builder client component**

```tsx
// src/components/reports/ReportBuilder.tsx
"use client";
import { useMemo, useState, useTransition } from "react";
import type { BoardPayload } from "@/lib/boards/queries";
import { type ReportConfig } from "@/lib/reports/config";
import {
  computeGroupSummaries,
  computeKpis,
  shapeReport,
} from "@/lib/reports/shape";
import { saveReport } from "@/lib/reports/actions";
import { exportReportPdf } from "@/lib/reports/actions";
import { SectionRail } from "./SectionRail";
import { PreviewPane } from "./PreviewPane";

function download(base64: string, mime: string, fileName: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportBuilder({
  reportId,
  boardId,
  initialName,
  initialConfig,
  payload,
  peopleNames,
  orgName,
}: {
  reportId: string;
  boardId: string;
  initialName: string;
  initialConfig: ReportConfig;
  payload: BoardPayload;
  peopleNames: Record<string, string>;
  orgName: string;
}) {
  const [config, setConfig] = useState(initialConfig);
  const [name] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Shaped client-side once; preview re-renders from local state (0 round-trips).
  const names = useMemo(
    () => new Map(Object.entries(peopleNames)),
    [peopleNames],
  );
  const model = useMemo(() => shapeReport(payload, names), [payload, names]);
  const kpis = useMemo(() => computeKpis(payload, names), [payload, names]);
  const summaries = useMemo(() => computeGroupSummaries(payload), [payload]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "320px 1fr",
        height: "100%",
      }}
    >
      <div
        style={{
          padding: 16,
          overflow: "auto",
          borderRight: "1px solid var(--border, #333)",
        }}
      >
        <SectionRail config={config} onChange={setConfig} />
        {/* Per-block option editors (summary/notes text, table orientation, spotlight picker)
            are added here; keep each a small controlled input writing into `config`. */}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await saveReport({
                  reportId,
                  boardId,
                  name,
                  config,
                });
                if (!res.ok) setError(res.error);
              })
            }
          >
            Save
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await exportReportPdf({ reportId, boardId });
                if (res.ok)
                  download(res.data.base64, res.data.mime, res.data.fileName);
                else setError(res.error);
              })
            }
          >
            Export PDF
          </button>
        </div>
        {error ? (
          <p role="alert" style={{ color: "#e5484d" }}>
            {error}
          </p>
        ) : null}
      </div>
      <div style={{ height: "100%" }}>
        <PreviewPane
          config={config}
          model={model}
          kpis={kpis}
          groupSummaries={summaries}
          boardName={payload.board.name}
          orgName={orgName}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write the builder page (RSC shell)**

```tsx
// src/app/(app)/boards/[boardId]/reports/[reportId]/page.tsx
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getBoardPayload } from "@/lib/boards/queries";
import { resolvePeopleNames } from "@/lib/boards/people-names";
import { getActiveOrgId } from "@/lib/org/active";
import { getReport } from "@/lib/reports/queries";
import { ReportBuilder } from "@/components/reports/ReportBuilder";

export default async function ReportBuilderPage({
  params,
}: {
  params: Promise<{ boardId: string; reportId: string }>;
}) {
  const { boardId, reportId } = await params;
  await requireUser();
  const [payload, report] = await Promise.all([
    getBoardPayload(boardId),
    getReport(reportId),
  ]);
  if (!payload || !report || report.boardId !== boardId) notFound();
  const peopleNames = Object.fromEntries(await resolvePeopleNames(payload));
  // Org display name: reuse existing org query if available; fall back to id.
  const orgName = await getActiveOrgId();
  return (
    <div style={{ height: "100dvh" }}>
      <ReportBuilder
        reportId={report.id}
        boardId={boardId}
        initialName={report.name}
        initialConfig={report.config}
        payload={payload}
        peopleNames={peopleNames}
        orgName={orgName}
      />
    </div>
  );
}
```

> The `exportReportPdf` action is implemented in Task 8; import compiles now because it's declared in `actions.ts` (add a stub returning `fail("not implemented")` in Task 4's file if executing tasks strictly in order, then fill it in Task 8). During subagent-driven execution, run Task 8 immediately after this task.

- [ ] **Step 6: Verify build & tests**

Run: `pnpm typecheck && pnpm vitest run src/components/reports`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/reports/ src/app/(app)/boards/[boardId]/reports/[reportId]/page.tsx
git commit -m "feat(reports): two-pane report builder with live iframe preview"
```

---

## Task 8: Export action (server render → PDF bytes)

**Files:**

- Modify: `src/lib/reports/actions.ts` (add `exportReportPdf`)
- Test: `src/lib/reports/export.test.ts`

Depends on: Task 3 (pdf), Task 5 (shape), Task 6 (ReportDocument + CSS).

- [ ] **Step 1: Write the failing test (HTML assembly is pure & testable)**

```ts
// src/lib/reports/export.test.ts
import { describe, expect, it } from "vitest";
import { buildReportHtml } from "@/lib/reports/export-html";
import { defaultReportConfig } from "@/lib/reports/config";

describe("buildReportHtml", () => {
  it("wraps the document in a full HTML doc with the report CSS", () => {
    const html = buildReportHtml({
      config: { ...defaultReportConfig(), title: "Q3" },
      model: { columns: [], groups: [] },
      kpis: {
        itemCount: 0,
        percentComplete: 0,
        overdueCount: 0,
        statusTally: [],
      },
      groupSummaries: [],
      boardName: "B",
      orgName: "O",
    });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("--peri:#5866c4");
    expect(html).toContain("Q3");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/reports/export.test.ts`
Expected: FAIL — `@/lib/reports/export-html` missing.

- [ ] **Step 3: Write the pure HTML assembler**

```tsx
// src/lib/reports/export-html.tsx
import { renderToStaticMarkup } from "react-dom/server";
import {
  ReportDocument,
  type ReportDocumentProps,
} from "@/components/reports/ReportDocument";
import { REPORT_CSS } from "@/lib/reports/report-css";

export function buildReportHtml(props: ReportDocumentProps): string {
  const body = renderToStaticMarkup(<ReportDocument {...props} />);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${REPORT_CSS}</style></head><body>${body}</body></html>`;
}
```

- [ ] **Step 4: Add `exportReportPdf` to the actions file**

Append to `src/lib/reports/actions.ts`:

```ts
import { getBoardPayload } from "@/lib/boards/queries";
import { resolvePeopleNames } from "@/lib/boards/people-names";
import {
  computeGroupSummaries,
  computeKpis,
  shapeReport,
} from "@/lib/reports/shape";
import { buildReportHtml } from "@/lib/reports/export-html";
import { renderHtmlToPdf } from "@/lib/reports/pdf";
import { getReport } from "@/lib/reports/queries";

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").slice(0, 80) || "report";
}

export async function exportReportPdf(input: {
  reportId: string;
  boardId: string;
}): Promise<ActionResult<{ fileName: string; base64: string; mime: string }>> {
  const parsed = z
    .object({ reportId: z.string().uuid(), boardId: z.string().uuid() })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid");

  const access = await reportBoardAccess(parsed.data.boardId);
  if (!access) return fail("You don't have access to this board.");

  const [payload, report] = await Promise.all([
    getBoardPayload(parsed.data.boardId),
    getReport(parsed.data.reportId),
  ]);
  if (!payload || !report || report.boardId !== parsed.data.boardId)
    return fail("Report not found.");

  const names = await resolvePeopleNames(payload);
  const html = buildReportHtml({
    config: report.config,
    model: shapeReport(payload, names),
    kpis: computeKpis(payload, names),
    groupSummaries: computeGroupSummaries(payload),
    boardName: payload.board.name,
    orgName: payload.board.org_id,
  });

  const tableBlock = report.config.blocks.find(
    (b) => b.type === "table" && b.enabled,
  );
  const landscape =
    !tableBlock ||
    (tableBlock.type === "table" &&
      tableBlock.options.orientation === "landscape");

  const bytes = await renderHtmlToPdf(html, { landscape });
  return {
    ok: true,
    data: {
      fileName: `${sanitizeFileName(report.name)}.pdf`,
      base64: bytes.toString("base64"),
      mime: "application/pdf",
    },
  };
}
```

> `reportBoardAccess` and the `z`/`ActionResult`/`fail` imports already exist at the top of `actions.ts` from Task 4 — do not re-import.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run src/lib/reports/export.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/reports/export-html.tsx src/lib/reports/export.test.ts src/lib/reports/actions.ts
git commit -m "feat(reports): exportReportPdf action (server render -> chromium)"
```

---

## Task 9: AI-drafted narrative (summary + highlights/risks)

**Files:**

- Create: `src/lib/reports/ai-draft-schema.ts`
- Create: `src/lib/reports/ai-draft.ts`
- Create: `src/lib/reports/ai-actions.ts`
- Test: `src/lib/reports/ai-draft.test.ts`

Depends on: Task 2 (config), Task 5 (shape), existing AI gateway. Mirrors `board-actions.ts` + `board-generate.ts` + `board-gen-schema.ts` exactly.

- [ ] **Step 1: Write the schema (JSON Schema for the adapter + Zod for re-validation)**

```ts
// src/lib/reports/ai-draft-schema.ts
import { z } from "zod";

export const REPORT_NARRATIVE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "highlights", "risks"],
  properties: {
    summary: { type: "string" },
    highlights: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
  },
} as const;

export const reportNarrativeSchema = z.object({
  summary: z.string().max(8000),
  highlights: z.array(z.string().max(500)).max(20),
  risks: z.array(z.string().max(500)).max(20),
});
export type ReportNarrative = z.infer<typeof reportNarrativeSchema>;

export function validateNarrative(raw: unknown): ReportNarrative {
  return reportNarrativeSchema.parse(raw);
}
```

- [ ] **Step 2: Write the generator (adapter structured call — mirrors board-generate.ts)**

```ts
// src/lib/reports/ai-draft.ts
import type { ProviderAdapter } from "@/lib/ai/providers/types";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import type { BoardSnapshot } from "@/lib/ai/board-snapshot";
import {
  REPORT_NARRATIVE_JSON_SCHEMA,
  validateNarrative,
  type ReportNarrative,
} from "@/lib/reports/ai-draft-schema";

function systemPrompt(): string {
  return [
    "You write concise status-report narratives for a project board.",
    "Return a JSON object: `summary` (2-4 sentence executive summary),",
    "`highlights` (notable done/on-track items), `risks` (blocked/overdue items).",
    "Be factual and specific to the data. No preamble.",
  ].join("\n");
}

function userPrompt(snapshot: BoardSnapshot): string {
  return `Board: ${snapshot.board.name}\nRows: ${snapshot.rowCount}\nColumns+stats:\n${JSON.stringify(snapshot.columnStats)}`;
}

export async function draftReportNarrative(
  snapshot: BoardSnapshot,
  opts: { adapter: ProviderAdapter; apiKey: string },
): Promise<{ narrative: ReportNarrative; usage: AiUsageTokens }> {
  const { data, usage } = await opts.adapter.generateStructured<unknown>({
    apiKey: opts.apiKey,
    system: systemPrompt(),
    user: userPrompt(snapshot),
    schema: REPORT_NARRATIVE_JSON_SCHEMA,
  });
  return { narrative: validateNarrative(data), usage };
}
```

- [ ] **Step 3: Write the server action (entitlement-gated, mirrors board-actions.ts)**

```ts
// src/lib/reports/ai-actions.ts
"use server";
import { z } from "zod";
import { resolveActiveOrg } from "@/lib/org/active";
import { requireUser } from "@/lib/auth/session";
import { runAi } from "@/lib/ai/gateway";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { buildBoardSnapshot } from "@/lib/ai/board-snapshot";
import { getBoardPayload } from "@/lib/boards/queries";
import { reportBoardAccess } from "@/lib/reports/access";
import { type ActionResult, fail } from "@/lib/actions/result";
import { draftReportNarrative } from "@/lib/reports/ai-draft";
import type { ReportNarrative } from "@/lib/reports/ai-draft-schema";
import { mapAiError } from "@/lib/ai/errors"; // confirm the exact export used by board-actions.ts

export async function draftReportNarrativeAction(input: {
  boardId: string;
}): Promise<ActionResult<ReportNarrative>> {
  const parsed = z.object({ boardId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return fail("Invalid");
  const access = await reportBoardAccess(parsed.data.boardId);
  if (!access) return fail("You don't have access to this board.");
  try {
    const org = await resolveActiveOrg();
    if (!org) return fail("No organization.");
    await requireAiEntitlement(org.id, "report_narrative");
    const user = await requireUser();
    const payload = await getBoardPayload(parsed.data.boardId);
    if (!payload) return fail("Board not found.");
    const snapshot = buildBoardSnapshot({
      board: { id: payload.board.id, name: payload.board.name },
      columns: payload.columns,
      items: payload.items,
      cellValues: payload.cellValues,
    });
    const narrative = await runAi(
      { orgId: org.id, userId: user.id, feature: "report_narrative" },
      async ({ adapter, apiKey }) => {
        const { narrative, usage } = await draftReportNarrative(snapshot, {
          adapter,
          apiKey,
        });
        return { result: narrative, usage, model: adapter.defaultModel };
      },
    );
    return { ok: true, data: narrative };
  } catch (e) {
    return fail(mapAiError(e));
  }
}
```

> Confirm `mapAiError`'s import path against `board-actions.ts` (it maps `AiDisabledError`/`AiQuotaExceededError` to friendly strings). The graceful-fallback UX (Task 9 Step 5) relies on this returning a clear message when `ai_mode` is off.

- [ ] **Step 4: Write the unit test (mocked adapter)**

```ts
// src/lib/reports/ai-draft.test.ts
import { describe, expect, it, vi } from "vitest";
import { draftReportNarrative } from "@/lib/reports/ai-draft";
import type { BoardSnapshot } from "@/lib/ai/board-snapshot";

const snapshot: BoardSnapshot = {
  board: { id: "b1", name: "Board" },
  rowCount: 2,
  columns: [],
  columnStats: {},
  meta: { rowCount: 2, columnCount: 0, estimatedTokens: 10 },
};

describe("draftReportNarrative", () => {
  it("calls generateStructured and re-validates the result", async () => {
    const generateStructured = vi.fn(async () => ({
      data: { summary: "All good.", highlights: ["Shipped X"], risks: [] },
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    const adapter = { generateStructured } as never;
    const { narrative } = await draftReportNarrative(snapshot, {
      adapter,
      apiKey: "k",
    });
    expect(narrative.summary).toBe("All good.");
    expect(generateStructured).toHaveBeenCalledOnce();
  });

  it("throws when the model returns a malformed object", async () => {
    const adapter = {
      generateStructured: async () => ({
        data: { summary: 123 },
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    } as never;
    await expect(
      draftReportNarrative(snapshot, { adapter, apiKey: "k" }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 5: Wire "Draft with AI" into the builder with graceful fallback**

In `src/components/reports/ReportBuilder.tsx`, add a summary-block option editor with a "Draft with AI" button that calls `draftReportNarrativeAction({ boardId })`. On success, write `data.summary` into the summary block's `options.text` (set `aiGenerated: true`) and seed the spotlight block's suggested items from any highlights/risks that match item names. On failure, surface `res.error` and leave the plain editable textarea usable. **The summary/notes textareas must be fully functional with no AI**, so an `ai_mode: off` org still gets a complete manual builder.

```tsx
// inside ReportBuilder.tsx — sketch of the handler (add near the other transitions)
const [aiError, setAiError] = useState<string | null>(null);
function draftWithAi() {
  start(async () => {
    setAiError(null);
    const res = await draftReportNarrativeAction({ boardId });
    if (!res.ok) {
      setAiError(res.error);
      return;
    }
    setConfig((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) =>
        b.type === "summary"
          ? {
              ...b,
              options: {
                ...b.options,
                text: res.data.summary,
                aiGenerated: true,
              },
            }
          : b,
      ),
    }));
  });
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm vitest run src/lib/reports/ai-draft.test.ts && pnpm typecheck`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/reports/ai-draft-schema.ts src/lib/reports/ai-draft.ts src/lib/reports/ai-actions.ts src/lib/reports/ai-draft.test.ts src/components/reports/ReportBuilder.tsx
git commit -m "feat(reports): AI-drafted narrative with entitlement gating + manual fallback"
```

---

## Task 10: Entry point, reports list, and full verification

**Files:**

- Create: `src/app/(app)/boards/[boardId]/reports/page.tsx`
- Modify: `src/components/boards/BoardHeader.tsx`
- Test: manual acceptance + full gate run

Depends on: all prior tasks.

- [ ] **Step 1: Write the reports list page**

```tsx
// src/app/(app)/boards/[boardId]/reports/page.tsx
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listReports } from "@/lib/reports/queries";
import { CreateReportButton } from "@/components/reports/CreateReportButton";

export default async function ReportsListPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;
  await requireUser();
  const reports = await listReports(boardId);
  return (
    <div style={{ padding: 24 }}>
      <h1>Reports</h1>
      <CreateReportButton boardId={boardId} />
      <ul>
        {reports.map((r) => (
          <li key={r.id}>
            <Link href={`/boards/${boardId}/reports/${r.id}`}>{r.name}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Write the `CreateReportButton` client component**

```tsx
// src/components/reports/CreateReportButton.tsx
"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { createReport } from "@/lib/reports/actions";

export function CreateReportButton({ boardId }: { boardId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await createReport({ boardId, name: "Status Report" });
          if (res.ok) router.push(`/boards/${boardId}/reports/${res.data.id}`);
        })
      }
    >
      New report
    </button>
  );
}
```

- [ ] **Step 3: Add the "Report" action to the board header**

In `src/components/boards/BoardHeader.tsx`, add a link/button (match the existing header control styling — **load the `pulse-ui` skill**) to `/boards/${boardId}/reports`. Place it beside the existing Export menu control.

- [ ] **Step 4: Run the full gate suite**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS. Fix any failures before proceeding.

- [ ] **Step 5: Manual acceptance (the spec's "How to test")**

Run the dev server and walk the spec's manual test steps: header → Report → New → toggle/reorder blocks (confirm the preview updates with **no network request** in devtools) → Draft with AI (and the AI-off fallback) → Save → reload persists → Export PDF opens a valid PDF with cover/table/KPIs/etc. Confirm a non-member cannot open the board's reports.

- [ ] **Step 6: Commit**

```bash
git add src/app/(app)/boards/[boardId]/reports/page.tsx src/components/reports/CreateReportButton.tsx src/components/boards/BoardHeader.tsx
git commit -m "feat(reports): reports list + board-header entry point"
```

- [ ] **Step 7: Finish the task (merge to develop + cleanup)**

Run: `scripts/finish-task.sh`
Expected: rebases onto develop, runs all four gates against the merged state, merges `task/board-pdf-reports` into `develop`, removes the worktree, deletes the branch. Then hand the user the "How to test this" walkthrough (spec's manual steps).

---

## Self-Review

**Spec coverage:**

- Report Builder (configurable, saved per board) → Tasks 1, 4, 7. ✅
- 8 blocks / no charts → Task 6 (all eight components; no chart block exists). ✅
- Editorial visual direction → Task 6 CSS (centered cover, thin accent line, whitespace). ✅
- Landscape/all-columns default + curated toggle + overflow note → Task 6 `TableBlock` + config `tableOptions`. ✅
- Record cards for Spotlight → Task 6 `SpotlightBlock`. ✅
- One render surface (preview + PDF) → Task 6 `ReportDocument`, Task 7 `PreviewPane`, Task 8 `buildReportHtml`. ✅
- Server headless Chromium, render-to-string not navigate → Tasks 3, 8. ✅
- `window.print()` fallback documented → Task 3 Step 5. ✅
- AI whole-report aware (summary + highlights/risks), entitlement-gated, manual fallback → Task 9. ✅
- `reports` table, RLS, indexed `(org_id, board_id)` → Task 1. ✅
- Perf budget (in-page toggles = 0 round-trips) → Task 7 `PreviewPane` (client render), Task 5 isomorphic shaping. ✅
- Execution DAG batches → mirrored in Task numbering + dependencies below. ✅
- Testing (config, shape, actions integration, AI mocked, PDF smoke, block render) → Tasks 2,5,4,9,3,6. ✅

**Placeholder scan:** The only deferred detail is the per-block option editors' exact inputs in Task 7 (marked as a sketch) and the integration-test happy path (Task 4) — both are bounded, explicitly scoped, and reference the real API/fixtures; no `TBD`/`handle edge cases` hand-waving in code steps.

**Type consistency:** `ReportConfig`/`ReportBlock` (Task 2) used consistently in Tasks 4/6/7/8; `ReportModel`/`Kpis`/`GroupSummary` (Task 5) used in Tasks 6/7/8; `ReportNarrative` (Task 9) used in its action + test; `ActionResult`/`fail`/`{ ok: true, data }` shape consistent with `result.ts`; `renderHtmlToPdf(html, { landscape })` signature matches between Tasks 3 and 8.

## Execution DAG

- **Batch 1 (parallel):** Task 1 ∥ Task 2 ∥ Task 3 ∥ Task 5
- **Batch 2 (parallel):** Task 4 (needs 1,2) ∥ Task 6 (needs 2,5)
- **Batch 3 (parallel):** Task 7 (needs 4,6) ∥ Task 8 (needs 3,5,6) ∥ Task 9 (needs 2,5)
- **Batch 4:** Task 10 (needs all)
- **Critical path:** (1/2) → 6 → 7 → 10.

> Task 0 (worktree) and Task 10 Step 7 (finish-task) bracket the batches. When dispatching a batch's tasks to parallel agents that mutate files, keep them in the single shared worktree (they touch disjoint files per the File Structure table); no per-task worktrees needed since the file sets don't overlap within a batch.
