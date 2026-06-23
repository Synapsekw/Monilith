# AI Dashboard Generation — Design Spec

**Date:** 2026-06-23
**Slug:** `ai-dashboard-gen`
**Status:** Approved (design); pending implementation plan

## Summary

Add an AI layer on top of the existing dashboards feature. From the Dashboards
area, a user picks one board, reviews and approves a compact summary of that
board's structure, and the AI (Anthropic **Opus 4.8**, `claude-opus-4-8`)
proposes a complete dashboard — a set of widgets (number / chart / battery /
list) with sensible grid layout. The proposal renders as a **read-only preview
with real data**; the user accepts it to materialize a brand-new dashboard, or
regenerates.

The model designs **structure only** (which columns to chart, chart type,
measure, layout). It never computes the numbers — the existing
`dashboard_series` / `dashboard_aggregate` / `dashboard_list_rows` RPCs do that
server-side at render time against the live database.

## Locked decisions

| Decision                 | Choice                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Data sent to the LLM** | Board **schema + aggregate stats only** — column names/kinds, status & dropdown option labels, row count, per-column fill rate, cardinality, numeric min/max/avg, date range. **No raw cell values ever leave the workspace.** |
| **Apply flow**           | Generate → **read-only preview with real data** → "Create dashboard" (brand-new) or "Regenerate". Non-destructive.                                                                                                             |
| **Board scope**          | **One board** per generation.                                                                                                                                                                                                  |
| **Entry point**          | "Generate with AI" in the **Dashboards area**, next to "New dashboard".                                                                                                                                                        |
| **Approval UX**          | **Summary + single confirm** — board name, row count, column list, estimated payload size, one "Generate" confirm. No per-column opt-out (none is needed — no cell values are sent).                                           |
| **Model**                | `claude-opus-4-8` via the official `@anthropic-ai/sdk`, server-only `ANTHROPIC_API_KEY`, adaptive thinking, structured output re-validated with existing Zod widget schemas.                                                   |

> Note: the brief asked for "Sonnet 4.7", which does not exist. The user selected
> Opus 4.8. The model is a single constant (`src/lib/ai/anthropic.ts`), trivially
> changed later.

## Why schema + stats (not raw cell values)

The LLM picks _which_ widgets to build; the database computes _what they show_.
Column **names** carry most of the semantics ("Priority", "Owner", "Budget",
"Due date"); option labels and summary stats supply the rest (don't suggest a pie
chart over a 50-value column; don't chart a 95%-empty column). Raw cell values
add token cost and privacy exposure with almost no design benefit. Net effect:
tiny payloads, a reassuring approval screen ("no cell contents leave your
workspace"), cheaper/faster generations, and no need for row-capping/truncation.

## Architecture

New module `src/lib/ai/` (no AI infra exists today — clean slate).

### 1. `src/lib/ai/anthropic.ts`

Server-only Anthropic client factory. `export const MODEL = "claude-opus-4-8"`.
Reads `ANTHROPIC_API_KEY`; if missing, throws a typed `AiNotConfiguredError`
that actions translate into a clean `{ ok: false, error }`.

### 2. `src/lib/ai/board-snapshot.ts`

Pure function: board id + raw board data → `BoardSnapshot`:

- `board`: `{ id, name }`
- `columns`: `[{ id, name, kind, options?: [{ id, label }] }]` (options for
  status/dropdown only)
- `rowCount`: number of items
- `columnStats`: per column — `fillRate` (0–1), `distinctCount`, and kind-specific
  summaries: status/dropdown → `{ optionId/label, count }[]`; numbers →
  `{ min, max, avg, sum }`; date → `{ earliest, latest }`; people →
  `distinctAssignees`; text → `fillRate` only.
- Metadata: `{ rowCount, columnCount, estimatedTokens }`.

**No individual cell values.** Stats are aggregates only. Item cap is irrelevant
because we never serialize per-row data; stats are computed over all rows
server-side.

### 3. `src/lib/ai/proposal.ts`

The prompt + the call + validation/repair.

- **System prompt** teaches the model the exact widget vocabulary: the four
  widget kinds and their configs (chart types; `primary`/`series` dimensions of
  kind status/dropdown/people/date; `measure` count/sum/avg + value column;
  number agg + display; battery group column; list columns/limit/filter), the
  12-column grid, and design heuristics (lead with a headline number, pick chart
  types appropriate to cardinality, prefer count unless a numbers column makes
  sum/avg meaningful, etc.). This prefix is **prompt-cached** (stable across
  generations).
- **User content**: the `BoardSnapshot` (volatile, after the cache breakpoint).
- **Structured output**: requests a `DashboardProposal`:
  `{ name: string, widgets: [{ kind, title, config, layout: { x, y, w, h } }] }`.
- **Re-validation + repair** (`validateProposal`): every widget's `config` is
  parsed with the existing `chartConfigSchema` / `numberConfigSchema` /
  `batteryConfigSchema` / `listConfigSchema`; referential checks confirm every
  `columnId` exists in the snapshot, dimension kinds match the referenced
  column's kind, and `measure.valueColumnId` (sum/avg) points to a `numbers`
  column. Invalid widgets are dropped; if a widget is salvageable it's repaired
  (e.g., coerce agg→count when value column is missing). Layout is **auto-packed**
  (`packLayout`) if the model overlaps rects or omits them.

### 4. Server Actions — extend `src/lib/dashboards/actions.ts` conventions

All `"use server"`, Zod-validated, `ActionResult<T>` discriminated union, RLS via
the server Supabase client.

- `getBoardSnapshotSummary(boardId)` → `{ boardName, rowCount, columns: [{name,kind}], estimatedTokens }` for the approval screen. **No LLM call.**
- `generateDashboardProposal({ boardId, feedback? })` → builds snapshot, calls
  Opus, validates/repairs, returns `{ proposal }` (not persisted). Blocks on
  empty board / no chartable columns before calling the LLM.
- `previewWidgetData({ boardId, config })` → runs the existing
  `dashboard_series` / `dashboard_aggregate` / `dashboard_list_rows` RPCs for an
  **unsaved** config so the preview shows live data (the RPCs already take
  board + config params, not a stored widget id).
- `createDashboardFromProposal({ workspaceId, name, widgets })` → creates the
  dashboard and each widget via the existing `create_dashboard_widget` RPC,
  returns `{ dashboardId }`; `revalidatePath("/dashboards")`.

### 5. UI — `src/components/dashboards/ai/` (follows `pulse-ui`)

A client wizard driven entirely by **client state + History API** — step
transitions are **0 RSC navigations**.

- `GenerateWithAiButton` — entry alongside "New dashboard"; lazy-loads the wizard.
- `AiDashboardWizard` — steps: **board-pick → approval → generating → preview**.
- `AiProposalPreview` — renders proposed widgets read-only via `previewWidgetData`,
  with "Create dashboard" / "Regenerate" / "Cancel".

## Data flow

1. Wizard opens → loads workspace boards (one fetch).
2. Board selected → `getBoardSnapshotSummary` → approval screen.
3. Confirm → `generateDashboardProposal` → validated proposal (not persisted).
4. Preview → `previewWidgetData` per widget → live charts/cards/lists.
5. "Create dashboard" → `createDashboardFromProposal` → route to new dashboard.
   "Regenerate" re-runs step 3 (optional feedback note).

## Error handling

- **No API key** → `{ ok: false, error: "AI generation isn't configured." }`;
  button shows an explainer/disabled state, never crashes.
- **Empty board / no chartable columns** → blocked pre-LLM with a clear message.
- **LLM / network / rate-limit** (typed SDK exceptions) → friendly message + retry.
- **Invalid/empty proposal** after validation → drop bad widgets; if none remain,
  "Couldn't generate a good layout — try regenerating."
- AI actions are **server-only**; `ANTHROPIC_API_KEY` never reaches the browser.

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint** of `/dashboards`: unchanged — static button, lazy wizard.
- **In-page interactions** (wizard steps, approval, preview): **0 RSC
  navigations** — client state + History API only.
- **Server round-trips only on explicit actions**: boards list (once), snapshot
  summary (on board pick), generate (LLM), preview data (per widget; bounded by
  the existing RPC limits 12–100), create. None are view toggles.
- **Bounded/indexed**: snapshot stats aggregate server-side over the indexed
  `board_id`; preview reuses already-bounded dashboard RPCs.

## Testing (TDD — written and executed)

- **Pure units**: `board-snapshot` (column resolution, stats, empty board);
  `validateProposal` (drops invalid widgets, referential integrity, kind/measure
  matching, repair); `packLayout`.
- **Server actions**: Anthropic client injected/mocked — **no real API calls in
  tests**; assert payload shape, mapping, and that create calls the right RPC.
  Supabase mocked.
- **RLS integration**: snapshot read and `createDashboardFromProposal` are
  org-scoped (reuse `*.rls.integration.test.ts` pattern).
- **Component**: wizard step gating (no generate before approval), preview render,
  error/empty states (Vitest + jsdom, matching existing `*.test.tsx`).

## Out of scope (YAGNI)

- Multi-board generation, appending to existing dashboards, per-column opt-out,
  streaming token-by-token UI, editing the proposal inline before create
  (the created dashboard is fully editable with existing tools), persisting
  generation history.

## Env / ops

- `ANTHROPIC_API_KEY` (server-only) — already added locally; add to Vercel
  Production + Preview before deploy. Document the name in `.env.example`.
