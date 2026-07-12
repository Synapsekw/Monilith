# E2 — Item & Content Assist — Design Spec

**Date:** 2026-07-12
**Slug:** `e2-item-content-assist`
**Phase:** 10 — AI & Agents · **Epic 2** (F7–F9) · **Batch 2** (parallel with E3/E4/E6, all on E1)
**Status:** Draft — pending review
**Parent scope:** `docs/superpowers/specs/2026-07-05-ai-platform-phase-10-scope.md`
**Consumes (E1):** `docs/superpowers/specs/2026-07-05-ai-foundation-and-ask-pulse-design.md`

## Summary

Three AI features that surface intelligence exactly where item work already happens — the item
panel and the board grid — each built on E1's gateway/entitlement/ledger and the proven
**snapshot → structured output → multi-layer Zod re-validation → existing RPCs** pattern. No glow,
no badges, no new tab: AI is an explicit, on-demand action.

- **F7 AI item assist** — in the item panel's **`fields` tab**, an assist that can (a) draft/rewrite a
  **description** into a chosen text column, (b) **suggest subtasks** (child items), and (c) **propose a
  status/priority** value. Each is a propose → review → apply flow; apply reuses the existing board
  write actions (`upsertCell`, `addSubitem`).
- **F8 Thread summarization** — a **"Catch me up"** action over an item's `item_updates` +
  `item_activities`, returning a short plain-text digest. Read-only; no writes.
- **F9 Smart column fill** — from a board column header, **bulk-classify** a free-text column into a
  target **status / dropdown** column, shown in a **preview-and-apply grid** (import-wizard pattern).
  Apply reuses `bulkSetCell`. **Sends the raw text of the source column to the model** — the one E2
  feature with a prominent, up-front privacy notice.

### What E2 does NOT add (reuse story / YAGNI)

- **No new migration.** F7/F8/F9 add no tables, columns, enums, or RPCs. All persistence flows through
  existing board write actions. New `ai_usage.feature` values (`item_assist`, `thread_summary`,
  `column_fill`) are plain string tags on the existing ledger — no schema change.
- **No new write RPCs.** Apply steps call `upsertCell` / `addSubitem` (F7) and `bulkSetCell` (F9),
  which already validate value-vs-kind, derive org/board server-side, and enforce RLS.
- **No provider-adapter interface change.** v1 requires **Anthropic** for the three features (mirrors
  Ask Pulse's `ProviderNotCapableError` guard). Generalizing structured output onto the adapter is a
  fast-follow and a coordination point with E4 (see Locked decisions).

## Locked decisions

| Decision                 | Choice                                                                                                                                                                                                                                                     | Rationale                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **"Description" target** | The user picks a **text column** to write into (default: the board's first `text` column). If the board has no text column, the description sub-feature is disabled with a hint. Item has no native description field (`items` = name + system cols only). | Reuses `upsertCell({columnId, value:{text}})`; invents no schema.                                                                          |
| **"Subtasks" target**    | Each accepted suggestion becomes a **child item** via `addSubitem({parentId, name})`. Disabled when the item is itself a subitem (`addSubitem` rejects nesting: `parent.parent_id !== null`).                                                              | Matches the existing subitem model (`items.parent_id`).                                                                                    |
| **"Priority"**           | There is no priority type — "priority" is just a `status`/`dropdown` column. F7 proposes an **existing option id** for a chosen status/dropdown column; apply is `upsertCell({value:{optionId}})`.                                                         | Reuse; the model is given the column's `{id,label}` options and its choice is re-validated against them.                                   |
| **Provider (v1)**        | **Anthropic only** for F7/F8/F9, guarded like Ask Pulse (`adapter.id !== 'anthropic'` → `ProviderNotCapableError`). Feature modules call the Anthropic SDK directly inside `runAi`, exactly as `src/lib/ai/ask/ask.ts` does.                               | Ships fast; avoids reshaping the shared adapter interface mid-batch (E4 will want a generic structured method — coordinate then, not now). |
| **F9 privacy**           | Raw source-column text **leaves the tenant**. The Smart-Fill dialog shows an **up-front notice** naming the provider before any call, and states the bounded row count.                                                                                    | Scope stance: raw cell values leave the workspace only when a feature needs it, called out per-feature.                                    |
| **F7/F8 context**        | The model sees the **item name + selected text-field values (F7) / update bodies + activity descriptors (F8)** — raw item text. Called out in each panel with a subtle one-liner.                                                                          | Same privacy stance, lower blast radius than F9 (single item, not a whole column).                                                         |
| **F8 output**            | Plain-text digest (no structure); returned complete with a "thinking…" state. Streaming deferred (matches E1).                                                                                                                                             | Simplest useful thing.                                                                                                                     |
| **F9 apply granularity** | User reviews the per-row preview, may **deselect/override** any row, then **Apply**. Only accepted rows are written, in one batched `bulkSetCell` per target option (or one call over the accepted set).                                                   | Preview-and-apply, never silent bulk writes.                                                                                               |

## Architecture

Every feature adds an isolated module under `src/lib/ai/<feature>/` (server) plus a lazy client
surface under `src/components/ai/<feature>/`. All Server Actions follow the repo convention:
`"use server"`, Zod `safeParse` at the boundary, `ActionResult<T>` via `fail`/`ok` from
`src/lib/actions/result.ts`, RLS via the cookie-bound `createClient()`, entitlement-gated and metered
through E1's gateway.

### 0. Shared: `src/lib/ai/action-guard.ts` (new, tiny)

The typed-error → user-message ladder is currently **duplicated** verbatim in `src/lib/ai/actions.ts`
and `src/lib/ai/ask/actions.ts`. Extract it once:

- `mapAiError(e: unknown): string` — maps `AiDisabledError` / `AiQuotaExceededError` /
  `ByoKeyMissingError` / `AiNotConfiguredError` / `ProviderNotCapableError` to the existing friendly
  copy, with a generic fallback. All E2 actions consume it; the two E1 call sites are refactored onto
  it (behavior-preserving). Satisfies the "grep before writing a helper" invariant.

### 1. F7 — Item assist · `src/lib/ai/item-assist/`

- **`schema.ts`** — the assist proposal shape + the Anthropic structured-output JSON schema, mirroring
  `proposal-schema.ts`'s "fully-specify the schema so the model can't emit an empty object" discipline:
  - `description?: string` (bounded length), `subtasks?: string[]` (bounded count/length),
    `status?: { columnId: string; optionId: string }`.
  - The client requests only the sub-parts the user asked for (task-scoped prompt), so unused fields
    stay absent.
- **`assist.ts`** — `generateItemAssist({ apiKey, item, columns, thread?, want })`: builds a
  privacy-bounded context (item name + selected text cells + the target status column's
  `{id,label}` options via `buildBoardSnapshot`, optionally a short thread excerpt), calls the
  Anthropic SDK for structured output, returns `{ proposal, usage }`. Client is injected for tests.
- **`validate.ts`** — `validateItemAssist(proposal, ctx)`: re-checks the model's output the way
  `validateProposal` does — a proposed `status.optionId` **must** exist in the referenced column's
  settings options; over-long descriptions/subtasks are trimmed or dropped with warnings. Never trust
  raw model output at the write boundary.
- **`actions.ts`** —
  - `generateItemAssist({ itemId, want, targetColumnId? })`: resolve org+user, `requireAiEntitlement`,
    read the item + board (RLS-scoped, server-side — never trust client-passed cells), `runAi(...,
'item_assist', fn)`, validate, return `{ proposal, warnings }`.
  - **Apply is the existing actions, called from the client per accepted field** — no new write action:
    description → `upsertCell({ itemId, columnId, value: { text } })`; each subtask →
    `addSubitem({ parentId: itemId, name })`; status → `upsertCell({ itemId, columnId, value: { optionId } })`.

### 2. F8 — Thread summarization · `src/lib/ai/summarize/`

- **`summarize.ts`** — `summarizeThread({ apiKey, updates, activities, members })`: renders a bounded,
  chronological transcript (update `body_text` + human-readable activity descriptors via
  `resolveActivity`, author names via `members`), calls Anthropic for a **plain-text** completion,
  returns `{ summary, usage }`. Bounded input (reuse the existing `UPDATES_LIMIT=30` /
  `ACTIVITY_LIMIT=50` caps) as a cost guard.
- **`actions.ts`** — `summarizeThread({ itemId })`: resolve org+user, `requireAiEntitlement`, read
  `item_updates` + `item_activities` for the item **bounded + indexed on `(item_id, created_at desc)`**
  (RLS-scoped), guard empty thread ("Nothing to summarize yet"), `runAi(..., 'thread_summary', fn)`,
  return `{ summary }`. Read-only.

### 3. F9 — Smart column fill · `src/lib/ai/column-fill/`

- **`schema.ts`** — the classification output schema: `rows: { itemId: string; optionId: string | null }[]`
  (null = "no confident match"), fully specified for structured output.
- **`classify.ts`** — `classifyColumn({ apiKey, rows, targetOptions })`: given `[{itemId, text}]` and the
  target column's `{id,label}` options, asks the model to map each row's raw text to an option id (or
  null). Returns `{ classifications, usage }`.
- **`validate.ts`** — `validateClassifications(...)`: every returned `optionId` must be an existing
  option on the target column; unknown ids → null (dropped). Bounds row count.
- **`actions.ts`** —
  - `classifyColumn({ boardId, sourceColumnId, targetColumnId })`: resolve org+user,
    `requireAiEntitlement`, read the **source column's cell text bounded to `COLUMN_FILL_MAX` rows**
    (indexed on `cell_values(column_id)`), read the target column's options, `runAi(..., 'column_fill',
fn)`, validate, return `{ preview: { itemId, itemName, sourceText, proposedOptionId }[], warnings }`.
  - `applyColumnFill({ targetColumnId, assignments })`: group accepted `{itemId, optionId}` and write via
    **`bulkSetCell({ itemIds, columnId, value: { optionId } })`** (one call per distinct option id).
    Re-validates option ids server-side before writing.

### 4. UI (lazy, client-state, 0 RSC navigations)

`pulse-ui` + `frontend-design` skills loaded before building. All AI entries are static buttons; the
heavy surfaces are `next/dynamic({ ssr: false })`.

- **F7 `src/components/ai/item-assist/ItemAssistPanel.tsx`** — mounted in `ItemPanel.tsx`'s **`fields`
  tab** (replacing today's "Edit fields in the board grid" placeholder). Three assist entries
  ("Draft description", "Suggest subtasks", "Set status") each open a review card: proposed value,
  editable, with **Apply** / **Discard**. Description target = a text-column picker (default first text
  column; disabled + hint when none). Subtasks disabled for subitems. A subtle privacy one-liner.
  Panel state is local (`useState`) like the existing tabs — panel open + tab switch stay **0
  round-trips** (as `FilesTab` already does).
- **F8 `src/components/ai/summarize/ThreadSummary.tsx`** — a **"Catch me up"** button rendered above the
  thread in `UpdatesTab.tsx`; on click, calls `summarizeThread`, shows a "thinking…" state then the
  digest in a dismissible card. Disabled when the thread is empty.
- **F9 `src/components/ai/column-fill/`** — `SmartFillDialog.tsx` (lazy) opened from a **column-header
  menu** entry ("Smart fill…") on text columns; a target-column picker (status/dropdown columns), the
  **up-front privacy notice**, a "Classify" action, then `SmartFillGrid.tsx` — the preview-and-apply
  grid (row: source text → proposed option chip, editable/deselectable) with **Apply N rows**. Reuses
  the visual language of `src/components/boards/import/MappingGrid.tsx`.

## Data flow (representative — F7 status propose→apply)

1. User opens the item panel → `fields` tab (0 round-trips) → clicks "Set status".
2. `generateItemAssist({ itemId, want:['status'], targetColumnId })` → `requireAiEntitlement` →
   server reads item + board snapshot (RLS) → `runAi('item_assist')` → structured output →
   `validateItemAssist` (optionId ∈ column options) → `{ proposal }`.
3. Client shows the proposed option chip; user accepts → `upsertCell({ itemId, columnId, value:{optionId} })`.
4. Board realtime + item panel reflect the write; `runAi` has logged tokens/cost/credits.

## Error handling

- AI off / not configured / quota exceeded / BYO missing / non-Anthropic provider → clean
  `ActionResult` message via `mapAiError`, never a 500; the assist entries explain, never crash.
- Empty inputs are guarded **before** spend (F8 empty thread; F9 empty column; F7 no target column).
- Model output is never trusted: F7 status/F9 option ids and F7 subtask/description lengths are
  re-validated; unknown ids dropped with a warning.
- Apply failures surface the existing board mutation toasts (`bulkSetCell`/`upsertCell` already do
  optimistic-then-reconcile with error toasts).

## Security & privacy notes

- All reads are **cookie-bound / RLS-scoped**; cross-org/cross-board access is impossible by
  construction. Feature modules never import the service client (the gateway's `runAi` uses it only for
  metering, as in E1).
- Apply writes go through existing actions that derive org/board server-side and validate value-vs-kind
  — a tampered proposal cannot write a malformed or cross-tenant cell.
- **Raw text leaving the tenant** is per-feature and called out: F7 (item name + selected text fields +
  optional short thread), F8 (thread text), **F9 (the whole source column's text — prominent up-front
  notice)**.
- Bounded prompts (item text, thread caps, column-fill row cap) double as cost-abuse guards.

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint unchanged.** AI entries are static buttons; `ItemAssistPanel` and `SmartFillDialog` are
  `next/dynamic({ ssr:false })`; opening the item panel and switching tabs remain **0 round-trips**
  (item-panel tabs are client `useState`; `FilesTab`'s lazy query is the established pattern).
- **Server round-trips only on explicit AI actions** — `generateItemAssist`, `summarizeThread`,
  `classifyColumn`, and the apply actions. **None are triggered by a view/tab/filter toggle.** Each AI
  call is exactly **one Server Action** wrapping **one metered `runAi`**.
- **In-panel/in-dialog toggles = client state.** F7 review cards and F9 preview edits mutate client
  state only; where a URL-worthy step exists (F9 dialog step) use the **History API**
  (`pushState`/`replaceState`), never a `<Link>`/router navigation (gotcha-09).
- **Bounded / indexed reads.** F7 reads one item by pk + board schema snapshot. F8 reads
  `item_updates` / `item_activities` by the **`(item_id, created_at desc)` index**, capped at 30/50.
  F9 reads the source column's cells **bounded to `COLUMN_FILL_MAX`** over the
  **`cell_values(column_id)` index**; the preview is bounded and client-held; apply is one batched
  `bulkSetCell` per option. No unbounded `select *` on a growing table.

## Parallelization plan (AGENTS.md #6)

F7, F8, F9 are **disjoint feature areas** (separate `src/lib/ai/<feature>/` modules and separate
components) with one shared micro-dependency — the `mapAiError` helper. Independent units:

- **Batch 0 (foundation):** `action-guard.ts` (`mapAiError`) — tiny; unblocks all three.
- **Batch 1 (parallel):** F7 lib, F8 lib, F9 lib — three concurrent agents, no shared files.
- **Batch 2 (parallel):** F7 actions, F8 actions, F9 actions.
- **Batch 3 (parallel):** F7 UI, F8 UI, F9 UI.

Critical path = Batch 0 → any feature's lib → its actions → its UI ≈ **4 waves**. The full Execution
DAG (task-level edges, batches, critical path) is in the implementation plan.

## Cross-epic shared-surface touchpoints (Batch 2 coordination)

Flagged so the cross-epic build DAG can serialize or worktree-isolate where E2 overlaps E3/E4/E6:

- **`src/lib/ai/` flat dir** — E2 adds `action-guard.ts` + `item-assist/`, `summarize/`, `column-fill/`
  sub-dirs; E3/E4 also add modules here. Sub-dirs avoid file collisions; `errors.ts`/`pricing.ts` may
  see additive edits from multiple epics.
- **`src/lib/ai/providers/` (adapter interface)** — E2 deliberately does **not** touch it (Anthropic
  direct-SDK, guarded). E4 will likely add a generic structured-output method; that is the natural place
  to later refactor F7/F9 off the direct call. Coordinate the interface change through whichever epic
  lands it first.
- **`ItemPanel.tsx` tab bar / `UpdatesTab.tsx`** — F7 rewrites the `fields` tab body; F8 adds a button
  to `UpdatesTab`. E3 (⌘K) should not need these — but flag the file.
- **Board table / column-header menu** — F9 adds a "Smart fill…" entry; E3 (NL actions) and E4 (F12
  import mapping) may also touch board-table headers/menus.
- **Import-wizard components (`src/components/boards/import/`)** — F9 mirrors `MappingGrid`'s pattern;
  E4/F12 edits the wizard itself. If F9 extracts a shared preview-grid primitive, that becomes a shared
  surface with E4.
- **`supabase/migrations/`** — **E2 needs none**, so E2 introduces **zero** migration-ordering conflict
  with the rest of Batch 2 (a scheduling win).

## Testing (TDD — written and executed)

- **Pure units:** F7 `validateItemAssist` (optionId ∈ options; length trims), F8 transcript builder
  (ordering, author resolution, empty), F9 `validateClassifications` (unknown ids → null; row cap).
  Anthropic client injected/mocked — **no real API calls**.
- **Actions:** entitlement gate fires before spend; `runAi` invoked with the right feature tag; typed
  errors → `mapAiError` copy; apply calls the correct existing write action with a re-validated payload.
- **Component:** F7 assist panel (propose/edit/apply/discard, disabled states, no-text-column hint),
  F8 "Catch me up" (thinking/summary/empty/disabled), F9 dialog (privacy notice shown, preview edit,
  apply-N).
- **Reuse the existing gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Out of scope for E2 (YAGNI)

- Streaming; a generic provider-adapter structured method (fast-follow with E4); per-user assist memory;
  applying F7 across many items at once (that's F9's job for columns); NL writes from the panel (F6/E3);
  semantic retrieval for context (F15); editing the item name via assist (rename stays manual).
