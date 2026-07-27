# E3 — Conversational Actions (F6 ⌘K natural-language writes) — Design Spec

**Date:** 2026-07-12
**Slug:** `e3-conversational-actions`
**Phase:** 10 — AI & Agents · **Epic 3** (F6)
**Status:** Design draft — pending review
**Parent scope:** `docs/superpowers/specs/2026-07-05-ai-platform-phase-10-scope.md`
**Consumes:** E1 (`docs/superpowers/specs/2026-07-05-ai-foundation-and-ask-pulse-design.md`) — gateway, entitlement, F5 read-tool loop
**Coordinates with:** `docs/superpowers/specs/2026-07-12-ask-pulse-full-page-conversational-design.md` (its "Phase 2 — write actions")

## Summary

Turn a natural-language command into a **confirmed** structured write. From ⌘K a user types
"create task Ship v2 due Friday for Dana in Backlog"; the model resolves the target board/group/owner
against **RLS-scoped read tools**, emits a **proposal** (never a live mutation), the UI renders a
human-readable **confirm card**, and only on **Approve** does a typed, RLS-enforced Server Action run
the canonical create/upsert mutations. Nothing the model says ever writes to the database directly.

The load-bearing deliverable is a **shared, headless write-action engine** (`src/lib/ai/write/`) that
is surface-agnostic: E3 ships it plus the ⌘K surface, and the separately-planned Ask-Monolith-full-page
track consumes the _same_ engine for its in-thread confirm cards (its "Phase 2"). No duplication of
write tools, proposal validation, name resolution, or execution across the two surfaces.

## Locked decisions

| Decision                | Choice                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Write safety model**  | The model only ever emits a **proposal** (structured data). Every real mutation runs through the existing typed, RLS-enforced Server Actions (`createItem`, `createGroup`, `upsertCell`) **after** an explicit human **Approve**. No raw model-issued mutation, ever.                                                                           |
| **Confirm UX**          | Propose → render confirm card(s) → Approve/Cancel. Nothing mutates before Approve. Multiple proposed actions in one command are each individually confirmable.                                                                                                                                                                                  |
| **Name resolution**     | Happens **inside** the tool-use loop via RLS-scoped read tools (reuse F5's `list_boards`/`get_board_overview`, add `list_board_members`). The model resolves board/group/column/status-option/owner **ids**; the server then **re-derives** every human label from those ids for the confirm card and **re-validates** the ids at execute time. |
| **Action surface (v1)** | `create_item` (in a named group, with optional owner/due-date/status), `set_item_fields` (update an existing item's owner/date/status), `create_group`. Board creation is **F10** (Generation), not here.                                                                                                                                       |
| **Engine ownership**    | E3 owns and builds `src/lib/ai/write/` (engine + Server Actions). The ⌘K surface and the Ask-full-page Phase 2 are both **thin consumers** of it.                                                                                                                                                                                               |
| **Model / provider**    | Anthropic `claude-opus-4-8` (tool use requires `adapter.supportsTools`, same gate as Ask Monolith). Routes through `runAi` for metering; `feature = "conversational_action"`.                                                                                                                                                                      |
| **Persistence**         | Stateless per command (no conversation memory in ⌘K). A proposal is passed from `propose` to the client and back to `execute`; nothing is stored between the two calls except in client state.                                                                                                                                                  |

## The Ask-Monolith-full-page boundary (key coordination decision)

The full-page conversational spec (2026-07-12) explicitly folds F6 into its **Phase 2** ("Ask proposes
create/update actions that render as a confirm-before-execute card"). Left unmanaged, that would
**duplicate** the write-tool + confirm-execute logic across two surfaces, and it also **collides on the
exact ⌘K wiring E3 builds on** — that track _retires_ the `AskPulse` dialog and _repoints_ the ⌘K
"Ask Monolith…" entry to navigate to `/ask` (removing `AskPulse.tsx`/`AskPulseHost`/`AskPulseTrigger` and
the `askPulseOpen` slice in `src/stores/ui.ts`).

**Decision:**

1. **E3 owns the shared headless write-action engine** (`src/lib/ai/write/`: write tools, name
   resolution, Zod proposal/validated schemas, the propose loop, the execute mapper, and the
   `proposeActions` / `executeActions` Server Actions). It is surface-agnostic — no React, no ⌘K, no
   `/ask` coupling. The full-page track's "Phase 2" becomes a **thin consumer**: it renders the shared
   `ValidatedAction[]` as in-thread confirm cards and calls the same `executeActions` on Approve. It
   does **not** re-implement any of the engine.
2. **E3 owns a distinct ⌘K "quick action" surface** — an inline propose→confirm flow _inside the
   command palette_, so a one-shot imperative command never has to leave to the chat page. This is the
   original F6 vision (a fast, zero-navigation write path) and is complementary to, not a duplicate of,
   the chat destination.
3. **Shared-file collision is sequenced, not parallelized.** `command-palette.tsx`, `src/stores/ui.ts`,
   and `app-shell.tsx` are touched by _both_ tracks. Whichever of {full-page ⌘K repoint, E3 ⌘K NL mode}
   merges second must rebase and reconcile the ⌘K entries in one file. The recommended order (below)
   keeps the engine (durable, high value) independent of that UI churn so it can land first regardless.

Net: **one engine, two surfaces.** If the owner later prefers the chat page as the sole AI-write home,
E3's ⌘K surface can be scoped down to "repoint into `/ask` prefilled" with **zero** change to the
engine — the engine is the investment, the ⌘K surface is the swappable part.

## Architecture

Extends `src/lib/ai/`. All Server Actions follow the repo convention: `"use server"`, Zod `safeParse`
at the boundary, `ActionResult<T>` / `fail` from `src/lib/actions/result.ts`, RLS via the cookie-bound
`createClient()`. All model spend flows through `runAi` (E1 gateway). Entitlement is gated with
`requireAiEntitlement` (E1) before any token spend.

### 1. Shared write-action engine — `src/lib/ai/write/`

New folder, sibling to `src/lib/ai/ask/`. (Do **not** put this in `src/lib/ai/actions.ts` — that name is
already taken by dashboard-gen.)

- **`schema.ts`** — the Zod contract shared by both surfaces:
  - `ProposedAction` = discriminated union on `kind`:
    - `{ kind: "create_item", boardId, groupId, name, fields?: ProposedFields }`
    - `{ kind: "set_item_fields", boardId, itemId, fields: ProposedFields }`
    - `{ kind: "create_group", boardId, name }`
  - `ProposedFields` = `{ ownerUserIds?: string[]; dueDate?: string /* ISO */; endDate?: string; statusOptionId?: string | null }`
  - `ValidatedAction` = `ProposedAction` after server re-validation, plus a `summary: string`
    (human-readable, e.g. _"Create task 'Ship v2' in Backlog · due Fri Jul 17 · owner Dana"_) and a
    `warnings: string[]` (e.g. _"'Dana' matched 2 members — used Dana Ruiz"_). This mirrors the
    proven `src/lib/ai/proposal-schema.ts` (dashboard-gen) pattern: the model obeys the JSON schema,
    the server re-validates and annotates.
  - `ExecutionResult` = per-action `{ ok: true; itemId?: string } | { ok: false; error: string }`.

- **`write-tools.ts`** — Anthropic `Tool[]` declarations handed to the model. **These tools are
  proposal-only: executing one records the intended write and returns a preview — it never mutates.**
  - `propose_create_item({ board_id, group_id, name, owner_user_ids?, due_date?, status_option_id? })`
  - `propose_set_item_fields({ board_id, item_id, owner_user_ids?, due_date?, status_option_id? })`
  - `propose_create_group({ board_id, name })`
    Each tool's executor: Zod-parse the args, resolve → build a `ValidatedAction` (with summary +
    warnings), push it onto the collector, and return `{ content: JSON.stringify({ preview: summary, warnings }) }`
    so the model can confirm to itself it captured the intent and stop.

- **`read-tools.ts` (or reuse)** — the propose loop is handed **F5's read tools** (`list_boards`,
  `get_board_overview`, `query_items` from `src/lib/ai/ask/tools.ts`, imported unchanged) **plus one
  new read tool**, `list_board_members({ board_id })`, returning `[{ userId, name }]` for owner
  resolution (RLS-scoped: reuse `listOrgMembersCached(orgId)` intersected with the board's
  `board_members` grants, or the org roster when the board has no explicit grants). Read tools execute
  for real (safe — read-only); write tools do not.

- **`resolve.ts`** — pure/RLS-scoped helpers the write-tool executors use to turn the model's ids into
  a `ValidatedAction`:
  - re-fetch the board payload (`getBoardPayload`, RLS-scoped) to confirm `group_id`/`item_id`/
    `column` ids belong to the board and to read labels;
  - pick the board's **date** column and **status/people** columns by kind (via the board snapshot) so
    `set_item_fields` knows which `columnId` to write; if a board has >1 date column, prefer one named
    like "due"/"deadline" and record a warning;
  - decode `status_option_id` → option label; `owner_user_ids` → member names;
  - `dueDate` is validated as an ISO date (`dateValueSchema`), never free text.

- **`propose.ts`** — `proposeLoop({ apiKey, workspaceId, orgId, instruction })`: the tool-use loop.
  System prompt teaches: _today's date + the user's timezone_ (so "Friday" resolves to an ISO date),
  the read tools (resolve names first), the write tools (propose, never assume), and "if the target is
  ambiguous or missing, ask for a clarification instead of guessing." Reuses the exact loop shape of
  `askPulseLoop` (round cap `MAX_ROUNDS = 6`, usage summed). Returns `{ actions: ValidatedAction[];
clarification?: string; usage }`. The Anthropic client is dependency-injected for tests.

- **`execute.ts`** — `executeAction(action: ValidatedAction): Promise<ExecutionResult>`: maps each
  validated action to the **canonical typed Server Actions**, re-validating ids belong to the resolved
  board along the way:
  - `create_item` → `createItem({ groupId, name })`; then for each present field, `upsertCell` with the
    correct `columnId` and kind-shaped value (`{ userIds }` / `{ date }` / `{ optionId }`).
  - `set_item_fields` → `upsertCell` per field on the existing `itemId`.
  - `create_group` → `createGroup({ boardId, name })`.
    RLS is the guard at every write; a field write that fails does **not** roll back the item create — the
    result reports per-field partial success so the user sees exactly what landed.

- **`actions.ts`** — the two Server Actions (`"use server"`, `ActionResult`):
  - `proposeActions({ instruction }): ActionResult<{ actions: ValidatedAction[]; clarification?: string }>`
    — Zod-bounds `instruction` (`min 3, max 1000`, same cost guard as Ask); resolve user/org/workspace
    server-side; `requireAiEntitlement(orgId, "conversational_action")`; `runAi(..., proposeLoop)`.
  - `executeActions({ actions }): ActionResult<{ results: ExecutionResult[] }>` — **re-validates every
    action against `ValidatedAction` (Zod) server-side** (never trusts the client's array), then runs
    `executeAction` per action. No new entitlement charge (execution is deterministic DB work, no model
    call) — but it re-checks `ai_mode !== 'off'` so a disabled org can't execute a stale proposal.

### 2. ⌘K surface — `src/components/command-palette.tsx` + `src/components/ai/actions/`

The command palette gains a **quick-action mode**. Because the design is being coordinated with the
full-page track's ⌘K repoint, the _entry_ is deliberately factored so both can coexist:

- A new `CommandGroup` **"Actions"** with a single item **"Run a command…"** (Wand icon). Selecting it
  (or submitting the palette query when it reads as an imperative) switches the palette body into an
  inline **action composer** rendered by a new lazy component `src/components/ai/actions/QuickAction.tsx`
  (dynamic, `ssr:false` — the SDK/action code loads only on first use).
- `QuickAction.tsx` flow (client state only — no RSC navigation):
  1. Textarea → on submit calls `proposeActions({ instruction })` inside a `useTransition`.
  2. **Thinking** state ("Working out what to do…").
  3. On result: render one **confirm card** per `ValidatedAction` (`ActionConfirmCard.tsx`): the
     `summary`, any `warnings` (as a muted note), and **[Approve] / [Cancel]**. A `clarification`
     (no actions) renders as a plain message with a "try again" affordance.
  4. **Approve** → `executeActions({ actions: approved })` → success line ("Created 'Ship v2' — open ↗")
     that deep-links to `/boards/<id>?item=<id>`; **Cancel** dismisses with no write.
- `ActionConfirmCard.tsx` and the `ValidatedAction` types are **exported for reuse** so the full-page
  track renders the identical card in its thread.
- Loaded with the **`pulse-ui`** + **`frontend-design`** skills (dark-first, periwinkle accent, mono
  kickers, radius-14; existing `Button`/`Textarea`/`Kicker`/`Card` primitives). Empty/disabled/quota/
  error states are first-class (`role="alert"`), matching the existing `AskPulse` panel's treatment.

## Data flow (⌘K create task)

1. ⌘K → "Run a command…" → user types _"create task Ship v2 due Friday for Dana in Backlog"_ → submit.
2. `proposeActions` → resolve org/workspace → `requireAiEntitlement(org, "conversational_action")` →
   `runAi("conversational_action", proposeLoop)`.
3. The loop: `list_boards` → pick the active board → `get_board_overview` (decode the "Status" options,
   find the "Due" date column) → `list_board_members` (Dana → userId) → `propose_create_item({...ids})`.
   The write-tool executor resolves + validates → one `ValidatedAction` with summary + warnings. `runAi`
   meters tokens/cost.
4. UI renders the confirm card: _"Create task 'Ship v2' in Backlog · due Fri Jul 17 · owner Dana Ruiz"_.
5. **Approve** → `executeActions` re-validates → `createItem` → `upsertCell(date)` → `upsertCell(people)`
   → per-field `ExecutionResult`. Success line deep-links to the new item. **Cancel** → nothing written.

## Write-tool safety model (the non-negotiable invariants)

1. **The model never mutates.** Write tools are proposal-only; the only DB writes happen in
   `executeActions`, gated behind a human Approve click.
2. **Every write is a typed, RLS-enforced Server Action.** `executeAction` calls `createItem` /
   `createGroup` / `upsertCell` — the same code paths a human uses. No bespoke SQL, no service client,
   no bypassing `cellValueSchema`. RLS is the tenant boundary; a resolved id the user can't write simply
   fails the action.
3. **Two independent re-validations.** Ids + values are Zod-validated at **propose** time (in the
   write-tool executor) and again at **execute** time (server re-parses the client-supplied
   `ValidatedAction[]`). The client array is never trusted.
4. **Human-readable confirm derived from ids, not from model prose.** The confirm card's labels are
   re-derived server-side from the resolved ids (`resolve.ts`), so the user approves what will _actually_
   happen, even if the model's narration drifts.
5. **Ambiguity fails safe.** Multiple owner matches, no matching group, or >1 candidate date column
   surface as `warnings` on the card (proceed with the best match, disclosed) or, when there is no safe
   default (no target board/group at all), as a `clarification` with **zero** proposed actions — never a
   silent guess.
6. **Entitlement gated at propose; disabled re-checked at execute.** `off`/quota-exceeded fail closed
   with the same typed errors + friendly copy as Ask Pulse.

## Error handling

- **AI off / not configured / quota / BYO missing / provider-not-capable** → reuse the exact typed
  errors (`AiDisabledError`, `AiQuotaExceededError`, `AiNotConfiguredError`, `ByoKeyMissingError`,
  `ProviderNotCapableError`) and friendly messages already established in `src/lib/ai/ask/actions.ts`.
- **No boards / no writable target** → `proposeActions` returns a `clarification` ("I couldn't find a
  board to add that to — open a board and try again"), no actions.
- **Partial execution** → each field is its own `ExecutionResult`; the item may be created while the
  owner assignment fails (e.g. the member lost access mid-flow) — the UI shows exactly what landed and
  what didn't, never a false "done".
- **Tool/loop/rate-limit errors** → friendly retry copy; partial tool failures degrade gracefully
  (the read tools already return `{"error": ...}` rather than throwing).

## Security notes

- The propose loop uses the **cookie-bound** client for every read tool, so cross-org/cross-board reads
  are impossible by construction (RLS) even if the model "asks" for an id it shouldn't see.
- `executeActions` writes only via cookie-client Server Actions — no service-role write path exists in
  this epic. `record_ai_usage` (service context, inside `runAi`) is the only privileged call, unchanged
  from E1.
- `instruction` is Zod-bounded (`≤1000`) as a token/cost-abuse guard, matching Ask Pulse.

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint** unchanged — ⌘K already mounts; the action composer + its SDK/action imports are
  **lazy** (`next/dynamic`, `ssr:false`), loaded only when the user opens "Run a command…". No new
  work on any page load.
- **AI is an explicit action, never a view toggle.** One `proposeActions` Server Action per command
  submit; one `executeActions` per Approve. Switching between "Search / Ask / Actions" modes inside
  ⌘K is **client state only — 0 RSC navigations**; the confirm card lives in client state.
- **Reads are bounded & indexed.** The propose loop reuses F5's bounded read tools (`query_items` caps
  at `QUERY_ITEMS_MAX = 50`; overviews are aggregate snapshots over `board_id`-indexed tables;
  `list_board_members` is bounded by `ORG_MEMBERS_LIMIT = 500`). No unbounded `select *`.
- **Metering** — one metered `runAi` call per propose (tokens/cost/credits into `ai_usage`); execute is
  deterministic DB work, not metered. The tool-use round cap (`MAX_ROUNDS = 6`) bounds worst-case spend.

## Testing (TDD — written and executed; all four gates green before merge)

- **Pure units:** `schema.ts` (Zod round-trips; the discriminated union rejects a bad `kind`, a
  non-ISO `dueDate`, a missing `name`); `resolve.ts` summary/label building + ambiguity warnings
  (multiple owner matches, >1 date column) with a fixture board payload.
- **Write-tool executors:** each `propose_*` tool records a `ValidatedAction` (never mutates — assert no
  DB write path is called) and returns a preview; invalid args return an `{"error"}` content.
- **Propose loop** (`propose.test.ts`): DI a fake Anthropic client scripted to call read tools then a
  write tool; assert the returned `actions`, that read tools executed and write tools did not mutate,
  and that usage is summed. Mirrors `ask.test.ts`.
- **Execute mapper** (`execute.test.ts`): a `create_item` with all fields calls `createItem` then
  `upsertCell` with the correct kind-shaped values (mocked canonical actions); a failing field yields a
  per-field `ExecutionResult` without failing the whole action.
- **Server actions** (`actions.test.ts`): `proposeActions` gates entitlement before spend and maps typed
  errors to `fail(...)`; `executeActions` **re-validates** and rejects a tampered client array; disabled
  org can't execute.
- **Component:** `QuickAction` (thinking → confirm card → approve executes → success deep-link; cancel is
  a no-op; clarification renders; disabled/quota/error states) with the actions mocked.
- **No real API calls** anywhere — the Anthropic client is injected/mocked throughout.

## Out of scope for this epic (YAGNI)

- Conversation memory / multi-turn in ⌘K (each command is stateless; multi-turn lives in the full-page
  track). Board **creation** (F10). Bulk/multi-item generation beyond what one command names. Deleting
  or archiving via NL (v1 is create/update only — destructive ops need their own confirm design).
  Streaming the proposal. Undo beyond the existing soft-delete/trash. The full-page track's chat UI,
  schema, and streaming (this epic only produces the _engine_ it will consume).

## Env / ops

- No new env vars; reuses the E1 managed/BYO key resolution. No migration (writes go through existing
  tables via existing RPCs/actions). `feature = "conversational_action"` is a free-text ledger value —
  no schema change to `ai_usage`.
