# Board Intelligence — design

**Date:** 2026-09-11
**Status:** approved in brainstorm, awaiting plan
**Scope:** one spec, four build phases (Orient → Advise → Act → Ask)

## 1. Summary

Board Intelligence puts a quiet layer of understanding on top of every board: what is overdue,
who is overloaded, which groups have stalled, what changed since you were last here, and what is
blocking what. It shows these as deterministic signals on first paint, and, on demand, produces a
short brief with concrete suggestions that can be applied with one click, promoted to standing
automations, or questioned inline.

The four jobs, all in scope, each its own phase:

| Phase | Job    | Surface                                                   |
| ----- | ------ | --------------------------------------------------------- |
| 1     | Orient | Intelligence strip under the board header                 |
| 2     | Advise | Dock "Intelligence" tab: brief + suggestions + Apply/Undo |
| 3     | Act    | "Always do this" on a suggestion → board automation       |
| 4     | Ask    | Inline Q&A composer at the bottom of the Intelligence tab |

Decisions locked during brainstorm:

- Placement A + B: an always-on **strip** on its own row, and a **dock tab** for depth. No arrival
  briefing card, no permanent annotation layer. Row highlighting appears only while a chip is
  active.
- The label is **Intelligence** everywhere (strip kicker, dock tab). Not "Pulse", not "AI".
- Strip signals are **deterministic, computed client-side** from the board payload already in
  memory. No LLM, no new hot-path read.
- The brief/suggestions run is **per user, on demand**, cached per (board, user).
- **Apply writes immediately** with an Undo toast; the change lands in item activity.
- "Always do this" **creates a board automation** in the existing engine; Intelligence never runs
  rules itself.
- Q&A is **inline and ephemeral**: no thread, no rail entry, gone on reload, with an
  "Open in Chat" escape hatch.

Design constraints inherited from the vault: AI ships at the seams, not as chrome
(decision 27); the board dock is the sanctioned board-level AI surface (decision 33a); no AI
badge, no glow, no sparkle icon; monochrome chrome, one periwinkle accent, colour only on status
(pulse-ui skill).

## 2. Surfaces

### 2.1 Intelligence strip

- Rendered by the board page between `BoardHeader` and the active view, for all views (table,
  kanban, calendar, timeline). Own row, roughly 32px.
- Anatomy, left to right: mono uppercase kicker "Intelligence" with a 6px dot; up to five hairline
  chips; a "✕ clear" ghost chip when a filter is active; a "Catch me up" pill; a mono "updated Xm
  ago" meta once a run exists for this user.
- A chip is a hairline pill with a 6px status-colour dot, a tabular count, and a label. Chips with a
  zero count are hidden. When every count is zero the strip collapses to one line:
  "All on track · nothing overdue · last change 3h ago".
- Loading state is skeleton pills, never a spinner.
- Chip click activates a board filter (see §3.3). The active chip takes the accent hairline and a
  10% accent fill. Matching rows get a 2px left rule in the chip's status colour; non-matching rows
  dim to about 35% opacity. Clicking the active chip again, or "✕ clear", removes the filter.
- "Catch me up" opens the dock on the Intelligence tab and triggers a run if the cached one is
  stale or missing (§4.4).
- Viewers see the strip in full.

### 2.2 Dock Intelligence tab

- The dock header gains a segmented control **Chat | Intelligence**, left of "+ New". The
  Intelligence segment carries a count badge equal to unresolved suggestions (suggestions minus
  dismissed minus applied). Existing dock behaviour (resize, collapse, mobile sheet) is unchanged.
- Tab body, top to bottom:
  1. **Brief block** — kicker "Last 7 days" with the run timestamp on the right; three to five
     plain sentences. Bold is allowed for the lead clause; no headings, no markdown lists.
  2. **Suggested list** — kicker "Suggested · N". Each card: title, evidence kicker (for example
     "140% → 95%", "2 dependents"), one-line body, a primary action button, a secondary action, and
     a "why?" text button that opens a popover listing the evidence rows (item names, the values
     used). Cards are hairline surfaces; the primary button is the only accent fill.
  3. **Q&A area** (Phase 4) — answered pairs stack under the suggestions.
  4. **Composer** — "Ask about this board…" (Phase 4).
  5. Footer — mono: "Read-only until you apply · {model} · {tokens}".
- Empty state before the first run: the brief block shows a one-line explanation and a "Catch me
  up" button. Loading state during a run: skeleton lines for the brief, two skeleton cards.
- Viewers see brief, suggestions, and Q&A but no Apply, no secondary write actions, no
  "Always do this".

## 3. Signals engine (Phase 1)

### 3.1 Module

`src/lib/boards/intelligence/signals.ts`, pure and synchronous:

```ts
computeSignals(payload: BoardPayload, opts: { now: Date; lastSeenAt: Date | null; currentUserId: string }): Signal[]

type SignalKind = "overdue" | "overloaded" | "stalled" | "changed" | "blocked";
type Signal = {
  kind: SignalKind;
  count: number;
  label: string;          // "overdue", "overloaded · Ana", "stalled groups", "changed since Tue", "blocked chain"
  tone: "red" | "yellow" | "gray" | "accent" | "orange";
  itemIds: string[];      // rows the chip filter shows
  groupIds?: string[];    // for stalled: groups to keep expanded
  subjectUserId?: string; // for overloaded
};
```

Thresholds live in `src/lib/boards/intelligence/constants.ts`, hardcoded for v1:
`STALL_DAYS = 5`, `OVERLOAD_RATIO = 1.25`, `MAX_CHIPS = 5`.

### 3.2 Kinds

- **overdue** — items whose date column value is before `now` and whose status is not a "done"
  option. Uses the board's primary date and status columns as the existing overdue logic in the
  date cell does.
- **overloaded** — per person: open items assigned, weighted by the effort/numbers column when
  present, compared with the board median load. Reuses the workload helpers in `src/lib/workload/`.
  Emits one chip per person over `OVERLOAD_RATIO`, highest first; only the first fits within
  `MAX_CHIPS`.
- **stalled** — a group with at least one open item whose most recent `updated_at` across its items
  is older than `STALL_DAYS`.
- **changed** — items with `updated_at` later than `lastSeenAt`. Hidden when `lastSeenAt` is null
  (first visit).
- **blocked** — items in a "stuck"-toned status option, or with the blocked flag where the board
  has one, that have at least one dependent in `payload.dependencies`. `itemIds` include the blocker
  and its dependents.

Ordering in the strip: overdue, blocked, overloaded, stalled, changed. Chips beyond `MAX_CHIPS`
are dropped from the strip but still available to the run (§4).

### 3.3 Filter integration

- The active chip is stored in the existing board filter/sort URL state as `intel=<kind>[:<subject>]`
  via `history.replaceState`, alongside `q`, filters, and sort. The filter hook exposes it; the
  table, kanban, calendar, and timeline views narrow the in-memory item list to `signal.itemIds`
  exactly as they do for search today. No RSC navigation, no refetch.
- Highlight and dim are applied by the row components from a `intelMatch: boolean | null` prop
  (null when no chip is active).

### 3.4 Last-visit stamp

- New table `board_visits (board_id uuid, user_id uuid, last_seen_at timestamptz not null,
primary key (board_id, user_id))`. RLS: a user reads and writes only their own rows, and only for
  boards in their org (reuse the board access predicate).
- Read: the board payload query joins the current user's row and returns `lastSeenAt`.
- Write: server action `touchBoardVisit(boardId)` called from the board client on
  `visibilitychange` → hidden and on unmount, debounced so a visit writes once. Failure is silent.

## 4. Intelligence run (Phase 2)

### 4.1 Entry points

- Server action `runBoardIntelligence(boardId, { force?: boolean })` in
  `src/lib/ai/board-intelligence/run.ts`. Called by "Catch me up", the tab's Refresh button, and
  the tab's first open when no cached row exists. Never called on page load.
- Server action `getBoardIntelligence(boardId)` returns the latest cached row for the current user
  or null. Called lazily when the Intelligence tab is first opened.

### 4.2 Gateway and tier

- New feature key `board_intelligence` in `FEATURE_TIERS` (`src/lib/ai/model-map.ts`), tier
  `standard`. All calls go through `runAi({ orgId, userId, feature: "board_intelligence" })`, so
  org AI mode, ceilings, and usage recording apply unchanged.

### 4.3 Input

Assembled server-side, bounded and token-estimated with `estimateTokens`:

1. `buildBoardSnapshot(boardId)` — existing, already bounded.
2. Deterministic signals recomputed server-side by calling `computeSignals` on the same payload
   query, so the model receives the counts rather than inventing them.
3. Board transcript: `item_activities` and `item_updates` for this board, last 7 days, newest
   first, capped at 200 rows and then trimmed to the remaining token budget. Built by a
   board-level sibling of the existing `buildTranscript` used by item "Catch me up".
4. Member roster (id, display name) so `reassign` actions can name real users.

All untrusted text (item names, update bodies) goes through the existing prompt sanitizer and the
nonce-marked `composeSystemPrompt` blocks. The prompt instructs plain prose, no markdown.

### 4.4 Output and validation

Structured JSON validated with Zod (`src/lib/ai/board-intelligence/schema.ts`):

```ts
{
  brief: string;                    // 3–5 sentences, ≤ 700 chars
  suggestions: Suggestion[];        // ≤ 5
}
Suggestion = { id: string; kind: SuggestionKind; title: string; evidence: string; body: string;
               evidenceItemIds: string[]; actions: Action[] /* 1–2 */ }
Action =
  | { type: "reassign"; itemIds: string[]; toUserId: string }
  | { type: "set_due"; itemId: string; date: string }
  | { type: "set_status"; itemId: string; optionId: string }
  | { type: "nudge"; itemId: string; userId: string; message: string }
  | { type: "filter"; signalKind: SignalKind };
```

A suggestion whose actions fail validation, reference an item not on the board, or reference a
user not on the board is dropped before storage. The brief is stored even when zero suggestions
survive.

### 4.5 Cache

- New table `board_intelligence_runs (id uuid pk, org_id uuid, board_id uuid, user_id uuid,
generated_at timestamptz, input_hash text, payload jsonb, dismissed text[] default '{}',
applied text[] default '{}', model text, tokens_in int, tokens_out int)`. Index
  `(board_id, user_id, generated_at desc)`. RLS: own rows in own org.
- `input_hash` = hash of item count, max `updated_at` across items, and the signal counts.
- A run is **stale** when older than 30 minutes or when its `input_hash` differs from the current
  one. The tab shows a stale run with a "Refresh" affordance; "Catch me up" on a stale run triggers
  a new one; a fresh run is served from cache with no LLM call.
- Dismiss writes the suggestion id into `dismissed`; Apply writes into `applied`. Badge count =
  suggestions − dismissed − applied.

### 4.6 Apply and Undo

- Apply calls `applySuggestion(runId, suggestionId)`, which executes the suggestion's actions
  through the existing AI write path as one batch, capturing before-values for every touched cell.
  The action returns the before-values; the client shows a toast "Applied · Undo" for 8 seconds.
- Undo calls `revertSuggestion(runId, suggestionId, beforeValues)` which replays the before-values
  through the same path and removes the id from `applied`.
- Both directions land in `item_activities` with the current user as actor and `source =
"intelligence"`, so the item timeline and the digest see them as ordinary edits.
- If a batch fails midway, the already-written cells are reverted with the captured before-values,
  the toast shows the error, and the card stays unresolved.
- Viewers never see Apply; the server actions also reject them.

## 5. Rules — "Always do this" (Phase 3)

The automations engine today offers triggers `item_created`, `status_changed`, `date_reached`,
`percent_reached`, `person_assigned` and actions `notify`, `move_to_group`, `set_option`,
`set_percent`, `call_webhook`.

- Cards whose actions map onto those primitives show "Always do this":
  - `nudge` on an overdue item → trigger `date_reached` (offset +N days) → action `notify` the
    owner with the nudge message.
  - `set_status` → trigger `date_reached` → action `set_option`.
- Clicking it opens the existing automation editor pre-filled; the user reviews and saves. The rule
  belongs to the board, appears in the Automations sheet, and is edited or deleted there.
  Intelligence never executes rules.
- `reassign` needs a new automation action `assign_person { userId }` in the engine (executor,
  schema, editor row). That is a task of this spec; until it merges, reassign cards show no
  "Always do this".
- Out of scope: stall-based triggers ("no activity for N days") and any autopilot mode.

## 6. Inline Q&A (Phase 4)

- Composer at the bottom of the Intelligence tab. Submit posts to a streaming route
  `src/app/api/board-intelligence/ask/route.ts` using the existing stream protocol and
  `useAskStream`, feature key `board_intelligence`.
- Context: the cached run payload (brief, suggestions, signals), the board snapshot, and the same
  read tools the dock chat has (`query_items`, `semantic_search_items`). No write tools, no memory
  writes.
- Each answer renders as a Q/A pair under the suggestions. Up to five pairs are kept in component
  state; nothing is persisted; a reload clears them. No `ai_conversations` row is created.
- Each answer has an "Open in Chat" link that creates a real board thread with that Q/A as the
  opening turn, for when it becomes a conversation.

## 7. Data model and security

- Two new tables: `board_visits` (§3.4) and `board_intelligence_runs` (§4.5), minted with
  `scripts/new-migration.sh`, applied to DEV through the `supabase-dev` MCP with the same version,
  verified with `pnpm db:ledger-check`, types regenerated in the same PR.
- RLS default-deny on both; both scoped by org through the existing board access predicate;
  `board_intelligence_runs` additionally restricted to the owning user.
- All writes go through Server Actions with Zod-validated inputs. Suggestions are validated
  against the board's current items and members at apply time, not only at generation time.
- The model output is untrusted: only the closed `Action` union can be applied, and every id is
  checked against the board before a write.

## 8. Performance and data-fetching budget

- **First paint**: the board payload as today plus one primary-key read on `board_visits`. Signals
  are computed client-side from the payload and memoized with the existing filter derivations.
  Zero LLM calls, zero additional list reads.
- **Dock tab first open**: one `LIMIT 1` read on `board_intelligence_runs` by
  `(board_id, user_id, generated_at desc)`.
- **In-page interactions**: chip activate/clear, dismiss, tab switch, Q&A history — client state,
  URL mirrored with `history.replaceState`, zero server round-trips.
- **Server-touching interactions**: Catch me up / Refresh = one server action (one LLM call);
  Apply / Undo = one server action each plus a targeted board revalidation; Q&A = one streaming
  request.
- **Bounded reads**: transcript capped at 200 rows / 7 days over `item_activities(board_id,
created_at)` and `item_updates(item_id, created_at)` (indexes verified at plan time, added if
  missing); snapshot bounded by `buildBoardSnapshot`; visit write once per visit.
- Cache staleness (30 minutes or input change) bounds LLM spend to at most one run per user per
  board per half hour of active editing.

## 9. Execution plan

### 9.1 Phases

1. **Orient** — signals module, strip, filter integration in all views, `board_visits`.
2. **Advise** — run action, schema, `board_intelligence_runs`, dock segmented control, tab body,
   Apply/Undo, dismiss.
3. **Act** — `assign_person` automation action; "Always do this" prefill for nudge, set_status,
   reassign.
4. **Ask** — streaming route, composer, inline Q/A pairs, "Open in Chat".

### 9.2 Independent units

- (a) `signals.ts` + constants + tests, and the strip component.
- (b) `board_visits` migration, payload join, `touchBoardVisit`.
- (c) run action, prompt, Zod schema, `board_intelligence_runs` migration, cache logic.
- (d) `assign_person` automation action.
- (e) dock segmented control shell (Chat | Intelligence) with an empty tab body.

### 9.3 Execution DAG

- **Wave 1 (parallel):** a, b, c, d, e.
- **Wave 2 (parallel):** tab body with brief + suggestion cards (needs c, e); chip filter wired
  into kanban / calendar / timeline (needs a); strip "updated Xm ago" + "Catch me up" wiring
  (needs a, c).
- **Wave 3 (parallel):** Apply / Undo / dismiss (needs tab body); Q&A route + composer (needs c,
  tab body); "Always do this" prefill (needs d, tab body).
- **Critical path:** c → tab body → Apply/Undo.
- Migrations (b, c) land through the orchestrator one at a time so `database.types.ts` never
  races; agents gate and commit, the orchestrator merges.

## 10. Testing

- **Signals**: Vitest table tests per kind — thresholds, done items excluded from overdue, first
  visit hides "changed", blocked chain includes dependents, empty board yields no signals, chip
  ordering and `MAX_CHIPS` truncation.
- **Strip**: RTL — chips render with counts, zero-state one-liner, click writes `intel=` to URL and
  activates the filter, second click clears, viewer mode renders, skeleton state.
- **Views**: table/kanban/timeline narrow to `itemIds` and apply highlight/dim props.
- **Run**: schema rejects unknown action types and off-board ids; stale/fresh decision by age and
  `input_hash`; cached run served without an LLM call; usage recorded under
  `board_intelligence`; transcript capped at 200 rows.
- **Apply/Undo**: batch success writes and records activity with `source = "intelligence"`;
  mid-batch failure reverts; Undo restores before-values; viewer rejected server-side.
- **Rules**: `assign_person` executor; prefill mapping for nudge, set_status, reassign.
- **Q&A**: stream protocol round-trip; write tools absent from the tool list; "Open in Chat"
  creates a thread with the Q/A opener.
- Integration suites run only under `PULSE_TEST_DB`, as today. Each phase ships with a manual
  "How to test" walkthrough in its session note.
