# MCP Tool Layer — Deduplicate `writeCellValue` and `GetClient`

**Date:** 2026-07-25
**Status:** Design approved, ready to plan
**Type:** Pure refactor (no behavior change)
**Origin:** `vault/sessions/2026-07-24-1950-mcp-server-oauth.md` lines 73–75, logged as an
explicit "natural extraction candidate":

> `writeCellValue` is duplicated near-verbatim between `create-item.ts`/`update-item.ts`, and a
> `GetClient` type is redeclared in six tool files instead of a shared module — fine for now,
> natural extraction candidate.

---

## 1. Problem

The MCP tool layer (`src/lib/mcp/tools/`) has two known duplications. Both are artifacts of how
the layer was built: the MCP server plan (`docs/superpowers/plans/2026-07-24-mcp-server.md`)
dispatched Tasks 10/11/12 as **Batch D in parallel**, and its Task 11 interface block even says
`Consumes: GetClient type (Task 10)` — but three concurrent subagents in three worktrees each
declared their own copy rather than importing one. The duplication is a **parallel-execution
artifact**, not a design decision, which is why it is safe to collapse.

This spec establishes the _actual_ current state (the session note's "near-verbatim" undersells
it), decides where the shared code belongs, and — critically — establishes the test safety net a
no-behavior-change refactor needs, because the current safety net is not adequate.

---

## 2. Verified duplication inventory

Established by reading every file under `src/lib/mcp/tools/` at
`task/mcp-tools-dedupe` (frozen `develop`, commit `a78e1bd` lineage).

### 2.1 `type GetClient` — 6 declarations, character-identical

```ts
type GetClient = () => Promise<SupabaseClient<Database>>;
```

| File                                | Line |
| ----------------------------------- | ---- |
| `src/lib/mcp/tools/list-boards.ts`  | 5    |
| `src/lib/mcp/tools/get-board.ts`    | 6    |
| `src/lib/mcp/tools/get-item.ts`     | 6    |
| `src/lib/mcp/tools/search-items.ts` | 6    |
| `src/lib/mcp/tools/create-item.ts`  | 7    |
| `src/lib/mcp/tools/update-item.ts`  | 8    |

All six are module-private (not exported), all six are byte-identical, and all six drag in the
same two type-only imports (`SupabaseClient`, `Database`) purely to express them. The single
producer of the value they describe is `getRequestClient` in `src/lib/mcp/context.ts`, closed over
in `register.ts:13` (`const getClient = () => getRequestClient(auth)`). Six declarations, one
producer.

### 2.2 `writeCellValue` — 2 copies, **byte-for-byte identical**

`create-item.ts:20–56` and `update-item.ts:20–56`. Diffing the two function bodies yields **zero
differences** (the only diff hunk is a trailing blank line in `create-item.ts` outside the
function). The session note's "near-verbatim" is inaccurate in the _safe_ direction: there is no
silent create/update divergence hiding in these two copies.

The three cosmetic differences are all _outside_ the shared body:

1. `create-item.ts:19` carries a doc comment (`/** Writes one cell value, mirroring the guard
logic in src/lib/boards/actions/cell.ts's upsertCell. */`); `update-item.ts` has none.
2. `create-item.ts:4` imports `Database` and `Json` in one statement; `update-item.ts` splits them
   across lines 4 and 6.
3. `create-item.ts` passes the RPC-returned `item.id`; `update-item.ts` passes `input.itemId`.

### 2.3 Third duplication found (in scope, same cluster)

The `fieldInput` Zod schema is also duplicated verbatim — `create-item.ts:9–12` and
`update-item.ts:10–13`:

```ts
const fieldInput = z.object({
  columnId: z.string().uuid(),
  value: z.record(z.string(), z.unknown()),
});
```

…as is its hand-written TS mirror in both handler signatures
(`fields?: { columnId: string; value: Record<string, unknown> }[]`) and the identical aggregate
`isError` expression (`create-item.ts:91–96`, `update-item.ts:97–101`). These belong to the same
create/update field-write cluster and collapse with the same edit, so they are in scope.

### 2.4 Duplication found but held OUT of scope

The MCP result envelope is hand-shaped **14 times** across the six tool files — 8 error variants
(`{ content: [{ type: "text" as const, text: … }], isError: true }`) and 6 success variants
(`{ content: [{ type: "text" as const, text: JSON.stringify(…) }] }`). A shared
`textResult`/`errorResult` pair would collapse all 14.

**Deliberately excluded.** It was not the flagged debt, it touches the return statement of every
handler in all six files (not just the two-file cluster), and it is the seam where a
redesign-by-accretion would start. Recorded as finding **F3** below.

---

## 3. Does a canonical helper already exist? (AGENTS.md "grep before writing a helper")

**Yes — and it cannot be reused. This is load-bearing and was verified, not assumed.**

`src/lib/boards/actions/cell.ts` → `upsertCell(input)` is the canonical server-side cell write.
The MCP `writeCellValue` copies are a deliberate re-implementation of its guard sequence — the doc
comment in `create-item.ts:19` says so explicitly. Every other server-side cell writer in the repo
**does** route through it (`src/lib/ai/write/execute.ts:33`, `src/lib/boards/bulk-actions.ts:147`,
`src/lib/boards/time-actions.ts:231`, `src/components/ai/item-assist/ItemAssistPanel.tsx:156,437`).

### Why MCP can't call it

`upsertCell` is a `"use server"` Server Action whose first act is
`await createClient()` from `src/lib/supabase/server.ts`, which builds the client from
**`cookies()` (`next/headers`)**. An MCP request carries **no Monolith session cookie** — only our
opaque OAuth bearer token, which `src/lib/mcp/context.ts:36 getRequestClient` resolves to a
**bridged** client via `getBridgedClient` → `clientFromAccessToken`
(`src/lib/mcp/oauth/session-bridge.ts:131`). Calling `upsertCell` from a tool handler would
silently construct an **unauthenticated** client and fail under RLS.

This is already a recorded project decision, not a new discovery — the MCP server plan's Global
Constraints (`docs/superpowers/plans/2026-07-24-mcp-server.md:19`) and its Task 10 note (line 1757) both state it.

### Also checked and ruled out

| Candidate                                           | Verdict                                                                                                                                                                                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/boards/mutations/cells.ts`                 | **Not** a server mutation module despite the name — `"use client"` React Query hooks wrapping `upsertCell`. Unusable server-side.                                                                                                             |
| `src/lib/boards/spreadsheet-actions.ts:293`         | Bulk board-seed `insert` (brand-new board, no prior cells). Different operation, not a duplicate of the guard sequence.                                                                                                                       |
| `src/lib/ai/column-fill/actions.ts:101`             | Cell **read** only; its writes go through `bulk-actions` → `upsertCell`.                                                                                                                                                                      |
| `src/lib/supabase/typed-rpc.ts`                     | Applies to `.rpc()` calls. `create-item.ts:67`'s `supabase.rpc("create_item", …)` is a generated-typed table RPC, not a candidate for change in this refactor.                                                                                |
| `src/lib/actions/result.ts` (`ActionResult`/`fail`) | Correct for Server Actions. MCP tool handlers must return the **MCP** `{content, isError}` envelope, not `ActionResult`. `writeCellValue`'s `Promise<string \| null>` (message-or-null) is an internal convention of the MCP layer and stays. |

**Conclusion:** a canonical helper exists but is structurally unreachable from MCP. Extracting a
**single MCP-local** helper is therefore the correct answer, not a violation of the
grep-before-writing rule. The alternative — hoisting a client-injected core out of `upsertCell` so
both callers share one implementation — is genuinely better long-term but is explicitly **out of
scope**; see §5 Option B and finding **F1**.

---

## 4. Findings recorded, NOT fixed by this refactor

The refactor is defined as **zero behavior change**. Reading the code turned up real issues. Per
the task's scope discipline they are documented here with a recommendation and left alone. Any of
them landing inside this task would make "no behavior change" a lie.

### F1 — `people` cell writes via MCP never send `assigned` notifications (genuine bug, user-visible)

**The divergence is not between the two MCP copies (those are identical) — it is between the MCP
copies and canonical `upsertCell`.**

`upsertCell` does more than the guard sequence the MCP copies mirror. `cell.ts:52–64` reads the
prior assignees for a `people` column, and `cell.ts:78–106` inserts `kind: "assigned"`
notifications for the newly-added members after the write. The MCP `writeCellValue` copies mirror
the four guards and the upsert, and **silently omit the entire fan-out**.

Verified as a real gap, not a false positive:

- `people` is a live `column_kind` (`src/lib/validations/boards.ts:10`), and
  `cellValueSchema("people")` returns `peopleValueSchema`, so MCP `create_item`/`update_item`
  **can** write a people cell today.
- `src/lib/boards/actions/cell.ts:92` is the **only** producer of `kind: "assigned"` in the entire
  codebase (grepped `src/`).
- The notification is **not** DB-triggered. The only `notif`-related trigger is
  `gate_notification_by_pref`
  (`supabase/migrations/20260716090205_notification_preferences.sql:54`), which _filters_ inserts —
  it does not create them.

**User-observable effect:** "Assign Sarah to this task" in Claude Desktop assigns Sarah and she is
never notified. The same edit in the Monolith UI notifies her. Silent, and the kind of thing that is
only noticed as "Monolith notifications are unreliable."

**Recommendation:** separate `fix(mcp):` task, and the right way to fix it is §5 Option B —
hoist a client-injected `upsertCellCore(supabase, …)` out of `upsertCell`, have both `upsertCell`
and the MCP tools call it, and the fan-out is shared by construction rather than remembered.
Doing it as a _behavior fix_ also means it gets its own tests asserting the notification insert,
which a "no behavior change" refactor could never justify. Worth an ADR: _app-layer side effects
in Server Actions are invisible to non-cookie callers (MCP, jobs) — put them in the DB or in a
client-injected core._

Reassuring counterpart: `updated_at`, the automation engine, and activity logging **are** DB
triggers on `cell_values` (`20260615061747_boards_core.sql:112`,
`20260618150000_automations_engine.sql:89`, `20260617090000_collaboration_updates_activity.sql:111`),
so MCP writes fire all three correctly. F1 is the _only_ side-effect gap.

### F2 — `update_item` with neither `name` nor `fields` reports success for a no-op

`updateItemHandler` (`update-item.ts:58`) skips the rename when `input.name` is falsy and iterates
an empty `fields ?? []`, returning `{itemId, fieldErrors: []}` with `isError: undefined`. It never
verifies the item exists. An agent calling `update_item` with a bogus `itemId` and no payload is
told the update succeeded. Low severity; arguably correct-as-specified. **Recommendation:** leave
as-is, but _pin it with a characterization test_ so the behavior is intentional rather than
accidental. Revisit only if a real agent trips on it.

### F3 — MCP result envelope hand-shaped 14×

See §2.4. **Recommendation:** fold into whichever task next adds or changes an MCP tool, where
touching every handler's return statement is already the job.

### F4 — Field writes are 3N sequential round-trips (up to 150)

`writeCellValue` issues 2 reads + 1 upsert per field, and both handlers loop with `await` inside
`for`. The Zod schema caps `fields` at 50, so worst case is 150 sequential round-trips in one tool
call. `Promise.all` would fix the latency but **changes error ordering** in `fieldErrors` and gives
up the sequential-write semantics — a behavior change. **Recommendation:** leave alone; extracting
to one helper makes it a one-place fix if MCP tool latency ever becomes a complaint.

---

## 5. Approaches considered

### Option A — MCP-local shared module (**chosen**)

One new source file, `src/lib/mcp/tools/shared.ts`, exporting `GetClient`, `writeCellValue`, the
`fieldInput` schema, and its `FieldInput` type (plus one test-support module — §7.3). Six tool files
import `GetClient`; create/update additionally import `writeCellValue` + the schema.

Pros: mechanically provable no-behavior-change (the extracted body is byte-identical to both
copies, so the move is a literal cut-and-paste); ~150 LOC net negative; leaves the boards layer
untouched; matches the layer's existing `context.ts` / `register.ts` structure. Cons: does not
close F1 — accepted, because closing F1 _is_ a behavior change and belongs in its own task.

### Option B — hoist a client-injected core out of `upsertCell`

`src/lib/boards/actions/cell-core.ts` exporting
`upsertCellCore(supabase: SupabaseClient<Database>, input): Promise<string | null>`, consumed by
both the thin `"use server" upsertCell` wrapper and the MCP tools. One implementation for the whole
app, and F1 closes for free.

**Rejected for this task, recommended as the follow-up.** It edits the hottest write path in the
product (every UI cell edit, plus AI write, bulk, and time-tracking callers), it _necessarily_
changes MCP behavior by adding the notification fan-out, and `supabase.auth.getUser()` inside the
fan-out has different semantics under a bridged client than under a cookie client — a real design
question, not a refactor. Landing it under a "no behavior change" banner would be dishonest. Option
A is a strict prerequisite anyway: once the MCP side has one call site instead of two, Option B is
a two-line swap.

### Option C — leave it, add a cross-reference comment

Rejected. The debt was explicitly flagged, the fix is cheap and mechanical, and the six-way
`GetClient` copy is already actively misleading (the original plan's own interface block says it
should be shared).

---

## 6. Design

### 6.1 New module: `src/lib/mcp/tools/shared.ts`

Exports exactly four things, no more:

| Export           | Kind       | Source                                                                      |
| ---------------- | ---------- | --------------------------------------------------------------------------- |
| `GetClient`      | `type`     | verbatim from any of the 6 copies                                           |
| `fieldInput`     | Zod object | verbatim from `create-item.ts:9–12`                                         |
| `FieldInput`     | `type`     | `z.infer<typeof fieldInput>` — replaces the two hand-written inline mirrors |
| `writeCellValue` | `async fn` | verbatim from `create-item.ts:20–56`, doc comment retained and extended     |

Placed **inside** `src/lib/mcp/tools/` rather than in `src/lib/mcp/`: every export is consumed only
by tool modules, and `src/lib/mcp/context.ts` (the producer of the `GetClient` value) must not
depend on the tools it serves.

**Naming check:** `shared.ts` matches the existing repo convention for a sibling-only helper module
(`src/lib/boards/mutations/shared.ts`). Not `types.ts` — the module carries runtime code, not just
types.

### 6.2 Signature preservation (the invariant that makes this safe)

`writeCellValue` keeps its exact signature and its `Promise<string | null>` message-or-null
contract, including every literal error string. Those strings are the MCP tool's user-facing output
— they reach Claude Desktop verbatim via `fieldErrors: ["<columnId>: <message>"]`. All six must
survive character-identical:

- `` `Column ${field.columnId} not found.` ``
- `"Item not found."`
- `"Item and column belong to different boards."`
- `valueParsed.error.issues[0]?.message` / `"Invalid value."`
- `error?.message` (Postgres upsert error, passed through)
- `null` on success

### 6.3 Per-file changes

| File              | Change                                                                                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list-boards.ts`  | delete `type GetClient`; `import type { GetClient } from "./shared"`; drop now-unused `SupabaseClient`/`Database` type imports                                                                                    |
| `get-board.ts`    | same                                                                                                                                                                                                              |
| `get-item.ts`     | same                                                                                                                                                                                                              |
| `search-items.ts` | same                                                                                                                                                                                                              |
| `create-item.ts`  | delete `type GetClient`, local `fieldInput`, local `writeCellValue`; import all three from `./shared`; use `FieldInput[]` in the handler signature; drop unused `SupabaseClient`/`Json`/`cellValueSchema` imports |
| `update-item.ts`  | same as `create-item.ts`                                                                                                                                                                                          |
| `register.ts`     | **unchanged** (imports only the `register*Tool` functions)                                                                                                                                                        |
| `context.ts`      | **unchanged** (must not import from `tools/`)                                                                                                                                                                     |

No public signature changes: `createItemHandler`, `updateItemHandler`, and all six `register*Tool`
functions keep their exact exported shapes, so `register.ts` and every existing test compile
untouched. ESLint's unused-import rule is the mechanical check that step-4 cleanup was complete.

### 6.4 Independent units (AGENTS.md #6)

- **U1** — the shared module itself. Purely additive; typechecks and is unit-testable with nothing
  else changed.
- **U2** — the four read-only tools (`list-boards`, `get-board`, `get-item`, `search-items`).
  `GetClient` import swap only. Disjoint file set from U3.
- **U3** — the two write tools (`create-item`, `update-item`). Full collapse.
- **U4** — the test safety net (§7). Must land **before** U1–U3; splits into two mutually
  independent halves (create-item vs update-item).

U2 and U3 share no files and can run concurrently once U1 exists.

---

## 7. Test strategy — honest coverage assessment

**Baseline, measured:** `npx vitest run --project unit src/lib/mcp/` → 13 files, 28 tests, all
green, 1.71s. Of that, the six tool files hold **9 tests total**.

### 7.1 Current coverage of `writeCellValue` — thin, and worse than thin

`writeCellValue` has six exit paths. Two are exercised.

| Exit path                                | Covered today                           |
| ---------------------------------------- | --------------------------------------- |
| column not found (`colErr \|\| !column`) | ❌ none                                 |
| item not found (`itemErr \|\| !item`)    | ❌ none                                 |
| cross-board mismatch                     | ✅ `update-item.test.ts:51`             |
| `cellValueSchema` rejection              | ❌ none — **and actively neutralized**  |
| upsert DB error                          | ❌ none                                 |
| success (returns `null`)                 | ⚠️ both happy-path tests, but see below |

Two problems make the existing tests an inadequate net for a refactor:

1. **Validation is mocked out of existence.** Both `create-item.test.ts:3` and
   `update-item.test.ts:3` do
   `vi.mock("@/lib/validations/boards", () => ({ cellValueSchema: () => ({ safeParse: v => ({ success: true, data: v }) }) }))`.
   Every value passes. The `cellValueSchema(column.kind)` call — the whole point of the guard — is
   never actually exercised.
2. **The upserted row shape is never asserted.** Both happy-path tests assert only
   `expect(upserted).toHaveLength(1)`. Nothing checks that `org_id`/`board_id` come from the
   **column** (the RLS-relevant derivation), that `item_id`/`column_id` are right, that `value` is
   the _parsed_ output, or that `onConflict: "item_id,column_id"` is passed. **A refactor could
   silently break `org_id` derivation or drop `onConflict` and all 9 tests would still pass.**

Also uncovered at the handler level: `create_item`'s RPC-error path, `update_item`'s
rename-error path, the aggregate `isError` rule (all fields fail → `true`; _partial_ failure →
`undefined`), the `"<columnId>: <message>"` prefix format of `fieldErrors`, and F2's no-op path.

### 7.2 Consequence: characterization tests come first, as a hard gate

**No extraction happens until the net exists.** The plan's first task writes characterization
tests against the _current_ code — they must go green **before** any file is touched, because
their job is to pin behavior, not to drive it. That is the correct inversion of normal TDD for a
refactor, and it is the only thing that makes "no behavior change" a claim rather than a hope.

Required new coverage (all six `writeCellValue` exits × both handlers where meaningful):

1. **Row-shape assertion** (the most important single test): a real deep-equal on the upserted row
   — `org_id`/`board_id` from the column, `item_id`/`column_id`, parsed `value` — plus the
   `{ onConflict: "item_id,column_id" }` second argument.
2. Each of the four guard failures, asserting the **exact** error string, that `upsert` was
   **never called**, and that the message appears in `fieldErrors` with its `"<columnId>: "`
   prefix.
3. Real `cellValueSchema` behavior — at least one test **without** the `vi.mock`, feeding a
   genuinely invalid value for a known kind and asserting rejection. This closes the biggest hole.
4. Upsert DB error → message propagates into `fieldErrors`.
5. Aggregate `isError`: all-fail → `true`; **partial**-fail (1 of 2) → `undefined` with a
   1-element `fieldErrors`. This is the subtlest logic in either handler and has zero coverage.
6. `create_item` RPC error → `isError: true` with the RPC message.
7. `update_item` rename error → `isError: true`, and fields are **not** written.
8. F2's no-op path, pinned as documented-current-behavior with a comment linking to F2.

**Load-bearing check (mandatory):** a characterization test that passes trivially is worse than no
test. Each new test must be _proved_ to fail if the behavior it pins is perturbed — at minimum,
temporarily break `org_id: column.org_id` → `org_id: item.board_id` and confirm the row-shape test
goes red, then revert. Evidence in the task notes, per
`superpowers:verification-before-completion`.

### 7.3 Test support

The eight-ish new tests all need the same chainable Supabase stub
(`from(t).select().eq().maybeSingle()` / `.upsert()` / `.update().eq().select().maybeSingle()` /
`.rpc()`), currently hand-rolled per test. A small builder goes in **`src/test/mcp-fake-client.ts`**
— matching the existing `src/test/` convention for non-`*.test.ts` test-support modules
(`integration-auth.ts`, `integration-env.ts`), and safely outside vitest's
`src/**/*.{test,spec}.{ts,tsx}` include glob. Hand-copying a stub builder eight times inside a
deduplication task would be self-defeating.

### 7.4 The refactor's own acceptance criterion

After U1–U3: the characterization tests pass **completely unmodified**. Any test that needs
editing to go green is a behavior change and must be stopped and reported, not accommodated.
`src/lib/mcp/tools/cross-org-access.rls.integration.test.ts` is untouched and continues to skip
without `.env.test` (expected).

Plus the four gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

## 8. Performance & data-fetching budget (AGENTS.md #5)

**Not applicable in the usual sense** — no UI, no views/tabs/filters/sorts, no RSC navigation, no
client state. The MCP tool layer is a server-side JSON-RPC surface with no rendering path.

The budget is not vacuous, though, because a refactor can regress query counts. Stated as a
**preserved invariant**:

- **Per field written:** exactly 2 bounded reads (`columns` by `id`, `items` by `id` — both primary
  key) + 1 upsert on the `(item_id, column_id)` primary key. Unchanged.
- **Per tool call:** exactly one `getClient()` — which is also one rate-limit decision
  (`context.ts:39`) and one bridge-secret rotation (`context.ts:50–51`). **`getClient()` must not be
  moved inside `writeCellValue` or into the field loop**; that would multiply both the rate-limit
  charge and the secret rotation per field. This is the one way this refactor could actually cause
  harm, so it is called out explicitly and belongs in the plan's verification step.
- **Boundedness:** `fields` is capped at 50 by Zod; `search_items` at 50 (`SEARCH_LIMIT`). No
  unbounded `select *` anywhere in the layer. Unchanged.
- **Not improved, deliberately:** the 3N sequential round-trip shape (finding F4) is preserved
  exactly, because parallelizing it changes `fieldErrors` ordering.

---

## 9. Out of scope (explicit)

- Closing F1 (the `people` notification gap) — separate `fix(mcp):` task, per §5 Option B.
- Option B's `upsertCellCore` hoist, and any edit to `src/lib/boards/`.
- The result-envelope helper (F3), the round-trip shape (F4), F2's semantics.
- New MCP tools, tool schema changes, tool description changes, anything OAuth.
- `register.ts` and `context.ts` structure.
- Rewriting the existing 9 tests. They are **added to**, never edited (an edit would signal a
  behavior change).

---

## 10. How to test (AGENTS.md #1)

**Not user-observable — pure internal refactor; verified by `pnpm test` (the
`src/lib/mcp/tools/*.test.ts` suites, which this task substantially expands).**

That said, the MCP tools _are_ a user-facing surface via Claude Desktop, so the plan's manual
smoke step (optional, only if a DEV MCP connection is already wired) is: in Claude Desktop against
DEV, (1) "create an item called _Refactor smoke_ in group X with status Working on it" → item
appears on the board with the status cell set; (2) "rename it to _Refactor smoke 2_ and set its
due date" → both land. Watch for regressions in: the field-write error text an agent sees, cells
landing with a wrong `org_id`, and the `isError` flag flipping (which changes whether Claude
treats a partial write as a failure and retries).

---

## 11. Success criteria

1. `type GetClient` is declared **once**, in `src/lib/mcp/tools/shared.ts`; zero other
   declarations in `src/`.
2. `writeCellValue` is defined **once**; zero `cell_values` upserts remain in `create-item.ts` /
   `update-item.ts`.
3. `fieldInput` is defined once; both handler signatures use the inferred `FieldInput`.
4. All six `writeCellValue` exit paths and both handlers' error paths are covered by
   characterization tests, each proved load-bearing.
5. The characterization tests pass **unmodified** before and after the extraction.
6. One `getClient()` call per tool invocation (verified by assertion, not inspection).
7. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green.
8. F1–F4 are recorded — F1 as a filed follow-up (ADR-worthy), not silently fixed.
