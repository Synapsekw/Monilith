# Phase 10 · E4 — Generation — Design Spec

**Date:** 2026-07-12
**Slug:** `e4-generation`
**Status:** Approved (design); pending implementation plan
**Parent scope:** `docs/superpowers/specs/2026-07-05-ai-platform-phase-10-scope.md` (E4, batch 2)
**Depends on:** E1 foundation (merged) — the gateway, entitlement, ledger, and provider adapters in `src/lib/ai/`.

## Summary

E4 adds three **generation** features, each of which turns a natural-language / heuristic
intent into a **draft structured artifact that a human reviews and explicitly approves before
anything is persisted**. All three reuse the proven dashboard-gen mechanic
(`src/lib/ai/generate.ts` + `proposal-schema.ts`): _privacy-considered snapshot → structured
(JSON-schema) model output → multi-layer Zod re-validation/repair → existing RPCs_, metered
through the E1 gateway (`runAi` + `requireAiEntitlement`).

- **F10 — AI board generation.** "Build me a board for X" → a proposed board **schema (columns +
  kinds + options) + groups + starter items**. The user reviews the proposed structure, then
  clicks **Create board**, which materializes it via the existing atomic
  `create_board_from_template` RPC (the same RPC the spreadsheet importer uses).
- **F11 — Automation builder from NL.** "When status becomes Done, notify the owner and move to
  Archive" → a generated automations **rule config** (`Draft` = trigger + actions + condition,
  the exact shape `src/lib/validations/automations.ts` defines) that **pre-fills the existing
  `AutomationBuilder`**. The human edits and clicks the existing **Save**, which is the only
  persistence path — the AI never writes.
- **F12 — AI import mapping.** In the spreadsheet Import Wizard's **Map** step, a "Suggest with
  AI" affordance proposes per-column `{kind, role, target}` mappings that patch the wizard's
  client state. The user reviews the mapping grid and the existing **Confirm** step before any
  commit.

Every feature is **propose → human approves → persist**. Nothing is auto-applied.

## Design stance (inherited, non-negotiable)

AI ships **at the seams**, not as chrome — a `Sparkles` entry where the work already happens (the
New-board dialog, the automations builder, the import Map step), no glow, no badges
(`vault/product.md` anti-reference). Every model call is **on-demand, entitlement-gated, and
metered** through E1's `runAi`. Structured output is **always re-validated** against the canonical
Zod schemas and referentially checked against real board data before it can touch the database.

## Locked decisions

| Decision                            | Choice                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Human-approval gate**             | **Mandatory for all three.** F10: a pre-persist **review step** in the wizard (the proposal is returned but NOT written until "Create board"). F11: the AI only **seeds the builder's `initial` prop**; the existing **Save** is the sole write path. F12: suggestions patch **client state only**; the existing Confirm step gates the commit. No feature ever auto-writes. |
| **Reuse over rebuild**              | F10 → `create_board_from_template` (atomic board+groups+columns+items+cells). F11 → the existing `AutomationBuilder` (`initial` prop) + `createAutomation`. F12 → the existing `SheetState` / `onStateChange` mapping-grid contract. No new persistence RPCs; **no migrations**.                                                                                             |
| **One structured-output primitive** | Add a generic `generateStructured({apiKey, system, user, schema})` to the `ProviderAdapter` interface (mirrors the existing `generateProposal`). All three generators call it through the E1-resolved adapter, so managed **and** BYO both work. `generate.ts`'s `generateProposal` is refactored to delegate to it (single implementation per provider).                    |
| **Model id-emission**               | F10 mints new rows, so the model emits **temporary string ids** (`"grp-1"`, `"col-2"`, `"item-3"`) that the validator remaps to server-minted `crypto.randomUUID()`. F11/F12 reference **existing** board ids that are supplied in the prompt context (like dashboard-gen's `columnId`s), then re-validated referentially.                                                   |
| **Data sent to the model**          | F10: the user's free-text description only (no board data — it's a new board). F11: the board's **automations context** — columns `{id,name,kind,options:{id,label}[]}`, groups `{id,name}`, members `{id,name}` (labels + ids, no cell values). F12: **raw sample cell values** — column headers + a capped set of example values per column (see "Data egress" below).     |
| **Model / provider**                | Anthropic `claude-opus-4-8` primary via the E1 gateway; `generateStructured` implemented for all three adapters (anthropic/openai/google) so BYO orgs keep working, mirroring today's `generateProposal`.                                                                                                                                                                    |
| **Metering feature keys**           | `board_gen`, `automation_gen`, `import_mapping` — plain strings passed to `runAi`/`requireAiEntitlement` (E1 takes a free-form `feature: string`; no enum/registry to touch).                                                                                                                                                                                                |

## Data egress (privacy)

- **F10** sends only the user's prompt. No workspace data leaves.
- **F11** sends board **schema + labels** (column names/kinds, option labels, group names, member
  display names) — the same class as dashboard-gen. **No cell values.** Ids are opaque UUIDs.
- **F12 is a new egress class** and must be called out in the UI. Column headers plus a **capped
  sample of raw cell values** (default ≤ 5 values/column, ≤ ~40 columns) are sent so the model can
  infer kind/role/target. Unlike every current `src/lib/ai/` feature (which sends only derived
  schema/stats), F12 sends verbatim cell text. The Map step shows an inline disclosure ("A few
  sample cell values are sent to suggest mappings") and the payload is **bounded** server-side.

## Reused E1 / existing surfaces (verified — do not re-derive)

- **Gateway:** `runAi({orgId,userId,feature}, fn)` and `resolveAiAdapter(orgId)` in
  `src/lib/ai/gateway.ts`; `requireAiEntitlement(orgId, feature)` in `src/lib/ai/entitlement.ts`;
  typed errors in `src/lib/ai/errors.ts` (`AiDisabledError`, `AiQuotaExceededError`,
  `ByoKeyMissingError`, `AiNotConfiguredError`, `ProviderNotCapableError`). The canonical action
  error-mapping is `src/lib/ai/ask/actions.ts` / `src/lib/ai/actions.ts` — copy it verbatim.
- **Adapter:** `ProviderAdapter` in `src/lib/ai/providers/types.ts`; `getAdapter` registry;
  `anthropicAdapter` in `src/lib/ai/providers/anthropic.ts` (structured output via
  `client.messages.parse({ output_config: { format: jsonSchemaOutputFormat(SCHEMA) } })`,
  adaptive thinking, cache-controlled system prompt). `MODEL = "claude-opus-4-8"`.
- **Validation/repair pattern:** `src/lib/ai/proposal-schema.ts` — a hand-written JSON schema for
  the model (`oneOf` per variant, discriminating fields **required** so the model can't emit empty
  configs), then referential + Zod re-validation that **drops or repairs** invalid pieces and
  collects `warnings[]`. All three E4 validators follow this exactly.
- **Result shape:** `ActionResult<T>` / `fail` from `src/lib/actions/result.ts`. Typed RPC via
  `typedRpc` in `src/lib/supabase/typed-rpc.ts`.

### F10 specifics

- **Materialize RPC:** `create_board_from_template(p_workspace_id uuid, p_name text, p_template jsonb) → boards`
  (`SECURITY DEFINER`, `authenticated`-only, org-membership checked, confines every item's
  `groupId`/cell's `columnId` to the board it mints, seeds a default `table` view). Server-action
  wrapper: `createBoardFromTemplate` in `src/lib/boards/actions/board.ts` (via `typedRpc`).
- **`TemplatePayload`** (`src/lib/boards/template-payload.ts`):
  `{ groups: {id,name,color,position}[]; columns: {id,kind,name,settings,position}[]; items: {id,groupId,name,position,cells:{columnId,value}[]}[] }`.
  `settings` for status/dropdown = `{ options: {id,label,color}[] }`, else `{}`. `buildTemplatePayload()`
  in that file is the reference builder. Cell `value` is kind-shaped (status `{optionId}`, dropdown
  `{optionIds}`, date `{date}`, numbers `{n}`, text `{text}`, …).
- **Column kinds + option schema:** `columnKindSchema` (18 kinds) and `optionSchema`
  (`{id,label,color}`) in `src/lib/validations/boards.ts`; per-kind `cellValueSchema(kind)` and
  `columnSettingsSchema(kind)` there too. `COLUMN_KIND_META` (`hasOptions` true only for
  status/dropdown) in `src/lib/boards/column-kinds.ts`.
- **Entry point:** `NewBoardDialog` (`src/components/boards/NewBoardDialog.tsx`) — already toggles
  Blank / template picker / embedded `ImportWizard`; add a third **"Generate with AI"** mode
  (`Sparkles`). Mounted from `BoardsNav.tsx` and the ⌘K "New board" command. The `?ai=1`
  auto-open convention (mirrors `DashboardsNav`) supports a Regenerate/back flow.

### F11 specifics

- **Builder:** `AutomationBuilder` (`src/components/boards/automations/AutomationBuilder.tsx`) takes
  `initial?: Draft` and calls `onSubmit(draft)`. `Draft = { trigger: AutomationTrigger; actions:
AutomationAction[]; condition?: ListFilter | null }` (`recipes.ts`). It's already the seam recipes
  use — F11 is "a recipe the AI writes."
- **Host:** `AutomationsDialog` (`src/components/boards/automations/AutomationsDialog.tsx`) has
  `mode: "list" | "build"`, `startBuild(draft?)`, and passes `columns: CacheColumn[]`,
  `members: BuilderMember[] ({userId,fullName,email})`, `groups: BuilderGroup[] ({id,name})`. Mounted
  from `BoardHeader.tsx`. The AI affordance lives in build mode next to "Start from a recipe".
- **Persist:** `createAutomation({ boardId, name?, trigger, actions, condition? })` in
  `src/lib/boards/automation-actions.ts` → `ActionResult<{id}>`, validated by `createAutomationSchema`.
  This is the **existing Save path** the human triggers — unchanged.
- **Output schema:** `automationTriggerSchema` (discriminated union: `status_changed`,
  `item_created`, `person_assigned`, `date_reached`, `percent_reached`) + `automationActionSchema`
  (`notify` {owner|member}, `set_option`, `set_percent`, `move_to_group`, `call_webhook`) +
  `automationConditionSchema` (= `listFilterSchema`) in `src/lib/validations/automations.ts`. The
  model's JSON schema mirrors these unions; `call_webhook` is **omitted** from the AI schema (admin-
  gated, higher-risk — keep it manual in v1).

### F12 specifics

- **Map step:** `MapStep.tsx` → `MappingGrid.tsx`; single mutation primitive
  `onStateChange({ ...state, columns })`. Per-column editable fields on `ColumnState`
  (`import-wizard-state.ts`): `include`, `name`, `kind: ImportableKind`, `role: "name"|"data"`,
  `target: ColumnTarget` (`"create" | "skip" | {columnId}`), `options`, `detectedKind`.
- **Heuristic being augmented:** `autoMatchColumns(headers, boardColumns) → (string|null)[]`
  (`match-columns.ts`, normalized-name + kind-compat). `BoardColumnRef = {id,name,kind,options}`.
- **Sample data source:** `detectAllColumns(header, rows) → DetectedColumn[]` where
  `DetectedColumn = {header, kind, options, sampleValues}` (up to 50 samples/col; F12 sends far
  fewer). `ImportableKind` set: `text, numbers, percent, currency, status, dropdown, date, checkbox,
rating, email, link, phone, priority`. The full parsed grid is already client-side
  (`ParsedTable = {header, rows, rowIndices}`), so the client assembles the capped sample payload.

## Architecture

New sibling modules in `src/lib/ai/`, one small set per feature, all pure-then-thin like
dashboard-gen. **The only shared-surface change is the adapter's new `generateStructured` method**
(and `generate.ts` delegating to it). Everything else is additive.

```
src/lib/ai/
  providers/types.ts          (MODIFY: + generateStructured on ProviderAdapter)
  providers/anthropic.ts      (MODIFY: implement generateStructured; generateProposal delegates)
  providers/openai.ts,        (MODIFY: implement generateStructured)
  providers/google.ts
  generate.ts                 (MODIFY: generateProposal → thin wrapper over generateStructured)

  board-gen-schema.ts + test        F10: JSON schema + validateBoardProposal → TemplatePayload
  board-generate.ts   + test        F10: prompt + generateStructured (DI adapter)
  board-actions.ts    + test        F10: generateBoardProposal, createBoardFromProposal
  board-gen.rls.integration.test.ts F10

  automation-context.ts   + test    F11: board → grounding context (labels+ids, no cells)
  automation-gen-schema.ts + test   F11: JSON schema + validateAutomationDraft(draft, ctx) → Draft
  automation-generate.ts  + test    F11: prompt + generateStructured (DI adapter)
  automation-gen-actions.ts + test  F11: generateAutomationDraft (no persistence)

  import-mapping-schema.ts   + test F12: JSON schema + applyMappingSuggestions(state, sugg, cols)
  import-mapping-generate.ts + test F12: prompt + generateStructured (DI adapter)
  import-mapping-actions.ts  + test F12: suggestImportMapping (bounded payload; no mutation)

src/components/
  boards/ai/AiBoardWizard.tsx + test        F10 wizard (describe → generate → review → create)
  boards/ai/AiBoardReviewBanner.tsx + test  F10 post-create banner (Keep/Discard/Regenerate)
  boards/NewBoardDialog.tsx                 (MODIFY: + "Generate with AI" mode)
  boards/automations/AutomationsDialog.tsx  (MODIFY: + "Describe an automation" AI affordance)
  boards/import/MapStep.tsx                 (MODIFY: + "Suggest with AI" button + disclosure)
```

### F10 flow

1. `NewBoardDialog` "Generate with AI" → describe step: a bounded textarea ("Build me a board
   for…", ≤ 2000 chars).
2. `generateBoardProposal({ workspaceId, prompt })` (entitlement-gated, `runAi`, `board_gen`) →
   model emits `{ name, groups[], columns[], items[] }` with **temp ids** →
   `validateBoardProposal` remaps temp ids → UUIDs, validates each column kind
   (`columnKindSchema`) + settings (`columnSettingsSchema`), each cell (`cellValueSchema(kind)`),
   confines cell `columnId`→minted columns and item `groupId`→minted groups, drops/repairs the
   invalid, returns `{ templatePayload, summary, warnings }`. **Nothing persisted.**
3. Review step: show the proposed board name, groups, columns (name · kind), and starter-item
   count. Buttons: **Create board** / **Regenerate** (optional feedback) / Back.
4. **Create board** → `createBoardFromProposal({ workspaceId, proposal })` calls
   `create_board_from_template` → route to `/boards/{id}?review=1` with `AiBoardReviewBanner`
   (Keep / Discard via existing `deleteBoard` / Regenerate). The pre-persist review in step 3 is
   the required approval gate; the post-create banner is a convenience mirror of dashboard-gen.

### F11 flow

1. In `AutomationsDialog` build mode, a "Describe an automation…" input + Generate.
2. `generateAutomationDraft({ boardId, prompt })` (entitlement-gated, `runAi`, `automation_gen`)
   builds the automations context server-side (`buildAutomationContext` from `getBoardPayload` +
   board members), calls the model, `validateAutomationDraft(draft, ctx)` referentially checks
   every id and kind (e.g. `status_changed.columnId` ∈ status/dropdown cols; `set_option.optionId`
   ∈ that column's options; `move_to_group.groupId` ∈ groups; `notify.member.userId` ∈ members),
   dropping invalid actions, returning `{ draft, warnings }`. **Nothing persisted.**
3. Seed the builder: `setInitialDraft(draft); setMode("build")` — the human sees a fully populated
   `AutomationBuilder`, edits freely, and clicks **Save** → existing `createAutomation`. That Save
   is the only write path (the approval gate).

### F12 flow

1. Map step "Suggest with AI" button. Client assembles a bounded payload from the parsed grid:
   `{ columns: [{sourceIndex, header, sampleValues[≤5]}], boardColumns? }`.
2. `suggestImportMapping(payload)` (entitlement-gated, `runAi`, `import_mapping`) → model emits
   `[{sourceIndex, kind, role, targetColumnId?}]` → server clamps `kind ∈ IMPORTABLE_KINDS`,
   `role ∈ {name,data}`, and `targetColumnId ∈ boardColumns` → `{ suggestions, warnings }`.
3. Client `applyMappingSuggestions(state, suggestions, boardColumns)` (pure) patches
   `ColumnState.{kind,role,target,detectedKind}` and calls `onStateChange` **once**. The user
   reviews the mapping grid and the existing **Confirm** step gates the actual `commitImport`.

## Error handling (all three)

Copy the `src/lib/ai/ask/actions.ts` mapping verbatim: `AiDisabledError` → "AI is turned off…",
`AiQuotaExceededError` → "You've used this month's AI allowance.", `ByoKeyMissingError` → "…ask an
admin to update Settings.", `AiNotConfiguredError` → feature-appropriate message,
`ProviderNotCapableError` (if a BYO provider can't do structured output) → graceful message; any
other → "…hit a snag. Please try again." When the validator drops everything (empty draft /
0 columns / no usable board), return a clear "Couldn't generate a usable X — try again" and never
persist. All AI code is `server-only`; keys never reach the browser.

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint** of `/boards`, the automations dialog, and the import wizard is **unchanged** —
  every AI entry is a static `Sparkles` button/input; the F10 wizard is lazy
  (`next/dynamic`, `ssr:false`), F11/F12 affordances mount inside already-open dialogs.
- **0 RSC navigations for in-page work.** F10 wizard steps, F11 generate-then-seed, and F12
  suggest-then-apply are **client state only**. The only navigation is F10's final
  `router.push('/boards/{id}?review=1')` **after** the user clicks Create (a real server-data
  change → navigation is correct). F12/F11 do **no** navigation (they mutate in-dialog state).
- **Server round-trips only on explicit actions.** `generateBoardProposal`, `createBoardFromProposal`,
  `generateAutomationDraft`, `suggestImportMapping` each fire **once per button press**. None are
  triggered by tab/filter/sort/step toggles.
- **Bounded / indexed reads.** F10 writes via one atomic RPC. F11's context read is `getBoardPayload`
  (existing RLS-scoped, `board_id`-indexed batch) + a members lookup; the context is schema+labels
  (tiny, independent of row count). F12's egress payload is **explicitly capped** (≤ N columns,
  ≤ 5 samples/column) server-side — never the whole grid. The `ai_usage` ledger write is the E1
  path (indexed `(org_id, created_at)`).

## Parallelization plan (AGENTS.md #6)

**Independent units.** After the shared adapter change (Task 1) lands, **F10, F11, F12 are three
fully independent tracks** — disjoint files (`boards/ai/`, `boards/automations/`,
`boards/import/` + their own sibling `src/lib/ai/*` modules and **separate action files**, so no
shared-file edits), no runtime dependency on one another, and **no migrations** (nothing to
serialize). They are the primary `superpowers:dispatching-parallel-agents` wave inside this
worktree. Within each track, the pure schema/validator and the prompt layer can also be built
concurrently before the action ties them together. See the plan's Execution DAG for batches and
the critical path (F10 is the longest track — the wall-clock floor).

## Testing (TDD — written and executed)

- **Pure units** (the bulk): `validateBoardProposal` (temp-id remap, kind/settings/cell validation,
  groupId/columnId confinement, drop/repair, warnings); `validateAutomationDraft` (id + kind
  referential checks per trigger/action, drop invalid, empty-draft guard);
  `applyMappingSuggestions` (kind/role/target clamping, one `onStateChange`); `buildAutomationContext`
  (labels + ids, **no cell values** — assert the serialized context contains no raw cell text);
  the F10 payload builder (temp→uuid remap round-trips into a valid `TemplatePayload`);
  `generateStructured` per adapter (injected/mocked client — **no real API calls**).
- **Server actions:** Supabase + generate layer mocked; assert entitlement gate is called before any
  token spend, `runAi` feature key, RPC composition (`create_board_from_template` once), the
  no-persistence contract for F11/F12, and the F12 payload cap.
- **RLS integration:** `board-gen.rls.integration.test.ts` — a user can `create_board_from_template`
  in their own workspace and **cannot** cross-tenant; `describe.skipIf(!SERVICE_ROLE_KEY)` per repo
  norm.
- **Component:** F10 wizard step gating (no create before review; Create calls the mocked action);
  F11 dialog seeds the builder from a generated draft and Save calls `createAutomation`; F12 Map
  step applies suggestions to state and shows the raw-sample disclosure. Vitest + jsdom, matching
  existing `*.test.tsx`.

## Out of scope (YAGNI)

- AI-authored automations that self-deploy without human approval (parent scope forbids it in v1);
  `call_webhook` in the F11 AI schema (admin-gated, keep manual). F10 editing the proposal inline
  before create (the created board is fully editable with existing tools) and multi-board / append
  generation. F12 auto-committing without the Confirm step, and F12 sending the full grid (only a
  capped sample). Streaming token-by-token UIs. New provider capabilities beyond the E1 seam.

## Env / ops

No new env or secrets — reuses E1's `ANTHROPIC_API_KEY` / BYO Vault path and entitlement config.
**No migrations** (all three reuse existing RPCs). New metering feature keys (`board_gen`,
`automation_gen`, `import_mapping`) appear in the `ai_usage` ledger automatically.
