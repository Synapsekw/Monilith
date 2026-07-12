# E2 — Item & Content Assist — Implementation Plan

**Date:** 2026-07-12
**Slug:** `e2-item-content-assist`
**Design spec:** `docs/superpowers/specs/2026-07-12-e2-item-content-assist-design.md`
**Branch/worktree:** `task/e2-item-assist` (cut from `develop` with all of Phase 10 E1 merged)
**Method:** `superpowers:test-driven-development` per task; `superpowers:dispatching-parallel-agents`
per batch; `pulse-ui` + `frontend-design` before any UI task.

## E1 interfaces this epic consumes (do not reinvent)

Verified against the merged E1 code (the live API differs from the E1 spec — use these):

- **Gateway** `src/lib/ai/gateway.ts`:
  `runAi<T>({ orgId, userId, feature }, fn: (resolved) => Promise<{ result: T; usage: AiUsageTokens; model: string }>): Promise<T>`
  — resolves the adapter+key, invokes `fn`, meters via `record_ai_usage`. `resolved` = `{ adapter, apiKey, mode, provider }`.
- **Entitlement** `src/lib/ai/entitlement.ts`: `requireAiEntitlement(orgId, feature)` — call **before** any spend; throws typed errors.
- **Errors** `src/lib/ai/errors.ts`: `AiDisabledError`, `AiQuotaExceededError`, `ByoKeyMissingError`, `AiNotConfiguredError`, `ProviderNotCapableError`.
- **Provider guard** `resolved.adapter.id === 'anthropic'` (else `ProviderNotCapableError`); model = `resolved.adapter.defaultModel` / `MODEL` from `src/lib/ai/providers/anthropic`. Direct Anthropic SDK usage pattern: `src/lib/ai/ask/ask.ts`.
- **Snapshot** `src/lib/ai/board-snapshot.ts`: `buildBoardSnapshot({board,columns,items,cellValues})` → schema + `{id,label}` options + aggregate stats (privacy-safe context).
- **Propose→review→apply reference:** `src/lib/ai/actions.ts` (`generateDashboardProposal`/`createDashboardFromProposal`) + `src/lib/ai/proposal-schema.ts` (structured JSON schema + `validateProposal` re-validation).
- **Existing write actions (apply steps — reuse, add none):**
  - `src/lib/boards/actions/cell.ts` → `upsertCell({ itemId, columnId, value })` (validates value-vs-kind, derives org/board).
  - `src/lib/boards/actions/item.ts` → `addSubitem({ parentId, name })` (rejects nesting).
  - `src/lib/boards/bulk-actions.ts` → `bulkSetCell({ itemIds, columnId, value })` → `BulkOutcome`.
- **Data (F8):** `item_updates` / `item_activities`, indexed `(item_id, created_at desc)`; render via `resolveActivity` (`src/lib/collaboration/activity.ts`), caps `UPDATES_LIMIT=30` / `ACTIVITY_LIMIT=50`.
- **Cell value shapes:** status `{optionId}`, dropdown `{optionIds[]}`, text `{text}`; column options at `columns.settings.options: [{id,label,color}]`.
- **Result helpers:** `ActionResult` / `fail` from `src/lib/actions/result.ts`.

**No new migration.** New `ai_usage.feature` tags: `item_assist`, `thread_summary`, `column_fill` (plain strings).

---

## Task 0 — Shared AI action-guard helper

**Goal:** One `mapAiError` for the typed-error → user-copy ladder; refactor the two E1 duplicates onto it.
**Files:** `src/lib/ai/action-guard.ts` (+ `.test.ts`); edit `src/lib/ai/actions.ts` + `src/lib/ai/ask/actions.ts` to consume it (behavior-preserving).
**Test-first:** `mapAiError(new AiQuotaExceededError())` → "You've used this month's AI allowance."; each typed error → its existing string; unknown → generic fallback.
**Interfaces:**

- Consumes: `src/lib/ai/errors.ts`.
- Produces: `mapAiError(e: unknown): string`.

## Task 1 — F7 item-assist lib (schema + generate + validate)

**Goal:** Structured-output assist proposal for description / subtasks / status, plus re-validation.
**Files:** `src/lib/ai/item-assist/schema.ts`, `assist.ts`, `validate.ts` (+ `.test.ts` each).
**Test-first:** JSON schema requires the discriminating fields (mirror `proposal-schema` "no empty object"); `validateItemAssist` drops a `status.optionId` not in the column's options, trims over-long description, caps subtasks; injected fake client returns a canned structured payload (no network).
**Interfaces:**

- Consumes: `runAi` (via caller), `buildBoardSnapshot`, Anthropic SDK (injected), Task 0 not required here.
- Produces: `ItemAssistWant`, `ItemAssistProposal`, `generateItemAssist({apiKey,item,columns,thread?,want})`, `validateItemAssist(proposal, ctx)`.

## Task 2 — F7 item-assist server action

**Goal:** `generateItemAssist` action: gate → read item+board (RLS) → `runAi('item_assist')` → validate.
**Files:** `src/lib/ai/item-assist/actions.ts` (+ `.test.ts`).
**Test-first:** entitlement gate fires before any client call; Anthropic guard → `ProviderNotCapableError` copy; on a non-existent item → `fail`; happy path returns `{proposal,warnings}`; typed errors mapped via `mapAiError`. Apply is **not** a new action — the test asserts the action returns a proposal only (client calls `upsertCell`/`addSubitem`).
**Interfaces:**

- Consumes: Task 1, Task 0 (`mapAiError`), `requireAiEntitlement`, `runAi`, `getBoardPayload`, `requireUser`/`getUserOrgs`.
- Produces: `generateItemAssist({ itemId, want, targetColumnId? }): ActionResult<{proposal,warnings}>`.

## Task 3 — F7 UI (fields-tab assist panel)

**Goal:** Replace the `fields`-tab placeholder with the assist panel (propose/edit/apply/discard).
**Files:** `src/components/ai/item-assist/ItemAssistPanel.tsx` (+ `.test.tsx`); edit `src/components/boards/item-panel/ItemPanel.tsx` to mount it lazily in the `fields` tab.
**Test-first (RTL):** renders three assist entries; description entry disabled + hint when the board has no text column; subtasks entry disabled for a subitem; apply calls the injected `upsertCell`/`addSubitem`; disabled/quota states render, no crash. Load `pulse-ui` first.
**Interfaces:**

- Consumes: Task 2 action; `upsertCell`, `addSubitem`; item panel props (`columns`, `itemId`, `boardId`).
- Produces: `ItemAssistPanel`; `ItemPanel` `fields` tab wired.

## Task 4 — F8 summarize lib + server action

**Goal:** Bounded transcript builder + Anthropic plain-text summary + read-only action.
**Files:** `src/lib/ai/summarize/summarize.ts`, `actions.ts` (+ `.test.ts` each).
**Test-first:** transcript builder orders chronologically, resolves author names, renders activity via `resolveActivity`, returns empty-sentinel for no thread; action gates before spend, guards empty thread, reads bounded/indexed `item_updates`+`item_activities`, `runAi('thread_summary')`, returns `{summary}`; injected client (no network).
**Interfaces:**

- Consumes: Task 0 (`mapAiError`), `runAi`, `requireAiEntitlement`, `resolveActivity`, collaboration reads.
- Produces: `summarizeThread({apiKey,updates,activities,members})` (lib) + `summarizeThread({itemId}): ActionResult<{summary}>` (action).

## Task 5 — F8 UI ("Catch me up")

**Goal:** A button above the thread that shows a thinking→digest card.
**Files:** `src/components/ai/summarize/ThreadSummary.tsx` (+ `.test.tsx`); edit `src/components/boards/item-panel/UpdatesTab.tsx` to render it.
**Test-first (RTL):** button disabled on empty thread; click → thinking → summary card; dismiss; disabled/quota states. Load `pulse-ui` first.
**Interfaces:**

- Consumes: Task 4 action; `UpdatesTab` cache/props.
- Produces: `ThreadSummary`; `UpdatesTab` wired.

## Task 6 — F9 column-fill lib (schema + classify + validate)

**Goal:** Structured per-row classification of source text → target option id, plus re-validation.
**Files:** `src/lib/ai/column-fill/schema.ts`, `classify.ts`, `validate.ts` (+ `.test.ts` each).
**Test-first:** schema requires `rows:[{itemId,optionId|null}]`; `classifyColumn` maps `[{itemId,text}]` + target `{id,label}` options → ids (injected client); `validateClassifications` nulls unknown ids and enforces `COLUMN_FILL_MAX`.
**Interfaces:**

- Consumes: Anthropic SDK (injected).
- Produces: `COLUMN_FILL_MAX`, `classifyColumn({apiKey,rows,targetOptions})`, `validateClassifications(...)`.

## Task 7 — F9 column-fill server actions (classify + apply)

**Goal:** Bounded classify action + batched apply via `bulkSetCell`.
**Files:** `src/lib/ai/column-fill/actions.ts` (+ `.test.ts`).
**Test-first:** classify gates before spend, reads source column cells **bounded to `COLUMN_FILL_MAX`** over the `cell_values(column_id)` index, reads target options, `runAi('column_fill')`, returns preview rows; apply re-validates option ids and calls `bulkSetCell` once per distinct option id; typed errors → `mapAiError`.
**Interfaces:**

- Consumes: Task 6, Task 0, `requireAiEntitlement`, `runAi`, `bulkSetCell`, board reads.
- Produces: `classifyColumn({boardId,sourceColumnId,targetColumnId}): ActionResult<{preview,warnings}>`, `applyColumnFill({targetColumnId,assignments}): ActionResult<BulkOutcome>`.

## Task 8 — F9 UI (Smart-Fill dialog + preview grid + column-header entry)

**Goal:** Lazy dialog with up-front privacy notice, target picker, classify, preview-and-apply grid.
**Files:** `src/components/ai/column-fill/SmartFillDialog.tsx`, `SmartFillGrid.tsx` (+ `.test.tsx`); edit the board column-header menu to add "Smart fill…" on text columns.
**Test-first (RTL):** privacy notice renders before any classify call; target picker lists only status/dropdown columns; preview rows editable/deselectable; "Apply N" calls `applyColumnFill` with only accepted rows; disabled/quota/empty states. `next/dynamic({ssr:false})`; History API for the dialog step (no router nav). Load `pulse-ui` first.
**Interfaces:**

- Consumes: Task 7 actions; column-header menu; board columns.
- Produces: `SmartFillDialog`, `SmartFillGrid`; column-header "Smart fill…" entry.

---

## Execution DAG (AGENTS.md #6)

**Dependency edges** (from the `Consumes` blocks):

```
T0 (mapAiError)  ──▶ T2, T4, T7
T1 ──▶ T2 ──▶ T3            (F7 chain)
        T4 ──▶ T5           (F8 chain)
T6 ──▶ T7 ──▶ T8            (F9 chain)
T1, T6 : no unmet deps beyond E1 (already merged)
T4 : depends on T0 only
```

**Parallel batches** (each = one concurrent wave of agents):

- **Batch 0:** `T0` — tiny helper; unblocks the three action tasks. (Run T1 and T6 concurrently with it
  if desired — they have no dep on T0, but their _action_ tasks do.)
- **Batch 1 (parallel ×3):** `T1` (F7 lib), `T6` (F9 lib), and `T4`-lib-portion. Simpler scheduling:
  run `T1`, `T4`, `T6` — but `T4` folds lib+action, so gate it behind T0. Practical wave: **`T1`, `T6`**
  (pure libs, no T0 dep) alongside **`T0`**.
- **Batch 2 (parallel ×3):** `T2` (needs T0+T1), `T4` (needs T0), `T7` (needs T0+T6).
- **Batch 3 (parallel ×3):** `T3` (needs T2), `T5` (needs T4), `T8` (needs T7).

Disjoint files per wave → dispatch with `superpowers:dispatching-parallel-agents`; each agent works in
the shared `task/e2-item-assist` worktree on **non-overlapping paths** (item-assist/ vs summarize/ vs
column-fill/ modules and separate components). The only shared edits are T0's refactor of the two E1
action files (done first, alone) and three small mount-point edits (`ItemPanel.tsx`, `UpdatesTab.tsx`,
column-header menu) which land in Batch 3 on different files.

**Critical path (wall-clock floor):** `T0 → T7 → T8` (or `T0/T1 → T2 → T3`, or `T6 → T7 → T8`) —
**≈ 4 task-waves**: helper → feature-lib → feature-actions → feature-UI. F9 (T6→T7→T8) is the
heaviest UI (the preview grid), so it sets the practical floor.

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint unchanged** — AI entries are static buttons; `ItemAssistPanel` + `SmartFillDialog` are
  `next/dynamic({ ssr:false })`; opening the item panel + switching tabs stay **0 round-trips** (client
  `useState`, mirroring `FilesTab`'s lazy-on-open query).
- **One Server Action per AI call**, only on explicit user action (Draft/Suggest/Set, Catch me up,
  Classify, Apply) — never on a tab/filter/sort/view toggle. Each wraps exactly one metered `runAi`.
- **In-panel/in-dialog state is client-only**; the F9 dialog's step uses the **History API**
  (`push/replaceState`), never `<Link>`/router (gotcha-09). Item-panel tabs remain client `useState`.
- **Bounded + indexed reads:** F7 = one item by pk + board snapshot; F8 = `item_updates`/`item_activities`
  by `(item_id, created_at desc)` capped 30/50; F9 = source column cells bounded to `COLUMN_FILL_MAX`
  over `cell_values(column_id)`; apply = one batched `bulkSetCell` per option. No unbounded `select *`.

## Verification (per task + epic close)

Each task: red → green → refactor, then `pnpm typecheck && pnpm lint && pnpm test`. Epic close (from
the worktree): all four gates — `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — then
`scripts/finish-task.sh`. Anthropic client is injected/mocked throughout — **no real API calls in
tests**. Ship a numbered "How to test this" walkthrough (open an item panel → fields tab → Draft
description / Suggest subtasks / Set status; Updates tab → Catch me up; board text-column header →
Smart fill → notice → classify → apply).

## Cross-epic shared-surface touchpoints (for the Batch-2 build DAG)

- `src/lib/ai/` flat dir (E2 adds `action-guard.ts` + 3 sub-dirs; E3/E4 also add here).
- `src/lib/ai/providers/` adapter interface — **E2 does not touch it** (Anthropic direct-SDK); E4 likely
  adds a generic structured method (later refactor target for F7/F9).
- `ItemPanel.tsx` / `UpdatesTab.tsx` (F7/F8 mounts).
- Board column-header menu + import-wizard components (F9 vs E3 NL-actions, E4/F12 import mapping).
- `supabase/migrations/` — **E2 needs none** (zero migration-ordering conflict with the rest of Batch 2).
