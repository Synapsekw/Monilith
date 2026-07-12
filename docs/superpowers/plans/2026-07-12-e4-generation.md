# E4 — Generation (F10/F11/F12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`
> (recommended — the three feature tracks are a parallel dispatch wave) or
> `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax. Load `pulse-ui` +
> `frontend-design` before any UI task (AGENTS.md #3). Spec:
> `docs/superpowers/specs/2026-07-12-e4-generation-design.md`.

**Goal:** Ship three propose-then-approve generation features on top of the E1 AI foundation, each
metered through the gateway and each requiring an **explicit human approval before any write**:
**F10** AI board generation ("build me a board for X" → schema + groups + starter items →
`create_board_from_template`), **F11** NL automation builder (prompt → a `Draft` that pre-fills the
existing `AutomationBuilder`; the existing **Save** persists), **F12** AI import mapping (Map step
"Suggest with AI" → patches wizard client state; the existing **Confirm** step persists).

**Architecture:** One shared-surface change — a generic `generateStructured` on the `ProviderAdapter`
(mirrors today's `generateProposal`) so all three generators run through the E1-resolved adapter
(managed + BYO). Everything else is **additive** sibling modules in `src/lib/ai/` following the
dashboard-gen shape: a **pure JSON-schema + Zod re-validator/repairer**, a thin **generate** layer
(DI'd adapter), a **server action** that gates entitlement and composes existing RPCs, and a **UI**
that is client-state + History-API only. **No migrations** — F10 reuses `create_board_from_template`,
F11 reuses `createAutomation`, F12 mutates client state and reuses `commitImport`.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Supabase (RLS), Zod, `@anthropic-ai/sdk`
(via E1 adapters), React (Vitest + jsdom), pulse-ui (shadcn/Tailwind v4).

---

## Key existing facts (verified — do not re-derive)

**E1 gateway/metering (reuse verbatim):**

- `runAi({ orgId, userId, feature }, async ({ adapter, apiKey }) => ({ result, usage, model }))` and
  `resolveAiAdapter(orgId)` — `src/lib/ai/gateway.ts`. `requireAiEntitlement(orgId, feature)` —
  `src/lib/ai/entitlement.ts` (call **before** any token spend). Typed errors + the canonical
  action error-mapping: `src/lib/ai/errors.ts` and `src/lib/ai/ask/actions.ts` /
  `src/lib/ai/actions.ts`. `ActionResult`/`fail` — `src/lib/actions/result.ts`.
- `ProviderAdapter` — `src/lib/ai/providers/types.ts`; `getAdapter` — `providers/registry.ts`;
  Anthropic structured output — `providers/anthropic.ts`
  (`client.messages.parse({ model: MODEL, max_tokens, thinking:{type:"adaptive"},
output_config:{ effort:"high", format: jsonSchemaOutputFormat(SCHEMA) },
system:[{type:"text",text,cache_control:{type:"ephemeral"}}], messages })`), `MODEL =
"claude-opus-4-8"`. The JSON-schema + drop/repair/`warnings[]` pattern to copy:
  `src/lib/ai/proposal-schema.ts`.

**F10:**

- Materialize: `create_board_from_template(p_workspace_id uuid, p_name text, p_template jsonb) → boards`
  (returns `{ id, org_id }`). Wrapper `createBoardFromTemplate` — `src/lib/boards/actions/board.ts`
  via `typedRpc(supabase, "create_board_from_template", …)`.
- `TemplatePayload` — `src/lib/boards/template-payload.ts`:
  `{ groups:{id,name,color,position}[]; columns:{id,kind,name,settings,position}[];
items:{id,groupId,name,position,cells:{columnId,value}[]}[] }`. status/dropdown settings =
  `{ options:{id,label,color}[] }` else `{}`. `buildTemplatePayload()` = reference builder.
- Kinds/options/cells: `columnKindSchema`, `optionSchema` (`{id,label,color}`),
  `columnSettingsSchema(kind)`, `cellValueSchema(kind)` — `src/lib/validations/boards.ts`;
  `COLUMN_KIND_META` (hasOptions ⇔ status/dropdown) — `src/lib/boards/column-kinds.ts`.
- Entry: `NewBoardDialog` — `src/components/boards/NewBoardDialog.tsx` (already toggles blank /
  template / embedded `ImportWizard`). `?ai=1` auto-open convention mirrors
  `src/components/dashboards/DashboardsNav.tsx`. Delete for Discard: `deleteBoard` in
  `src/lib/boards/actions/board.ts`.

**F11:**

- Builder: `AutomationBuilder({ columns:CacheColumn[], members:BuilderMember[], groups:BuilderGroup[],
initial?:Draft, canWebhook?, onSubmit(draft), onCancel })` —
  `src/components/boards/automations/AutomationBuilder.tsx`.
  `Draft = { name?; trigger:AutomationTrigger; actions:AutomationAction[]; condition?:ListFilter|null }`
  — `src/components/boards/automations/recipes.ts` (see `recipe*()` factories for the output shape).
- Host: `AutomationsDialog` — `…/AutomationsDialog.tsx`; `mode:"list"|"build"`, `startBuild(draft?)`
  (sets `initialDraft`, bumps `builderKey`, mode→build). Props already carry `columns` /
  `members` (`{userId,fullName,email}`) / `groups` (`{id,name}`). Mounted from `BoardHeader.tsx`.
- Persist (the human's Save): `createAutomation({ boardId, name?, trigger, actions, condition? }) →
ActionResult<{id}>` — `src/lib/boards/automation-actions.ts` (validates `createAutomationSchema`).
- Output schema unions: `automationTriggerSchema` / `automationActionSchema` /
  `automationConditionSchema (=listFilterSchema)` — `src/lib/validations/automations.ts`.
- **The engine matches raw ids** (Postgres AFTER trigger, `…automations_engine.sql`) — there is **no**
  name→id resolver; the generator MUST emit real board UUIDs (present in the context) and resolve NL
  values ("Done", "Archive") to option/group ids itself (mirror the `doneOptionId()` `/done|complete/i`
  heuristic). `createAutomationSchema` checks **format only**, not existence — so the validator does
  the referential check.

**F12:**

- `MapStep` / `MappingGrid` — `src/components/boards/import/`; single mutation
  `onStateChange({ ...state, columns })`. `ColumnState` (`import-wizard-state.ts`):
  `{ sourceIndex, include, name, kind:ImportableKind, options, role:"name"|"data",
detectedKind, target:ColumnTarget }`; `ColumnTarget = "create"|"skip"|{columnId}`.
- Heuristic augmented: `autoMatchColumns(headers:{name,kind}[], boardColumns:BoardColumnRef[]) →
(string|null)[]`; `BoardColumnRef = {id,name,kind,options}` — `spreadsheet/match-columns.ts`.
- Samples: `detectAllColumns(header,rows) → DetectedColumn{header,kind,options,sampleValues}` —
  `spreadsheet/detect.ts`; `ImportableKind`/`IMPORTABLE_KINDS` — `spreadsheet/types.ts`. Parsed grid
  (`ParsedTable{header,rows,rowIndices}`) is client-side in `ImportWizard.tsx`.

**Repo norms:** commit subjects lowercase (`feat(ai):` / `test(ai):`), stage by path, identity pinned
by the worktree. Integration tests: `describe.skipIf(!SERVICE_ROLE_KEY)` + dotenv `.env.local` +
`signInWithRetry` (pattern: `src/lib/ai/ai-dashboard.rls.integration.test.ts`). Confirm any Next.js 16
API (`searchParams` is async) against `node_modules/next/dist/docs/`.

---

## File structure

**Modify (shared — Task 1 only):** `src/lib/ai/providers/types.ts`, `providers/anthropic.ts`,
`providers/openai.ts`, `providers/google.ts`, `src/lib/ai/generate.ts`.

**Create — F10:** `src/lib/ai/board-gen-schema.ts`(+test), `board-generate.ts`(+test),
`board-actions.ts`(+test), `board-gen.rls.integration.test.ts`,
`src/components/boards/ai/AiBoardWizard.tsx`(+test), `AiBoardReviewBanner.tsx`(+test).
**Modify — F10:** `src/components/boards/NewBoardDialog.tsx`, `src/app/(app)/boards/[boardId]/page.tsx`
(render the review banner on `?review=1`).

**Create — F11:** `src/lib/ai/automation-context.ts`(+test), `automation-gen-schema.ts`(+test),
`automation-generate.ts`(+test), `automation-gen-actions.ts`(+test).
**Modify — F11:** `src/components/boards/automations/AutomationsDialog.tsx`.

**Create — F12:** `src/lib/ai/import-mapping-schema.ts`(+test), `import-mapping-generate.ts`(+test),
`import-mapping-actions.ts`(+test).
**Modify — F12:** `src/components/boards/import/MapStep.tsx`.

_Separate action files per track (`board-actions.ts`, `automation-gen-actions.ts`,
`import-mapping-actions.ts`) — the existing `src/lib/ai/actions.ts` is **not** edited, so the three
tracks share no file and never conflict._

---

## Execution DAG

- **Batch A (foundation):** Task 1 (`generateStructured` on all adapters + `generate.ts` delegation).
  Everything consumes it → must merge first.
- **Batch B (three parallel tracks — dispatch as concurrent subagents):**
  - **F10:** Task 2 → Task 3 → Task 4 → (Task 5 ∥ Task 6).
  - **F11:** Task 7 → Task 8 → Task 9 → Task 10.
  - **F12:** Task 11 → Task 12 → Task 13 → Task 14.
    (Within a track, the pure task and the prompt task may also run concurrently; the action task joins
    them.) The three tracks touch disjoint files and need no migration → true parallelism.
- **Batch C:** Task 15 (end-to-end wiring + the four gates).

```
                ┌─ F10: 2 → 3 → 4 → {5, 6} ─┐
Task 1 (shared)─┼─ F11: 7 → 8 → 9 → 10 ─────┼─ Task 15 (gates)
                └─ F12: 11 → 12 → 13 → 14 ───┘
```

**Critical path:** `1 → 2 → 3 → 4 → 6 → 15` (F10, the longest track — the wall-clock floor ≈ 6 tasks
deep). F11 and F12 (4 deep each) finish inside F10's shadow.

---

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint** of `/boards`, the automations dialog, the import wizard: **unchanged**. AI entries
  are static `Sparkles` buttons/inputs; the F10 wizard is lazy (`next/dynamic`, `ssr:false`);
  F11/F12 affordances mount inside already-open dialogs.
- **0 RSC navigations for in-page work.** F10 steps, F11 generate→seed, F12 suggest→apply are
  **client state only**. The single navigation is F10's `router.push('/boards/{id}?review=1')`
  **after** Create (real data change → correct). F11/F12 never navigate.
- **Server round-trips only on explicit button presses:** `generateBoardProposal`,
  `createBoardFromProposal`, `generateAutomationDraft`, `suggestImportMapping` — one per press, never
  on step/tab/filter toggles.
- **Bounded/indexed:** F10 = one atomic RPC write. F11 context read = `getBoardPayload` (RLS-scoped,
  `board_id`-indexed) + members lookup; payload is schema+labels (row-count-independent). F12 egress
  is **capped server-side** (≤ ~40 columns, ≤ 5 samples/column) — never the whole grid. Ledger write
  is E1's indexed `(org_id, created_at)` path.

---

## Task 1: Generic `generateStructured` on the provider adapter (shared foundation)

**Files:** Modify `src/lib/ai/providers/types.ts`, `providers/anthropic.ts`, `providers/openai.ts`,
`providers/google.ts`, `src/lib/ai/generate.ts`. Touch `providers/adapters.test.ts` /
`generate.test.ts`.

**Interfaces:**

- **Consumes:** existing `ProviderAdapter`, `jsonSchemaOutputFormat`, `MODEL`, `AiUsageTokens`.
- **Produces:** `adapter.generateStructured<T>({ apiKey, system, user, schema }): Promise<{ data: T;
usage: AiUsageTokens }>` (implemented for anthropic/openai/google) — consumed by Tasks 3, 8, 12.

- [ ] **Step 1 (failing test):** In `providers/adapters.test.ts`, add a case: a mocked Anthropic
      client whose `messages.parse` returns `{ parsed_output: {ok:true}, usage:{input_tokens:1,
output_tokens:2} }`; assert `anthropicAdapter.generateStructured({ apiKey, system, user, schema })`
      resolves `{ data:{ok:true}, usage:{inputTokens:1, outputTokens:2} }` and that the schema was passed
      through `jsonSchemaOutputFormat`. Run → FAIL.
- [ ] **Step 2 (interface):** Add to `ProviderAdapter`:
  ```ts
  generateStructured<T = unknown>(args: {
    apiKey: string; system: string; user: string; schema: object;
  }): Promise<{ data: T; usage: AiUsageTokens }>;
  ```
- [ ] **Step 3 (anthropic):** Implement by extracting the exact body of `generateProposal`
      (parse call → `parsed_output ?? JSON.parse(text)`), parameterizing the schema. Then **refactor
      `generateProposal` to delegate** so there is one structured-output implementation:
      `const { data, usage } = await this.generateStructured({ apiKey, system, user, schema:
PROPOSAL_JSON_SCHEMA }); return { proposal: data as DashboardProposal, usage };`.
- [ ] **Step 4 (openai/google):** Implement `generateStructured` mirroring each adapter's existing
      `generateProposal` JSON path (same model/JSON-mode call, generic schema). Keep `generateProposal`
      delegating. Preserve `supportsTools`.
- [ ] **Step 5 (delegate the lib):** In `src/lib/ai/generate.ts`, leave `generateProposal(snap,{adapter,
apiKey,feedback})` as-is (it already calls `adapter.generateProposal`) — no behavior change; the
      refactor is inside the adapter. Confirm `generate.test.ts` + `proposal-schema.test.ts` still pass.
- [ ] **Step 6:** `pnpm test src/lib/ai/providers src/lib/ai/generate.test.ts` → PASS. Commit
      `feat(ai): add generic generateStructured to provider adapters`.

---

## Task 2: F10 — board proposal JSON schema + validator (pure)

**Files:** Create `src/lib/ai/board-gen-schema.ts` + `.test.ts`.

**Interfaces:**

- **Consumes:** `columnKindSchema`, `optionSchema`, `columnSettingsSchema`, `cellValueSchema` from
  `@/lib/validations/boards`; `TemplatePayload` type from `@/lib/boards/template-payload`.
- **Produces:** `BOARD_PROPOSAL_JSON_SCHEMA` (object), `type BoardProposal`,
  `validateBoardProposal(proposal, opts?): { name; templatePayload: TemplatePayload; summary:
{ groups:number; columns:{name,kind}[]; items:number }; warnings:string[] }` — consumed by Tasks 3,
  4, 6. `opts.newId?: () => string` (default `crypto.randomUUID`) for deterministic tests.

The model emits **temp ids**; the validator remaps them to UUIDs and confines references.

- [ ] **Step 1 (failing test):** Cover: (a) a valid proposal (2 groups, a status column with 2
      options, a text column, 3 items with kind-correct cells) → `templatePayload` where every
      `column.id`/`group.id`/`item.id` is a fresh UUID, every `cell.columnId` ∈ minted columns, every
      `item.groupId` ∈ minted groups, status settings carry `{options}`; (b) a column with an unknown
      `kind` is dropped with a warning; (c) a cell whose value fails `cellValueSchema(kind)` is dropped,
      the item kept; (d) an item referencing an unknown temp `groupId` is reassigned to the first group
      (or dropped) with a warning; (e) `positions` are assigned 0..n; (f) name falls back when blank.
      Run → FAIL.
- [ ] **Step 2 (schema):** Author `BOARD_PROPOSAL_JSON_SCHEMA` in the `proposal-schema.ts` style —
      required discriminating fields so the model can't emit empties. Shape:
      `{ name; groups:[{ tempId, name, color? }]; columns:[{ tempId, name, kind(enum of the 18),
options?:[{label,color?}] }]; items:[{ groupTempId, name, cells:[{ columnTempId, value:object }] }] }`.
      Bound array sizes (≤ 8 groups, ≤ 20 columns, ≤ 60 items) to cap tokens.
- [ ] **Step 3 (validator):** Implement `validateBoardProposal`: mint `newId()` per temp group/column/
      item, build temp→uuid maps; validate each column `kind` via `columnKindSchema`, synthesize
      `settings` (`{options:[{id:newId,label,color}]}` for status/dropdown via `optionSchema`, else `{}`);
      for each item map `groupTempId`→uuid (fallback+warn if missing); for each cell map
      `columnTempId`→uuid, and re-key option references in the value to the minted option ids, then
      `cellValueSchema(kind).safeParse` (drop+warn on failure); assign `position`. Return the
      `TemplatePayload` + summary + warnings.
- [ ] **Step 4:** `pnpm test src/lib/ai/board-gen-schema.test.ts` → PASS. Commit
      `feat(ai): board proposal json schema + validator (temp-id remap into template payload)`.

---

## Task 3: F10 — board generate layer (prompt + structured call)

**Files:** Create `src/lib/ai/board-generate.ts` + `.test.ts`.

**Interfaces:**

- **Consumes:** `adapter.generateStructured` (Task 1), `BOARD_PROPOSAL_JSON_SCHEMA` +
  `type BoardProposal` (Task 2).
- **Produces:** `buildBoardGenSystemPrompt()`, `generateBoardProposal(prompt, { adapter, apiKey,
feedback? }): Promise<{ proposal: BoardProposal; usage }>` — consumed by Task 4. (Mirrors
  `generate.ts` exactly.)

- [ ] **Step 1 (failing test):** DI a fake adapter whose `generateStructured` returns a canned
      `{data: proposal, usage}`; assert `buildBoardGenSystemPrompt()` teaches the kind vocabulary + option
      shape + "design a usable starter board" heuristics; assert `generateBoardProposal` returns the
      proposal and threads `feedback` into the user message. Run → FAIL.
- [ ] **Step 2 (implement):** System prompt teaches: the column kinds and which carry options
      (status/dropdown), the temp-id contract ("use tempId strings like `col-1`; never invent UUIDs"),
      and design heuristics (lead with a Status + an Owner(people) + a Date column, add domain columns,
      2–4 groups, 5–15 realistic starter items with kind-correct cells). Cache-control the system prompt.
      User prompt = the sanitized description + optional feedback. Call `adapter.generateStructured({
apiKey, system, user, schema: BOARD_PROPOSAL_JSON_SCHEMA })`.
- [ ] **Step 3:** `pnpm test src/lib/ai/board-generate.test.ts` → PASS. Commit
      `feat(ai): board proposal generation via generateStructured (injectable adapter)`.

---

## Task 4: F10 — server actions (generate + create)

**Files:** Create `src/lib/ai/board-actions.ts` + `.test.ts`.

**Interfaces:**

- **Consumes:** `generateBoardProposal` (Task 3), `validateBoardProposal` (Task 2), `runAi` +
  `requireAiEntitlement` + errors (E1), `create_board_from_template` RPC (via `createClient` +
  `typedRpc`), `getUserOrgs`/`requireUser`, `ActionResult`/`fail`.
- **Produces:** `generateBoardProposal` action `({ workspaceId, prompt, feedback? }) →
ActionResult<{ proposal: { name; templatePayload; summary; warnings } }>` (no persistence) and
  `createBoardFromProposal({ workspaceId, proposal }) → ActionResult<{ boardId }>` — consumed by
  Task 6. (Note: name-collision with the lib fn is avoided — this is the `"use server"` action;
  import the lib as `generateBoardProposalLLM`.)

- [ ] **Step 1 (failing tests):** Mock `@/lib/supabase/server`, the generate lib, and session.
      Assert: (a) the action **calls `requireAiEntitlement` before `runAi`** and returns the validated
      proposal, never persisting; (b) a blank/too-long prompt (Zod `min(3).max(2000)`) → `fail` with no
      LLM call; (c) `createBoardFromProposal` calls `create_board_from_template` **once** with
      `{ p_workspace_id, p_name, p_template }` and returns `boardId`; (d) `AiQuotaExceededError` →
      the allowance message. Run → FAIL.
- [ ] **Step 2 (implement):** `"use server"`. `generateBoardProposal` action: Zod-validate input;
      resolve org; `requireAiEntitlement(org.id, "board_gen")`; `runAi({orgId,userId,feature:"board_gen"},
async ({adapter,apiKey}) => { const {proposal,usage} = await generateBoardProposalLLM(prompt,
{adapter,apiKey,feedback}); return { result: proposal, usage, model: adapter.defaultModel }; })`;
      `validateBoardProposal`; if `templatePayload.columns.length === 0` → `fail("Couldn't generate a
usable board — try again.")`; else return it. `createBoardFromProposal`: Zod-validate the proposal
      shape (kinds/settings/cells re-checked defensively — **re-run `validateBoardProposal`'s structural
      guards or a `templatePayloadSchema` before writing**, mirroring `createDashboardFromProposal`), then
      `typedRpc(supabase,"create_board_from_template",{ p_workspace_id, p_name:name, p_template })`;
      return `{ boardId: row.id }`. Map E1 errors like `src/lib/ai/actions.ts`.
- [ ] **Step 3:** `pnpm test src/lib/ai/board-actions.test.ts` → PASS. Commit
      `feat(ai): board-gen server actions (propose + create-from-proposal)`.

---

## Task 5: F10 — RLS integration test

**Files:** Create `src/lib/ai/board-gen.rls.integration.test.ts`.

**Interfaces:** Consumes the `create_board_from_template` RPC + auth helpers. Produces coverage only.

- [ ] **Step 1:** Follow `src/lib/ai/ai-dashboard.rls.integration.test.ts`
      (`describe.skipIf(!SERVICE_ROLE_KEY)`, dotenv, admin + anon clients, `signInWithRetry`). Seed two
      orgs/users + a workspace each.
- [ ] **Step 2:** Assert user A (anon client) can `rpc("create_board_from_template", { p_workspace_id:
A_ws, p_name, p_template })` and the board is org-A-scoped; assert calling it with **workspace B**
      fails / is not visible cross-tenant (the RPC's `is_org_member` check). Run → PASS or SKIP. Commit
      `test(ai): rls coverage for board-gen create_board_from_template`.

---

## Task 6: F10 — wizard UI + NewBoardDialog entry + review banner

**Files:** Create `src/components/boards/ai/AiBoardWizard.tsx` + `.test.tsx`,
`AiBoardReviewBanner.tsx` + `.test.tsx`. Modify `src/components/boards/NewBoardDialog.tsx`,
`src/app/(app)/boards/[boardId]/page.tsx`.

**Interfaces:** Consumes the Task 4 actions; `deleteBoard`. Produces the user-facing F10 flow.
**Load `pulse-ui` + `frontend-design` first.**

- [ ] **Step 1 (failing component test):** `AiBoardWizard.test.tsx` — mock `@/lib/ai/board-actions`.
      Assert: describe step renders a bounded textarea; **Create is unreachable until the review step**
      (i.e. Generate must succeed first — step gating); a `{ok:false,error}` from generate renders in a
      `role="alert"`; clicking Create calls `createBoardFromProposal` with the returned proposal. Run →
      FAIL.
- [ ] **Step 2 (implement wizard):** Controlled `Dialog` state machine
      `useState<"describe"|"generating"|"review">`, `useTransition`. describe → `generateBoardProposal`
      → review renders the summary (name, groups, columns `name · kind`, item count, any `warnings`) with
      **Create board** / **Regenerate** (re-runs generate, optional feedback) / Back. Create →
      `createBoardFromProposal` → `router.push('/boards/{boardId}?review=1')` + close. Errors via
      `role="alert"`. **No persistence happens before Create.**
- [ ] **Step 3 (entry):** In `NewBoardDialog`, add a **"Generate with AI"** mode (`Sparkles`,
      `aria-label`), alongside blank/template/import, lazy-loading `AiBoardWizard` (`next/dynamic`,
      `ssr:false`); pass `workspaceId`. Keep existing modes intact.
- [ ] **Step 4 (review banner):** `AiBoardReviewBanner.tsx` (mirror
      `dashboards/ai/AiReviewBanner.tsx`): Keep (drop `?review=1` via `history.replaceState`, dismiss),
      Discard (`deleteBoard` → `/boards`), Regenerate (`deleteBoard` → `/boards?ai=1`). In
      `boards/[boardId]/page.tsx` (RSC, `const sp = await searchParams`) render it only when
      `sp.review === "1"`. Confirm `searchParams` async API against the bundled Next docs.
- [ ] **Step 5:** `pnpm test src/components/boards/ai` → PASS. Commit
      `feat(ai): board-gen wizard, new-board entry, and post-create review banner`.

---

## Task 7: F11 — automations context + draft validator (pure)

**Files:** Create `src/lib/ai/automation-context.ts` + `.test.ts`,
`src/lib/ai/automation-gen-schema.ts` + `.test.ts`.

**Interfaces:**

- **Consumes:** `automationTriggerSchema`/`automationActionSchema`/`automationConditionSchema` +
  `createAutomationSchema` from `@/lib/validations/automations`; `optionSchema`/column kinds; the
  `Draft` shape.
- **Produces:** `type AutomationContext = { columns:{id,name,kind,options:{id,label}[]}[];
groups:{id,name}[]; members:{id,name}[] }`; `buildAutomationContext(input) → AutomationContext`;
  `AUTOMATION_DRAFT_JSON_SCHEMA`; `validateAutomationDraft(draft, ctx): { draft: Draft|null;
warnings:string[] }` — consumed by Tasks 8, 9.

- [ ] **Step 1 (failing tests — context):** `buildAutomationContext` from raw columns/groups/members
      yields labels + ids only; assert **no cell values** appear (`JSON.stringify(ctx)` excludes any cell
      text) and status/dropdown carry `options:{id,label}`.
- [ ] **Step 2 (failing tests — validator):** `validateAutomationDraft` referential checks against a
      fixture ctx: (a) `status_changed.columnId` must be a status/dropdown column (else drop trigger →
      `draft:null`); (b) `set_option.optionId` ∈ that column's options; (c) `move_to_group.groupId` ∈
      groups; (d) `notify.member.userId` ∈ members, `notify.owner.peopleColumnId` is a people column;
      (e) `date_reached`/`percent_reached` on the right kind; (f) invalid **actions** are dropped (keep
      the rest); if 0 actions survive → `draft:null` + warning; (g) `call_webhook` actions are dropped
      with a warning (AI can't emit webhooks in v1). Run → FAIL.
- [ ] **Step 3 (implement):** `AUTOMATION_DRAFT_JSON_SCHEMA` mirrors the trigger/action unions
      (via `oneOf`, discriminators required) **minus** `call_webhook`; ids are plain strings the model
      copies from the supplied context. `validateAutomationDraft` runs the referential checks above, then
      a final `createAutomationSchema.omit({boardId:true})`-style structural parse of the survivors.
- [ ] **Step 4:** `pnpm test src/lib/ai/automation-context.test.ts src/lib/ai/automation-gen-schema.test.ts`
      → PASS. Commit `feat(ai): automation context + NL-draft json schema & referential validator`.

---

## Task 8: F11 — automation generate layer

**Files:** Create `src/lib/ai/automation-generate.ts` + `.test.ts`.

**Interfaces:**

- **Consumes:** `adapter.generateStructured` (Task 1), `AUTOMATION_DRAFT_JSON_SCHEMA` +
  `AutomationContext` (Task 7).
- **Produces:** `buildAutomationGenSystemPrompt()`, `generateAutomationDraft(prompt, ctx, { adapter,
apiKey }): Promise<{ draft: Draft; usage }>` — consumed by Task 9.

- [ ] **Step 1 (failing test):** DI a fake adapter; assert the system prompt instructs the model to
      **use only ids from the provided context** and to resolve NL values (e.g. "Done"/"Archive") to
      option/group ids by label; assert the ctx (columns/options/groups/members) is serialized into the
      user message and the draft is returned. Run → FAIL.
- [ ] **Step 2 (implement):** System prompt: trigger/action vocabulary, "reference only ids present
      in the context; match a named status/group by its label", cache-controlled. User message = ctx JSON
  - the user's bounded prompt. Call `generateStructured({ …, schema: AUTOMATION_DRAFT_JSON_SCHEMA })`.
- [ ] **Step 3:** `pnpm test src/lib/ai/automation-generate.test.ts` → PASS. Commit
      `feat(ai): NL automation draft generation via generateStructured`.

---

## Task 9: F11 — server action (generate draft, no persistence)

**Files:** Create `src/lib/ai/automation-gen-actions.ts` + `.test.ts`.

**Interfaces:**

- **Consumes:** `generateAutomationDraft` lib (Task 8), `buildAutomationContext` +
  `validateAutomationDraft` (Task 7), `getBoardPayload` (columns/groups) + org-members query, E1
  gateway/entitlement/errors.
- **Produces:** `generateAutomationDraft` action `({ boardId, prompt }) → ActionResult<{ draft: Draft;
warnings:string[] }>` (NO persistence) — consumed by Task 10. (Import the lib fn under an alias to
  avoid the name clash.)

- [ ] **Step 1 (failing tests):** Mock supabase/session/generate lib. Assert: `requireAiEntitlement`
      is called **before** `runAi`; the action reads board context server-side and returns a
      `validateAutomationDraft`-filtered draft **without inserting any automation**; a draft that
      validates to `null` → `fail("Couldn't turn that into an automation — try rephrasing.")`; bounded
      prompt (Zod `min(3).max(1000)`). Run → FAIL.
- [ ] **Step 2 (implement):** `"use server"`; resolve org; `requireAiEntitlement(org.id,
"automation_gen")`; build ctx from `getBoardPayload(boardId)` + members; `runAi({…, feature:
"automation_gen"}, …)` → `generateAutomationDraft(prompt, ctx, {adapter,apiKey})`; run
      `validateAutomationDraft(draft, ctx)`; return `{ draft, warnings }`. Map E1 errors like
      `ask/actions.ts`. **Never call `createAutomation` here.**
- [ ] **Step 3:** `pnpm test src/lib/ai/automation-gen-actions.test.ts` → PASS. Commit
      `feat(ai): generate-automation-draft action (no persistence; human saves)`.

---

## Task 10: F11 — AutomationsDialog AI affordance (UI)

**Files:** Modify `src/components/boards/automations/AutomationsDialog.tsx` (+ update its test).

**Interfaces:** Consumes the Task 9 action + the existing `startBuild(draft)` seam. Produces the
user-facing F11 flow. **Load `pulse-ui` + `frontend-design` first.**

- [ ] **Step 1 (failing test):** In `AutomationsDialog.test.tsx` (or a new test), mock
      `@/lib/ai/automation-gen-actions`. Assert: in build mode a "Describe an automation…" input +
      Generate render; on a successful generate the dialog seeds the builder (`startBuild(draft)` → the
      builder shows the generated trigger/actions) and any `warnings` render; clicking the builder's
      **Save** still calls the existing `createAutomation` (unchanged). Run → FAIL.
- [ ] **Step 2 (implement):** Add a bounded text input + Generate button in build mode near "Start
      from a recipe", wired to `generateAutomationDraft({ boardId, prompt })` via `useTransition`/mutation.
      On `{ok:true}` → `startBuild(res.data.draft)` (reuses the recipe seam) and surface warnings; on
      `{ok:false}` → inline `role="alert"`. **No new persistence path** — the human reviews in
      `AutomationBuilder` and clicks Save. Gate visibility on AI availability if trivially known.
- [ ] **Step 3:** `pnpm test src/components/boards/automations` → PASS. Commit
      `feat(ai): describe-an-automation entry that seeds the builder for human approval`.

---

## Task 11: F12 — import-mapping schema + apply (pure)

**Files:** Create `src/lib/ai/import-mapping-schema.ts` + `.test.ts`.

**Interfaces:**

- **Consumes:** `ImportableKind`/`IMPORTABLE_KINDS` (`spreadsheet/types`), `SheetState`/`ColumnState`
  (`import-wizard-state`), `BoardColumnRef` (`match-columns`).
- **Produces:** `IMPORT_MAPPING_JSON_SCHEMA`; `type MappingSuggestion = { sourceIndex; kind;
role:"name"|"data"; targetColumnId?:string }`; `applyMappingSuggestions(state, suggestions,
boardColumns?): SheetState` (pure) — consumed by Tasks 12, 14.

- [ ] **Step 1 (failing test):** `applyMappingSuggestions` on a fixture `SheetState`: patches each
      matched column's `kind`/`role`/`detectedKind`; sets `target` to `{columnId}` when
      `targetColumnId ∈ boardColumns` else `"create"`; **clamps** unknown `kind`→keeps prior,
      `role∉{name,data}`→"data"; a suggestion for an out-of-range `sourceIndex` is ignored; the result is
      a new state object (single logical `onStateChange`). Run → FAIL.
- [ ] **Step 2 (implement):** `IMPORT_MAPPING_JSON_SCHEMA` = array of `{ sourceIndex:int, kind:enum
IMPORTABLE_KINDS, role:enum[name,data], targetColumnId?:string }`. `applyMappingSuggestions` maps
      over `state.columns` applying validated patches (defensive clamps), returns `{...state, columns}`.
- [ ] **Step 3:** `pnpm test src/lib/ai/import-mapping-schema.test.ts` → PASS. Commit
      `feat(ai): import-mapping json schema + pure applyMappingSuggestions`.

---

## Task 12: F12 — import-mapping generate layer

**Files:** Create `src/lib/ai/import-mapping-generate.ts` + `.test.ts`.

**Interfaces:**

- **Consumes:** `adapter.generateStructured` (Task 1), `IMPORT_MAPPING_JSON_SCHEMA` +
  `MappingSuggestion` (Task 11).
- **Produces:** `buildImportMappingSystemPrompt()`, `generateImportMapping(payload, { adapter, apiKey
}): Promise<{ suggestions: MappingSuggestion[]; usage }>` where `payload = { columns:
{sourceIndex,header,sampleValues:string[]}[]; boardColumns?: {id,name,kind}[] }` — consumed by
  Task 13.

- [ ] **Step 1 (failing test):** DI a fake adapter; assert the system prompt explains the kinds +
      role semantics + "map to an existing board column id only when confident, else propose create";
      assert headers+samples are serialized and suggestions returned. Run → FAIL.
- [ ] **Step 2 (implement):** Prompt teaches `ImportableKind` semantics and the existing-column
      targeting rule; cache-controlled system prompt. Call `generateStructured({ …, schema:
IMPORT_MAPPING_JSON_SCHEMA })`.
- [ ] **Step 3:** `pnpm test src/lib/ai/import-mapping-generate.test.ts` → PASS. Commit
      `feat(ai): import-mapping suggestion generation via generateStructured`.

---

## Task 13: F12 — server action (bounded payload, no mutation)

**Files:** Create `src/lib/ai/import-mapping-actions.ts` + `.test.ts`.

**Interfaces:**

- **Consumes:** `generateImportMapping` (Task 12), E1 gateway/entitlement/errors, `IMPORTABLE_KINDS`.
- **Produces:** `suggestImportMapping({ columns:{sourceIndex,header,sampleValues}[], boardColumns? })
→ ActionResult<{ suggestions: MappingSuggestion[]; warnings:string[] }>` — consumed by Task 14.

- [ ] **Step 1 (failing tests):** Mock supabase/session/generate lib. Assert: `requireAiEntitlement`
      before `runAi` (feature `import_mapping`); the input Zod schema **caps** columns (≤ ~40) and
      `sampleValues` (≤ 5 each, each length-bounded) — over-cap input is truncated/rejected; suggestions
      with an unknown `kind`/`role`/dangling `targetColumnId` are filtered with warnings; **no DB
      mutation** occurs. Run → FAIL.
- [ ] **Step 2 (implement):** `"use server"`; Zod-validate + **truncate** the payload to the caps
      (raw-egress bound); resolve org; `requireAiEntitlement(org.id,"import_mapping")`;
      `runAi({…,feature:"import_mapping"}, …)` → `generateImportMapping`; clamp/filter suggestions
      against `IMPORTABLE_KINDS` + `boardColumns`; return `{ suggestions, warnings }`. Map E1 errors.
- [ ] **Step 3:** `pnpm test src/lib/ai/import-mapping-actions.test.ts` → PASS. Commit
      `feat(ai): suggest-import-mapping action (bounded raw-sample egress; no mutation)`.

---

## Task 14: F12 — MapStep "Suggest with AI" (UI)

**Files:** Modify `src/components/boards/import/MapStep.tsx` (+ its test).

**Interfaces:** Consumes the Task 13 action + `applyMappingSuggestions` (Task 11) + the existing
`onStateChange` contract. Produces the user-facing F12 flow. **Load `pulse-ui` + `frontend-design`.**

- [ ] **Step 1 (failing test):** `MapStep.test.tsx` — mock `@/lib/ai/import-mapping-actions`. Assert:
      a "Suggest with AI" button renders with an inline **raw-sample disclosure**; clicking it builds the
      capped payload from `table` (headers + ≤5 samples/col, existing `boardColumns` when present), and on
      success calls `onStateChange` **once** with the applied suggestions; a `{ok:false}` shows a
      `role="alert"`. Run → FAIL.
- [ ] **Step 2 (implement):** Add the button + disclosure in the MapStep header block (near "Exclude N
      rows"); assemble `{ columns:[{sourceIndex,header,sampleValues}], boardColumns }` from the parsed
      `table`/`DetectedColumn.sampleValues`; call `suggestImportMapping` via `useTransition`; on success
      `onStateChange(applyMappingSuggestions(state, res.data.suggestions, boardColumns))`. The user then
      reviews the mapping grid and the existing **Confirm** step gates the commit — no auto-commit.
- [ ] **Step 3:** `pnpm test src/components/boards/import` → PASS. Commit
      `feat(ai): suggest-with-ai affordance in the import map step (review-gated)`.

---

## Task 15: End-to-end wiring + verification gates

**Files:** none new — integration + cleanup.

- [ ] **Step 1:** Trace each flow against the code: F10 (New-board → describe → generate → review →
      Create → `?review=1` banner → keep/discard); F11 (dialog → describe → generate → seeded builder →
      Save); F12 (Map → suggest → apply → Confirm → commit). Fix any prop/return-name mismatches across
      tasks (`generateStructured`, `validateBoardProposal`, `AutomationContext`, `MappingSuggestion`,
      action names).
- [ ] **Step 2:** Confirm entitlement is gated **before any token spend** and each action passes the
      right `feature` key (`board_gen` / `automation_gen` / `import_mapping`); confirm F11/F12 never
      persist and F10 persists only on Create.
- [ ] **Step 3: Run the four gates:**
  ```bash
  pnpm typecheck && pnpm lint && pnpm test && pnpm build
  ```
  All PASS (RLS integration SKIPs without the service-role key — repo norm). Justify any unavoidable
  `any` at the SDK boundary with a one-line comment (matching existing precedent).
- [ ] **Step 4:** Commit any fixes `chore(ai): wire e4 generation end-to-end and green the gates`.

---

## Self-review (completed)

- **Spec coverage:** F10 (schema+groups+items → `create_board_from_template`) → Tasks 2–6; F11 (NL →
  `Draft` → existing builder/Save) → Tasks 7–10; F12 (Map-step AI suggestions → client state →
  Confirm) → Tasks 11–14. Shared structured-output primitive → Task 1. Human-approval gate enforced
  everywhere (F10 pre-persist review + Create; F11 seed-only + Save; F12 client-state + Confirm) —
  no auto-apply. Perf budget (lazy/ client-state / 0 RSC nav / bounded reads / capped F12 egress) →
  addressed per task and in the budget section. Tests → every task is TDD.
- **Reuse:** `generate.ts`/`proposal-schema.ts` pattern (Tasks 2/7/11 mirror it), the E1 gateway +
  entitlement + error mapping (every action), `create_board_from_template`, `AutomationBuilder`
  `initial` seam + `createAutomation`, and the `SheetState`/`onStateChange` mapping contract. New
  generators are **siblings** in `src/lib/ai/`; the only shared-surface edit is the adapter interface
  (Task 1). **No migrations.**
- **DAG / parallelism:** Task 1 gates the three independent tracks (disjoint files, separate action
  files, no shared migration); F10/F11/F12 dispatched as a concurrent subagent wave; critical path =
  F10 (`1→2→3→4→6→15`).
- **Placeholder scan:** pure/logic tasks specify full contracts + representative tests; action/UI
  tasks give exact signatures, RPC names, reuse seams, and test assertions. Names
  (`generateStructured`, `BoardProposal`, `validateBoardProposal`, `AutomationContext`,
  `MappingSuggestion`, action names) are used consistently across tasks.
- **Caveats flagged:** F12 is a **new raw-data egress class** (capped + disclosed); the F10 action /
  lib share the name `generateBoardProposal` (alias the lib import); `call_webhook` is intentionally
  excluded from the F11 AI schema (admin-gated, manual in v1); confirm the async `searchParams` /
  structured-output SDK call against the bundled Next/claude-api docs at build time.

```

```
