# Board PDF Report Builder — Design

**Date:** 2026-07-16
**Status:** Approved (brainstorm) — ready for implementation plan
**Author:** Dani (with Claude)

## Summary

A dedicated, per-board feature that lets a user compose a **saved, reusable report
configuration** and export it as a polished **PDF**. The report is a light, print-first
document (white paper, Pulse periwinkle accent) in an **Editorial** visual direction. The
board **table renders landscape / all-columns by default**, and the executive summary +
highlights are **AI-assisted**.

This is deliberately built as a **separate "Report Builder" feature**, not a one-click export,
because the reports serve two audiences at once — **client-facing deliverables** (polish
matters) and **internal status snapshots** (substance/completeness matters).

## Goals

- Compose a report from a palette of blocks, reorder them, preview live, export to PDF.
- Save the configuration **per board** so the same report can be regenerated (e.g. weekly).
- Reuse existing infrastructure: `getBoardPayload`, the AI gateway, the export-download UX.
- Faithful, premium output that matches the app's design language.

## Non-goals (explicit v1 scope line)

- **Single board per report.** Multi-board / workspace roll-ups → v2.
- **Charts** (donut/bars) → v2. KPIs (plain formatted numbers) cover the at-a-glance need.
- **Org-level reusable templates** (decoupled from a board) → v2. v1 saves configs per board.
- No scheduled/emailed delivery in v1 (the data model does not preclude it later).

## Audience & scope decisions (from brainstorm)

| Decision         | Choice                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Audience         | Client-facing deliverable **+** internal status snapshot                                                                     |
| Ambition         | **Report Builder** (configurable sections, saved) — not a one-click export                                                   |
| Data scope       | **Single board** per report (v1)                                                                                             |
| Blocks (v1)      | Cover · Executive summary · KPIs · Board table · Group summaries · Item spotlight · Notes · Appendix. **No charts.**         |
| Exec summary     | **AI-drafted, whole-report aware** (also seeds spotlight highlights/risks), user-editable; graceful fallback to manual       |
| Persistence      | **Saved report configs per board** (new `reports` table)                                                                     |
| Visual direction | **A · Editorial** (whitespace, thin accent line, centered cover, understated group headings)                                 |
| Table rendering  | **Landscape / all-columns default** + overflow policy; curated-columns as optional toggle; record cards reused for Spotlight |
| PDF engine       | **Server-side headless Chromium** (`playwright-core` + `@sparticuz/chromium`)                                                |

## UX & entry point

- **Entry:** a **"Report"** action in the board header, alongside the existing Export menu
  (`src/components/boards/ExportMenu.tsx` sits in the same toolbar area).
- **Routes** (App Router, under the existing `(app)` group):
  - `/boards/[boardId]/reports` — list of saved reports for the board (new · open · duplicate).
  - `/boards/[boardId]/reports/[reportId]` — the **two-pane builder**:
    - **Left rail:** section list — toggle each block on/off, drag to reorder, expand a block
      to edit its options (title/branding, curated columns, landscape on/off, notes text,
      spotlight item picker, "Draft with AI" for the summary).
    - **Right pane:** **live print preview** — the print report route rendered in an `<iframe>`,
      re-rendered from local builder state (no server round-trip).
- **Export:** an "Export PDF" button runs a server action that returns
  `{ base64, mime, fileName }` and triggers a client blob download — **identical UX to the
  existing xlsx/csv export** (`ExportMenu` pattern: `atob` → `Blob` → `<a download>`).

## The one-render-surface principle

There is exactly **one** print-styled React surface that renders a report from its config
object. It is the source of truth for **both** the live preview **and** the generated PDF, so
the two can never drift.

- **Print route:** `src/app/(app)/boards/[boardId]/reports/[reportId]/print/page.tsx`
  (server component). It calls `requireUser()`, `getBoardPayload(boardId)`, resolves people
  names, loads the saved `reports` row, and renders the ordered blocks from `config`. It ships
  print CSS (`@page` size/orientation, page-break rules, white background) and is visually
  self-contained (no app chrome).
- **Preview** embeds this route in an iframe within the builder.
- **PDF** is produced from the **server-rendered HTML string** of this same surface (see engine).

## Blocks (v1)

All blocks are optional and orderable. Each is a focused, independently testable component
under `src/components/reports/blocks/`.

1. **Cover** — report title, board name, org logo, date/date-range, "prepared for / by".
   Editorial cover: centered, thin periwinkle accent line.
2. **Executive summary** — a narrative paragraph. **AI-drafted & editable** (see AI section);
   falls back to a plain editable text field when AI is unavailable.
3. **KPIs** — headline numbers derived from the board: item count, % complete, overdue count,
   per-status tallies. Plain formatted figures (no chart dependency).
4. **Board table** — the core data: groups → items → columns.
   - **Default:** landscape orientation, all columns.
   - **Overflow policy** (when columns exceed page width even in landscape): fit-to-width →
     shrink type to a floor → **continuation** (remaining columns on a following page section).
     Documented, deterministic, no clipping.
   - **Curated-columns toggle:** user selects a subset; portrait becomes viable.
   - Reuses the group/item/subitem walking + column ordering + per-kind value formatting logic
     already in `src/lib/boards/spreadsheet/export-workbook.ts` and
     `src/lib/boards/spreadsheet/cell-codec.ts` (extract the shared shaping so both consumers use it).
5. **Group summaries** — per-group rollups: count, % complete, sums of number/currency columns.
6. **Item spotlight** — hand-picked items rendered as **record cards** (label → value), good for
   highlights/risks. AI can pre-select candidates (see AI section).
7. **Notes / commentary** — free-text blocks the user writes in the builder.
8. **Appendix** — full data listing + attachments/links index (the completeness/archival case).

## Data model

New migration (minted via `scripts/new-migration.sh`, applied to DEV via the `supabase-dev`
MCP with the **same version+name**, types regenerated with `pnpm db:types`, all in one PR):

```sql
create table reports (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  board_id    uuid not null references boards(id) on delete cascade,
  name        text not null,
  config      jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index reports_org_board_idx on reports (org_id, board_id);
```

- **`org_id` denormalized** on the row (matches every other board table) → single-check RLS via
  `is_org_member(org_id)`. Board-level access enforced on top via the existing
  `deriveBoardAccess`/`board_members` pattern in the actions layer.
- **`config` JSONB** is validated by a Zod schema at the boundary (never trusted raw). Shape:
  `{ title, branding, sections: OrderedBlock[], ... }` where each `OrderedBlock` carries its
  type, enabled flag, and per-block options. Schema versioned with a `v` field for forward-compat.

## Architecture / new code

- **`src/lib/reports/config.ts`** — Zod schema + TS types for the report config (the contract
  shared by builder, print route, and actions). No `any`.
- **`src/lib/reports/queries.ts`** — `getReport(reportId)`, `listReports(boardId)`
  (RLS-scoped, `React.cache`-wrapped, bounded).
- **`src/lib/reports/actions.ts`** — server actions returning canonical `ActionResult`/`fail`
  (`src/lib/actions/result.ts`): `createReport`, `saveReport`, `deleteReport`, `exportReportPdf`.
- **`src/lib/reports/pdf.ts`** — the PDF engine helper (headless Chromium; see below).
- **`src/lib/reports/ai-draft.ts`** — AI narrative generation (see AI section).
- **`src/lib/reports/shape.ts`** — extract the group→item→cell shaping currently embedded in
  `export-workbook.ts` so both the spreadsheet exporter and the report blocks consume one
  ordering/formatting source (avoids a second, drifting copy).
- **`src/components/reports/`** — `ReportBuilder` (client), `SectionRail`, per-block config
  panels, `PreviewPane` (iframe), and `blocks/` (the print-render components).
- **Print route** — as described in "one render surface".

## PDF engine (server-side headless Chromium)

- `exportReportPdf(reportId)` server action:
  1. Authorize (org + board access), load report + board payload.
  2. **Render the report blocks to a self-contained HTML string server-side** (React →
     static markup + inlined print CSS).
  3. Launch `playwright-core` with `@sparticuz/chromium`, `page.setContent(html)`,
     `page.pdf({ landscape, printBackground, format: 'A4', margin })`.
  4. Return `{ base64, mime: 'application/pdf', fileName }`; client downloads via the existing
     blob pattern.
- **Why render-to-string, not navigate:** driving headless Chromium to the authenticated print
  _route_ would require piping the user's Supabase auth cookies into the browser context — a
  known source of pain. Rendering the HTML string in the already-authenticated server action and
  `setContent`-ing it sidesteps auth entirely. **The same HTML builder feeds both the string (PDF)
  and the iframe (preview).**

### Primary technical risk (de-risked first)

**`@sparticuz/chromium` on Vercel serverless** — bundle size and cold-start behavior under Fluid
Compute. This is isolated as a **standalone spike (T3) in Batch 1**, before anything depends on it.
**Documented fallback:** if the spike shows Chromium is unworkable in our deploy, fall back to
**browser-native `window.print()`** on the print route (zero server PDF infra, perfect fidelity,
loses server-side artifact/consistent filenames). The one-render-surface design means this
fallback costs only the engine layer, not a redesign.

## AI-assisted narrative

Reuses existing infra — no new AI plumbing:

- `src/lib/reports/ai-draft.ts` → `draftReportNarrative(boardSnapshot)` returns
  `{ summary: string, highlights: ItemRef[], risks: ItemRef[] }`.
- Context via `src/lib/ai/board-snapshot.ts`; execution via `src/lib/ai/gateway.ts` `runAi`
  (respects org `ai_mode`: off / managed / BYO-key); cost through existing metering
  (`src/lib/ai/pricing.ts`) and entitlement gating (`src/lib/ai/entitlement.ts`).
- **Graceful degradation:** when `ai_mode` is off / unentitled, the "Draft with AI" affordance
  is hidden/disabled and the summary + spotlight fall back to fully manual. The feature must be
  **fully usable without AI**.
- Output is always **user-editable** before export — AI drafts, human approves.

## Data flow & performance budget (working agreement #5)

- **First paint (builder):** loads the saved report `config` + `getBoardPayload(boardId)`
  **once**, server-side. `getBoardPayload` is already RLS-scoped and **bounded** (items ≤ 5000,
  cells ≤ 20000) over indexed columns; `reports` reads hit the `(org_id, board_id)` index.
- **In-page interactions** (toggle a block, reorder, edit title/notes, flip landscape, pick
  spotlight items): **pure client state → 0 server round-trips.** The preview iframe re-renders
  from local builder state. No `<Link>`/router navigation, no RSC refetch. (Builder state is
  local component/Zustand state, not URL-driven, so the History API is not needed here.)
- **Server actions only for real mutations:** `saveReport` (persist config + targeted
  revalidate), `draftReportNarrative` (AI), `exportReportPdf` (bytes).
- No unbounded `select *` on growing tables anywhere in the feature.

## Execution DAG (working agreement #6)

**Interfaces / dependency edges:**

- **T1 — Migration + `reports` table + regenerated types.** Produces: table, RLS, types.
- **T2 — Report config Zod schema + TS types** (`src/lib/reports/config.ts`). Produces: the
  config contract. Consumes: nothing.
- **T3 — PDF-engine spike** (`playwright-core` + `@sparticuz/chromium` render-to-PDF helper,
  isolated; validates Vercel viability). Produces: `pdf.ts` render helper + go/no-go.
- **T4 — Reports queries + `create/save/delete/list` actions.** Consumes: T1, T2. Produces:
  data layer.
- **T5 — Print route + block components + shared shaping (`shape.ts`).** Consumes: T2. Produces:
  the one render surface (HTML for both preview and PDF).
- **T6 — Builder two-pane UI + preview pane.** Consumes: T2, T5. Produces: builder.
- **T7 — `exportReportPdf` wiring** (string-render → engine → download). Consumes: T3, T5.
- **T8 — AI draft module** (`ai-draft.ts`). Consumes: T2, `board-snapshot`. Produces: narrative.
- **T9 — Entry point + board header / Export menu integration.** Consumes: T6.
- **T10 — End-to-end tests + polish.** Consumes: all.

**Parallel batches (waves of concurrent agents):**

- **Batch 1:** T1 ∥ T2 ∥ T3 _(spike de-risked before dependents)_
- **Batch 2:** T4 ∥ T5
- **Batch 3:** T6 ∥ T7 ∥ T8
- **Batch 4:** T9 → T10

**Critical path (wall-clock floor):** T1/T2 → T5 → T6 → T9 → T10.

## Testing (mandatory)

- **Config schema** — Zod parse/validate unit tests (valid/invalid/versioning).
- **Report actions** — create/save/list/delete integration tests, org + board-access scoping;
  DB-touching suites `PULSE_TEST_DB`-gated (run in a rolled-back txn on DEV per repo policy).
- **AI draft** — unit test with a **mocked gateway** (deterministic), plus the off/unentitled
  fallback path.
- **Block rendering** — unit tests per block (empty board, wide board overflow, subitems).
- **PDF render smoke** — the engine produces non-empty `application/pdf` bytes from a fixture
  report (skipped in CI if Chromium unavailable; run in the spike + locally).
- All four gates green before "done": `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## New dependencies

- `playwright-core` + `@sparticuz/chromium` (runtime PDF generation). No charting lib (charts
  cut from v1). `pdfjs-dist` already present is a _reader_, not relevant here.

## How to test (manual acceptance, post-merge)

1. Pull `develop`; open a board with several groups/items and a few column kinds.
2. Board header → **Report** → **New report**.
3. Toggle blocks on/off, drag to reorder; confirm the **right-hand preview updates instantly**
   with no page reload / network request.
4. On the Executive summary block, click **Draft with AI** (AI-enabled org) → a summary appears
   and is editable; on an AI-off org, confirm the block is plainly editable with no AI button.
5. Click **Save**, reload the page → the configuration persists.
6. Click **Export PDF** → a PDF downloads; open it and verify: Editorial cover, landscape board
   table with all columns (or curated if toggled), KPIs, group summaries, spotlight cards, notes.
7. Confirm RLS: a user without access to the board cannot open its reports.

## Open questions for the plan

- Exact `config` JSONB shape + per-block option schemas (settle in `writing-plans`).
- Overflow-policy thresholds (columns-per-page, type-size floor) — tune against real boards.
- Whether `shape.ts` extraction is done as a pre-refactor of `export-workbook.ts` or a parallel
  module (lean: extract once, both consume).
