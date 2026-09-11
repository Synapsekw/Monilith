# Board Intelligence — Phase 2 (Advise) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every board an on-demand, per-user Intelligence brief with up to five concrete suggestions that can be applied with one click and undone for eight seconds, served from a per-(board, user) cache and reached from a "Catch me up" pill on the strip and an Intelligence tab in the board dock.

**Architecture:** A Server Action assembles a bounded input (board snapshot + server-side recompute of the Phase 1 signals + a 7-day board transcript + the member roster), runs it through the AI gateway under the new `board_intelligence` feature key, validates the structured output with Zod against the board's real items, columns, options and members, and caches the result in a new `board_intelligence_runs` row keyed by an input hash. Applying a suggestion runs its cell writes as ONE transaction through a new SECURITY INVOKER RPC that captures before-values and stamps `item_activities.source = 'intelligence'` via a transaction-local setting; Undo replays the before-values through the same RPC. The dock gains a Chat | Intelligence tab pair; a small Zustand store bridges the strip (inside the intelligence provider) and the dock (its sibling) without hoisting providers.

**Tech Stack:** Next.js 16 App Router (Server Actions, RSC), Supabase Postgres + RLS + plpgsql RPC, Zod, Zustand, TanStack board cache, Vitest + Testing Library, sonner toasts, Tailwind v4 with pulse-ui tokens.

## Global Constraints

- The label is **Intelligence** everywhere. Never "Pulse", never "AI" in user-facing copy (owner ruling, memory `no-pulse-naming-in-ui`).
- pulse-ui tokens only: monochrome chrome, single periwinkle accent, colour only on status. No AI badge, no glow, no sparkle icon (decision 27). Load the `pulse-ui` and `frontend-design` skills before any UI task.
- Next.js 16: confirm every framework API against `node_modules/next/dist/docs/` before use. No `router.refresh`, no `<Link>`/`router` navigation for in-page state (gotcha-09).
- Within-board mutations never call `revalidatePath` (rule at `src/lib/boards/actions/group.ts:26-36`); they return authoritative rows as `BoardEffect[]` and the client folds them with `useApplyBoardEffects()`.
- Server Actions return `ActionResult<T>` / `fail()` from `src/lib/actions/result.ts`; RPC calls go through `typedRpc` from `src/lib/supabase/typed-rpc.ts`. Never re-declare these.
- Migrations are minted ONLY with `scripts/new-migration.sh <slug>`, applied to DEV by the **orchestrator** via the `supabase-dev` MCP `apply_migration` with the same `<version>_<slug>` name, then `pnpm db:ledger-check` (reconcile a drifted label with `scripts/reconcile-migration-version.sh`). Types are regenerated with the `supabase-dev` MCP `generate_typescript_types` piped through `prettier --parser typescript` into `src/types/database.types.ts` (in a worktree `pnpm db:types` fails — memory `worktree-db-types-fails-use-mcp`).
- The DEV database holds live user data. No destructive experiments. Integration suites run only under `PULSE_TEST_DB=1` against a scratch project.
- Run every gate in the **foreground** (`pnpm typecheck && pnpm lint && pnpm test`), never as a background task. `pnpm build` is run by `finish-task.sh` at the end.
- Model wire id: always pass `model.requestModel` to the provider; `runAi` meters `model.model` itself.
- Model output is untrusted: only the closed `Action` union is applied, every id is re-checked against the board at apply time, and every untrusted string that reaches a prompt goes through `sanitizeInline`.
- Commit identity `Danijel Jovanovic <info@synapse-solutions.ai>`; stage by path only; Conventional Commits.

## Spec references

- Design spec: `docs/superpowers/specs/2026-09-11-board-intelligence-design.md` — §2.1 (strip Phase-2 pieces), §2.2 (dock tab), §4 (run), §7 (data model), §8 (perf budget), §10 (tests).
- Phase 1 plan (shipped): `docs/superpowers/plans/2026-09-11-board-intelligence-phase-1-orient.md` — its "Deviations from the spec text" section is authoritative over the spec where they disagree.
- Phase 1 session note: `vault/sessions/2026-09-11-1757-board-intelligence-phase1-orient.md` (open threads, parked residuals).

## Deviations from the spec text (decided at plan time — the code follows THIS list)

1. **Apply does not go through `executeActions`.** The existing AI write path (`src/lib/ai/write/execute.ts`) loops `upsertCell` sequentially, re-reads the full board payload per action, captures no before-values and has no `source` concept. Apply instead calls a new SECURITY INVOKER RPC `apply_intelligence_cells(p_board_id, p_writes)` that runs all cell writes in one transaction, returns before-values and the authoritative rows, and stamps `item_activities.source`. Values are still validated with `cellValueSchema(kind)` (the same boundary `upsertCellCore` uses) and new-assignee notifications are replayed through a helper extracted from `cell-core.ts`. Mid-batch failure is a transaction rollback, not a manual revert.
2. **`item_activities.source` does not exist yet.** This plan adds it (`text not null default 'user'`) and teaches `tg_log_cell_activity` and `tg_log_update_activity` to read a transaction-local setting `app.activity_source`.
3. **No "targeted board revalidation" (§8).** Apply/Undo return `BoardEffect[]`; the client folds them into the TanStack cache. A new effect kind `cells_cleared` covers Undo back to an empty cell.
4. **The latest run row is read on the board page**, in the existing `Promise.all`, as one indexed `LIMIT 1` single-row read (`(board_id, user_id, generated_at desc)`), and passed to both the strip and the dock. This is what makes the dock badge and "updated Xm ago" true on first paint; the tab's first open then costs **0** reads. The spec's "tab first open = one LIMIT 1 read" becomes "page = one LIMIT 1 read, tab = 0".
5. **Per-action Apply.** A card's primary and secondary buttons each apply ONE action: `applySuggestion({ runId, suggestionId, actionIndex })`. Applying any action marks the suggestion applied.
6. **Actions carry `columnId`.** `set_due`, `set_status` and `reassign` name the column they write; validation checks the column's kind (`date` / `status` / `people`) and, for status, that `optionId` is one of that column's options. This mirrors Phase 1 deviation 10 (overdue checks every date column) instead of guessing a "primary" column.
7. **`nudge`** writes an `item_updates` row authored by the current user (the model's message, sanitized, ≤280 chars) plus a `notifications` row of kind `mention` for the target (skipped when the target is the current user) — the same shape the automations `notify` action uses. Undo deletes the update row (own-author policy); the notification stays.
8. **`filter`** is client-only: the card button asks the intelligence provider to activate the matching chip through the bridge store; nothing is written.
9. **Labels are resolved server-side at generation time** (`action.label`, `suggestion.evidenceRows[]` with item names) so the dock, which has no board payload, renders cards without a lookup.
10. **Dock header on the Intelligence tab hides the `AgentSwitcher`** (it is chat-only chrome and the header is 320px wide). The tab pair uses the ItemPanel pill-tab recipe (`role="tablist"`, arrow keys wired) because no segmented-control primitive exists.
11. **Viewers may run** "Catch me up" (they see the brief) but `applySuggestion` / `revertSuggestion` reject anyone who is not `owner` or `editor` (`getBoardAccess`), and the RPC's RLS (`cell_values: insert/update/delete if can edit`) rejects them a second time.
12. **The strip's "updated Xm ago"** reads the bridge store, seeded from the page's run row and updated by the dock after every run/dismiss/apply.

## Performance & data-fetching budget (spec §8, restated for what is built here)

- **First paint:** the board payload as today, the `board_visits` PK read, **plus one** `board_intelligence_runs` read (`.eq(board_id).eq(user_id).order(generated_at desc).limit(1).maybeSingle()`, covered by the new index) issued inside the page's existing `Promise.all`. Zero LLM calls. Zero list reads.
- **Dock open:** unchanged (one `loadDockThreads`). **Intelligence tab open:** 0 reads. If no run exists and the tab is opened, ONE `runBoardIntelligence` call (LLM) — spec §4.1.
- **In-page:** tab switch, dismiss (optimistic, then one write), why? popover, chip activation — client state; 0 reads.
- **Catch me up / Refresh:** one Server Action. LLM only when stale (older than `INTELLIGENCE_STALE_MS` = 30 min or `input_hash` changed) or forced; otherwise the cached row is returned with no model call.
- **Apply / Undo:** one Server Action each (one RPC transaction inside), effects folded client-side, no revalidation.
- **Bounded reads inside the run:** `getBoardPayload` (already bounded), `item_activities` by `(board_id, created_at desc)` limit `TRANSCRIPT_ACTIVITY_LIMIT` = 150, `item_updates` by `(board_id, created_at desc)` limit `TRANSCRIPT_UPDATES_LIMIT` = 50 (new index added in the migration), both within the last 7 days; transcript trimmed oldest-first to `TRANSCRIPT_TOKEN_BUDGET` = 6000 estimated tokens; item roster capped at `ROSTER_MAX_ITEMS` = 120 rows (signal items first).

## File structure

**Create**

- `supabase/migrations/<stamp>_board_intelligence_runs.sql` — table, RLS, index, `item_updates` board index, `item_activities.source`, trigger updates, RPC `apply_intelligence_cells` + lockdown.
- `src/lib/ai/board-intelligence/schema.ts` — JSON schema for the model + Zod schemas + `toAction`.
- `src/lib/ai/board-intelligence/validate.ts` — `validateIntelligenceOutput(raw, board)` → payload with off-board suggestions dropped and labels resolved.
- `src/lib/ai/board-intelligence/board-context.ts` — `BoardContext` (items, columns, options, members) derived from a payload; shared by validate/apply/prompt.
- `src/lib/ai/board-intelligence/transcript.ts` — `buildBoardTranscript` (board-level sibling of `buildTranscript`).
- `src/lib/ai/board-intelligence/input-hash.ts` — `intelligenceInputHash`.
- `src/lib/ai/board-intelligence/prompt.ts` — system prompt + user prompt builder (roster, signals, members, transcript).
- `src/lib/ai/board-intelligence/generate.ts` — `generateBoardIntelligence` via `adapter.generateStructured`.
- `src/lib/ai/board-intelligence/runs.ts` — row ↔ `BoardIntelligenceRun` mapping, `getLatestBoardIntelligenceRun`, `isRunStale`, `unresolvedCount`.
- `src/lib/ai/board-intelligence/run.ts` — `"use server"`: `runBoardIntelligence`, `dismissSuggestion`.
- `src/lib/ai/board-intelligence/apply-core.ts` — `server-only`: action → cell writes, RPC call, nudge writes, before-values.
- `src/lib/ai/board-intelligence/apply.ts` — `"use server"`: `applySuggestion`, `revertSuggestion`.
- `src/lib/boards/actions/assign-notify.ts` — `notifyNewAssignees` extracted from `cell-core.ts`.
- `src/stores/board-intelligence.ts` — bridge store (run per board, open request, filter request).
- `src/components/boards/dock/DockTabs.tsx` — Chat | Intelligence tab pair with badge.
- `src/components/boards/dock/intelligence/IntelligenceTab.tsx`, `BriefBlock.tsx`, `SuggestionCard.tsx`, `use-intelligence-run.ts`.
- Tests beside each file (`*.test.ts[x]`), plus `src/lib/ai/board-intelligence/board-intelligence-runs.rls.integration.test.ts`.

**Modify**

- `src/app/globals.css`, `src/app/globals.intel-layer.test.ts`, `src/components/boards/table/NameCell.tsx`, `src/components/boards/table/ItemRow.tsx`, `src/components/boards/table/SortableSubitemRow.tsx`, `src/components/boards/gantt/GanttRowItem.tsx` (Task 0).
- `src/types/database.types.ts` (regenerated), `src/lib/ai/model-map.ts` + test, `src/lib/boards/intelligence/constants.ts`, `src/lib/validations/board-intelligence.ts`.
- `src/lib/ai/write/effects.ts`, `src/lib/boards/ai-effects.ts` + test (`cells_cleared`), `src/lib/boards/actions/cell-core.ts`.
- `src/components/boards/dock/use-dock-state.ts` + test (`tab`), `src/components/boards/dock/BoardDock.tsx` + test (tabs, new props).
- `src/components/boards/IntelligenceStrip.tsx` + test, `src/lib/boards/intelligence/context.tsx` + test (filter request), `src/components/boards/BoardViews.tsx`, `src/app/(app)/boards/[boardId]/page.tsx`.

## Shared types (defined in Task 3, consumed everywhere — copy exactly)

```ts
// src/lib/ai/board-intelligence/schema.ts
export type SuggestionKind =
  "overdue" | "blocked" | "overloaded" | "stalled" | "changed" | "other";

export type Action =
  | {
      type: "reassign";
      itemIds: string[];
      columnId: string;
      toUserId: string;
      label: string;
    }
  | {
      type: "set_due";
      itemId: string;
      columnId: string;
      date: string;
      label: string;
    }
  | {
      type: "set_status";
      itemId: string;
      columnId: string;
      optionId: string;
      label: string;
    }
  | {
      type: "nudge";
      itemId: string;
      userId: string;
      message: string;
      label: string;
    }
  | { type: "filter"; signalKind: SignalKind; label: string };

export type Suggestion = {
  id: string; // "s1".."s5", minted server-side
  kind: SuggestionKind;
  title: string; // ≤ 80 chars
  evidence: string; // kicker, ≤ 40 chars, e.g. "140% → 95%"
  body: string; // ≤ 240 chars
  evidenceRows: { itemId: string; name: string; detail: string }[]; // ≤ 8
  actions: Action[]; // 1–2, validated
};

export type BoardIntelligencePayload = {
  brief: string; // ≤ 700 chars
  suggestions: Suggestion[]; // ≤ 5
  signals: { kind: SignalKind; count: number; label: string }[];
};

// src/lib/ai/board-intelligence/runs.ts
export type BoardIntelligenceRun = {
  id: string;
  boardId: string;
  generatedAt: string; // ISO
  inputHash: string;
  payload: BoardIntelligencePayload;
  dismissed: string[];
  applied: string[];
  model: string | null;
  tokensIn: number;
  tokensOut: number;
};

// src/lib/ai/board-intelligence/apply-core.ts
export type BeforeValue = {
  itemId: string;
  columnId: string;
  value: unknown | null;
}; // null = the cell was empty
export type ApplyOutcome = {
  before: BeforeValue[];
  updateIds: string[];
  effects: BoardEffect[];
};
```

---

### Task 0: Cosmetic residuals from Phase 1 (row rule polish)

**Files:**

- Modify: `src/app/globals.css` (the Board Intelligence block inside `@layer utilities`, ~lines 910–978)
- Modify: `src/app/globals.intel-layer.test.ts`
- Modify: `src/components/boards/table/NameCell.tsx` (~line 113–135)
- Modify: `src/components/boards/table/ItemRow.tsx:277-281`, `src/components/boards/table/SortableSubitemRow.tsx` (its `NameCell` call)
- Modify: `src/components/boards/gantt/GanttRowItem.tsx:196-212`

**Interfaces:**

- Consumes: `useIntelMatch(itemId): boolean | null` and `intelRowClasses(match)` from `@/lib/boards/intelligence/context`.
- Produces: a new utility class `.intel-rule` (a sticky-safe rule drawn INSIDE a frozen column) and the attribute `data-intel-rule="cell"` on rows that delegate the rule to a child; a new `NameCell` prop `intelMatch?: boolean | null`.

Why: the `::after` rule is anchored to the row's left edge, so in Table and Timeline it scrolls away with the content while the name column stays frozen; it overlaps NameCell's 3px selection bar; it ignores kanban card radius; the CSS header still says "inset"; `pointer-events: none` is unasserted.

- [ ] **Step 1: Lock the existing behaviour in the CSS test (fails first for the new rules)**

Append to the `describe` in `src/app/globals.intel-layer.test.ts`:

```ts
it("keeps the rule out of the hit-test and rounds it with its host", () => {
  const utilities = extractLayerBlock("utilities");
  const after = utilities.match(/\.intel-match::after\s*\{([^}]*)\}/);
  expect(after).not.toBeNull();
  expect(after![1]).toMatch(/pointer-events:\s*none/);
  expect(after![1]).toMatch(/border-start-start-radius:\s*inherit/);
  expect(after![1]).toMatch(/border-end-start-radius:\s*inherit/);
});

it("lets a frozen column draw the rule instead of the row", () => {
  const utilities = extractLayerBlock("utilities");
  // A row that delegates the rule to a sticky child must not ALSO paint it.
  expect(utilities).toMatch(
    /\.intel-match\[data-intel-rule="cell"\]::after\s*\{[^}]*content:\s*none/,
  );
  const rule = utilities.match(/\.intel-rule\s*\{([^}]*)\}/);
  expect(rule).not.toBeNull();
  expect(rule![1]).toMatch(/position:\s*absolute/);
  expect(rule![1]).toMatch(/left:\s*0/);
  expect(rule![1]).toMatch(/width:\s*2px/);
  expect(rule![1]).toMatch(/background:\s*var\(--intel-rule, transparent\)/);
  expect(rule![1]).toMatch(/pointer-events:\s*none/);
  expect(utilities).not.toMatch(/\.intel-match\s*\{[^}]*inset\b/);
});
```

- [ ] **Step 2: Run the test, confirm the two new cases fail**

Run: `pnpm vitest run src/app/globals.intel-layer.test.ts`
Expected: 2 failing (`border-start-start-radius` missing; `.intel-rule` missing).

- [ ] **Step 3: Update the CSS block**

In `src/app/globals.css`, (a) rewrite the header comment's first sentence to "matching rows paint a 2px rule in that status colour as an `::after` pseudo-element (or, for rows with a frozen first column, an `.intel-rule` child inside that column), non-matching rows dim." and delete "(inset so nothing shifts)"; (b) extend `.intel-match::after` and add the two new rules, all inside the SAME `@layer utilities` block, after `.intel-match::after`:

```css
.intel-match::after {
  content: "";
  position: absolute;
  inset-block: 0;
  left: 0;
  width: 2px;
  background: var(--intel-rule, transparent);
  z-index: 20;
  pointer-events: none;
  /* Follow the host's corners (kanban cards are rounded-lg); a 2px box
       with a 14px radius simply clips to the card's left edge. */
  border-start-start-radius: inherit;
  border-end-start-radius: inherit;
}
/* Rows whose first column is `sticky left-0` (table NameCell, gantt label)
     delegate the rule to an `.intel-rule` child INSIDE that column, so it
     stays visible at scrollLeft > 0. The row-level pseudo-element is
     suppressed for them — one rule, not two. */
.intel-match[data-intel-rule="cell"]::after {
  content: none;
}
.intel-rule {
  position: absolute;
  inset-block: 0;
  left: 0;
  width: 2px;
  background: var(--intel-rule, transparent);
  z-index: 20;
  pointer-events: none;
  border-start-start-radius: inherit;
  border-end-start-radius: inherit;
}
```

- [ ] **Step 4: Run the CSS test, confirm all pass**

Run: `pnpm vitest run src/app/globals.intel-layer.test.ts`
Expected: PASS.

- [ ] **Step 5: NameCell draws the rule and hides its selection bar while matching**

In `src/components/boards/table/NameCell.tsx` add the prop `intelMatch?: boolean | null` to the props type and destructure it. In the non-editing branch (the `group/name … sticky left-0 z-10` element, ~line 122), change the `selected` class expression so the bar is hidden while the intel rule is showing, and render the rule as the first child:

```tsx
        selected
          ? cn(
              "before:bg-primary before:pointer-events-none before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded",
              // The intel rule owns x=0 while a chip is active; the periwinkle
              // wash still says "selected" on its own.
              intelMatch === true && "before:hidden",
            )
          : indented
            ? "bg-surface-sunken hover:bg-surface"
            : "bg-surface hover:bg-surface-muted",
```

and, immediately inside that element, before the existing children:

```tsx
{
  intelMatch === true && (
    <span aria-hidden data-testid="intel-rule" className="intel-rule" />
  );
}
```

- [ ] **Step 6: Table rows delegate the rule**

In `src/components/boards/table/ItemRow.tsx` the root `<div>` (the one that receives `intelRowClasses(intelMatch)` at ~line 268) gets `data-intel-rule="cell"`, and the `<NameCell …>` call (~line 277) gets `intelMatch={intelMatch}`. Do the same in `src/components/boards/table/SortableSubitemRow.tsx` (root `<div>` at its `intelRowClasses` call; its `NameCell` call).

- [ ] **Step 7: Gantt rows delegate the rule**

In `src/components/boards/gantt/GanttRowItem.tsx` add `data-intel-rule="cell"` to the `data-testid="gantt-row"` root and render `{intelMatch === true && <span aria-hidden data-testid="intel-rule" className="intel-rule" />}` as the first child of the sticky label `<div>` (the one with `bg-background sticky left-0 z-10`). The label already has `position: sticky`, which is a containing block for the absolute child.

- [ ] **Step 8: Extend the existing intel view tests**

In `src/components/boards/BoardTable.intel.test.tsx` and `src/components/boards/GanttBoard.intel.test.tsx` find the case that asserts a matching row carries `intel-match` and add, in the same case:

```ts
expect(row).toHaveAttribute("data-intel-rule", "cell");
expect(within(row).getByTestId("intel-rule")).toBeInTheDocument();
```

(and for a non-matching row: `expect(within(miss).queryByTestId("intel-rule")).toBeNull()`). Import `within` from `@testing-library/react` if missing.

- [ ] **Step 9: Run the affected suites**

Run: `pnpm vitest run src/app/globals.intel-layer.test.ts src/components/boards/BoardTable.intel.test.tsx src/components/boards/GanttBoard.intel.test.tsx src/components/boards/KanbanBoard.intel.test.tsx src/components/boards/table`
Expected: PASS.

- [ ] **Step 10: Gates and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all pass.

```bash
git add src/app/globals.css src/app/globals.intel-layer.test.ts src/components/boards/table/NameCell.tsx src/components/boards/table/ItemRow.tsx src/components/boards/table/SortableSubitemRow.tsx src/components/boards/gantt/GanttRowItem.tsx src/components/boards/BoardTable.intel.test.tsx src/components/boards/GanttBoard.intel.test.tsx
git commit -m "fix(boards): keep the intelligence rule inside frozen columns and off the selection bar"
```

Note for the final browser check (Task 9): scroll a wide table horizontally with a chip active — the rule must stay put at the frozen name column; select a matching row — wash without the bar; kanban card — rule follows the rounded corner.

---

### Task 1: Migration — `board_intelligence_runs`, `item_activities.source`, `apply_intelligence_cells`

**Files:**

- Create: `supabase/migrations/<stamp>_board_intelligence_runs.sql` (minted by `scripts/new-migration.sh board_intelligence_runs`)
- Modify: `src/types/database.types.ts` (regenerated — never hand-edit)
- Create: `src/lib/ai/board-intelligence/board-intelligence-runs.rls.integration.test.ts`

**Interfaces:**

- Consumes: `public.can_read_board(uuid)`, `public.is_org_member(uuid)`, `public.boards_id_org_key unique (id, org_id)` (exists since `20260804144223`), trigger functions `tg_log_cell_activity` / `tg_log_update_activity` (latest definitions in `20260621150000_fix_cell_activity_column_cascade_delete.sql` and `20260617090000_collaboration_updates_activity.sql`).
- Produces: table `public.board_intelligence_runs`; column `public.item_activities.source text not null default 'user'`; index `item_updates_board_created_idx (board_id, created_at desc)`; RPC `public.apply_intelligence_cells(p_board_id uuid, p_writes jsonb) returns jsonb` with result shape `{ "before": [{item_id, column_id, value|null}], "cells": [<cell_values row> | {item_id, column_id, cleared: true}] }`; generated types for all of the above.

**Migration application is the ORCHESTRATOR's job** (memory `serialize-merges-agents-stop-before-finish`): the implementer writes the file and the test, then STOPS and reports the version; the orchestrator applies it through the `supabase-dev` MCP `apply_migration` with `name: "<stamp>_board_intelligence_runs"`, runs `pnpm db:ledger-check` (reconcile on drift), regenerates types via the MCP, and commits.

- [ ] **Step 1: Mint the file**

Run: `scripts/new-migration.sh board_intelligence_runs`
Expected: prints the path `supabase/migrations/<stamp>_board_intelligence_runs.sql` and the 4-step next-steps block.

- [ ] **Step 2: Write the migration body (replace the TODO in the header with the description below, keep the minted header lines)**

```sql
-- What this migration does:
--   Board Intelligence Phase 2 (spec §4.5, §4.6, §7):
--   1. board_intelligence_runs — per (board, user) cache of a brief + suggestions.
--   2. item_activities.source — 'user' by default, 'intelligence' when a write
--      came from an applied/undone suggestion; set through a transaction-local
--      setting read by the existing activity triggers.
--   3. apply_intelligence_cells(p_board_id, p_writes) — ONE transaction for a
--      suggestion's cell writes; returns before-values (for Undo) and the
--      authoritative rows (for the client cache). SECURITY INVOKER: RLS on
--      cell_values (can_edit_board) is the authorization.
--   4. item_updates (board_id, created_at desc) — the board-level transcript read.

-- ── 1. runs cache ───────────────────────────────────────────────────────────
create table public.board_intelligence_runs (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  board_id     uuid not null,
  user_id      uuid not null references auth.users (id) on delete cascade,
  generated_at timestamptz not null default now(),
  input_hash   text not null,
  payload      jsonb not null,
  dismissed    text[] not null default '{}'::text[],
  applied      text[] not null default '{}'::text[],
  model        text,
  tokens_in    integer not null default 0,
  tokens_out   integer not null default 0,
  -- org_id must be the board's org: enforced declaratively for every role,
  -- service_role included (see 20260804144223_board_thread_org_coupling.sql).
  constraint board_intelligence_runs_board_org_fkey
    foreign key (board_id, org_id) references public.boards (id, org_id) on delete cascade
);

comment on table public.board_intelligence_runs is
  'Cached Board Intelligence brief + suggestions per (board, user). Own rows only; stale after 30 min or when input_hash changes.';

create index board_intelligence_runs_lookup_idx
  on public.board_intelligence_runs (board_id, user_id, generated_at desc);

alter table public.board_intelligence_runs enable row level security;

create policy "board_intelligence_runs: select own"
  on public.board_intelligence_runs for select to authenticated
  using (user_id = (select auth.uid()) and public.can_read_board(board_id));

create policy "board_intelligence_runs: insert own"
  on public.board_intelligence_runs for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_org_member(org_id)
    and public.can_read_board(board_id)
  );

create policy "board_intelligence_runs: update own"
  on public.board_intelligence_runs for update to authenticated
  using (user_id = (select auth.uid()) and public.can_read_board(board_id))
  with check (user_id = (select auth.uid()) and public.can_read_board(board_id));

create policy "board_intelligence_runs: delete own"
  on public.board_intelligence_runs for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.board_intelligence_runs to authenticated;

-- ── 2. activity source ──────────────────────────────────────────────────────
alter table public.item_activities
  add column source text not null default 'user'
  constraint item_activities_source_check check (source in ('user', 'intelligence'));

comment on column public.item_activities.source is
  'user (default) or intelligence — set when the write came from an applied/undone Board Intelligence suggestion.';

-- The triggers read a transaction-local setting; unset → 'user'. Bodies are
-- the latest shipped definitions (20260621150000 / 20260617090000) plus `source`.
create or replace function public.tg_log_cell_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_source text := coalesce(nullif(current_setting('app.activity_source', true), ''), 'user');
begin
  if (tg_op = 'INSERT') then
    insert into public.item_activities (org_id, board_id, item_id, actor_id, action, column_id, new_value, source)
    values (new.org_id, new.board_id, new.item_id, (select auth.uid()), 'cell_changed', new.column_id, new.value, v_source);
    return new;
  elsif (tg_op = 'UPDATE') then
    if (new.value is distinct from old.value) then
      insert into public.item_activities (org_id, board_id, item_id, actor_id, action, column_id, old_value, new_value, source)
      values (new.org_id, new.board_id, new.item_id, (select auth.uid()), 'cell_changed', new.column_id, old.value, new.value, v_source);
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    if exists (select 1 from public.items where id = old.item_id)
       and exists (select 1 from public.columns where id = old.column_id) then
      insert into public.item_activities (org_id, board_id, item_id, actor_id, action, column_id, old_value, source)
      values (old.org_id, old.board_id, old.item_id, (select auth.uid()), 'cell_changed', old.column_id, old.value, v_source);
    end if;
    return old;
  end if;
  return null;
end; $$;

create or replace function public.tg_log_update_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_source text := coalesce(nullif(current_setting('app.activity_source', true), ''), 'user');
begin
  insert into public.item_activities (org_id, board_id, item_id, actor_id, action, new_value, source)
  values (new.org_id, new.board_id, new.item_id, new.author_id, 'update_added',
          jsonb_build_object('update_id', new.id), v_source);
  return new;
end; $$;

-- ── 3. one-transaction apply ────────────────────────────────────────────────
-- p_writes: [{ "item_id": uuid, "column_id": uuid, "value": jsonb | null }]
-- value null = clear the cell (an empty cell is the ABSENCE of a row).
-- Returns { "before": [...], "cells": [...] } — see the plan for the shape.
create or replace function public.apply_intelligence_cells(p_board_id uuid, p_writes jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_org    uuid;
  v_write  jsonb;
  v_item   uuid;
  v_col    uuid;
  v_value  jsonb;
  v_old    jsonb;
  v_row    public.cell_values;
  v_before jsonb := '[]'::jsonb;
  v_cells  jsonb := '[]'::jsonb;
begin
  if p_writes is null or jsonb_typeof(p_writes) <> 'array'
     or jsonb_array_length(p_writes) = 0 or jsonb_array_length(p_writes) > 50 then
    raise exception 'apply_intelligence_cells: expected 1..50 writes';
  end if;

  -- RLS-filtered: a board the caller cannot read reads as "not found".
  select b.org_id into v_org from public.boards b where b.id = p_board_id;
  if v_org is null then
    raise exception 'apply_intelligence_cells: board not found';
  end if;

  -- Transaction-local: every activity row the triggers write in this call
  -- carries source = 'intelligence'; the setting dies with the transaction.
  perform set_config('app.activity_source', 'intelligence', true);

  for v_write in select * from jsonb_array_elements(p_writes) loop
    v_item  := (v_write->>'item_id')::uuid;
    v_col   := (v_write->>'column_id')::uuid;
    v_value := v_write->'value';
    v_old   := null;

    if not exists (select 1 from public.items i where i.id = v_item and i.board_id = p_board_id)
       or not exists (select 1 from public.columns c where c.id = v_col and c.board_id = p_board_id) then
      raise exception 'apply_intelligence_cells: item or column is not on this board';
    end if;

    select cv.value into v_old from public.cell_values cv
      where cv.item_id = v_item and cv.column_id = v_col;
    v_before := v_before || jsonb_build_object('item_id', v_item, 'column_id', v_col, 'value', v_old);

    if v_value is null or jsonb_typeof(v_value) = 'null' then
      delete from public.cell_values cv where cv.item_id = v_item and cv.column_id = v_col;
      v_cells := v_cells || jsonb_build_object('item_id', v_item, 'column_id', v_col, 'cleared', true);
    else
      insert into public.cell_values (org_id, board_id, item_id, column_id, value)
      values (v_org, p_board_id, v_item, v_col, v_value)
      on conflict (item_id, column_id) do update set value = excluded.value
      returning * into v_row;
      v_cells := v_cells || to_jsonb(v_row);
    end if;
  end loop;

  return jsonb_build_object('before', v_before, 'cells', v_cells);
end $$;

comment on function public.apply_intelligence_cells (uuid, jsonb) is
  'Apply a Board Intelligence suggestion''s cell writes in one transaction under the caller''s RLS; returns before-values and the written rows. Activity rows get source = intelligence.';

revoke execute on function public.apply_intelligence_cells (uuid, jsonb) from public, anon;
grant execute on function public.apply_intelligence_cells (uuid, jsonb) to authenticated;

-- ── 4. board-level transcript read ──────────────────────────────────────────
create index item_updates_board_created_idx
  on public.item_updates (board_id, created_at desc);
```

- [ ] **Step 3: Write the RLS + RPC integration test (skips without `PULSE_TEST_DB`)**

Create `src/lib/ai/board-intelligence/board-intelligence-runs.rls.integration.test.ts` by copying the fixture scaffold of `src/lib/boards/intelligence/board-visits.rls.integration.test.ts` verbatim (three personas `owner`, `other` (shared as editor), `outsider`; same `makeUser`, org/board creation via `create_organization` → `workspaces` insert → `create_board` → `groups` select; same `afterAll` cleanup) and replace the probes with:

```ts
it("a user reads and writes only their own run rows", async () => {
  const { error: insErr } = await owner.anon
    .from("board_intelligence_runs")
    .insert({
      org_id: orgId,
      board_id: boardId,
      user_id: owner.id,
      input_hash: "h1",
      payload: { brief: "b", suggestions: [], signals: [] },
    });
  expect(insErr).toBeNull();
  const mine = await owner.anon
    .from("board_intelligence_runs")
    .select("id")
    .eq("board_id", boardId);
  expect(mine.data).toHaveLength(1);
  const theirs = await other.anon
    .from("board_intelligence_runs")
    .select("id")
    .eq("board_id", boardId);
  expect(theirs.data).toEqual([]);
});

it("an outsider cannot insert a run for a board they cannot read", async () => {
  const { error } = await outsider.anon.from("board_intelligence_runs").insert({
    org_id: orgId,
    board_id: boardId,
    user_id: outsider.id,
    input_hash: "h",
    payload: { brief: "", suggestions: [], signals: [] },
  });
  expect(error).not.toBeNull();
});

it("apply_intelligence_cells writes in one transaction and returns before-values", async () => {
  // A text column + one item, created by the owner.
  const { data: col } = await owner.anon
    .from("columns")
    .insert({
      org_id: orgId,
      board_id: boardId,
      name: "Notes",
      kind: "text",
      position: 0,
    })
    .select("id")
    .single();
  const { data: item } = await owner.anon
    .from("items")
    .insert({
      org_id: orgId,
      board_id: boardId,
      group_id: groupId,
      name: "Row",
      position: 0,
    })
    .select("id")
    .single();
  const res = await owner.anon.rpc("apply_intelligence_cells", {
    p_board_id: boardId,
    p_writes: [
      { item_id: item!.id, column_id: col!.id, value: { text: "hello" } },
    ],
  });
  expect(res.error).toBeNull();
  const out = res.data as { before: { value: unknown }[]; cells: unknown[] };
  expect(out.before[0]?.value).toBeNull(); // cell was empty
  expect(out.cells).toHaveLength(1);
  const act = await owner.anon
    .from("item_activities")
    .select("source")
    .eq("item_id", item!.id)
    .eq("action", "cell_changed");
  expect(act.data?.map((a) => a.source)).toEqual(["intelligence"]);
  // Replaying the before-value clears the cell again.
  const undo = await owner.anon.rpc("apply_intelligence_cells", {
    p_board_id: boardId,
    p_writes: [{ item_id: item!.id, column_id: col!.id, value: null }],
  });
  expect(undo.error).toBeNull();
  const cells = await owner.anon
    .from("cell_values")
    .select("id")
    .eq("item_id", item!.id);
  expect(cells.data).toEqual([]);
});

it("a viewer's apply is rejected and writes nothing", async () => {
  await owner.anon.rpc("share_board", {
    p_board_id: boardId,
    p_user_id: other.id,
    p_access: "viewer",
  });
  const { data: col } = await owner.anon
    .from("columns")
    .select("id")
    .eq("board_id", boardId)
    .limit(1)
    .single();
  const { data: item } = await owner.anon
    .from("items")
    .select("id")
    .eq("board_id", boardId)
    .limit(1)
    .single();
  const res = await other.anon.rpc("apply_intelligence_cells", {
    p_board_id: boardId,
    p_writes: [
      { item_id: item!.id, column_id: col!.id, value: { text: "nope" } },
    ],
  });
  expect(res.error).not.toBeNull();
  const cells = await admin
    .from("cell_values")
    .select("value")
    .eq("item_id", item!.id);
  expect(
    cells.data?.some((c) => JSON.stringify(c.value).includes("nope")),
  ).toBe(false);
});

it("an ordinary cell write still logs source = user", async () => {
  const { data: col } = await owner.anon
    .from("columns")
    .select("id")
    .eq("board_id", boardId)
    .limit(1)
    .single();
  const { data: item } = await owner.anon
    .from("items")
    .select("id")
    .eq("board_id", boardId)
    .limit(1)
    .single();
  await owner.anon
    .from("cell_values")
    .upsert(
      {
        org_id: orgId,
        board_id: boardId,
        item_id: item!.id,
        column_id: col!.id,
        value: { text: "plain" },
      },
      { onConflict: "item_id,column_id" },
    );
  const act = await owner.anon
    .from("item_activities")
    .select("source")
    .eq("item_id", item!.id)
    .order("created_at", { ascending: false })
    .limit(1);
  expect(act.data?.[0]?.source).toBe("user");
});
```

(If the `share_board` RPC in this test file's scaffold already shared `other` as `editor` in `beforeAll`, share a fourth persona `viewer` instead of re-sharing `other`; keep the scaffold's variable names.)

- [ ] **Step 4: Confirm the suite skips cleanly and lint passes on the file**

Run: `pnpm vitest run src/lib/ai/board-intelligence/board-intelligence-runs.rls.integration.test.ts`
Expected: "skipped" (no `PULSE_TEST_DB`). `pnpm lint` passes.

- [ ] **Step 5: STOP — report the version to the orchestrator**

Report: "Migration `<stamp>_board_intelligence_runs.sql` written; not applied; types not regenerated." Do NOT commit yet.

- [ ] **Step 6 (orchestrator): apply, verify, regenerate types, commit**

1. `supabase-dev` MCP `apply_migration` with `name: "<stamp>_board_intelligence_runs"` and the file's SQL as `query`.
2. `pnpm db:ledger-check` → expect `in sync (163 files, 163 DEV ledger rows)`. If the ledger row's version differs from the file, run `scripts/reconcile-migration-version.sh <ledger-version> <file-version>` and follow its printed steps.
3. `supabase-dev` MCP `generate_typescript_types` → save to a scratch file → `pnpm exec prettier --parser typescript <scratch> > src/types/database.types.ts`. Confirm `git diff --stat src/types/database.types.ts` shows `board_intelligence_runs`, `apply_intelligence_cells`, and `item_activities.source` and nothing unexpected.
4. `pnpm typecheck` (expect the exhaustive `switch (row.action)` in `src/lib/collaboration/activity.ts` untouched — no new enum value was added).
5. Commit:

```bash
git add supabase/migrations/<stamp>_board_intelligence_runs.sql src/types/database.types.ts src/lib/ai/board-intelligence/board-intelligence-runs.rls.integration.test.ts
git commit -m "feat(db): board_intelligence_runs cache, item_activities.source and the apply_intelligence_cells RPC"
```

---

### Task 2: Bridge store and dock `tab` state

**Files:**

- Create: `src/stores/board-intelligence.ts`, `src/stores/board-intelligence.test.ts`
- Modify: `src/components/boards/dock/use-dock-state.ts`, `src/components/boards/dock/use-dock-state.test.ts`
- Modify: `src/lib/boards/intelligence/constants.ts`

**Interfaces:**

- Consumes: `IntelSelection` from `@/lib/boards/intelligence/types`; `BoardIntelligenceRun` type — until Task 3 lands, declare the store generic over `TRun = unknown` is NOT acceptable; instead import the type from `@/lib/ai/board-intelligence/runs` and, if that file does not exist yet in your worktree, create it with ONLY the `BoardIntelligenceRun` and `BoardIntelligencePayload` types from the "Shared types" section (Task 3/5 will extend it).
- Produces:

```ts
// src/stores/board-intelligence.ts
export type DockTab = "chat" | "intelligence";
export type OpenRequest = { boardId: string; nonce: number; run: boolean };
export type FilterRequest = {
  boardId: string;
  selection: IntelSelection;
  nonce: number;
};
export interface BoardIntelligenceStoreState {
  runs: Record<string, BoardIntelligenceRun | null>;
  openRequest: OpenRequest | null;
  filterRequest: FilterRequest | null;
  setRun: (boardId: string, run: BoardIntelligenceRun | null) => void;
  requestOpen: (boardId: string, opts?: { run?: boolean }) => void;
  consumeOpen: (nonce: number) => void;
  requestFilter: (boardId: string, selection: IntelSelection) => void;
  consumeFilter: (nonce: number) => void;
}
export const useBoardIntelligenceStore: UseBoundStore<
  StoreApi<BoardIntelligenceStoreState>
>;
export function unresolvedCount(run: BoardIntelligenceRun | null): number;

// src/components/boards/dock/use-dock-state.ts — returns gain `tab` and `setTab`
export function useDockState(boardId: string): {
  open: boolean;
  width: number;
  tab: DockTab;
  hydrated: boolean;
  setOpen(o: boolean): void;
  setWidth(w: number): void;
  setTab(t: DockTab): void;
};

// src/lib/boards/intelligence/constants.ts — additions
export const INTELLIGENCE_STALE_MS = 30 * 60 * 1000;
export const TRANSCRIPT_DAYS = 7;
export const TRANSCRIPT_ACTIVITY_LIMIT = 150;
export const TRANSCRIPT_UPDATES_LIMIT = 50;
export const TRANSCRIPT_TOKEN_BUDGET = 6000;
export const ROSTER_MAX_ITEMS = 120;
export const MAX_SUGGESTIONS = 5;
```

- [ ] **Step 1: Store test**

Create `src/stores/board-intelligence.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  unresolvedCount,
  useBoardIntelligenceStore,
} from "./board-intelligence";
import type { BoardIntelligenceRun } from "@/lib/ai/board-intelligence/runs";

const run = (
  over: Partial<BoardIntelligenceRun> = {},
): BoardIntelligenceRun => ({
  id: "r1",
  boardId: "b1",
  generatedAt: "2026-09-11T10:00:00.000Z",
  inputHash: "h",
  payload: {
    brief: "Quiet week.",
    suggestions: [
      {
        id: "s1",
        kind: "overdue",
        title: "t",
        evidence: "e",
        body: "b",
        evidenceRows: [],
        actions: [{ type: "filter", signalKind: "overdue", label: "Show" }],
      },
      {
        id: "s2",
        kind: "stalled",
        title: "t",
        evidence: "e",
        body: "b",
        evidenceRows: [],
        actions: [{ type: "filter", signalKind: "stalled", label: "Show" }],
      },
    ],
    signals: [],
  },
  dismissed: [],
  applied: [],
  model: null,
  tokensIn: 0,
  tokensOut: 0,
  ...over,
});

beforeEach(() =>
  useBoardIntelligenceStore.setState({
    runs: {},
    openRequest: null,
    filterRequest: null,
  }),
);

describe("board intelligence bridge store", () => {
  it("counts unresolved suggestions", () => {
    expect(unresolvedCount(null)).toBe(0);
    expect(unresolvedCount(run())).toBe(2);
    expect(unresolvedCount(run({ dismissed: ["s1"] }))).toBe(1);
    expect(unresolvedCount(run({ dismissed: ["s1"], applied: ["s2"] }))).toBe(
      0,
    );
  });

  it("keeps one run per board", () => {
    useBoardIntelligenceStore.getState().setRun("b1", run());
    useBoardIntelligenceStore.getState().setRun("b2", null);
    expect(useBoardIntelligenceStore.getState().runs.b1?.id).toBe("r1");
    expect(useBoardIntelligenceStore.getState().runs.b2).toBeNull();
  });

  it("open requests carry a fresh nonce and are consumed by nonce", () => {
    const s = useBoardIntelligenceStore.getState();
    s.requestOpen("b1", { run: true });
    const first = useBoardIntelligenceStore.getState().openRequest!;
    expect(first).toMatchObject({ boardId: "b1", run: true });
    s.requestOpen("b1");
    const second = useBoardIntelligenceStore.getState().openRequest!;
    expect(second.nonce).not.toBe(first.nonce);
    expect(second.run).toBe(false);
    s.consumeOpen(first.nonce); // stale consume is a no-op
    expect(useBoardIntelligenceStore.getState().openRequest).toBe(second);
    s.consumeOpen(second.nonce);
    expect(useBoardIntelligenceStore.getState().openRequest).toBeNull();
  });

  it("filter requests behave the same way", () => {
    const s = useBoardIntelligenceStore.getState();
    s.requestFilter("b1", { kind: "overdue" });
    const req = useBoardIntelligenceStore.getState().filterRequest!;
    expect(req.selection).toEqual({ kind: "overdue" });
    s.consumeFilter(req.nonce);
    expect(useBoardIntelligenceStore.getState().filterRequest).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect failure (module missing)**

Run: `pnpm vitest run src/stores/board-intelligence.test.ts`
Expected: FAIL — cannot resolve `./board-intelligence`.

- [ ] **Step 3: Implement the store**

```ts
// src/stores/board-intelligence.ts
import { create } from "zustand";
import type { IntelSelection } from "@/lib/boards/intelligence/types";
import type { BoardIntelligenceRun } from "@/lib/ai/board-intelligence/runs";

/**
 * Ephemeral bridge between the Intelligence strip (inside
 * BoardIntelligenceProvider) and the board dock (its sibling in the page).
 * Pure client UI state: never persisted, never a server round-trip. Requests
 * are nonce-stamped commands — the consumer clears exactly the request it
 * handled, so a request issued while another is in flight is never lost.
 */
export type DockTab = "chat" | "intelligence";
export type OpenRequest = { boardId: string; nonce: number; run: boolean };
export type FilterRequest = {
  boardId: string;
  selection: IntelSelection;
  nonce: number;
};

export interface BoardIntelligenceStoreState {
  runs: Record<string, BoardIntelligenceRun | null>;
  openRequest: OpenRequest | null;
  filterRequest: FilterRequest | null;
  setRun: (boardId: string, run: BoardIntelligenceRun | null) => void;
  requestOpen: (boardId: string, opts?: { run?: boolean }) => void;
  consumeOpen: (nonce: number) => void;
  requestFilter: (boardId: string, selection: IntelSelection) => void;
  consumeFilter: (nonce: number) => void;
}

let nonce = 0;
const nextNonce = () => ++nonce;

export const useBoardIntelligenceStore = create<BoardIntelligenceStoreState>()(
  (set) => ({
    runs: {},
    openRequest: null,
    filterRequest: null,
    setRun: (boardId, run) =>
      set((s) => ({ runs: { ...s.runs, [boardId]: run } })),
    requestOpen: (boardId, opts) =>
      set({
        openRequest: { boardId, nonce: nextNonce(), run: opts?.run ?? false },
      }),
    consumeOpen: (n) =>
      set((s) => (s.openRequest?.nonce === n ? { openRequest: null } : {})),
    requestFilter: (boardId, selection) =>
      set({ filterRequest: { boardId, selection, nonce: nextNonce() } }),
    consumeFilter: (n) =>
      set((s) => (s.filterRequest?.nonce === n ? { filterRequest: null } : {})),
  }),
);

/** Badge count: suggestions − dismissed − applied. */
export function unresolvedCount(run: BoardIntelligenceRun | null): number {
  if (!run) return 0;
  const gone = new Set([...run.dismissed, ...run.applied]);
  return run.payload.suggestions.filter((s) => !gone.has(s.id)).length;
}
```

If `src/lib/ai/board-intelligence/runs.ts` does not exist in your worktree, create it containing only the `BoardIntelligencePayload`, `Suggestion`, `Action`, `SuggestionKind` and `BoardIntelligenceRun` type declarations from the "Shared types" section (import `SignalKind` from `@/lib/boards/intelligence/types`), so this store typechecks; Tasks 3 and 5 will move/extend them.

- [ ] **Step 4: Run store test → PASS**

- [ ] **Step 5: Dock state test for `tab`**

In `src/components/boards/dock/use-dock-state.test.ts`, update the first-render assertion to include the SSR default tab and add a tab test:

```ts
expect(seen[0]).toEqual({
  open: false,
  width: DOCK_MIN_WIDTH,
  tab: "chat",
  hydrated: false,
});
// …
expect(seen.at(-1)).toEqual({
  open: true,
  width: 380,
  tab: "chat",
  hydrated: true,
});
```

```ts
it("remembers the tab per board and defaults to chat for old rows", () => {
  window.localStorage.setItem(
    "monolith.dock.board-1",
    JSON.stringify({ open: true, width: 380 }),
  );
  const { result } = renderHook(() => useDockState("board-1"));
  expect(result.current.tab).toBe("chat");
  act(() => result.current.setTab("intelligence"));
  expect(result.current.tab).toBe("intelligence");
  expect(
    JSON.parse(window.localStorage.getItem("monolith.dock.board-1")!),
  ).toEqual({
    open: true,
    width: 380,
    tab: "intelligence",
  });
});
```

- [ ] **Step 6: Run → FAIL (no `tab`)**

- [ ] **Step 7: Implement `tab` in `use-dock-state.ts`**

Extend `Stored` to `{ open: boolean; width: number; tab: DockTab }` (import `DockTab` from `@/stores/board-intelligence`), `CLOSED` to include `tab: "chat"`, make `readStored` sanitise `tab` (`raw.tab === "intelligence" ? "intelligence" : "chat"`), and refactor `persist` to merge from a ref so all three setters share one path:

```ts
const latest = useRef<Stored>(CLOSED);
useEffect(() => {
  latest.current = { open: state.open, width: state.width, tab: state.tab };
});

const persist = useCallback(
  (patch: Partial<Stored>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    try {
      window.localStorage.setItem(keyFor(boardId), JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  },
  [boardId],
);

const setOpen = useCallback(
  (open: boolean) => {
    setState((p) => ({ ...p, open }));
    persist({ open });
  },
  [persist],
);
const setWidth = useCallback(
  (n: number) => {
    const width = clampDockWidth(n);
    setState((p) => ({ ...p, width }));
    persist({ width });
  },
  [persist],
);
const setTab = useCallback(
  (tab: DockTab) => {
    setState((p) => ({ ...p, tab }));
    persist({ tab });
  },
  [persist],
);

return {
  open: state.open,
  width: state.width,
  tab: state.tab,
  hydrated: state.hydrated,
  setOpen,
  setWidth,
  setTab,
};
```

Keep the gotcha-50 shape: storage is read only in the effect; the first render is `CLOSED` + `hydrated: false`.

- [ ] **Step 8: Add the constants** to `src/lib/boards/intelligence/constants.ts` (block above, with one-line comments).

- [ ] **Step 9: Run both suites and gates**

Run: `pnpm vitest run src/stores/board-intelligence.test.ts src/components/boards/dock` then `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/stores/board-intelligence.ts src/stores/board-intelligence.test.ts src/components/boards/dock/use-dock-state.ts src/components/boards/dock/use-dock-state.test.ts src/lib/boards/intelligence/constants.ts src/lib/ai/board-intelligence/runs.ts
git commit -m "feat(boards): intelligence bridge store, dock tab state and Phase 2 constants"
```

---

### Task 3: Output schema, board context and validation; feature key

**Files:**

- Create: `src/lib/ai/board-intelligence/schema.ts`, `schema.test.ts`
- Create: `src/lib/ai/board-intelligence/board-context.ts`, `board-context.test.ts`
- Create: `src/lib/ai/board-intelligence/validate.ts`, `validate.test.ts`
- Modify: `src/lib/ai/model-map.ts` (add `board_intelligence: "standard"`), `src/lib/ai/model-map.test.ts` (`toHaveLength(15)`)
- Modify (or create if Task 2 has not run): `src/lib/ai/board-intelligence/runs.ts` — the shared type declarations live in `schema.ts`; `runs.ts` re-exports `BoardIntelligencePayload`/`Suggestion`/`Action` from `./schema` and keeps `BoardIntelligenceRun`.

**Interfaces:**

- Consumes: `SignalKind` (`@/lib/boards/intelligence/types`), `BoardPayload` (`@/lib/boards/queries`), `parseColumnOptions` (`@/lib/boards/column-options`), `sanitizeInline` (`@/lib/ai/prompt-sanitize`), `Member = { userId: string; fullName: string | null }` (`@/lib/collaboration/activity`).
- Produces:

```ts
// schema.ts
export const BOARD_INTELLIGENCE_JSON_SCHEMA: object;           // what the model sees
export const rawOutputSchema: z.ZodType<RawOutput>;             // shape the model returns (flat actions)
export type RawOutput = { brief: string; suggestions: RawSuggestion[] };
export type RawSuggestion = { kind: SuggestionKind; title: string; evidence: string; body: string; evidenceItemIds: string[]; actions: RawAction[] };
export type RawAction = { type: "reassign"|"set_due"|"set_status"|"nudge"|"filter"; itemIds: string[]|null; itemId: string|null; columnId: string|null; toUserId: string|null; date: string|null; optionId: string|null; userId: string|null; message: string|null; signalKind: string|null };
export type SuggestionKind, Action, Suggestion, BoardIntelligencePayload; // as in "Shared types"
export const actionSchema: z.ZodType<Action>;                   // the CLOSED union used at apply time
export const payloadSchema: z.ZodType<BoardIntelligencePayload>; // parse of the stored jsonb (fail-closed)

// board-context.ts
export type BoardContext = {
  boardId: string; orgId: string;
  items: Map<string, { id: string; name: string; groupId: string; parentId: string | null }>;
  columns: Map<string, { id: string; name: string; kind: string; options: Map<string, string> /* optionId → label */ }>;
  members: Map<string, string>; // userId → display name
};
export function buildBoardContext(payload: BoardPayload, members: readonly Member[]): BoardContext;

// validate.ts
export function validateIntelligenceOutput(raw: unknown, ctx: BoardContext, signals: { kind: SignalKind; count: number; label: string }[]): { payload: BoardIntelligencePayload; warnings: string[] };
export function toAction(raw: RawAction, ctx: BoardContext): Action | null;  // null = dropped
```

- [ ] **Step 1: Schema tests**

Create `src/lib/ai/board-intelligence/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  BOARD_INTELLIGENCE_JSON_SCHEMA,
  actionSchema,
  payloadSchema,
  rawOutputSchema,
} from "./schema";

const rawAction = (over: Partial<Record<string, unknown>> = {}) => ({
  type: "filter",
  itemIds: null,
  itemId: null,
  columnId: null,
  toUserId: null,
  date: null,
  optionId: null,
  userId: null,
  message: null,
  signalKind: "overdue",
  ...over,
});

describe("board intelligence schemas", () => {
  it("the model-facing JSON schema requires every action field (strict structured output)", () => {
    const s = BOARD_INTELLIGENCE_JSON_SCHEMA as {
      properties: {
        suggestions: {
          items: {
            properties: {
              actions: {
                items: { required: string[]; additionalProperties: boolean };
              };
            };
          };
        };
      };
    };
    const action = s.properties.suggestions.items.properties.actions.items;
    expect(action.additionalProperties).toBe(false);
    expect(action.required).toEqual([
      "type",
      "itemIds",
      "itemId",
      "columnId",
      "toUserId",
      "date",
      "optionId",
      "userId",
      "message",
      "signalKind",
    ]);
  });

  it("parses a raw output and caps lengths", () => {
    const ok = rawOutputSchema.safeParse({
      brief: "Three items slipped this week.",
      suggestions: [
        {
          kind: "overdue",
          title: "Push the launch",
          evidence: "3 overdue",
          body: "b",
          evidenceItemIds: ["i1"],
          actions: [rawAction()],
        },
      ],
    });
    expect(ok.success).toBe(true);
    const tooLong = rawOutputSchema.safeParse({
      brief: "x".repeat(701),
      suggestions: [],
    });
    expect(tooLong.success).toBe(false);
    const six = rawOutputSchema.safeParse({
      brief: "b",
      suggestions: Array.from({ length: 6 }, () => ({
        kind: "other",
        title: "t",
        evidence: "e",
        body: "b",
        evidenceItemIds: [],
        actions: [rawAction()],
      })),
    });
    expect(six.success).toBe(false);
  });

  it("rejects an unknown action type in the closed union", () => {
    expect(
      actionSchema.safeParse({ type: "delete_item", itemId: "i", label: "x" })
        .success,
    ).toBe(false);
    expect(
      actionSchema.safeParse({
        type: "set_due",
        itemId: "i",
        columnId: "c",
        date: "2026-09-12",
        label: "Set due 12 Sep",
      }).success,
    ).toBe(true);
    expect(
      actionSchema.safeParse({
        type: "set_due",
        itemId: "i",
        columnId: "c",
        date: "12/09/2026",
        label: "x",
      }).success,
    ).toBe(false);
  });

  it("stored payload parse fails closed on a malformed row", () => {
    expect(payloadSchema.safeParse({ brief: "b" }).success).toBe(false);
    expect(
      payloadSchema.safeParse({ brief: "b", suggestions: [], signals: [] })
        .success,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL (module missing)**

- [ ] **Step 3: Implement `schema.ts`**

```ts
// src/lib/ai/board-intelligence/schema.ts
import { z } from "zod";
import type { SignalKind } from "@/lib/boards/intelligence/types";
import { MAX_SUGGESTIONS } from "@/lib/boards/intelligence/constants";

/* ── What the MODEL returns. Hand-written JSON Schema (house convention:
   REPORT_NARRATIVE_JSON_SCHEMA in src/lib/reports/ai-draft-schema.ts). Every
   action field is REQUIRED and nullable — strict structured output rejects
   optional keys on several providers, and a flat object with a `type`
   discriminator avoids oneOf (src/lib/ai/providers/google.ts:53). ── */
const nullableString = { type: ["string", "null"] } as const;
export const BOARD_INTELLIGENCE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["brief", "suggestions"],
  properties: {
    brief: { type: "string" },
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "kind",
          "title",
          "evidence",
          "body",
          "evidenceItemIds",
          "actions",
        ],
        properties: {
          kind: {
            type: "string",
            enum: [
              "overdue",
              "blocked",
              "overloaded",
              "stalled",
              "changed",
              "other",
            ],
          },
          title: { type: "string" },
          evidence: { type: "string" },
          body: { type: "string" },
          evidenceItemIds: { type: "array", items: { type: "string" } },
          actions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "type",
                "itemIds",
                "itemId",
                "columnId",
                "toUserId",
                "date",
                "optionId",
                "userId",
                "message",
                "signalKind",
              ],
              properties: {
                type: {
                  type: "string",
                  enum: [
                    "reassign",
                    "set_due",
                    "set_status",
                    "nudge",
                    "filter",
                  ],
                },
                itemIds: { type: ["array", "null"], items: { type: "string" } },
                itemId: nullableString,
                columnId: nullableString,
                toUserId: nullableString,
                date: nullableString,
                optionId: nullableString,
                userId: nullableString,
                message: nullableString,
                signalKind: nullableString,
              },
            },
          },
        },
      },
    },
  },
} as const;

/* ── Zod for the SAME shape, carrying the length caps the JSON Schema omits. ── */
const suggestionKind = z.enum([
  "overdue",
  "blocked",
  "overloaded",
  "stalled",
  "changed",
  "other",
]);
export type SuggestionKind = z.infer<typeof suggestionKind>;

const rawActionSchema = z.object({
  type: z.enum(["reassign", "set_due", "set_status", "nudge", "filter"]),
  itemIds: z.array(z.string()).max(50).nullable(),
  itemId: z.string().nullable(),
  columnId: z.string().nullable(),
  toUserId: z.string().nullable(),
  date: z.string().nullable(),
  optionId: z.string().nullable(),
  userId: z.string().nullable(),
  message: z.string().max(280).nullable(),
  signalKind: z.string().nullable(),
});
export type RawAction = z.infer<typeof rawActionSchema>;

const rawSuggestionSchema = z.object({
  kind: suggestionKind,
  title: z.string().min(1).max(80),
  evidence: z.string().max(40),
  body: z.string().max(240),
  evidenceItemIds: z.array(z.string()).max(8),
  actions: z.array(rawActionSchema).min(1).max(2),
});
export type RawSuggestion = z.infer<typeof rawSuggestionSchema>;

export const rawOutputSchema = z.object({
  brief: z.string().min(1).max(700),
  suggestions: z.array(rawSuggestionSchema).max(MAX_SUGGESTIONS),
});
export type RawOutput = z.infer<typeof rawOutputSchema>;

/* ── The CLOSED union that may ever be APPLIED (spec §4.4, §7). ── */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const signalKind = z.enum([
  "overdue",
  "overloaded",
  "stalled",
  "changed",
  "blocked",
]);
const label = z.string().min(1).max(60);
export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("reassign"),
    itemIds: z.array(z.string()).min(1).max(50),
    columnId: z.string(),
    toUserId: z.string(),
    label,
  }),
  z.object({
    type: z.literal("set_due"),
    itemId: z.string(),
    columnId: z.string(),
    date: isoDate,
    label,
  }),
  z.object({
    type: z.literal("set_status"),
    itemId: z.string(),
    columnId: z.string(),
    optionId: z.string(),
    label,
  }),
  z.object({
    type: z.literal("nudge"),
    itemId: z.string(),
    userId: z.string(),
    message: z.string().min(1).max(280),
    label,
  }),
  z.object({ type: z.literal("filter"), signalKind, label }),
]);
export type Action = z.infer<typeof actionSchema>;

export const suggestionSchema = z.object({
  id: z.string().min(1).max(8),
  kind: suggestionKind,
  title: z.string().min(1).max(80),
  evidence: z.string().max(40),
  body: z.string().max(240),
  evidenceRows: z
    .array(
      z.object({
        itemId: z.string(),
        name: z.string().max(255),
        detail: z.string().max(120),
      }),
    )
    .max(8),
  actions: z.array(actionSchema).min(1).max(2),
});
export type Suggestion = z.infer<typeof suggestionSchema>;

/** The jsonb we store; parsed again on every read, failing CLOSED (a run row
 *  an older client wrote in another shape is treated as "no run"). */
export const payloadSchema = z.object({
  brief: z.string().max(700),
  suggestions: z.array(suggestionSchema).max(MAX_SUGGESTIONS),
  signals: z
    .array(
      z.object({
        kind: signalKind,
        count: z.number().int().nonnegative(),
        label: z.string().max(80),
      }),
    )
    .max(10),
});
export type BoardIntelligencePayload = z.infer<typeof payloadSchema>;
export type { SignalKind };
```

Then make `src/lib/ai/board-intelligence/runs.ts` contain:

```ts
import type { BoardIntelligencePayload } from "./schema";
export type {
  Action,
  BoardIntelligencePayload,
  Suggestion,
  SuggestionKind,
} from "./schema";

export type BoardIntelligenceRun = {
  id: string;
  boardId: string;
  generatedAt: string;
  inputHash: string;
  payload: BoardIntelligencePayload;
  dismissed: string[];
  applied: string[];
  model: string | null;
  tokensIn: number;
  tokensOut: number;
};
```

(Task 5 adds functions to this file; keep it a plain module with no `server-only` so the store can import the types.)

- [ ] **Step 4: Run schema test → PASS**

- [ ] **Step 5: Board-context + validate tests**

Create `src/lib/ai/board-intelligence/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildBoardContext } from "./board-context";
import { toAction, validateIntelligenceOutput } from "./validate";
import type { BoardPayload } from "@/lib/boards/queries";

// Minimal payload: one group, a status column with two options, a date column,
// a people column, two items, one member. Cast through unknown — only the
// fields buildBoardContext reads are present.
const payload = {
  board: { id: "b1", org_id: "o1", name: "Launch" },
  groups: [{ id: "g1", name: "Sprint", position: 0 }],
  columns: [
    {
      id: "c-status",
      name: "Status",
      kind: "status",
      settings: {
        options: [
          { id: "o-done", label: "Done", color: "green" },
          { id: "o-stuck", label: "Stuck", color: "red" },
        ],
      },
    },
    { id: "c-date", name: "Due", kind: "date", settings: {} },
    { id: "c-people", name: "Owner", kind: "people", settings: {} },
  ],
  items: [
    { id: "i1", name: "Ship", group_id: "g1", parent_id: null },
    { id: "i2", name: "Test", group_id: "g1", parent_id: null },
  ],
  cellValues: [],
  dependencies: [],
  views: [],
  attachments: [],
  timeEntries: [],
  relationLinks: [],
  mirrorTargetCells: [],
  mirrorTargetColumns: [],
} as unknown as BoardPayload;
const members = [
  { userId: "u-ana", fullName: "Ana Lima" },
  { userId: "u-bo", fullName: null },
];
const ctx = buildBoardContext(payload, members);
const base = {
  itemIds: null,
  itemId: null,
  columnId: null,
  toUserId: null,
  date: null,
  optionId: null,
  userId: null,
  message: null,
  signalKind: null,
};

describe("buildBoardContext", () => {
  it("indexes items, columns with option labels, and member names", () => {
    expect(ctx.items.get("i1")?.name).toBe("Ship");
    expect(ctx.columns.get("c-status")?.options.get("o-stuck")).toBe("Stuck");
    expect(ctx.members.get("u-ana")).toBe("Ana Lima");
    expect(ctx.members.get("u-bo")).toBe("Someone");
  });
});

describe("toAction", () => {
  it("builds a labelled reassign when items, column kind and member all check out", () => {
    expect(
      toAction(
        {
          ...base,
          type: "reassign",
          itemIds: ["i1", "i2"],
          columnId: "c-people",
          toUserId: "u-ana",
        },
        ctx,
      ),
    ).toEqual({
      type: "reassign",
      itemIds: ["i1", "i2"],
      columnId: "c-people",
      toUserId: "u-ana",
      label: "Reassign 2 items to Ana Lima",
    });
  });
  it("drops a reassign whose column is not a people column or whose user is off-board", () => {
    expect(
      toAction(
        {
          ...base,
          type: "reassign",
          itemIds: ["i1"],
          columnId: "c-status",
          toUserId: "u-ana",
        },
        ctx,
      ),
    ).toBeNull();
    expect(
      toAction(
        {
          ...base,
          type: "reassign",
          itemIds: ["i1"],
          columnId: "c-people",
          toUserId: "u-zed",
        },
        ctx,
      ),
    ).toBeNull();
  });
  it("drops an item id that is not on the board", () => {
    expect(
      toAction(
        {
          ...base,
          type: "set_due",
          itemId: "i9",
          columnId: "c-date",
          date: "2026-09-20",
        },
        ctx,
      ),
    ).toBeNull();
  });
  it("checks status options against the column", () => {
    expect(
      toAction(
        {
          ...base,
          type: "set_status",
          itemId: "i1",
          columnId: "c-status",
          optionId: "o-done",
        },
        ctx,
      ),
    ).toEqual({
      type: "set_status",
      itemId: "i1",
      columnId: "c-status",
      optionId: "o-done",
      label: "Mark Ship as Done",
    });
    expect(
      toAction(
        {
          ...base,
          type: "set_status",
          itemId: "i1",
          columnId: "c-status",
          optionId: "o-nope",
        },
        ctx,
      ),
    ).toBeNull();
  });
  it("rejects a malformed date and an unknown signal kind", () => {
    expect(
      toAction(
        {
          ...base,
          type: "set_due",
          itemId: "i1",
          columnId: "c-date",
          date: "next week",
        },
        ctx,
      ),
    ).toBeNull();
    expect(
      toAction({ ...base, type: "filter", signalKind: "urgent" }, ctx),
    ).toBeNull();
    expect(
      toAction({ ...base, type: "filter", signalKind: "overdue" }, ctx),
    ).toEqual({
      type: "filter",
      signalKind: "overdue",
      label: "Show overdue rows",
    });
  });
  it("sanitizes the nudge message and names the recipient", () => {
    expect(
      toAction(
        {
          ...base,
          type: "nudge",
          itemId: "i2",
          userId: "u-ana",
          message: "Ping <b>now</b>\nplease",
        },
        ctx,
      ),
    ).toEqual({
      type: "nudge",
      itemId: "i2",
      userId: "u-ana",
      message: "Ping bnow/b please",
      label: "Nudge Ana Lima",
    });
  });
});

describe("validateIntelligenceOutput", () => {
  const signals = [{ kind: "overdue" as const, count: 1, label: "overdue" }];
  it("keeps the brief, drops suggestions with no valid action, mints ids, resolves evidence rows", () => {
    const { payload: out, warnings } = validateIntelligenceOutput(
      {
        brief: "One item is late.",
        suggestions: [
          {
            kind: "overdue",
            title: "Push Ship",
            evidence: "1 overdue",
            body: "b",
            evidenceItemIds: ["i1", "i9"],
            actions: [
              {
                ...base,
                type: "set_due",
                itemId: "i1",
                columnId: "c-date",
                date: "2026-09-20",
              },
              {
                ...base,
                type: "set_due",
                itemId: "i9",
                columnId: "c-date",
                date: "2026-09-20",
              },
            ],
          },
          {
            kind: "other",
            title: "Nonsense",
            evidence: "",
            body: "",
            evidenceItemIds: [],
            actions: [
              {
                ...base,
                type: "reassign",
                itemIds: ["i9"],
                columnId: "c-people",
                toUserId: "u-ana",
              },
            ],
          },
        ],
      },
      ctx,
      signals,
    );
    expect(out.brief).toBe("One item is late.");
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0]).toMatchObject({
      id: "s1",
      actions: [{ type: "set_due", itemId: "i1" }],
      evidenceRows: [{ itemId: "i1", name: "Ship" }],
    });
    expect(out.signals).toEqual(signals);
    expect(warnings.length).toBeGreaterThan(0);
  });
  it("throws on a shape the raw schema rejects", () => {
    expect(() =>
      validateIntelligenceOutput({ brief: 1 }, ctx, signals),
    ).toThrow();
  });
});
```

- [ ] **Step 6: Run → FAIL (modules missing)**

- [ ] **Step 7: Implement `board-context.ts` and `validate.ts`**

```ts
// src/lib/ai/board-intelligence/board-context.ts
import type { BoardPayload } from "@/lib/boards/queries";
import { parseColumnOptions } from "@/lib/boards/column-options";
import type { Member } from "@/lib/collaboration/activity";

export type BoardContext = {
  boardId: string;
  orgId: string;
  items: Map<
    string,
    { id: string; name: string; groupId: string; parentId: string | null }
  >;
  columns: Map<
    string,
    { id: string; name: string; kind: string; options: Map<string, string> }
  >;
  members: Map<string, string>;
};

/** Everything validation, labelling and apply need to check a model-supplied
 *  id against the board — built once from the RLS-scoped payload. */
export function buildBoardContext(
  payload: BoardPayload,
  members: readonly Member[],
): BoardContext {
  return {
    boardId: payload.board.id,
    orgId: payload.board.org_id,
    items: new Map(
      payload.items.map((i) => [
        i.id,
        { id: i.id, name: i.name, groupId: i.group_id, parentId: i.parent_id },
      ]),
    ),
    columns: new Map(
      payload.columns.map((c) => [
        c.id,
        {
          id: c.id,
          name: c.name,
          kind: c.kind,
          options: new Map(
            parseColumnOptions(c.settings).map((o) => [o.id, o.label]),
          ),
        },
      ]),
    ),
    members: new Map(members.map((m) => [m.userId, m.fullName ?? "Someone"])),
  };
}
```

```ts
// src/lib/ai/board-intelligence/validate.ts
import { sanitizeInline } from "@/lib/ai/prompt-sanitize";
import type { SignalKind } from "@/lib/boards/intelligence/types";
import type { BoardContext } from "./board-context";
import {
  rawOutputSchema,
  type Action,
  type BoardIntelligencePayload,
  type RawAction,
} from "./schema";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SIGNAL_KINDS: readonly SignalKind[] = [
  "overdue",
  "overloaded",
  "stalled",
  "changed",
  "blocked",
];
const isSignalKind = (s: string): s is SignalKind =>
  (SIGNAL_KINDS as readonly string[]).includes(s);

/** Turn one flat model action into a member of the closed union, or null when
 *  any id is not on the board, the column kind does not fit, or a value is
 *  malformed. Labels are resolved HERE, once, so the dock needs no payload. */
export function toAction(raw: RawAction, ctx: BoardContext): Action | null {
  const item = (id: string | null) => (id ? ctx.items.get(id) : undefined);
  const col = (id: string | null, kind: string) => {
    const c = id ? ctx.columns.get(id) : undefined;
    return c && c.kind === kind ? c : undefined;
  };
  switch (raw.type) {
    case "reassign": {
      const ids = (raw.itemIds ?? []).filter((id) => ctx.items.has(id));
      const c = col(raw.columnId, "people");
      const name = raw.toUserId ? ctx.members.get(raw.toUserId) : undefined;
      if (ids.length === 0 || !c || !raw.toUserId || !name) return null;
      return {
        type: "reassign",
        itemIds: ids,
        columnId: c.id,
        toUserId: raw.toUserId,
        label: `Reassign ${ids.length === 1 ? (item(ids[0])?.name ?? "1 item") : `${ids.length} items`} to ${name}`,
      };
    }
    case "set_due": {
      const it = item(raw.itemId);
      const c = col(raw.columnId, "date");
      if (!it || !c || !raw.date || !ISO_DATE.test(raw.date)) return null;
      return {
        type: "set_due",
        itemId: it.id,
        columnId: c.id,
        date: raw.date,
        label: `Set ${c.name} to ${raw.date}`,
      };
    }
    case "set_status": {
      const it = item(raw.itemId);
      const c = col(raw.columnId, "status");
      const opt = c && raw.optionId ? c.options.get(raw.optionId) : undefined;
      if (!it || !c || !raw.optionId || !opt) return null;
      return {
        type: "set_status",
        itemId: it.id,
        columnId: c.id,
        optionId: raw.optionId,
        label: `Mark ${it.name} as ${opt}`,
      };
    }
    case "nudge": {
      const it = item(raw.itemId);
      const name = raw.userId ? ctx.members.get(raw.userId) : undefined;
      const message = raw.message
        ? sanitizeInline(raw.message).trim().slice(0, 280)
        : "";
      if (!it || !raw.userId || !name || message.length === 0) return null;
      return {
        type: "nudge",
        itemId: it.id,
        userId: raw.userId,
        message,
        label: `Nudge ${name}`,
      };
    }
    case "filter": {
      if (!raw.signalKind || !isSignalKind(raw.signalKind)) return null;
      return {
        type: "filter",
        signalKind: raw.signalKind,
        label: `Show ${raw.signalKind} rows`,
      };
    }
  }
}

/**
 * Validate the model's output against the board (spec §4.4): the raw shape
 * must parse (throws otherwise — the caller maps it to a user-facing error);
 * a suggestion survives only if at least one action survives `toAction`;
 * evidence rows resolve to real item names; ids are minted s1..sN in order.
 * The brief is kept even when zero suggestions survive.
 */
export function validateIntelligenceOutput(
  raw: unknown,
  ctx: BoardContext,
  signals: BoardIntelligencePayload["signals"],
): { payload: BoardIntelligencePayload; warnings: string[] } {
  const parsed = rawOutputSchema.parse(raw);
  const warnings: string[] = [];
  const suggestions: BoardIntelligencePayload["suggestions"] = [];
  for (const s of parsed.suggestions) {
    const actions = s.actions
      .map((a) => toAction(a, ctx))
      .filter((a): a is Action => a !== null);
    if (actions.length === 0) {
      warnings.push(`Dropped "${s.title}": no valid action`);
      continue;
    }
    if (actions.length < s.actions.length)
      warnings.push(
        `"${s.title}": dropped ${s.actions.length - actions.length} invalid action(s)`,
      );
    const evidenceRows = s.evidenceItemIds.flatMap((id) => {
      const it = ctx.items.get(id);
      return it ? [{ itemId: it.id, name: it.name, detail: "" }] : [];
    });
    suggestions.push({
      id: `s${suggestions.length + 1}`,
      kind: s.kind,
      title: sanitizeInline(s.title).slice(0, 80),
      evidence: sanitizeInline(s.evidence).slice(0, 40),
      body: sanitizeInline(s.body).slice(0, 240),
      evidenceRows,
      actions,
    });
  }
  return {
    payload: { brief: parsed.brief.trim(), suggestions, signals },
    warnings,
  };
}
```

- [ ] **Step 8: Feature key**

In `src/lib/ai/model-map.ts` add `board_intelligence: "standard",` under the "Structured generation" group; in `src/lib/ai/model-map.test.ts` change `toHaveLength(14)` to `15`.

- [ ] **Step 9: Run tests + gates**

Run: `pnpm vitest run src/lib/ai/board-intelligence src/lib/ai/model-map.test.ts` then `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/ai/board-intelligence/schema.ts src/lib/ai/board-intelligence/schema.test.ts src/lib/ai/board-intelligence/board-context.ts src/lib/ai/board-intelligence/validate.ts src/lib/ai/board-intelligence/validate.test.ts src/lib/ai/board-intelligence/runs.ts src/lib/ai/model-map.ts src/lib/ai/model-map.test.ts
git commit -m "feat(ai): board intelligence output schema, board-checked validation and feature key"
```

---

### Task 4: Transcript, input hash, prompt and generation

**Files:**

- Create: `src/lib/ai/board-intelligence/transcript.ts`, `transcript.test.ts`
- Create: `src/lib/ai/board-intelligence/input-hash.ts`, `input-hash.test.ts`
- Create: `src/lib/ai/board-intelligence/prompt.ts`, `prompt.test.ts`
- Create: `src/lib/ai/board-intelligence/generate.ts`, `generate.test.ts`
- Modify: `src/lib/ai/summarize/summarize.ts` — add `export` to `describeActivityLine` (no other change)

**Interfaces:**

- Consumes: `resolveActivity`, `Column`, `Member` (`@/lib/collaboration/activity`); `describeActivityLine` (`@/lib/ai/summarize/summarize` — now exported); `estimateTokens` (`@/lib/agents/document-budget`); `sanitizeInline`; `BoardSnapshot` (`@/lib/ai/board-snapshot`); `Signal` (`@/lib/boards/intelligence/types`); `BoardContext` (Task 3); `BOARD_INTELLIGENCE_JSON_SCHEMA` (Task 3); `ProviderAdapter`, `GenerateArgs` (`@/lib/ai/providers/types`); `toRequestArgs` (`@/lib/ai/providers/request`); `AiUsageTokens` (`@/lib/ai/pricing`); constants from Task 2.
- Produces:

```ts
// transcript.ts
export function buildBoardTranscript(args: {
  updates: readonly Tables<"item_updates">[]; // newest-first from the query
  activities: readonly Tables<"item_activities">[]; // newest-first
  columns: readonly Column[];
  members: readonly Member[];
  itemNames: ReadonlyMap<string, string>;
  tokenBudget: number;
}): string; // "" when empty; oldest→newest; trimmed oldest-first to budget

// input-hash.ts
export function intelligenceInputHash(input: {
  itemCount: number;
  maxUpdatedAt: string | null;
  signals: readonly { kind: string; count: number }[];
}): string; // sha256 hex

// prompt.ts
export function systemPrompt(): string;
export function buildUserPrompt(input: PromptInput): string;
export type PromptInput = {
  snapshot: BoardSnapshot;
  ctx: BoardContext;
  signals: readonly Signal[];
  transcript: string;
  now: string;
  timezone: string;
  cellValues: readonly { item_id: string; column_id: string; value: unknown }[];
  itemsByRecency: readonly { id: string; updated_at: string }[];
};
export function buildItemRoster(
  input: Pick<PromptInput, "ctx" | "signals" | "cellValues" | "itemsByRecency">,
  max: number,
): string[];

// generate.ts
export async function generateBoardIntelligence(
  input: PromptInput,
  opts: {
    adapter: ProviderAdapter;
    apiKey: string;
    baseUrl?: string | null;
    model: string;
  },
): Promise<{ raw: unknown; usage: AiUsageTokens; model: string }>;
```

- [ ] **Step 1: Transcript test**

```ts
// src/lib/ai/board-intelligence/transcript.test.ts
import { describe, expect, it } from "vitest";
import { buildBoardTranscript } from "./transcript";
import type { Tables } from "@/types/database.types";

const update = (
  over: Partial<Tables<"item_updates">>,
): Tables<"item_updates"> => ({
  id: "u1",
  org_id: "o",
  board_id: "b",
  item_id: "i1",
  author_id: "ana",
  body: { text: "hi" },
  body_text: "hi",
  edited_at: null,
  created_at: "2026-09-10T09:00:00.000Z",
  updated_at: "2026-09-10T09:00:00.000Z",
  ...over,
});
const activity = (
  over: Partial<Tables<"item_activities">>,
): Tables<"item_activities"> => ({
  id: "a1",
  org_id: "o",
  board_id: "b",
  item_id: "i2",
  actor_id: "ana",
  action: "item_created",
  column_id: null,
  old_value: null,
  new_value: null,
  created_at: "2026-09-09T09:00:00.000Z",
  source: "user",
  ...over,
});
const members = [{ userId: "ana", fullName: "Ana" }];
const itemNames = new Map([
  ["i1", "Ship"],
  ["i2", "Test"],
]);

describe("buildBoardTranscript", () => {
  it("returns the empty sentinel with nothing to say", () => {
    expect(
      buildBoardTranscript({
        updates: [],
        activities: [],
        columns: [],
        members,
        itemNames,
        tokenBudget: 100,
      }),
    ).toBe("");
  });
  it("prefixes every line with the item name and sorts oldest first", () => {
    const out = buildBoardTranscript({
      updates: [update({})],
      activities: [activity({})],
      columns: [],
      members,
      itemNames,
      tokenBudget: 1000,
    });
    expect(out.split("\n")).toEqual([
      "[2026-09-09T09:00:00.000Z] (Test) Ana created this item",
      "[2026-09-10T09:00:00.000Z] (Ship) Ana: hi",
    ]);
  });
  it("drops the OLDEST lines first when over the token budget", () => {
    const updates = Array.from({ length: 20 }, (_, i) =>
      update({
        id: `u${i}`,
        body_text: "x".repeat(100),
        created_at: `2026-09-0${(i % 9) + 1}T0${i % 10}:00:00.000Z`,
      }),
    );
    const out = buildBoardTranscript({
      updates,
      activities: [],
      columns: [],
      members,
      itemNames,
      tokenBudget: 200,
    });
    const lines = out.split("\n");
    expect(lines.length).toBeLessThan(20);
    expect(lines.at(-1)).toContain("2026-09-09T0"); // the newest survived
  });
  it("sanitizes update bodies (no newlines, no angle brackets)", () => {
    const out = buildBoardTranscript({
      updates: [update({ body_text: "a\n<b>c</b>" })],
      activities: [],
      columns: [],
      members,
      itemNames,
      tokenBudget: 1000,
    });
    expect(out).toContain("(Ship) Ana: a bc/b");
  });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement `transcript.ts`** (and export `describeActivityLine` in `summarize.ts`)

```ts
// src/lib/ai/board-intelligence/transcript.ts
import { estimateTokens } from "@/lib/agents/document-budget";
import { sanitizeInline } from "@/lib/ai/prompt-sanitize";
import { describeActivityLine } from "@/lib/ai/summarize/summarize";
import {
  resolveActivity,
  type Column,
  type Member,
} from "@/lib/collaboration/activity";
import type { Tables } from "@/types/database.types";

type Entry = { at: string; line: string };

function nameOf(userId: string | null, members: readonly Member[]): string {
  if (!userId) return "Someone";
  return sanitizeInline(
    members.find((m) => m.userId === userId)?.fullName ?? "Someone",
  );
}

/**
 * Board-level sibling of summarize.ts's buildTranscript: the same line
 * grammar, prefixed with the item name so the model can tell rows apart, and
 * trimmed OLDEST-FIRST to `tokenBudget` (the newest activity is what a brief
 * is about). Both reads arrive newest-first; output is oldest→newest.
 */
export function buildBoardTranscript(args: {
  updates: readonly Tables<"item_updates">[];
  activities: readonly Tables<"item_activities">[];
  columns: readonly Column[];
  members: readonly Member[];
  itemNames: ReadonlyMap<string, string>;
  tokenBudget: number;
}): string {
  const { updates, activities, columns, members, itemNames, tokenBudget } =
    args;
  if (updates.length === 0 && activities.length === 0) return "";
  const item = (id: string) =>
    `(${sanitizeInline(itemNames.get(id) ?? "an item")})`;
  const entries: Entry[] = [
    ...updates.map((u): Entry => ({
      at: u.created_at,
      line: `${item(u.item_id)} ${nameOf(u.author_id, members)}: ${sanitizeInline(u.body_text)}`,
    })),
    ...activities.map((a): Entry => ({
      at: a.created_at,
      line: `${item(a.item_id)} ${nameOf(a.actor_id, members)} ${sanitizeInline(describeActivityLine(resolveActivity(a, columns, members)))}`,
    })),
  ];
  entries.sort((a, b) => a.at.localeCompare(b.at));
  let lines = entries.map((e) => `[${e.at}] ${e.line}`);
  while (lines.length > 1 && estimateTokens(lines.join("\n")) > tokenBudget)
    lines = lines.slice(1);
  return lines.join("\n");
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Input hash test + implementation**

```ts
// src/lib/ai/board-intelligence/input-hash.test.ts
import { describe, expect, it } from "vitest";
import { intelligenceInputHash } from "./input-hash";

describe("intelligenceInputHash", () => {
  const base = {
    itemCount: 3,
    maxUpdatedAt: "2026-09-11T10:00:00.000Z",
    signals: [{ kind: "overdue", count: 1 }],
  };
  it("is stable for equal input and 64 hex chars", () => {
    expect(intelligenceInputHash(base)).toBe(
      intelligenceInputHash({ ...base }),
    );
    expect(intelligenceInputHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("changes when the item count, the latest edit, or a signal count changes", () => {
    expect(intelligenceInputHash({ ...base, itemCount: 4 })).not.toBe(
      intelligenceInputHash(base),
    );
    expect(
      intelligenceInputHash({
        ...base,
        maxUpdatedAt: "2026-09-11T10:00:01.000Z",
      }),
    ).not.toBe(intelligenceInputHash(base));
    expect(
      intelligenceInputHash({
        ...base,
        signals: [{ kind: "overdue", count: 2 }],
      }),
    ).not.toBe(intelligenceInputHash(base));
  });
  it("ignores signal order", () => {
    const a = intelligenceInputHash({
      ...base,
      signals: [
        { kind: "overdue", count: 1 },
        { kind: "stalled", count: 2 },
      ],
    });
    const b = intelligenceInputHash({
      ...base,
      signals: [
        { kind: "stalled", count: 2 },
        { kind: "overdue", count: 1 },
      ],
    });
    expect(a).toBe(b);
  });
});
```

```ts
// src/lib/ai/board-intelligence/input-hash.ts
import { createHash } from "node:crypto";

/** Spec §4.5: hash of item count, max updated_at across items, and the signal
 *  counts. Same input → same hash → the cached run is served without a model call. */
export function intelligenceInputHash(input: {
  itemCount: number;
  maxUpdatedAt: string | null;
  signals: readonly { kind: string; count: number }[];
}): string {
  const sig = [...input.signals]
    .sort((a, b) => a.kind.localeCompare(b.kind))
    .map((s) => `${s.kind}=${s.count}`)
    .join(",");
  return createHash("sha256")
    .update(`${input.itemCount}|${input.maxUpdatedAt ?? ""}|${sig}`)
    .digest("hex");
}
```

- [ ] **Step 6: Prompt test**

```ts
// src/lib/ai/board-intelligence/prompt.test.ts
import { describe, expect, it } from "vitest";
import { buildItemRoster, buildUserPrompt, systemPrompt } from "./prompt";
import { buildBoardContext } from "./board-context";
import type { BoardPayload } from "@/lib/boards/queries";
import type { BoardSnapshot } from "@/lib/ai/board-snapshot";

const payload = {
  board: { id: "b1", org_id: "o1", name: "Launch <x>" },
  groups: [{ id: "g1", name: "Sprint" }],
  columns: [
    {
      id: "c-status",
      name: "Status",
      kind: "status",
      settings: { options: [{ id: "o-done", label: "Done", color: "green" }] },
    },
    { id: "c-date", name: "Due", kind: "date", settings: {} },
    { id: "c-people", name: "Owner", kind: "people", settings: {} },
  ],
  items: [
    {
      id: "i1",
      name: "Ship\nit",
      group_id: "g1",
      parent_id: null,
      updated_at: "2026-09-10T00:00:00.000Z",
    },
    {
      id: "i2",
      name: "Test",
      group_id: "g1",
      parent_id: null,
      updated_at: "2026-09-11T00:00:00.000Z",
    },
    {
      id: "i3",
      name: "Docs",
      group_id: "g1",
      parent_id: null,
      updated_at: "2026-09-01T00:00:00.000Z",
    },
  ],
  cellValues: [
    { item_id: "i1", column_id: "c-status", value: { optionId: "o-done" } },
    { item_id: "i1", column_id: "c-date", value: { date: "2026-09-01" } },
    { item_id: "i1", column_id: "c-people", value: { userIds: ["u-ana"] } },
  ],
  dependencies: [],
  views: [],
  attachments: [],
  timeEntries: [],
  relationLinks: [],
  mirrorTargetCells: [],
  mirrorTargetColumns: [],
} as unknown as BoardPayload;
const ctx = buildBoardContext(payload, [{ userId: "u-ana", fullName: "Ana" }]);
const signals = [
  {
    kind: "overdue" as const,
    count: 1,
    label: "overdue",
    tone: "red" as const,
    itemIds: ["i3"],
  },
];
const snapshot = {
  board: { id: "b1", name: "Launch <x>" },
  rowCount: 3,
  groups: [{ id: "g1", name: "Sprint" }],
  columns: [],
  columnStats: {},
  meta: { rowCount: 3, columnCount: 3, estimatedTokens: 10 },
} as BoardSnapshot;
const input = {
  snapshot,
  ctx,
  signals,
  transcript: "[t] (Ship) Ana: hi",
  now: "2026-09-11T12:00:00.000Z",
  timezone: "Europe/Berlin",
  cellValues: payload.cellValues,
  itemsByRecency: payload.items,
};

describe("prompt", () => {
  it("system prompt forbids markdown and invented ids", () => {
    const s = systemPrompt();
    expect(s).toMatch(/plain prose/i);
    expect(s).toMatch(/only ids that appear/i);
    expect(s).toMatch(/at most 5 suggestions/i);
  });
  it("roster puts signal items first, then by recency, capped", () => {
    const rows = buildItemRoster(input, 2);
    expect(rows[0]).toContain("i3"); // the overdue item leads
    expect(rows[1]).toContain("i2"); // most recently edited next
    expect(rows).toHaveLength(2);
  });
  it("roster lines carry status label, date and owner names, sanitized", () => {
    const rows = buildItemRoster(input, 10);
    const ship = rows.find((r) => r.includes("i1"))!;
    expect(ship).toContain("Ship it");
    expect(ship).toContain("Status: Done");
    expect(ship).toContain("Due: 2026-09-01");
    expect(ship).toContain("Owner: Ana");
  });
  it("user prompt has the delimited sections and sanitized board name", () => {
    const u = buildUserPrompt(input);
    for (const h of [
      "=== SIGNALS ===",
      "=== COLUMNS ===",
      "=== MEMBERS ===",
      "=== ITEMS ===",
      "=== RECENT ACTIVITY (7 days) ===",
      "=== END ===",
    ])
      expect(u).toContain(h);
    expect(u).toContain("Launch x");
    expect(u).not.toContain("<x>");
    expect(u).toContain("u-ana | Ana");
    expect(u).toContain("c-status | Status | status | options: o-done=Done");
  });
});
```

- [ ] **Step 7: Run → FAIL; implement `prompt.ts`**

```ts
// src/lib/ai/board-intelligence/prompt.ts
import { sanitizeInline } from "@/lib/ai/prompt-sanitize";
import type { BoardSnapshot } from "@/lib/ai/board-snapshot";
import type { Signal } from "@/lib/boards/intelligence/types";
import { ROSTER_MAX_ITEMS } from "@/lib/boards/intelligence/constants";
import type { BoardContext } from "./board-context";

export type PromptInput = {
  snapshot: BoardSnapshot;
  ctx: BoardContext;
  signals: readonly Signal[];
  transcript: string;
  now: string;
  timezone: string;
  cellValues: readonly { item_id: string; column_id: string; value: unknown }[];
  itemsByRecency: readonly { id: string; updated_at: string }[];
};

export function systemPrompt(): string {
  return [
    "You are the Intelligence layer of a work board. You write a short brief of the last 7 days and propose concrete next actions.",
    "Base everything ONLY on the data between the === markers. Never invent items, people, dates or counts; the SIGNALS section holds the authoritative counts.",
    "Write the brief as 3 to 5 sentences of plain prose — no headings, no lists, no markdown.",
    'Propose at most 5 suggestions, most important first. Each has a short title, a terse evidence kicker (for example "3 overdue" or "140% → 95%"), a one-line body, the ids of the items it rests on, and 1–2 actions.',
    "Actions must use only ids that appear in the ITEMS, COLUMNS, MEMBERS or SIGNALS sections: reassign needs a people column and a member; set_due needs a date column and YYYY-MM-DD; set_status needs a status column and one of its option ids; nudge needs a member and a message under 200 characters; filter needs a signal kind.",
    "Fill every action field; use null for fields that do not apply to the action type.",
    "Prefer nothing over noise: when the board is quiet, say so in the brief and return no suggestions.",
  ].join("\n");
}

type CtxColumn =
  BoardContext["columns"] extends Map<string, infer C> ? C : never;

function valueText(
  kind: string,
  value: unknown,
  col: CtxColumn,
  ctx: BoardContext,
): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  switch (kind) {
    case "status":
      return typeof v.optionId === "string"
        ? (col.options.get(v.optionId) ?? null)
        : null;
    case "date":
      return typeof v.date === "string"
        ? v.date + (typeof v.end === "string" ? `→${v.end}` : "")
        : null;
    case "people":
      return Array.isArray(v.userIds)
        ? v.userIds
            .map((id) => ctx.members.get(String(id)) ?? "someone")
            .join(", ")
        : null;
    case "numbers":
      return typeof v.n === "number" ? String(v.n) : null;
    case "percent":
      return typeof v.percent === "number" ? `${v.percent}%` : null;
    case "priority":
      return typeof v.level === "string" ? v.level : null;
    default:
      return null;
  }
}

/** One line per item: `- <id> | <name> | <group> | Col: value · Col: value`.
 *  Signal items first (they are what suggestions rest on), then by recency. */
export function buildItemRoster(
  input: Pick<PromptInput, "ctx" | "signals" | "cellValues" | "itemsByRecency">,
  max = ROSTER_MAX_ITEMS,
): string[] {
  const { ctx, signals, cellValues, itemsByRecency } = input;
  const order: string[] = [];
  const seen = new Set<string>();
  for (const s of signals)
    for (const id of s.itemIds)
      if (ctx.items.has(id) && !seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
  for (const it of [...itemsByRecency].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at),
  ))
    if (!seen.has(it.id) && ctx.items.has(it.id)) {
      seen.add(it.id);
      order.push(it.id);
    }
  const byItem = new Map<string, { column_id: string; value: unknown }[]>();
  for (const c of cellValues) {
    const arr = byItem.get(c.item_id) ?? [];
    arr.push(c);
    byItem.set(c.item_id, arr);
  }
  return order.slice(0, max).map((id) => {
    const it = ctx.items.get(id)!;
    const cells = (byItem.get(id) ?? []).flatMap((c) => {
      const col = ctx.columns.get(c.column_id);
      if (!col) return [];
      const text = valueText(col.kind, c.value, col, ctx);
      return text
        ? [`${sanitizeInline(col.name)}: ${sanitizeInline(text)}`]
        : [];
    });
    return `- ${id} | ${sanitizeInline(it.name)} | group ${it.groupId} | ${cells.join(" · ") || "no values"}`;
  });
}

export function buildUserPrompt(input: PromptInput): string {
  const { snapshot, ctx, signals, transcript, now, timezone } = input;
  const groups = snapshot.groups.map(
    (g) => `${g.id} | ${sanitizeInline(g.name)}`,
  );
  const columns = [...ctx.columns.values()].map((c) => {
    const opts = c.options.size
      ? ` | options: ${[...c.options].map(([id, label]) => `${id}=${sanitizeInline(label)}`).join(", ")}`
      : "";
    return `${c.id} | ${sanitizeInline(c.name)} | ${c.kind}${opts}`;
  });
  const members = [...ctx.members].map(
    ([id, name]) => `${id} | ${sanitizeInline(name)}`,
  );
  return [
    `Board "${sanitizeInline(snapshot.board.name)}" (id ${snapshot.board.id}), ${snapshot.rowCount} items. Now: ${now} (${timezone}).`,
    "",
    "=== SIGNALS ===",
    ...(signals.length
      ? signals.map(
          (s) =>
            `${s.kind} | count ${s.count} | ${sanitizeInline(s.label)} | items: ${s.itemIds.slice(0, 20).join(", ")}${s.itemIds.length > 20 ? ", …" : ""}`,
        )
      : ["none — all on track"]),
    "",
    "=== GROUPS ===",
    ...groups,
    "",
    "=== COLUMNS ===",
    ...columns,
    "",
    "=== MEMBERS ===",
    ...members,
    "",
    "=== ITEMS ===",
    ...buildItemRoster(input),
    "",
    "=== RECENT ACTIVITY (7 days) ===",
    transcript || "no activity in the last 7 days",
    "",
    "=== END ===",
  ].join("\n");
}
```

- [ ] **Step 8: Generate test + implementation**

```ts
// src/lib/ai/board-intelligence/generate.test.ts
import { describe, expect, it, vi } from "vitest";
import { generateBoardIntelligence } from "./generate";
import { BOARD_INTELLIGENCE_JSON_SCHEMA } from "./schema";
import type { ProviderAdapter } from "@/lib/ai/providers/types";

describe("generateBoardIntelligence", () => {
  it("calls generateStructured with the system/user prompts and the JSON schema, and passes the wire model", async () => {
    const generateStructured = vi
      .fn()
      .mockResolvedValue({
        data: { brief: "ok", suggestions: [] },
        usage: { inputTokens: 10, outputTokens: 5 },
        model: "claude-x",
      });
    const adapter = {
      kind: "anthropic",
      validateKey: vi.fn(),
      generateStructured,
      generateProposal: vi.fn(),
    } as unknown as ProviderAdapter;
    const out = await generateBoardIntelligence(
      {
        snapshot: {
          board: { id: "b", name: "B" },
          rowCount: 0,
          groups: [],
          columns: [],
          columnStats: {},
          meta: { rowCount: 0, columnCount: 0, estimatedTokens: 1 },
        },
        ctx: {
          boardId: "b",
          orgId: "o",
          items: new Map(),
          columns: new Map(),
          members: new Map(),
        },
        signals: [],
        transcript: "",
        now: "2026-09-11T00:00:00.000Z",
        timezone: "UTC",
        cellValues: [],
        itemsByRecency: [],
      },
      { adapter, apiKey: "k", baseUrl: null, model: "claude-wire" },
    );
    expect(generateStructured).toHaveBeenCalledTimes(1);
    const args = generateStructured.mock.calls[0][0];
    expect(args.model).toBe("claude-wire");
    expect(args.schema).toBe(BOARD_INTELLIGENCE_JSON_SCHEMA);
    expect(args.system).toMatch(/Intelligence layer/);
    expect(args.user).toContain("=== SIGNALS ===");
    expect(out).toEqual({
      raw: { brief: "ok", suggestions: [] },
      usage: { inputTokens: 10, outputTokens: 5 },
      model: "claude-x",
    });
  });
});
```

```ts
// src/lib/ai/board-intelligence/generate.ts
import "server-only";
import type { AiUsageTokens } from "@/lib/ai/pricing";
import { toRequestArgs } from "@/lib/ai/providers/request";
import type { ProviderAdapter } from "@/lib/ai/providers/types";
import { buildUserPrompt, systemPrompt, type PromptInput } from "./prompt";
import { BOARD_INTELLIGENCE_JSON_SCHEMA } from "./schema";

/** One structured call through the provider adapter (provider-portable — no
 *  Anthropic-direct client, no tool loop). `opts.model` is the WIRE id
 *  (`ResolvedModel.requestModel`); runAi meters the catalog id itself. */
export async function generateBoardIntelligence(
  input: PromptInput,
  opts: {
    adapter: ProviderAdapter;
    apiKey: string;
    baseUrl?: string | null;
    model: string;
  },
): Promise<{ raw: unknown; usage: AiUsageTokens; model: string }> {
  const { data, usage, model } = await opts.adapter.generateStructured<unknown>(
    {
      ...toRequestArgs(opts),
      system: systemPrompt(),
      user: buildUserPrompt(input),
      schema: BOARD_INTELLIGENCE_JSON_SCHEMA,
    },
  );
  return { raw: data, usage, model };
}
```

If `generate.test.ts` fails on the `server-only` import, add `vi.mock("server-only", () => ({}))` at the top of the test — check how `src/lib/reports/ai-draft.test.ts` (or the nearest `server-only` test) handles it and copy that.

- [ ] **Step 9: Run all four suites + gates**

Run: `pnpm vitest run src/lib/ai/board-intelligence src/lib/ai/summarize` then `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/ai/board-intelligence/transcript.ts src/lib/ai/board-intelligence/transcript.test.ts src/lib/ai/board-intelligence/input-hash.ts src/lib/ai/board-intelligence/input-hash.test.ts src/lib/ai/board-intelligence/prompt.ts src/lib/ai/board-intelligence/prompt.test.ts src/lib/ai/board-intelligence/generate.ts src/lib/ai/board-intelligence/generate.test.ts src/lib/ai/summarize/summarize.ts
git commit -m "feat(ai): board transcript, input hash, prompt and structured generation for board intelligence"
```

---

### Task 5: Run and dismiss Server Actions with the cache

**Files:**

- Modify: `src/lib/ai/board-intelligence/runs.ts` (add functions), create `runs.test.ts`
- Create: `src/lib/ai/board-intelligence/run.ts`, `run.test.ts`
- Modify: `src/lib/validations/board-intelligence.ts`

**Interfaces:**

- Consumes: everything from Tasks 1–4; `requireUser` (`@/lib/auth/session`), `resolveActiveOrg` (`@/lib/org/active`), `runAi` (`@/lib/ai/gateway`), `requireAiEntitlement` (`@/lib/ai/entitlement`), `mapAiError` (`@/lib/ai/action-guard`), `getBoardPayload` (`@/lib/boards/queries`), `listOrgMembersCached` (`@/lib/org/queries-cached`), `getBoardLastSeenAt` (`@/lib/boards/intelligence/visits`), `computeSignals` (`@/lib/boards/intelligence/signals`), `buildBoardSnapshot` (`@/lib/ai/board-snapshot`), `createClient` (`@/lib/supabase/server`).
- Produces:

```ts
// runs.ts (plain module)
export function rowToRun(
  row: Tables<"board_intelligence_runs">,
): BoardIntelligenceRun | null; // null when payload fails payloadSchema
export async function getLatestBoardIntelligenceRun(
  supabase: SupabaseClient<Database>,
  boardId: string,
  userId: string,
): Promise<BoardIntelligenceRun | null>; // never throws
export function isRunStale(
  run: BoardIntelligenceRun,
  opts: { nowMs: number; inputHash: string },
): boolean;

// run.ts ("use server")
export async function runBoardIntelligence(input: {
  boardId: string;
  force?: boolean;
}): Promise<ActionResult<BoardIntelligenceRun>>;
export async function dismissSuggestion(input: {
  runId: string;
  suggestionId: string;
}): Promise<ActionResult<BoardIntelligenceRun>>;

// validations/board-intelligence.ts additions
export const runBoardIntelligenceSchema = z.object({
  boardId: z.string().uuid(),
  force: z.boolean().optional(),
});
export const dismissSuggestionSchema = z.object({
  runId: z.string().uuid(),
  suggestionId: z.string().min(1).max(8),
});
```

- [ ] **Step 1: `runs.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { isRunStale, rowToRun } from "./runs";
import { INTELLIGENCE_STALE_MS } from "@/lib/boards/intelligence/constants";

const row = (payload: unknown) => ({
  id: "r1",
  org_id: "o",
  board_id: "b",
  user_id: "u",
  generated_at: "2026-09-11T10:00:00.000Z",
  input_hash: "h",
  payload,
  dismissed: ["s1"],
  applied: [],
  model: "m",
  tokens_in: 1,
  tokens_out: 2,
});

describe("rowToRun", () => {
  it("maps a valid row and fails closed on a malformed payload", () => {
    const run = rowToRun(
      row({ brief: "b", suggestions: [], signals: [] }) as never,
    );
    expect(run).toMatchObject({
      id: "r1",
      boardId: "b",
      inputHash: "h",
      dismissed: ["s1"],
      tokensIn: 1,
      tokensOut: 2,
    });
    expect(rowToRun(row({ nope: true }) as never)).toBeNull();
  });
});

describe("isRunStale", () => {
  const run = rowToRun(
    row({ brief: "b", suggestions: [], signals: [] }) as never,
  )!;
  const at = Date.parse(run.generatedAt);
  it("is fresh under 30 minutes with the same hash", () => {
    expect(
      isRunStale(run, {
        nowMs: at + INTELLIGENCE_STALE_MS - 1,
        inputHash: "h",
      }),
    ).toBe(false);
  });
  it("is stale after 30 minutes or when the hash changed", () => {
    expect(
      isRunStale(run, { nowMs: at + INTELLIGENCE_STALE_MS, inputHash: "h" }),
    ).toBe(true);
    expect(isRunStale(run, { nowMs: at, inputHash: "other" })).toBe(true);
  });
  it("treats an unparseable timestamp as stale", () => {
    expect(
      isRunStale(
        { ...run, generatedAt: "nope" },
        { nowMs: at, inputHash: "h" },
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL; implement in `runs.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database.types";
import { INTELLIGENCE_STALE_MS } from "@/lib/boards/intelligence/constants";
import { payloadSchema, type BoardIntelligencePayload } from "./schema";
// (keep the existing type exports and BoardIntelligenceRun)

export function rowToRun(
  row: Tables<"board_intelligence_runs">,
): BoardIntelligenceRun | null {
  const payload = payloadSchema.safeParse(row.payload);
  if (!payload.success) return null;
  return {
    id: row.id,
    boardId: row.board_id,
    generatedAt: row.generated_at,
    inputHash: row.input_hash,
    payload: payload.data,
    dismissed: row.dismissed,
    applied: row.applied,
    model: row.model,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
  };
}

/** Spec §8: ONE indexed LIMIT 1 read on (board_id, user_id, generated_at desc).
 *  Never throws — a missing row, an RLS denial or a transport error is "no run". */
export async function getLatestBoardIntelligenceRun(
  supabase: SupabaseClient<Database>,
  boardId: string,
  userId: string,
): Promise<BoardIntelligenceRun | null> {
  const { data, error } = await supabase
    .from("board_intelligence_runs")
    .select("*")
    .eq("board_id", boardId)
    .eq("user_id", userId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return rowToRun(data);
}

export function isRunStale(
  run: BoardIntelligenceRun,
  opts: { nowMs: number; inputHash: string },
): boolean {
  const at = Date.parse(run.generatedAt);
  if (Number.isNaN(at)) return true;
  return (
    opts.nowMs - at >= INTELLIGENCE_STALE_MS || run.inputHash !== opts.inputHash
  );
}
```

- [ ] **Step 3: `run.test.ts`** — mock every dependency module the way `src/lib/reports/ai-actions.test.ts` (or `src/lib/ai/summarize/actions.test.ts`) does, then assert the three budget-critical behaviours:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.fn();
const resolveActiveOrg = vi.fn();
const requireAiEntitlement = vi.fn();
const runAi = vi.fn();
const getBoardPayload = vi.fn();
const listOrgMembersCached = vi.fn();
const getBoardLastSeenAt = vi.fn();
const getLatestBoardIntelligenceRun = vi.fn();
const generateBoardIntelligence = vi.fn();
const from = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: () => resolveActiveOrg(),
}));
vi.mock("@/lib/ai/entitlement", () => ({
  requireAiEntitlement: (...a: unknown[]) => requireAiEntitlement(...a),
}));
vi.mock("@/lib/ai/gateway", () => ({
  runAi: (...a: unknown[]) => runAi(...a),
}));
vi.mock("@/lib/boards/queries", () => ({
  getBoardPayload: (id: string) => getBoardPayload(id),
}));
vi.mock("@/lib/org/queries-cached", () => ({
  listOrgMembersCached: (id: string) => listOrgMembersCached(id),
}));
vi.mock("@/lib/boards/intelligence/visits", () => ({
  getBoardLastSeenAt: (...a: unknown[]) => getBoardLastSeenAt(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (t: string) => from(t) }),
}));
vi.mock("./generate", () => ({
  generateBoardIntelligence: (...a: unknown[]) =>
    generateBoardIntelligence(...a),
}));
vi.mock("./runs", async (orig) => ({
  ...(await orig<typeof import("./runs")>()),
  getLatestBoardIntelligenceRun: (...a: unknown[]) =>
    getLatestBoardIntelligenceRun(...a),
}));

import { runBoardIntelligence } from "./run";

const BOARD = "11111111-1111-4111-8111-111111111111";
const payload = {
  board: { id: BOARD, org_id: "o1", name: "B" },
  groups: [],
  columns: [],
  items: [],
  cellValues: [],
  dependencies: [],
  views: [],
  attachments: [],
  timeEntries: [],
  relationLinks: [],
  mirrorTargetCells: [],
  mirrorTargetColumns: [],
};
const freshRun = {
  id: "r1",
  boardId: BOARD,
  generatedAt: new Date().toISOString(),
  inputHash: "",
  payload: { brief: "cached", suggestions: [], signals: [] },
  dismissed: [],
  applied: [],
  model: "m",
  tokensIn: 0,
  tokensOut: 0,
};

// A chainable query stub: every builder method returns itself; awaiting resolves `result`.
const chain = (result: unknown) => {
  const q: Record<string, unknown> = {};
  for (const m of [
    "select",
    "eq",
    "gte",
    "order",
    "limit",
    "insert",
    "single",
    "maybeSingle",
    "update",
    "in",
  ])
    q[m] = () => q;
  (q as { then: unknown }).then = (res: (v: unknown) => void) => res(result);
  return q;
};

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u1" });
  resolveActiveOrg.mockResolvedValue({ id: "o1", timezone: "UTC" });
  getBoardPayload.mockResolvedValue(payload);
  listOrgMembersCached.mockResolvedValue([
    { userId: "u1", fullName: "Me", email: "x", avatarUrl: null },
  ]);
  getBoardLastSeenAt.mockResolvedValue(null);
  from.mockImplementation((t: string) =>
    t === "board_intelligence_runs"
      ? chain({
          data: {
            id: "r2",
            org_id: "o1",
            board_id: BOARD,
            user_id: "u1",
            generated_at: "2026-09-11T10:00:00.000Z",
            input_hash: "h",
            payload: { brief: "new", suggestions: [], signals: [] },
            dismissed: [],
            applied: [],
            model: "m",
            tokens_in: 1,
            tokens_out: 1,
          },
          error: null,
        })
      : chain({ data: [], error: null }),
  );
  runAi.mockImplementation(
    async (_args: unknown, fn: (r: unknown) => Promise<{ result: unknown }>) =>
      (
        await fn({
          adapter: {},
          apiKey: "k",
          baseUrl: null,
          model: { requestModel: "wire", model: "cat" },
        })
      ).result,
  );
  generateBoardIntelligence.mockResolvedValue({
    raw: { brief: "new", suggestions: [] },
    usage: { inputTokens: 1, outputTokens: 1 },
    model: "m",
  });
});

describe("runBoardIntelligence", () => {
  it("rejects a malformed board id before touching anything", async () => {
    expect(await runBoardIntelligence({ boardId: "nope" })).toEqual({
      ok: false,
      error: "Invalid board.",
    });
    expect(getBoardPayload).not.toHaveBeenCalled();
  });
  it("serves a fresh cached run with NO model call", async () => {
    // input hash of an empty board with no signals — compute it the same way run.ts does
    const { intelligenceInputHash } = await import("./input-hash");
    getLatestBoardIntelligenceRun.mockResolvedValue({
      ...freshRun,
      inputHash: intelligenceInputHash({
        itemCount: 0,
        maxUpdatedAt: null,
        signals: [],
      }),
    });
    const res = await runBoardIntelligence({ boardId: BOARD });
    expect(res).toMatchObject({ ok: true, data: { id: "r1" } });
    expect(runAi).not.toHaveBeenCalled();
  });
  it("runs the model when forced, records under board_intelligence, and stores the row", async () => {
    getLatestBoardIntelligenceRun.mockResolvedValue(freshRun);
    const res = await runBoardIntelligence({ boardId: BOARD, force: true });
    expect(runAi).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "board_intelligence",
        orgId: "o1",
        userId: "u1",
      }),
      expect.any(Function),
    );
    expect(requireAiEntitlement).toHaveBeenCalledWith(
      "o1",
      "board_intelligence",
    );
    expect(res).toMatchObject({
      ok: true,
      data: { id: "r2", payload: { brief: "new" } },
    });
  });
  it("maps a gateway failure to the fallback copy", async () => {
    getLatestBoardIntelligenceRun.mockResolvedValue(null);
    runAi.mockRejectedValue(new Error("boom"));
    expect(await runBoardIntelligence({ boardId: BOARD })).toEqual({
      ok: false,
      error: "Couldn't read this board. Please try again.",
    });
  });
  it("returns not found when the payload is RLS-hidden", async () => {
    getBoardPayload.mockResolvedValue(null);
    expect(await runBoardIntelligence({ boardId: BOARD })).toEqual({
      ok: false,
      error: "Board not found.",
    });
  });
});
```

- [ ] **Step 4: Run → FAIL; implement `run.ts`**

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { runAi } from "@/lib/ai/gateway";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { mapAiError } from "@/lib/ai/action-guard";
import { buildBoardSnapshot } from "@/lib/ai/board-snapshot";
import { getBoardPayload } from "@/lib/boards/queries";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import { getBoardLastSeenAt } from "@/lib/boards/intelligence/visits";
import { computeSignals } from "@/lib/boards/intelligence/signals";
import {
  TRANSCRIPT_ACTIVITY_LIMIT,
  TRANSCRIPT_DAYS,
  TRANSCRIPT_TOKEN_BUDGET,
  TRANSCRIPT_UPDATES_LIMIT,
} from "@/lib/boards/intelligence/constants";
import { fail, type ActionResult } from "@/lib/actions/result";
import {
  dismissSuggestionSchema,
  runBoardIntelligenceSchema,
} from "@/lib/validations/board-intelligence";
import type { Json } from "@/types/database.types";
import { buildBoardContext } from "./board-context";
import { generateBoardIntelligence } from "./generate";
import { intelligenceInputHash } from "./input-hash";
import {
  getLatestBoardIntelligenceRun,
  isRunStale,
  rowToRun,
  type BoardIntelligenceRun,
} from "./runs";
import { buildBoardTranscript } from "./transcript";
import { validateIntelligenceOutput } from "./validate";

/**
 * "Catch me up" / Refresh / first tab open (spec §4.1). NEVER called on page
 * load. Order: RLS-scoped payload (access) → user/org → entitlement → signals
 * + input hash → cached row (served with no model call when fresh) → bounded
 * transcript reads → one metered structured call → validate → insert.
 */
export async function runBoardIntelligence(input: {
  boardId: string;
  force?: boolean;
}): Promise<ActionResult<BoardIntelligenceRun>> {
  const parsed = runBoardIntelligenceSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid board.");
  const { boardId, force = false } = parsed.data;

  const payload = await getBoardPayload(boardId);
  if (!payload) return fail("Board not found.");
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");

  try {
    await requireAiEntitlement(org.id, "board_intelligence");
    const supabase = await createClient();
    const now = new Date();
    const members = (await listOrgMembersCached(payload.board.org_id)).map(
      (m) => ({ userId: m.userId, fullName: m.fullName }),
    ); // email never reaches a prompt
    const memberNames = new Map(
      members.map((m) => [m.userId, m.fullName ?? "someone"]),
    );
    const lastSeen = await getBoardLastSeenAt(supabase, boardId, user.id);
    const signals = computeSignals(payload, {
      now,
      lastSeenAt: lastSeen ? new Date(lastSeen) : null,
      currentUserId: user.id,
      memberNames,
    });
    const maxUpdatedAt = payload.items.reduce<string | null>(
      (m, i) => (m === null || i.updated_at > m ? i.updated_at : m),
      null,
    );
    const inputHash = intelligenceInputHash({
      itemCount: payload.items.length,
      maxUpdatedAt,
      signals,
    });

    const cached = await getLatestBoardIntelligenceRun(
      supabase,
      boardId,
      user.id,
    );
    if (
      cached &&
      !force &&
      !isRunStale(cached, { nowMs: now.getTime(), inputHash })
    )
      return { ok: true, data: cached };

    const since = new Date(
      now.getTime() - TRANSCRIPT_DAYS * 86_400_000,
    ).toISOString();
    const [{ data: activities }, { data: updates }] = await Promise.all([
      supabase
        .from("item_activities")
        .select("*")
        .eq("board_id", boardId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(TRANSCRIPT_ACTIVITY_LIMIT),
      supabase
        .from("item_updates")
        .select("*")
        .eq("board_id", boardId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(TRANSCRIPT_UPDATES_LIMIT),
    ]);
    const ctx = buildBoardContext(payload, members);
    const transcript = buildBoardTranscript({
      updates: updates ?? [],
      activities: activities ?? [],
      columns: payload.columns,
      members,
      itemNames: new Map(payload.items.map((i) => [i.id, i.name])),
      tokenBudget: TRANSCRIPT_TOKEN_BUDGET,
    });
    const snapshot = buildBoardSnapshot({
      board: { id: payload.board.id, name: payload.board.name },
      groups: payload.groups,
      columns: payload.columns,
      items: payload.items,
      cellValues: payload.cellValues,
    });

    const generated = await runAi(
      { orgId: org.id, userId: user.id, feature: "board_intelligence" },
      async ({ adapter, apiKey, baseUrl, model }) => {
        const {
          raw,
          usage,
          model: used,
        } = await generateBoardIntelligence(
          {
            snapshot,
            ctx,
            signals,
            transcript,
            now: now.toISOString(),
            timezone: org.timezone ?? "UTC",
            cellValues: payload.cellValues,
            itemsByRecency: payload.items,
          },
          { adapter, apiKey, baseUrl, model: model.requestModel },
        );
        return { result: { raw, usage, model: used }, usage };
      },
    );
    const { payload: out } = validateIntelligenceOutput(
      generated.raw,
      ctx,
      signals.map((s) => ({ kind: s.kind, count: s.count, label: s.label })),
    );

    const { data: row, error } = await supabase
      .from("board_intelligence_runs")
      .insert({
        org_id: payload.board.org_id,
        board_id: boardId,
        user_id: user.id,
        input_hash: inputHash,
        payload: out as unknown as Json,
        model: generated.model,
        tokens_in: generated.usage.inputTokens,
        tokens_out: generated.usage.outputTokens,
      })
      .select("*")
      .single();
    if (error || !row)
      return fail(error?.message ?? "Couldn't save the brief.");
    const run = rowToRun(row);
    if (!run) return fail("Couldn't read the saved brief.");
    return { ok: true, data: run };
  } catch (e) {
    return fail(
      mapAiError(e, {
        fallback: "Couldn't read this board. Please try again.",
        notConfigured:
          "Add an AI provider key in Settings to use Intelligence.",
      }),
    );
  }
}

/** Dismiss = hide the card for this user (spec §4.5). Own row; no model call. */
export async function dismissSuggestion(input: {
  runId: string;
  suggestionId: string;
}): Promise<ActionResult<BoardIntelligenceRun>> {
  const parsed = dismissSuggestionSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid suggestion.");
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("board_intelligence_runs")
    .select("*")
    .eq("id", parsed.data.runId)
    .maybeSingle();
  const run = row ? rowToRun(row) : null;
  if (!run) return fail("Brief not found.");
  if (!run.payload.suggestions.some((s) => s.id === parsed.data.suggestionId))
    return fail("Suggestion not found.");
  const dismissed = Array.from(
    new Set([...run.dismissed, parsed.data.suggestionId]),
  );
  const { data: updated, error } = await supabase
    .from("board_intelligence_runs")
    .update({ dismissed })
    .eq("id", run.id)
    .select("*")
    .single();
  if (error || !updated) return fail(error?.message ?? "Couldn't dismiss.");
  const next = rowToRun(updated);
  return next ? { ok: true, data: next } : fail("Couldn't read the brief.");
}
```

Add the two Zod schemas to `src/lib/validations/board-intelligence.ts` (block in Interfaces).

- [ ] **Step 5: Run + gates**

Run: `pnpm vitest run src/lib/ai/board-intelligence` then `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS. If `computeSignals(payload, …)` fails to typecheck, pass `{ items: payload.items, columns: payload.columns, cellValues: payload.cellValues, groups: payload.groups, dependencies: payload.dependencies }` (the `SignalsInput` Pick).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/board-intelligence/runs.ts src/lib/ai/board-intelligence/runs.test.ts src/lib/ai/board-intelligence/run.ts src/lib/ai/board-intelligence/run.test.ts src/lib/validations/board-intelligence.ts
git commit -m "feat(ai): runBoardIntelligence with per-user cache, staleness and dismiss"
```

---

### Task 6: Apply and Undo through one RPC transaction; `cells_cleared` effect

**Files:**

- Create: `src/lib/boards/actions/assign-notify.ts`, `assign-notify.test.ts`
- Modify: `src/lib/boards/actions/cell-core.ts:92-125` (call the extracted helper)
- Modify: `src/lib/ai/write/effects.ts` (add `cells_cleared`), `src/lib/boards/ai-effects.ts` + `ai-effects.test.ts`
- Create: `src/lib/ai/board-intelligence/apply-core.ts`, `apply-core.test.ts`
- Create: `src/lib/ai/board-intelligence/apply.ts`, `apply.test.ts`
- Modify: `src/lib/validations/board-intelligence.ts`

**Interfaces:**

- Consumes: `cellValueSchema(kind)` (`@/lib/validations/boards`), `typedRpc`, `getBoardAccess` (`@/lib/boards/queries`), `removeCellValue` (`@/lib/boards/cache`), `BoardContext`, `Action`, `actionSchema`, `rowToRun`, `getBoardPayload`, `listOrgMembersCached`, `requireUser`, `createClient`.
- Produces:

```ts
// effects.ts addition
| { kind: "cells_cleared"; boardId: string; cells: { itemId: string; columnId: string }[] }

// assign-notify.ts
export async function notifyNewAssignees(supabase: SupabaseClient<Database>, args: { orgId: string; boardId: string; itemId: string; actorId: string | null; prior: readonly string[]; next: readonly string[] }): Promise<void>; // best-effort, logs, never throws

// apply-core.ts (server-only)
export type CellWrite = { item_id: string; column_id: string; value: Json | null };
export type BeforeValue = { itemId: string; columnId: string; value: unknown | null };
export type ApplyOutcome = { before: BeforeValue[]; updateIds: string[]; effects: BoardEffect[] };
export function planCellWrites(action: Extract<Action, { type: "reassign" | "set_due" | "set_status" }>, ctx: BoardContext, cellValues: readonly { item_id: string; column_id: string; value: unknown }[]): { ok: true; writes: CellWrite[] } | { ok: false; error: string };
export async function applyCellWrites(supabase: SupabaseClient<Database>, boardId: string, writes: CellWrite[]): Promise<{ before: BeforeValue[]; effects: BoardEffect[] }>; // throws on RPC error
export async function applyNudge(supabase: SupabaseClient<Database>, args: { orgId: string; boardId: string; itemId: string; actorId: string; userId: string; message: string }): Promise<{ updateId: string }>;
export function isActionApplicable(action: Action, ctx: BoardContext): boolean;   // re-check at apply time (spec §7)

// apply.ts ("use server")
export async function applySuggestion(input: { runId: string; suggestionId: string; actionIndex: number }): Promise<ActionResult<{ before: BeforeValue[]; updateIds: string[]; effects: BoardEffect[]; run: BoardIntelligenceRun }>>;
export async function revertSuggestion(input: { runId: string; suggestionId: string; before: BeforeValue[]; updateIds: string[] }): Promise<ActionResult<{ effects: BoardEffect[]; run: BoardIntelligenceRun }>>;

// validations additions
export const beforeValueSchema = z.object({ itemId: z.string().uuid(), columnId: z.string().uuid(), value: z.unknown() });
export const applySuggestionSchema = z.object({ runId: z.string().uuid(), suggestionId: z.string().min(1).max(8), actionIndex: z.number().int().min(0).max(1) });
export const revertSuggestionSchema = z.object({ runId: z.string().uuid(), suggestionId: z.string().min(1).max(8), before: z.array(beforeValueSchema).max(50), updateIds: z.array(z.string().uuid()).max(5) });
```

- [ ] **Step 1: Effects — test then implement**

Add to `src/lib/boards/ai-effects.test.ts` (follow the file's existing fixture helpers):

```ts
it("cells_cleared removes the named cells and nothing else", () => {
  const cache = withCells([
    cell("i1", "c1"),
    cell("i1", "c2"),
    cell("i2", "c1"),
  ]); // use the file's own helpers
  const next = applyBoardEffect(cache, {
    kind: "cells_cleared",
    boardId: "b1",
    cells: [{ itemId: "i1", columnId: "c1" }],
  });
  expect(next.cellValues.map((c) => `${c.item_id}/${c.column_id}`)).toEqual([
    "i1/c2",
    "i2/c1",
  ]);
});
```

Add the union member to `BoardEffect` in `src/lib/ai/write/effects.ts` and the case in `applyBoardEffect`:

```ts
    case "cells_cleared": {
      let next = cache;
      for (const c of effect.cells) next = removeCellValue(next, c.itemId, c.columnId);
      return next;
    }
```

(`removeCellValue` is exported from `@/lib/boards/cache`.) `pnpm typecheck` will flag any other exhaustive switch over `BoardEffect["kind"]` — add the case there too (grep `case "group_created"`).

- [ ] **Step 2: Extract `notifyNewAssignees`**

Create `src/lib/boards/actions/assign-notify.ts` with the body of `cell-core.ts` lines 92–125 (the `added` diff, the `no actor` short-circuit, the `notifications` insert of `kind: "assigned"`, the `console.error`), parameterised as in the Interfaces block; replace that block in `cell-core.ts` with:

```ts
if (column.kind === "people") {
  await notifyNewAssignees(supabase, {
    orgId: column.org_id,
    boardId: column.board_id,
    itemId: input.itemId,
    actorId,
    prior: priorPeople,
    next: (valueParsed.data as { userIds?: string[] }).userIds ?? [],
  });
}
```

Write `assign-notify.test.ts`: (a) inserts one row per newly-added id excluding the actor; (b) no insert when nothing was added; (c) `actorId: null` → no insert and a `console.error`; (d) an insert error is logged, not thrown. Run `pnpm vitest run src/lib/boards/actions` — the existing `cell-core` / `cell` tests must stay green.

- [ ] **Step 3: `apply-core.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isActionApplicable, planCellWrites } from "./apply-core";
import type { BoardContext } from "./board-context";

const ctx: BoardContext = {
  boardId: "b",
  orgId: "o",
  items: new Map([
    ["i1", { id: "i1", name: "Ship", groupId: "g", parentId: null }],
    ["i2", { id: "i2", name: "Test", groupId: "g", parentId: null }],
  ]),
  columns: new Map([
    [
      "c-people",
      { id: "c-people", name: "Owner", kind: "people", options: new Map() },
    ],
    ["c-date", { id: "c-date", name: "Due", kind: "date", options: new Map() }],
    [
      "c-status",
      {
        id: "c-status",
        name: "Status",
        kind: "status",
        options: new Map([["o-done", "Done"]]),
      },
    ],
  ]),
  members: new Map([["u-ana", "Ana"]]),
};
const cells = [
  {
    item_id: "i1",
    column_id: "c-date",
    value: { date: "2026-09-01", end: "2026-09-03" },
  },
];

describe("planCellWrites", () => {
  it("reassign replaces the owners of every item with the target", () => {
    const r = planCellWrites(
      {
        type: "reassign",
        itemIds: ["i1", "i2"],
        columnId: "c-people",
        toUserId: "u-ana",
        label: "x",
      },
      ctx,
      cells,
    );
    expect(r).toEqual({
      ok: true,
      writes: [
        { item_id: "i1", column_id: "c-people", value: { userIds: ["u-ana"] } },
        { item_id: "i2", column_id: "c-people", value: { userIds: ["u-ana"] } },
      ],
    });
  });
  it("set_due keeps an existing end date", () => {
    const r = planCellWrites(
      {
        type: "set_due",
        itemId: "i1",
        columnId: "c-date",
        date: "2026-09-10",
        label: "x",
      },
      ctx,
      cells,
    );
    expect(r).toEqual({
      ok: true,
      writes: [
        {
          item_id: "i1",
          column_id: "c-date",
          value: { date: "2026-09-10", end: "2026-09-03" },
        },
      ],
    });
  });
  it("set_status writes the option id", () => {
    const r = planCellWrites(
      {
        type: "set_status",
        itemId: "i2",
        columnId: "c-status",
        optionId: "o-done",
        label: "x",
      },
      ctx,
      cells,
    );
    expect(r).toEqual({
      ok: true,
      writes: [
        { item_id: "i2", column_id: "c-status", value: { optionId: "o-done" } },
      ],
    });
  });
  it("refuses a value the column's schema rejects", () => {
    const r = planCellWrites(
      {
        type: "set_due",
        itemId: "i1",
        columnId: "c-date",
        date: "not-a-date",
        label: "x",
      },
      ctx,
      cells,
    );
    expect(r.ok).toBe(false);
  });
});

describe("isActionApplicable", () => {
  it("re-checks ids against the current board", () => {
    expect(
      isActionApplicable(
        {
          type: "set_status",
          itemId: "i1",
          columnId: "c-status",
          optionId: "o-done",
          label: "x",
        },
        ctx,
      ),
    ).toBe(true);
    expect(
      isActionApplicable(
        {
          type: "set_status",
          itemId: "i1",
          columnId: "c-status",
          optionId: "o-gone",
          label: "x",
        },
        ctx,
      ),
    ).toBe(false);
    expect(
      isActionApplicable(
        {
          type: "reassign",
          itemIds: ["i9"],
          columnId: "c-people",
          toUserId: "u-ana",
          label: "x",
        },
        ctx,
      ),
    ).toBe(false);
    expect(
      isActionApplicable(
        {
          type: "nudge",
          itemId: "i1",
          userId: "u-zed",
          message: "m",
          label: "x",
        },
        ctx,
      ),
    ).toBe(false);
    expect(
      isActionApplicable(
        { type: "filter", signalKind: "overdue", label: "x" },
        ctx,
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 4: Run → FAIL; implement `apply-core.ts`**

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { BoardEffect } from "@/lib/ai/write/effects";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { cellValueSchema, type ColumnKind } from "@/lib/validations/boards";
import type { Database, Json, Tables } from "@/types/database.types";
import type { BoardContext } from "./board-context";
import type { Action } from "./schema";
import { toAction } from "./validate";

export type CellWrite = {
  item_id: string;
  column_id: string;
  value: Json | null;
};
export type BeforeValue = {
  itemId: string;
  columnId: string;
  value: unknown | null;
};
export type ApplyOutcome = {
  before: BeforeValue[];
  updateIds: string[];
  effects: BoardEffect[];
};

type CellAction = Extract<
  Action,
  { type: "reassign" | "set_due" | "set_status" }
>;

/** Turn a cell-writing action into RPC writes, validating every value with
 *  the SAME per-kind schema `upsertCellCore` uses (gotcha-60: one boundary). */
export function planCellWrites(
  action: CellAction,
  ctx: BoardContext,
  cellValues: readonly { item_id: string; column_id: string; value: unknown }[],
): { ok: true; writes: CellWrite[] } | { ok: false; error: string } {
  const col = ctx.columns.get(action.columnId);
  if (!col) return { ok: false, error: "Column not found." };
  const current = (itemId: string) =>
    cellValues.find(
      (c) => c.item_id === itemId && c.column_id === action.columnId,
    )?.value as Record<string, unknown> | undefined;
  const pairs: { itemId: string; value: unknown }[] =
    action.type === "reassign"
      ? action.itemIds.map((itemId) => ({
          itemId,
          value: { userIds: [action.toUserId] },
        }))
      : action.type === "set_due"
        ? [
            {
              itemId: action.itemId,
              value: {
                date: action.date,
                ...(typeof current(action.itemId)?.end === "string"
                  ? { end: current(action.itemId)!.end }
                  : {}),
              },
            },
          ]
        : [{ itemId: action.itemId, value: { optionId: action.optionId } }];
  const writes: CellWrite[] = [];
  for (const p of pairs) {
    const parsed = cellValueSchema(col.kind as ColumnKind).safeParse(p.value);
    if (!parsed.success)
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid value",
      };
    writes.push({
      item_id: p.itemId,
      column_id: action.columnId,
      value: parsed.data as Json,
    });
  }
  return { ok: true, writes };
}

const rpcResultSchema = z.object({
  before: z.array(
    z.object({
      item_id: z.string(),
      column_id: z.string(),
      value: z.unknown(),
    }),
  ),
  cells: z.array(
    z.union([
      z.object({
        item_id: z.string(),
        column_id: z.string(),
        cleared: z.literal(true),
      }),
      z.object({ id: z.string() }).passthrough(),
    ]),
  ),
});

/** ONE transaction: before-values out, authoritative rows out, activity rows
 *  stamped source = 'intelligence'. Throws on an RPC error (the caller maps it). */
export async function applyCellWrites(
  supabase: SupabaseClient<Database>,
  boardId: string,
  writes: CellWrite[],
): Promise<{ before: BeforeValue[]; effects: BoardEffect[] }> {
  const { data, error } = await typedRpc(supabase, "apply_intelligence_cells", {
    p_board_id: boardId,
    p_writes: writes as unknown as Json,
  });
  if (error) throw new Error(error.message);
  const out = rpcResultSchema.parse(data);
  const before = out.before.map((b) => ({
    itemId: b.item_id,
    columnId: b.column_id,
    value: b.value ?? null,
  }));
  const rows = out.cells.filter(
    (c): c is Tables<"cell_values"> => !("cleared" in c),
  );
  const cleared = out.cells.filter(
    (c): c is { item_id: string; column_id: string; cleared: true } =>
      "cleared" in c,
  );
  const effects: BoardEffect[] = [];
  if (rows.length)
    effects.push({ kind: "item_fields_set", boardId, cells: rows });
  if (cleared.length)
    effects.push({
      kind: "cells_cleared",
      boardId,
      cells: cleared.map((c) => ({ itemId: c.item_id, columnId: c.column_id })),
    });
  return { before, effects };
}

/** Nudge = an update on the item, as the current user, plus a mention
 *  notification for the target (the automations `notify` shape). */
export async function applyNudge(
  supabase: SupabaseClient<Database>,
  args: {
    orgId: string;
    boardId: string;
    itemId: string;
    actorId: string;
    userId: string;
    message: string;
  },
): Promise<{ updateId: string }> {
  const { data, error } = await supabase
    .from("item_updates")
    .insert({
      org_id: args.orgId,
      board_id: args.boardId,
      item_id: args.itemId,
      author_id: args.actorId,
      body: { text: args.message },
      body_text: args.message,
    })
    .select("id")
    .single();
  if (error || !data)
    throw new Error(error?.message ?? "Couldn't post the nudge.");
  if (args.userId !== args.actorId) {
    const { error: nErr } = await supabase.from("notifications").insert({
      org_id: args.orgId,
      recipient_id: args.userId,
      actor_id: args.actorId,
      kind: "mention",
      board_id: args.boardId,
      item_id: args.itemId,
      update_id: data.id,
    });
    if (nErr)
      console.error("[intelligence] nudge notification failed", {
        itemId: args.itemId,
        error: nErr.message,
      });
  }
  return { updateId: data.id };
}

/** Spec §7: validate against the board's CURRENT items and members at apply time. */
export function isActionApplicable(action: Action, ctx: BoardContext): boolean {
  const base = {
    itemIds: null,
    itemId: null,
    columnId: null,
    toUserId: null,
    date: null,
    optionId: null,
    userId: null,
    message: null,
    signalKind: null,
  };
  const raw =
    action.type === "reassign"
      ? {
          ...base,
          type: action.type,
          itemIds: action.itemIds,
          columnId: action.columnId,
          toUserId: action.toUserId,
        }
      : action.type === "set_due"
        ? {
            ...base,
            type: action.type,
            itemId: action.itemId,
            columnId: action.columnId,
            date: action.date,
          }
        : action.type === "set_status"
          ? {
              ...base,
              type: action.type,
              itemId: action.itemId,
              columnId: action.columnId,
              optionId: action.optionId,
            }
          : action.type === "nudge"
            ? {
                ...base,
                type: action.type,
                itemId: action.itemId,
                userId: action.userId,
                message: action.message,
              }
            : { ...base, type: action.type, signalKind: action.signalKind };
  const re = toAction(raw, ctx);
  if (!re) return false;
  // Every id the stored action names must still resolve (reassign: ALL items).
  return (
    action.type !== "reassign" ||
    (re.type === "reassign" && re.itemIds.length === action.itemIds.length)
  );
}
```

- [ ] **Step 5: `apply.test.ts`** — mock modules as in Task 5 (`requireUser`, `createClient`, `getBoardPayload`, `getBoardAccess` from `@/lib/boards/queries`, `listOrgMembersCached`, and `./apply-core`'s `applyCellWrites`/`applyNudge`), seed `from("board_intelligence_runs")` with a run whose suggestion `s1` has actions `[set_status i1 → o-done, nudge]`, and assert:

1. a viewer gets `{ ok: false, error: "Only editors can apply suggestions." }` and `applyCellWrites` is not called;
2. an editor applying `actionIndex: 0` calls `applyCellWrites` once with the planned write, the returned `run.applied` contains `"s1"`, and `before`/`effects` are passed through;
3. `actionIndex: 1` (nudge) calls `applyNudge` with the current user as actor and returns `updateIds: [id]`;
4. an action that no longer applies (mock the payload without item `i1`) fails with `"This suggestion no longer matches the board."`;
5. `revertSuggestion` with a `before` whose value fails the column schema fails with `"Invalid undo data."`; a valid one calls `applyCellWrites` with `value` from `before` (null for empty), deletes `updateIds` via `from("item_updates").delete()…`, and removes `"s1"` from `applied`.

- [ ] **Step 6: Implement `apply.ts`**

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { getBoardAccess, getBoardPayload } from "@/lib/boards/queries";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import { notifyNewAssignees } from "@/lib/boards/actions/assign-notify";
import { cellValueSchema, type ColumnKind } from "@/lib/validations/boards";
import { fail, type ActionResult } from "@/lib/actions/result";
import {
  applySuggestionSchema,
  revertSuggestionSchema,
} from "@/lib/validations/board-intelligence";
import type { BoardEffect } from "@/lib/ai/write/effects";
import type { Json } from "@/types/database.types";
import {
  applyCellWrites,
  applyNudge,
  isActionApplicable,
  planCellWrites,
  type BeforeValue,
} from "./apply-core";
import { buildBoardContext } from "./board-context";
import { rowToRun, type BoardIntelligenceRun } from "./runs";

const EDITOR_ONLY = "Only editors can apply suggestions.";

async function loadRun(
  supabase: Awaited<ReturnType<typeof createClient>>,
  runId: string,
) {
  const { data } = await supabase
    .from("board_intelligence_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  return data ? rowToRun(data) : null;
}
async function setApplied(
  supabase: Awaited<ReturnType<typeof createClient>>,
  run: BoardIntelligenceRun,
  applied: string[],
) {
  const { data, error } = await supabase
    .from("board_intelligence_runs")
    .update({ applied })
    .eq("id", run.id)
    .select("*")
    .single();
  const next = data ? rowToRun(data) : null;
  if (error || !next)
    throw new Error(error?.message ?? "Couldn't update the brief.");
  return next;
}

export async function applySuggestion(input: {
  runId: string;
  suggestionId: string;
  actionIndex: number;
}): Promise<
  ActionResult<{
    before: BeforeValue[];
    updateIds: string[];
    effects: BoardEffect[];
    run: BoardIntelligenceRun;
  }>
> {
  const parsed = applySuggestionSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid suggestion.");
  const user = await requireUser();
  const supabase = await createClient();
  const run = await loadRun(supabase, parsed.data.runId);
  if (!run) return fail("Brief not found.");
  const access = await getBoardAccess(run.boardId);
  if (access !== "owner" && access !== "editor") return fail(EDITOR_ONLY);
  const suggestion = run.payload.suggestions.find(
    (s) => s.id === parsed.data.suggestionId,
  );
  const action = suggestion?.actions[parsed.data.actionIndex];
  if (!suggestion || !action) return fail("Suggestion not found.");
  if (action.type === "filter") return fail("This action runs in the browser.");
  const payload = await getBoardPayload(run.boardId);
  if (!payload) return fail("Board not found.");
  const members = (await listOrgMembersCached(payload.board.org_id)).map(
    (m) => ({ userId: m.userId, fullName: m.fullName }),
  );
  const ctx = buildBoardContext(payload, members);
  if (!isActionApplicable(action, ctx))
    return fail("This suggestion no longer matches the board.");
  try {
    let before: BeforeValue[] = [];
    let updateIds: string[] = [];
    let effects: BoardEffect[] = [];
    if (action.type === "nudge") {
      const { updateId } = await applyNudge(supabase, {
        orgId: ctx.orgId,
        boardId: run.boardId,
        itemId: action.itemId,
        actorId: user.id,
        userId: action.userId,
        message: action.message,
      });
      updateIds = [updateId];
    } else {
      const plan = planCellWrites(action, ctx, payload.cellValues);
      if (!plan.ok) return fail(plan.error);
      ({ before, effects } = await applyCellWrites(
        supabase,
        run.boardId,
        plan.writes,
      ));
      if (action.type === "reassign") {
        for (const b of before) {
          const prior =
            (b.value as { userIds?: string[] } | null)?.userIds ?? [];
          await notifyNewAssignees(supabase, {
            orgId: ctx.orgId,
            boardId: run.boardId,
            itemId: b.itemId,
            actorId: user.id,
            prior,
            next: [action.toUserId],
          });
        }
      }
    }
    const next = await setApplied(
      supabase,
      run,
      Array.from(new Set([...run.applied, suggestion.id])),
    );
    return { ok: true, data: { before, updateIds, effects, run: next } };
  } catch (e) {
    return fail(
      e instanceof Error ? e.message : "Couldn't apply the suggestion.",
    );
  }
}

export async function revertSuggestion(input: {
  runId: string;
  suggestionId: string;
  before: BeforeValue[];
  updateIds: string[];
}): Promise<
  ActionResult<{ effects: BoardEffect[]; run: BoardIntelligenceRun }>
> {
  const parsed = revertSuggestionSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid undo data.");
  const user = await requireUser();
  const supabase = await createClient();
  const run = await loadRun(supabase, parsed.data.runId);
  if (!run) return fail("Brief not found.");
  const access = await getBoardAccess(run.boardId);
  if (access !== "owner" && access !== "editor") return fail(EDITOR_ONLY);
  const payload = await getBoardPayload(run.boardId);
  if (!payload) return fail("Board not found.");
  const kinds = new Map(payload.columns.map((c) => [c.id, c.kind]));
  const writes = [];
  for (const b of parsed.data.before) {
    const kind = kinds.get(b.columnId);
    if (!kind || !payload.items.some((i) => i.id === b.itemId))
      return fail("Invalid undo data.");
    if (b.value === null || b.value === undefined) {
      writes.push({ item_id: b.itemId, column_id: b.columnId, value: null });
      continue;
    }
    const v = cellValueSchema(kind as ColumnKind).safeParse(b.value);
    if (!v.success) return fail("Invalid undo data.");
    writes.push({
      item_id: b.itemId,
      column_id: b.columnId,
      value: v.data as Json,
    });
  }
  try {
    const effects: BoardEffect[] = [];
    if (writes.length)
      effects.push(
        ...(await applyCellWrites(supabase, run.boardId, writes)).effects,
      );
    if (parsed.data.updateIds.length) {
      const { error } = await supabase
        .from("item_updates")
        .delete()
        .in("id", parsed.data.updateIds)
        .eq("author_id", user.id);
      if (error) throw new Error(error.message);
    }
    const next = await setApplied(
      supabase,
      run,
      run.applied.filter((id) => id !== parsed.data.suggestionId),
    );
    return { ok: true, data: { effects, run: next } };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Couldn't undo.");
  }
}
```

- [ ] **Step 7: Run + gates**

Run: `pnpm vitest run src/lib/ai/board-intelligence src/lib/boards/actions src/lib/boards/ai-effects.test.ts` then `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/boards/actions/assign-notify.ts src/lib/boards/actions/assign-notify.test.ts src/lib/boards/actions/cell-core.ts src/lib/ai/write/effects.ts src/lib/boards/ai-effects.ts src/lib/boards/ai-effects.test.ts src/lib/ai/board-intelligence/apply-core.ts src/lib/ai/board-intelligence/apply-core.test.ts src/lib/ai/board-intelligence/apply.ts src/lib/ai/board-intelligence/apply.test.ts src/lib/validations/board-intelligence.ts
git commit -m "feat(ai): apply and undo board intelligence suggestions in one transaction with before-values"
```

---

### Task 7: Dock — Chat | Intelligence tabs, the Intelligence tab body, Apply/Undo/Dismiss UI

Load the `pulse-ui` and `frontend-design` skills first.

**Files:**

- Create: `src/components/boards/dock/DockTabs.tsx`, `DockTabs.test.tsx`
- Create: `src/components/boards/dock/intelligence/use-intelligence-run.ts`, `use-intelligence-run.test.tsx`
- Create: `src/components/boards/dock/intelligence/BriefBlock.tsx`, `SuggestionCard.tsx`, `IntelligenceTab.tsx`, `IntelligenceTab.test.tsx`
- Modify: `src/components/boards/dock/BoardDock.tsx` (props, header, body switch, open-request effect), `BoardDock.test.tsx`

**Interfaces:**

- Consumes: `useDockState` with `tab`/`setTab` (Task 2); `useBoardIntelligenceStore`, `unresolvedCount`, `DockTab` (Task 2); `runBoardIntelligence`, `dismissSuggestion` (Task 5); `applySuggestion`, `revertSuggestion` (Task 6); `useApplyBoardEffects` (`@/lib/boards/use-ai-effects`); `showUndoToast`, `showMutationError` (`@/lib/ui/mutation-toast`); `timeAgo` (`@/lib/boards/automation-runs`); `Kicker`, `Button`, `Skeleton`, `Popover*` from `@/components/ui`; `isRunStale` is NOT used client-side (the server is authoritative) — the client shows "Stale · Refresh" purely by age (`Date.now() - Date.parse(generatedAt) >= INTELLIGENCE_STALE_MS`).
- Produces:

```tsx
// DockTabs.tsx
export function DockTabs(props: {
  value: DockTab;
  onChange: (t: DockTab) => void;
  badge: number;
}): JSX.Element;
// role="tablist" aria-label="Dock sections"; two role="tab" buttons "Chat" / "Intelligence" with aria-selected,
// id="dock-tab-chat" / "dock-tab-intelligence", aria-controls="dock-panel-chat" / "dock-panel-intelligence";
// ArrowLeft/ArrowRight/Home/End move selection; badge > 0 renders <span className="text-primary ml-1 tabular-nums">{badge}</span>.

// use-intelligence-run.ts
export function useIntelligenceRun(
  boardId: string,
  opts: { canApply: boolean },
): {
  run: BoardIntelligenceRun | null;
  running: boolean;
  error: string | null;
  staleByAge: boolean;
  catchMeUp: () => Promise<void>; // runBoardIntelligence({ boardId })
  refresh: () => Promise<void>; // runBoardIntelligence({ boardId, force: true })
  dismiss: (suggestionId: string) => Promise<void>;
  apply: (suggestionId: string, actionIndex: number) => Promise<void>; // handles filter locally, toast + undo for the rest
  visible: Suggestion[]; // suggestions minus dismissed minus applied, in order
};

// BoardDock.tsx — new props (both optional so the page compiles before Task 8 wires them)
export function BoardDock(props: {
  boardId: string;
  agents: DockAgent[];
  currentUserId: string;
  access?: "owner" | "editor" | "viewer";
  initialRun?: BoardIntelligenceRun | null;
}): JSX.Element;
```

- [ ] **Step 1: `DockTabs` test**

```tsx
// src/components/boards/dock/DockTabs.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DockTabs } from "./DockTabs";

describe("DockTabs", () => {
  it("renders two tabs, marks the active one, and shows the unresolved badge", () => {
    render(<DockTabs value="chat" onChange={() => {}} badge={3} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Chat", "Intelligence3"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByText(/pulse|ai/i)).toBeNull();
  });
  it("hides a zero badge", () => {
    render(<DockTabs value="intelligence" onChange={() => {}} badge={0} />);
    expect(
      screen.getByRole("tab", { name: "Intelligence" }),
    ).toBeInTheDocument();
  });
  it("switches on click and on arrow keys", async () => {
    const onChange = vi.fn();
    render(<DockTabs value="chat" onChange={onChange} badge={0} />);
    await userEvent.click(screen.getByRole("tab", { name: "Intelligence" }));
    expect(onChange).toHaveBeenLastCalledWith("intelligence");
    screen.getByRole("tab", { name: "Chat" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("intelligence");
    await userEvent.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("chat");
  });
});
```

- [ ] **Step 2: Implement `DockTabs.tsx`** with the ItemPanel pill-tab recipe (`src/components/boards/item-panel/ItemPanel.tsx:144-169`): `h-7 rounded-full border px-3 text-sm`, selected = `bg-surface-muted border-border-bright text-foreground font-medium`, idle = `text-muted-foreground hover:text-foreground hover:border-border border-transparent`, every tab `focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none ease-keystone transition-colors pointer-coarse:min-h-11`. `onKeyDown` on the tablist handles ArrowLeft/ArrowRight/Home/End by calling `onChange` with the neighbouring tab and focusing it. No icon, no colour other than the accent count.

- [ ] **Step 3: `use-intelligence-run` test** — `vi.mock` the four Server Action modules and `@/lib/ui/mutation-toast` and `@/lib/boards/use-ai-effects` (return a `vi.fn()` from `useApplyBoardEffects`); seed the store with `setRun("b1", run)`; wrap `renderHook` in nothing (the store is global). Assert:

1. `visible` excludes dismissed and applied ids; `staleByAge` is true for a run older than 30 min.
2. `catchMeUp` calls `runBoardIntelligence({ boardId: "b1" })`, sets `running` while pending, and writes the result into the store; an `{ ok: false }` result lands in `error`; a thrown rejection lands in `error` too.
3. `dismiss("s1")` updates the store optimistically (card gone before the action resolves) and rolls back with `error` when the action fails.
4. `apply("s1", 0)` on a `filter` action calls `requestFilter("b1", { kind: "overdue" })` and touches no server action.
5. `apply("s1", 0)` on a cell action calls `applySuggestion({ runId, suggestionId: "s1", actionIndex: 0 })`, then `applyBoardEffects(effects)`, then `showUndoToast("Applied", fn)`; invoking that `fn` calls `revertSuggestion({ runId, suggestionId: "s1", before, updateIds })` and folds its effects; the store run is replaced by the action's `run` both times.
6. with `canApply: false`, `apply` on a cell action returns without calling anything (the UI never renders the button, this is the second guard).

- [ ] **Step 4: Implement `use-intelligence-run.ts`**

```ts
"use client";
import { useCallback, useMemo, useState } from "react";
import { useBoardIntelligenceStore } from "@/stores/board-intelligence";
import {
  runBoardIntelligence,
  dismissSuggestion,
} from "@/lib/ai/board-intelligence/run";
import {
  applySuggestion,
  revertSuggestion,
} from "@/lib/ai/board-intelligence/apply";
import type {
  BoardIntelligenceRun,
  Suggestion,
} from "@/lib/ai/board-intelligence/runs";
import { INTELLIGENCE_STALE_MS } from "@/lib/boards/intelligence/constants";
import { useApplyBoardEffects } from "@/lib/boards/use-ai-effects";
import { showMutationError, showUndoToast } from "@/lib/ui/mutation-toast";

export function useIntelligenceRun(
  boardId: string,
  opts: { canApply: boolean },
) {
  const run = useBoardIntelligenceStore((s) => s.runs[boardId] ?? null);
  const setRun = useBoardIntelligenceStore((s) => s.setRun);
  const requestFilter = useBoardIntelligenceStore((s) => s.requestFilter);
  const applyBoardEffects = useApplyBoardEffects();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runIt = useCallback(
    async (force: boolean) => {
      setRunning(true);
      setError(null);
      try {
        const res = await runBoardIntelligence({ boardId, force });
        if (res.ok) setRun(boardId, res.data);
        else setError(res.error);
      } catch {
        setError("Couldn't read this board. Please try again.");
      } finally {
        setRunning(false);
      }
    },
    [boardId, setRun],
  );

  const dismiss = useCallback(
    async (suggestionId: string) => {
      if (!run) return;
      const prev = run;
      setRun(boardId, { ...run, dismissed: [...run.dismissed, suggestionId] }); // optimistic
      try {
        const res = await dismissSuggestion({ runId: run.id, suggestionId });
        if (res.ok) setRun(boardId, res.data);
        else {
          setRun(boardId, prev);
          setError(res.error);
        }
      } catch {
        setRun(boardId, prev);
        setError("Couldn't dismiss.");
      }
    },
    [boardId, run, setRun],
  );

  const apply = useCallback(
    async (suggestionId: string, actionIndex: number) => {
      if (!run) return;
      const action = run.payload.suggestions.find((s) => s.id === suggestionId)
        ?.actions[actionIndex];
      if (!action) return;
      if (action.type === "filter") {
        requestFilter(boardId, { kind: action.signalKind });
        return;
      }
      if (!opts.canApply) return;
      setError(null);
      try {
        const res = await applySuggestion({
          runId: run.id,
          suggestionId,
          actionIndex,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        applyBoardEffects(res.data.effects);
        setRun(boardId, res.data.run);
        const { before, updateIds } = res.data;
        showUndoToast("Applied", () => {
          void (async () => {
            const undo = await revertSuggestion({
              runId: run.id,
              suggestionId,
              before,
              updateIds,
            });
            if (!undo.ok) {
              showMutationError("Couldn't undo.", new Error(undo.error));
              return;
            }
            applyBoardEffects(undo.data.effects);
            setRun(boardId, undo.data.run);
          })();
        });
      } catch {
        setError("Couldn't apply the suggestion.");
      }
    },
    [applyBoardEffects, boardId, opts.canApply, requestFilter, run, setRun],
  );

  const visible = useMemo<Suggestion[]>(() => {
    if (!run) return [];
    const gone = new Set([...run.dismissed, ...run.applied]);
    return run.payload.suggestions.filter((s) => !gone.has(s.id));
  }, [run]);
  const staleByAge = run
    ? Date.now() - Date.parse(run.generatedAt) >= INTELLIGENCE_STALE_MS
    : false;

  return {
    run,
    running,
    error,
    staleByAge,
    visible,
    catchMeUp: () => runIt(false),
    refresh: () => runIt(true),
    dismiss,
    apply,
  };
}
export type IntelligenceRunState = ReturnType<typeof useIntelligenceRun>;
export type { BoardIntelligenceRun };
```

- [ ] **Step 5: `IntelligenceTab` test** — render `<IntelligenceTab boardId="b1" canApply runOnMount={false} onRanOnMount={() => {}} />` with the store seeded, the action modules mocked as in Step 3, and assert (spec §2.2):

1. **Empty state** (`run: null`): one line "Nothing yet — a brief of the last 7 days and what to do next." (exact copy) and a `<Button>` "Catch me up"; clicking it calls `runBoardIntelligence`.
2. **Loading**: while `running`, a `role="status" aria-busy="true" aria-label="Reading the board"` region with 3 `Skeleton` lines + 2 skeleton cards; no spinner.
3. **Brief block**: `Kicker` "Last 7 days" left, `timeAgo(generatedAt)` right (mono, muted); the brief as a single `<p>`; no headings.
4. **Suggested list**: `Kicker` "Suggested · 2"; each card shows title, evidence kicker, body, the primary button (`action.label` of `actions[0]`, default `Button`), the secondary ghost button (`actions[1].label` when present), a ghost "Dismiss", and a "why?" `variant="link"` button opening a `Popover` listing `evidenceRows[].name`.
5. **Viewer** (`canApply={false}`): the same cards with NO Apply/secondary buttons for write actions; a `filter` primary still renders; "Dismiss" still renders.
6. **Stale**: a run older than 30 min shows a ghost "Refresh" next to the timestamp; clicking calls `runBoardIntelligence({ boardId: "b1", force: true })`.
7. **Footer**: text matches `/Read-only until you apply · .+ · \d+ tokens/` using `run.model` and `tokensIn + tokensOut`; for a viewer the footer reads "Read-only · {model} · {tokens}".
8. `screen.queryByText(/pulse/i)` is null.

- [ ] **Step 6: Implement `BriefBlock.tsx`, `SuggestionCard.tsx`, `IntelligenceTab.tsx`**

`SuggestionCard` props: `{ suggestion: Suggestion; canApply: boolean; onApply: (actionIndex: number) => void; onDismiss: () => void }`. Surface: `bg-surface border-border rounded-lg border p-3` (hairline, no shadow). Layout top→bottom: title (`text-sm font-medium`), `<Kicker size="xs">{evidence}</Kicker>` (skip when empty), body (`text-muted-foreground text-xs`), a row with the primary `<Button size="xs">` (`actions[0].label`), optional secondary `<Button size="xs" variant="ghost">` (`actions[1].label`), `<Button size="xs" variant="ghost">Dismiss</Button>`, and `<Popover><PopoverTrigger asChild><Button size="xs" variant="link">why?</Button></PopoverTrigger><PopoverContent align="start" className="w-64 p-2"><ul className="text-xs">…evidenceRows as <li> "{name}{detail ? ` · ${detail}` : ""}"…</ul></PopoverContent></Popover>`. A write action's button renders only when `canApply`; a `filter` action's button always renders. Tone: the card's `kind` maps to a 6px dot before the title using the strip's `DOT` classes (`overdue→bg-status-red`, `blocked→bg-status-orange`, `overloaded→bg-status-yellow`, `stalled→bg-status-gray`, `changed→bg-primary`, `other→bg-muted-foreground/60`) — the only colour on the card.

`BriefBlock` props: `{ brief: string; generatedAt: string; nowMs: number; stale: boolean; onRefresh: () => void; running: boolean }` — header row `flex items-center justify-between`: `<Kicker size="xs">Last 7 days</Kicker>` and `<span className="text-muted-foreground font-mono text-3xs">{timeAgo(generatedAt, nowMs)}</span>` followed by a ghost `xs` "Refresh" when `stale`; body `<p className="text-sm leading-relaxed">{brief}</p>`.

`IntelligenceTab` props: `{ boardId: string; canApply: boolean; runOnMount: boolean; onRanOnMount: () => void }`; root `<div id="dock-panel-intelligence" role="tabpanel" aria-labelledby="dock-tab-intelligence" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">`; uses `useIntelligenceRun`. Empty state: `<p className="text-muted-foreground text-sm">Nothing yet — a brief of the last 7 days and what to do next.</p>` + `<Button size="sm" onClick={catchMeUp}>Catch me up</Button>`. Error row: `text-destructive text-xs` + ghost "Try again". Footer: `<p className="text-muted-foreground font-mono text-3xs mt-auto">{canApply ? "Read-only until you apply" : "Read-only"} · {run.model ?? "model"} · {run.tokensIn + run.tokensOut} tokens</p>`.

- [ ] **Step 7: Wire `BoardDock.tsx`**

1. Props: add `access = "viewer"` and `initialRun = null`.
2. `const { open, setOpen, width, setWidth, tab, setTab } = useDockState(boardId);`
3. Seed + subscribe:

```tsx
const setRun = useBoardIntelligenceStore((s) => s.setRun);
const run = useBoardIntelligenceStore((s) => s.runs[boardId]); // undefined = not seeded yet
useEffect(() => {
  if (run === undefined) setRun(boardId, initialRun);
}, [boardId, initialRun, run, setRun]);
const openRequest = useBoardIntelligenceStore((s) => s.openRequest);
const consumeOpen = useBoardIntelligenceStore((s) => s.consumeOpen);
const [wantsRun, setWantsRun] = useState(false); // "Catch me up" asked for a run
useEffect(() => {
  if (!openRequest || openRequest.boardId !== boardId) return;
  setOpen(true);
  setTab("intelligence");
  if (openRequest.run) setWantsRun(true);
  consumeOpen(openRequest.nonce);
}, [boardId, consumeOpen, openRequest, setOpen, setTab]);
```

`IntelligenceTab` gets two props for this: `runOnMount: boolean` (= `wantsRun || run === null`; spec §4.1: the tab's first open with no cached row triggers a run, and "Catch me up" always triggers one — the server decides whether the model runs) and `onRanOnMount: () => void` (= `() => setWantsRun(false)`). Inside the tab: `const kicked = useRef(false); useEffect(() => { if (runOnMount && !kicked.current) { kicked.current = true; void catchMeUp().finally(onRanOnMount); } }, [runOnMount, catchMeUp, onRanOnMount]);`. Keep the dock's thread fetch untouched: the Chat body still mounts only when `tab === "chat"`, and `loaded.current` still guards `loadDockThreads`, so switching tabs never refetches threads. 4. Header (`DockBody`): render `<DockTabs value={tab} onChange={setTab} badge={unresolvedCount(run ?? null)} />` as the FIRST child; render `<AgentSwitcher …>` and the "+ New" button only when `tab === "chat"`; keep the close button. 5. Body: `tab === "chat"` → the existing error row / thread list / conversation (wrap in `<div id="dock-panel-chat" role="tabpanel" aria-labelledby="dock-tab-chat" className="contents">`); `tab === "intelligence"` → `<IntelligenceTab boardId={boardId} canApply={access !== "viewer"} runOnMount={runOnMount} onRanOnMount={onRanOnMount} />`. 6. `DockBodyProps` gains `tab`, `onTabChange`, `badge`, `boardId`, `canApply`, `runOnMount`, `onRanOnMount`. Pass them from both the desktop `<aside>` and the mobile `<Sheet>` surfaces (they share `DockBody`). 7. If `BoardDock.tsx` exceeds ~700 lines after this, move `DockBody` into `src/components/boards/dock/DockBody.tsx` (pure move, same props) in this task.

- [ ] **Step 8: `BoardDock.test.tsx` additions** (mock `@/lib/ai/board-intelligence/run` and `/apply` like the existing action mocks; reset the store in `beforeEach` with `useBoardIntelligenceStore.setState({ runs: {}, openRequest: null, filterRequest: null })`):

1. open dock → both tabs present, "Chat" selected, `AgentSwitcher` visible; click "Intelligence" → switcher and "+ New" gone, `role="tabpanel"` named by the Intelligence tab present, `loadDockThreads` still called exactly once after switching back and forth.
2. `initialRun` with 2 unresolved suggestions → the Intelligence tab shows badge "2"; a viewer (`access="viewer"`) sees cards without Apply buttons.
3. `initialRun={null}` + opening the Intelligence tab → `runBoardIntelligence` called once (`{ boardId: "b1", force: false }`), and not again on re-render.
4. `useBoardIntelligenceStore.getState().requestOpen("b1", { run: true })` while the dock is closed → the dock opens on the Intelligence tab and `runBoardIntelligence` is called once; `openRequest` is null afterwards.
5. the existing "restored open" / "Server Action that throws" cases still pass unchanged.

- [ ] **Step 9: Run + gates**

Run: `pnpm vitest run src/components/boards/dock` then `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/components/boards/dock
git commit -m "feat(boards): Intelligence tab in the board dock with brief, suggestion cards, apply and undo"
```

---

### Task 8: Strip "Catch me up" + "updated Xm ago", provider filter requests, page wiring

Load the `pulse-ui` skill first.

**Files:**

- Modify: `src/components/boards/IntelligenceStrip.tsx`, `IntelligenceStrip.test.tsx`
- Modify: `src/lib/boards/intelligence/context.tsx`, `context.test.tsx`
- Modify: `src/app/(app)/boards/[boardId]/page.tsx`

**Interfaces:**

- Consumes: `useBoardIntelligenceStore` (Task 2); `getLatestBoardIntelligenceRun` (Task 5); `BoardDock` props `access`, `initialRun` (Task 7); `timeAgo`.
- Produces: `StripViewProps` gains `lastRunAt: string | null` and `onCatchMeUp: () => void`; the provider consumes `filterRequest` for its board.

- [ ] **Step 1: Strip tests** (extend `IntelligenceStrip.test.tsx`, which renders `IntelligenceStripView` with explicit props):

```tsx
it("shows a Catch me up pill and, once a run exists, when it was updated", () => {
  const onCatchMeUp = vi.fn();
  const { rerender } = render(
    <IntelligenceStripView
      {...base}
      lastRunAt={null}
      onCatchMeUp={onCatchMeUp}
    />,
  );
  expect(screen.queryByText(/updated/)).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Catch me up" }));
  expect(onCatchMeUp).toHaveBeenCalledTimes(1);
  rerender(
    <IntelligenceStripView
      {...base}
      nowMs={Date.parse("2026-09-11T12:10:00.000Z")}
      lastRunAt="2026-09-11T12:00:00.000Z"
      onCatchMeUp={onCatchMeUp}
    />,
  );
  expect(screen.getByText("updated 10 minutes ago")).toBeInTheDocument();
});
```

and, for the connected component, a case that renders `<IntelligenceStrip />` inside the provider harness the file already uses (or `context.test.tsx`'s harness), clicks "Catch me up", and asserts `useBoardIntelligenceStore.getState().openRequest` equals `{ boardId, run: true, nonce: expect.any(Number) }`.

- [ ] **Step 2: Implement in `IntelligenceStrip.tsx`** — after the `✕ clear` ghost, a trailing cluster:

```tsx
<span className="ml-auto flex shrink-0 items-center gap-2">
  {lastRunAt && (
    <span className="text-muted-foreground text-3xs font-mono">
      updated {timeAgo(lastRunAt, nowMs)}
    </span>
  )}
  <button
    type="button"
    onClick={onCatchMeUp}
    className="border-border hover:border-border-hover focus-visible:ring-ring ease-keystone inline-flex h-6 shrink-0 items-center rounded-sm border px-2 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none pointer-coarse:h-11"
  >
    Catch me up
  </button>
</span>
```

The connected `IntelligenceStrip` reads `lastRunAt` from `useBoardIntelligenceStore((s) => s.runs[intel.boardId]?.generatedAt ?? null)` — add `boardId` to `BoardIntelligenceValue` (the provider already has it) — and `onCatchMeUp = () => requestOpen(boardId, { run: true })`. Update the doc comment at the top of the file (the "Phase 2" reservation is now shipped). Keep `IntelligenceStripView` pure.

- [ ] **Step 3: Provider consumes filter requests** — test in `context.test.tsx`: render the harness, `act(() => useBoardIntelligenceStore.getState().requestFilter(boardId, { kind: "overdue" }))`, assert the selection becomes `{ kind: "overdue" }` (the same assertion the existing `toggle` test makes) and `filterRequest` is null afterwards; a request for another board is ignored. Implement in `BoardIntelligenceProvider`:

```tsx
const filterRequest = useBoardIntelligenceStore((s) => s.filterRequest);
const consumeFilter = useBoardIntelligenceStore((s) => s.consumeFilter);
useEffect(() => {
  if (!filterRequest || filterRequest.boardId !== boardId) return;
  setIntel(filterRequest.selection);
  consumeFilter(filterRequest.nonce);
}, [boardId, consumeFilter, filterRequest, setIntel]);
```

- [ ] **Step 4: Page wiring** — in `src/app/(app)/boards/[boardId]/page.tsx` add to the `Promise.all` (with a comment mirroring the `getBoardLastSeenAt` one: "one indexed LIMIT 1 single-row read, in parallel; the dock badge and the strip's 'updated' meta are true on first paint, and the tab's first open costs no read"):

```ts
    getLatestBoardIntelligenceRun(supabase, boardId, user.id),
```

destructure it as `latestRun`, and pass `access={access ?? "viewer"} initialRun={latestRun}` to `<BoardDock …>`. No other page change (the strip reads the store the dock seeds).

- [ ] **Step 5: Run + gates**

Run: `pnpm vitest run src/components/boards/IntelligenceStrip.test.tsx src/lib/boards/intelligence src/components/boards/dock` then `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit** (the changelog trailer goes on THIS commit — it is the user-visible one)

```bash
git add src/components/boards/IntelligenceStrip.tsx src/components/boards/IntelligenceStrip.test.tsx src/lib/boards/intelligence/context.tsx src/lib/boards/intelligence/context.test.tsx "src/app/(app)/boards/[boardId]/page.tsx"
git commit -m "feat(boards): Catch me up on the intelligence strip opens the dock brief

Changelog: new | Board brief and suggestions | Catch me up on any board: the dock's Intelligence tab writes a short brief of the last 7 days with up to five suggestions you can apply in one click and undo for eight seconds."
```

Then regenerate the changelog in the same task: `pnpm changelog:gen`, confirm `src/lib/changelog/generated.ts` gained the entry, `git add src/lib/changelog/generated.ts && git commit -m "chore(changelog): regenerate generated.ts"`.

---

### Task 9: Whole-branch review, browser verification, closure

Not a build task; the orchestrator runs it after Task 8.

- [ ] **Step 1: Whole-branch review** on the top model (`superpowers:requesting-code-review` against `git diff develop...HEAD`) — Phase 1's blocking defects were found only here. Focus the reviewer on: RLS on the runs table vs. the page read; the RPC's RLS behaviour for viewers; `isActionApplicable` re-check; Undo replay of `null` before-values; the `source` GUC leaking across a pooled connection (it is `set_config(…, true)` = transaction-local — confirm no `is_local=false` slipped in); the dock's `loaded.current` still guarding thread fetches; the strip/dock store seeding order; no `revalidatePath` anywhere new.
- [ ] **Step 2: Browser check** (jsdom sees no paint order). With `pnpm dev` on the worktree, on a board with overdue/stuck items: Task 0's three visuals; "Catch me up" → dock opens on Intelligence, skeletons, then brief + cards; Apply a `set_status` → the row updates without reload, toast "Applied · Undo", Undo restores; the item's Activity Log shows both edits; as a viewer no Apply buttons; `/updates` lists the new entry. If the Chrome extension is unavailable, use the Playwright-from-worktree recipe (memory `playwright-screenshots-from-worktree`).
- [ ] **Step 3:** `scripts/finish-task.sh` from the worktree (rebases, gates incl. `pnpm build`, ledger check, merges to `develop`, removes the worktree).
- [ ] **Step 4:** `/wrapup` with the numbered "How to test" guide.

---

## Execution DAG

Dependencies (task → depends on):

- T0 (cosmetic) → none
- T1 (migration + types) → none (orchestrator applies before T5/T6 start)
- T2 (store + dock tab state + constants) → none
- T3 (schema, validate, board-context, feature key) → none
- T4 (transcript, hash, prompt, generate) → T3 (types), T2 (constants)
- T5 (run + dismiss actions) → T1, T2, T3, T4
- T6 (apply/undo + effects + assign-notify) → T1, T3
- T7 (dock UI) → T2, T5, T6
- T8 (strip, provider, page, changelog) → T2, T5, T7
- T9 (review, browser, finish) → T8

Parallel batches (each batch = one wave of concurrent implementers, each in the shared worktree on files that do not overlap; the orchestrator commits nothing itself except the T1 migration step 6):

| Wave | Tasks          | Notes                                                                                                                                                                                                                                                  |
| ---- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | T0, T1, T2, T3 | Four agents. T1 stops before applying; orchestrator applies + regenerates types at the end of wave 1 (serialized — `database.types.ts` is shared). T2 and T3 both may create `runs.ts` — the orchestrator resolves by keeping T3's version (superset). |
| 2    | T4, T6         | T6 waits for T1's types commit.                                                                                                                                                                                                                        |
| 3    | T5             | Single agent (critical path).                                                                                                                                                                                                                          |
| 4    | T7             | Single agent (UI; loads pulse-ui).                                                                                                                                                                                                                     |
| 5    | T8             | Single agent.                                                                                                                                                                                                                                          |
| 6    | T9             | Orchestrator.                                                                                                                                                                                                                                          |

Critical path: T3 → T4 → T5 → T7 → T8 → T9 (six steps). Wall-clock floor = the longest chain, not the task count.

Worktree: ONE task worktree for the whole phase (`scripts/start-task.sh board-intelligence-advise`); wave-mates edit disjoint files (see each task's Files block). The only shared files are `src/lib/validations/board-intelligence.ts` (T5 then T6 — sequential by wave) and `runs.ts` (T2/T3 — resolved above). Migrations: exactly one (T1), applied once by the orchestrator.
