# MCP `assigned` Notifications — hoist `upsertCellCore` out of `upsertCell`

**Date:** 2026-07-26
**Status:** Design written, awaiting review
**Type:** Behavior fix (user-visible) + targeted refactor of the hot cell-write path
**Origin:** Finding **F1** of `docs/superpowers/specs/2026-07-25-mcp-tools-dedupe-design.md`, promoted
to an ADR: `vault/decisions/2026-07-25-gotcha-60-server-action-side-effects-invisible-to-mcp.md`

---

## 1. Problem

Assigning a person to an item through the Monolith UI notifies them. Assigning the same person
through MCP (Claude Desktop → `create_item` / `update_item`) assigns them and **notifies nobody**.

`src/lib/boards/actions/cell.ts` → `upsertCell` does two things: the write (four guards + the
`cell_values` upsert) and a side effect (for a `people` column, read the prior assignees, then
insert `kind: "assigned"` notification rows for the newly-added members — `cell.ts:52-64` and
`cell.ts:78-106`). The MCP tool layer could not call `upsertCell` (it is a `"use server"` action
whose first act is the cookie-bound `createClient()`), so `src/lib/mcp/tools/shared.ts` →
`writeCellValue` re-implements the guards and the upsert and drops the fan-out. The omission is
recorded in-code as `KNOWN GAP (do not fix here)` (`shared.ts:36-40`).

Verified, not assumed (re-confirmed at this branch point):

- `cell.ts:87` is the **only** producer of `kind: "assigned"` in `src/`.
- The notification is **not** DB-generated. `gate_notification_by_pref`
  (`supabase/migrations/20260716090205_notification_preferences.sql`) is a BEFORE INSERT trigger
  that _filters_ rows; it never creates them.
- `people` is a live column kind and `cellValueSchema("people")` accepts `{ userIds: [...] }`, so
  MCP can write people cells today.
- Failure is silent: nobody files a bug for a notification that never arrived.

## 2. Goal / non-goals

**Goal.** One implementation of "write a cell" for the whole app, so the `assigned` fan-out is
shared **by construction** rather than remembered — the second option sanctioned by gotcha-60
("a client-injected core, with the `"use server"` action reduced to a thin cookie-client wrapper").

**Non-goals (explicitly out of scope, do not fix here):**

- **The sibling audit.** gotcha-60 generalizes: ~6 other Server Actions carry side effects that are
  invisible to non-cookie callers — `src/lib/collaboration/actions.ts` (mention fan-out),
  `src/lib/feedback/actions.ts`, `src/lib/org/admin-actions.ts`, `src/lib/platform/actions.ts`,
  `src/lib/account/actions.ts`. **Separate follow-up task.** This spec fixes the one confirmed
  user-visible gap and leaves the audit alone.
- An `unassigned` notification kind (see §6).
- Findings F2/F3/F4 of the dedupe spec (no-op `update_item`, the 14× result envelope, 3N sequential
  field round-trips).
- `peopleValueSchema` is `z.object({ userIds: z.array(z.string()) })` — unbounded and not
  uuid-validated (`src/lib/validations/boards.ts:151`). Noted in §7; not changed here.

---

## 3. The two real risks, resolved

The refactor is mechanical. These two questions are the actual content of this task, and both are
answered with evidence below.

### 3.1 Risk A — `supabase.auth.getUser()` under the bridged MCP client

The fan-out currently calls `supabase.auth.getUser()` to obtain `actor_id`. The MCP client is not a
cookie client: `src/lib/mcp/oauth/session-bridge.ts:99 clientFromAccessToken` builds
`createClient(url, ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: "Bearer <access_token>" } } })`
— a client with **no stored session** but a **custom Authorization header**.

**What actually happens (traced through the installed dependency, `@supabase/supabase-js` 2.108.1 /
`@supabase/auth-js` 2.108.1):**

- `SupabaseClient` sets `hasCustomAuthorizationHeader: Object.keys(this.headers).some(k => k.toLowerCase() === "authorization")`
  when it constructs the auth client
  (`node_modules/.pnpm/@supabase+supabase-js@2.108.1/…/dist/index.cjs:1425`) → **true** for the
  bridged client.
- `GoTrueClient._getUser()` returns `AuthSessionMissingError` only when there is no stored
  access token **and** `hasCustomAuthorizationHeader` is false
  (`…/@supabase/auth-js/dist/main/GoTrueClient.js:2587`). With the flag true it falls through and
  issues `GET /auth/v1/user` carrying the bearer header.

So `getUser()` **would resolve the right user today** — but relying on it is wrong for three
reasons:

1. **Cost.** It is a live network round-trip to GoTrue on every people-cell write (the cookie path
   pays it too — `src/lib/auth/session.ts` documents that the app moved off `getUser()` precisely
   to avoid it).
2. **Fragility with a catastrophic failure mode.** The behavior hangs on an auth-js internal flag
   that did not always exist. If a future bump changes it, `getUser()` returns null → `actor_id`
   null → the RLS `with check (actor_id = auth.uid())` rejects the **entire** insert → no
   notifications, silently. That is precisely the bug being fixed, reintroduced by a dependency
   upgrade with no test to catch it.
3. **Untestable.** A core that reaches for ambient auth cannot be unit-tested without mocking auth.

**Decision: the core takes an explicit `actorId` parameter and performs NO auth lookup.**

- `upsertCell` (Server Action) resolves it from the repo's canonical session helper,
  `getUser()` in `src/lib/auth/session.ts` — `getClaims()`-based, verified locally against the
  cached JWKS, wrapped in React `cache()`. Zero network round-trips, deduped across a request.
- MCP passes the id it **already has**: `resolveMcpAuth` puts `userId` on `AuthInfo.extra`
  (`src/lib/mcp/context.ts:22`). Zero extra work.
- A unit test asserts the core never touches `supabase.auth`.

Net effect on the hot path: the UI people-write **loses** one GoTrue round-trip; `bulkSetCell` over
N items loses N of them (one cached local verify instead).

### 3.2 Risk B — does the `notifications` insert pass RLS as the MCP user?

**Yes. No migration is required.** Verified against DEV (`pg_policy` / `pg_proc` reads):

```
policy "notifications: insert as member+actor"  FOR INSERT TO authenticated
  WITH CHECK ( is_org_member(org_id)
           AND actor_id = (SELECT auth.uid())
           AND is_member_of(recipient_id, org_id)
           AND (board_id IS NULL OR board_in_org(board_id, org_id))
           AND (item_id  IS NULL OR item_in_org(item_id, org_id)) )
```

`is_org_member`, `is_member_of`, `board_in_org`, `item_in_org` are all `SECURITY DEFINER` with
`EXECUTE` granted to `authenticated` (confirmed in `pg_proc.proacl` on DEV — the
`20260725102610_definer_acl_lockdown` migration revoked `authenticated` only from
`gate_notification_by_pref`, which is a trigger function and therefore never invoked by the caller
directly). `grant select, insert, update on public.notifications to authenticated` is in
`20260617100000_notifications.sql`.

The bridged MCP client is a **genuine GoTrue session for the same user** — anon key plus that
user's access token — so its Postgres role is `authenticated` and `auth.uid()` is the MCP user,
exactly as for a cookie session. `src/lib/collaboration/notifications.rls.integration.test.ts`
already proves an anon-key-plus-session client can insert an `assigned` row for a co-member; the
bridged client differs only in where the JWT was stored (Vault vs cookie).

Two consequences that must be handled, not assumed away:

- **`actor_id` must be the bridged JWT's subject.** We pass `AuthInfo.extra.userId`, which comes
  from the same `oauth_tokens` row the bridge secret was minted for, so they agree. If they ever
  diverged, the insert **fails closed** (RLS rejects, the cell write is unaffected, the failure is
  logged) — a safe failure mode, never a cross-tenant write.
- **The insert is one statement, so it is all-or-nothing.** An LLM can supply a `userIds` entry
  that is not an org member (nothing FK-checks people-cell contents). `is_member_of` then rejects
  the whole batch and _nobody_ gets notified, with the cell write still applied. We keep parity
  with the UI (single best-effort insert, `console.error` on failure) rather than pre-filtering
  recipients with an extra membership query — YAGNI, and the failure is logged rather than silent.
  Pinned with a test so the behavior is intentional.

`gate_notification_by_pref` sits on the table, so recipient opt-outs are honored on the MCP path
automatically — no extra work.

---

## 4. Approaches considered

### Option A — client-injected core (**chosen**)

`upsertCellCore(supabase, input, actorId)` in a new **non-`"use server"`** module; `upsertCell`
becomes a thin cookie-client wrapper; `writeCellValue` becomes a thin MCP adapter over the same
core. Every existing `upsertCell` caller (`bulk-actions.ts`, `time-actions.ts`,
`ai/write/execute.ts`, `ItemAssistPanel.tsx`) keeps calling the unchanged action signature and is
unaffected. This is the shape gotcha-60 prescribes and the dedupe spec pre-registered as Option B.

### Option B — a DB trigger on `cell_values`

Genuinely attractive: an `AFTER INSERT OR UPDATE` trigger has `OLD.value`/`NEW.value`, so the
added-assignee diff is natural, and _every_ caller — MCP, cron, webhooks, a future queue worker —
inherits it by construction. gotcha-60 names this as the stronger of the two options.

**Rejected for now.** It would also fire for callers that deliberately do not notify today (the
automation engine, CSV import, template instantiation), which is a much larger behavior change than
this task's brief; the actor would have to come from `auth.uid()` inside a definer trigger (null
for service-role paths); and the repo's integration suites **skip by default** (they require a
provisioned test project + `.env.test`), so a trigger-based fix would ship with no coverage in
`pnpm test`. Recorded as the eventual direction if a third non-cookie writer appears.

### Option C — copy the fan-out into `writeCellValue`

Rejected on sight. Two copies of a side effect is exactly the divergence gotcha-60 exists to stop.

---

## 5. Design

### 5.1 New module — `src/lib/boards/actions/cell-core.ts`

**It must not carry the `"use server"` directive.** A `"use server"` module may only export async
functions treated as Server Actions with serializable arguments; a `SupabaseClient` parameter is
neither. The core therefore lives in its own file (directives are per-file, so sitting inside
`actions/` is fine) and starts with `import "server-only"` (stubbed under Vitest by
`vitest.server-only-stub.ts`). It is **not** re-exported from the `src/lib/boards/actions.ts`
barrel — the barrel's public surface stays exactly the set of actions it exports today.

```ts
export async function upsertCellCore(
  supabase: SupabaseClient<Database>,
  input: { itemId: string; columnId: string; value: unknown },
  actorId: string | null,
): Promise<ActionResult>;
```

Body = today's `upsertCell` minus the Zod input parse, the `createClient()`, and the
`supabase.auth.getUser()` call: column read → item/board integrity guard →
`cellValueSchema(kind)` validation → prior-assignee read (people only) → upsert → fan-out (people
only). Returns the canonical `ActionResult` / `fail` from `src/lib/actions/result.ts` (never a
locally re-declared shape).

Fan-out rules, unchanged from today except for where the actor comes from:

- Recipients = `next.userIds` minus `priorPeople` minus `actorId` (you never notify yourself).
- Best-effort: a failed insert **does not** fail the cell write; it is logged as
  `console.error("[notifications] assigned fan-out failed", { itemId, recipients, error })`.
- **New:** `actorId === null` → skip the insert and log the same line with `error: "no actor"`.
  A null actor is a guaranteed RLS rejection, so today's code merely pays a round-trip to be told
  so. Reachable only when the caller is unauthenticated, in which case the upsert itself already
  failed under RLS.

### 5.2 `upsertCell` becomes a wrapper (`src/lib/boards/actions/cell.ts`)

```ts
export async function upsertCell(input: {
  itemId: string;
  columnId: string;
  value: unknown;
}): Promise<ActionResult> {
  const parsed = upsertCellSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const user = await getUser(); // @/lib/auth/session — cached, local JWKS verify
  return upsertCellCore(supabase, parsed.data, user?.id ?? null);
}
```

The Zod boundary parse stays in the wrapper, not the core: the action's boundary is untrusted
client input, while the MCP boundary is `fieldInput` in `shared.ts` plus the tool's own
`z.string().uuid()` on `itemId`. Both boundaries validate; the core is not a boundary. (This also
keeps the existing MCP tests, which call handlers directly with `"i1"`/`"c1"` ids, valid.)

`clearCell` is untouched.

### 5.3 MCP side

| File                                                  | Change                                                                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/mcp/context.ts`                              | add `mcpActorId(auth: AuthInfo): string` — reads `auth.extra.userId`, throws `"Malformed auth context."` when absent (mirrors `getRequestClient`'s guard).                                 |
| `src/lib/mcp/tools/shared.ts`                         | `writeCellValue(supabase, itemId, field, actorId)` → delegates to `upsertCellCore`, maps `ActionResult` to the `string \| null` contract. Guards deleted; the `KNOWN GAP` comment deleted. |
| `src/lib/mcp/tools/create-item.ts` / `update-item.ts` | handlers take a required trailing `actorId: string` and pass it through.                                                                                                                   |
| `src/lib/mcp/tools/register.ts`                       | `const actorId = mcpActorId(auth)`, passed to the two write-tool registrations. Read-only tools untouched.                                                                                 |

`getClient()` still runs **exactly once per tool invocation** (each call charges the MCP rate limit
and rotates the bridge secret) — the core receives the already-resolved client.

**One intentional agent-visible string change.** `writeCellValue`'s
`` `Column ${field.columnId} not found.` `` becomes the core's `"Column not found."`. Both handlers
already prefix `` `${field.columnId}: ` ``, so the agent still sees `c1: Column not found.` — no
information is lost. Two existing assertions are updated. Every other message
(`"Item not found."`, `"Item and column belong to different boards."`, the Zod issue message, the
Postgres error passthrough, `null` on success) is unchanged.

### 5.4 Independent units (working agreement #6)

Four pieces with no shared state, schedulable concurrently: (1) the fake-client test support,
(2) the core module + its tests, (3) the `mcpActorId` helper, (4) the RLS integration proof. The
two rewires (boards wrapper / MCP tools) touch disjoint file sets and are a second wave.

---

## 6. Should `clearCell` on a people column notify? **No.**

Decided explicitly, because today's silence is accidental rather than reasoned:

- `assigned` is an **addition** event. Clearing a people cell adds nobody, so the existing
  "recipients = added, excluding the actor" rule yields an empty set. There is nothing to send.
- Removal would need a **new** `notification_kind` — the enum is `('mention','assigned','update_on_item')`
  — i.e. a migration, plus a preference row kind, plus inbox rendering. Out of proportion, and
  nobody has asked for "you were unassigned".
- Partial removal is already silent for the same reason (writing a shorter `userIds` list produces
  no additions), so notifying on a full clear would be **inconsistent** with the partial case.

`clearCell` therefore stays a pure delete, and gains a characterization test asserting it never
touches `notifications`, so the silence is now intentional and pinned.

---

## 7. Performance & data-fetching budget (working agreement #5)

No UI, no new views/tabs/filters, no read-path change, so no first-paint impact and no navigation
concerns. The budget that matters here is the **hottest write path in the product**.

| Path                                | Today                                                                   | After                                                           |
| ----------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| UI cell write, non-people           | 2 reads + 1 upsert                                                      | identical (+1 cached **local** JWT verify, 0 network)           |
| UI cell write, people               | 2 reads + prior read + upsert + **`auth.getUser()` (network)** + insert | same minus the network call → **one round-trip fewer**          |
| `bulkSetCell` over N items (people) | N × `auth.getUser()` network calls                                      | 1 local verify total (React `cache()` dedupes)                  |
| MCP write, non-people               | 2 reads + 1 upsert                                                      | identical                                                       |
| MCP write, people                   | 2 reads + 1 upsert, **no notification**                                 | + prior read + 1 insert; **0** auth calls (actor already known) |

Bounded-read check: the prior-assignee read is a `maybeSingle()` on the `(item_id, column_id)`
primary key. The notification insert is one statement with at most `userIds.length` rows, and MCP
caps `fields` at 50 per call. No unbounded `select *` is introduced. Known soft spot, not changed
here: `peopleValueSchema` does not cap `userIds` length — recorded as a follow-up.

Query counts are asserted in the unit tests, not assumed.

---

## 8. Testing (working agreement #4)

Unit tests carry the proof, because integration suites `describe.skipIf(!integrationTargetReady())`
and skip without a dedicated test project — they cannot be the gate.

**`src/lib/boards/actions/cell-core.test.ts` (new)**

1. people write notifies only newly-added members, excluding `actorId`.
2. no new members → **zero** `notifications` calls.
3. non-people column → no prior read, no `notifications` call, and **`supabase.auth` is never
   accessed** (the anti-regression pin for §3.1).
4. `actorId === null` → no insert, one `console.error`, action still `ok`.
5. failed insert → still `{ ok: true }`, one `console.error` with the recipient count.
6. guard cases (column missing / item missing / cross-board / invalid value) return the exact
   `fail` messages.

**`src/lib/boards/actions.test.ts` (edit)** — the existing
`upsertCell people-cell assignment fan-out` block stays green, with one required change: the actor
now comes from the already-mocked `@/lib/auth/session` `getUser` instead of
`supabase.auth.getUser`, so those two tests set `sessionGetUser` to the actor id. This is the one
place a test edit is legitimate; everything else must pass untouched.

**`src/lib/boards/actions.test.ts` (add)** — one new `it` asserting `clearCell` on a `people`
column never touches `notifications` (§6), alongside the existing fan-out block.

**MCP unit tests** — `src/test/mcp-fake-client.ts` gains a `cell_values` prior-read response and a
`notifications` insert capture; `create-item.test.ts` / `update-item.test.ts` gain a people-field
test asserting the insert row shape (`org_id`, `recipient_id`, `actor_id` = the MCP user, `kind:
"assigned"`, `board_id`, `item_id`) and a non-people test asserting no insert. All existing call
sites gain the trailing `actorId` argument.

**`*.rls.integration.test.ts` (new, skipped by default)** — the only end-to-end proof of §3.2:
build a client in the exact bridged shape (anon key + `Authorization: Bearer <session access
token>`, `persistSession: false`) and assert it can insert an `assigned` row for a co-member and is
rejected for a non-member. Runs only with `.env.test`; documented as such.

Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

**Manual acceptance (user-facing, so a walkthrough is required at closure):** from Claude Desktop,
`update_item` assigning a co-member to an item, then confirm the notification bell shows
"assigned you" for that member in the Monolith UI, and that the same member's notification preference
opt-out still suppresses it.

---

## 9. Risks

| Risk                                                             | Mitigation                                                                                                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Touching the hottest write path (every UI cell edit)             | Wrapper keeps an identical exported signature; body moves near-verbatim; existing suites must pass unedited apart from the one documented actor-source change. |
| `"use server"` export rules                                      | The core is a separate non-directive module; `pnpm build` is the mechanical check.                                                                             |
| An LLM invents a non-member `userId`                             | RLS rejects the batch, cell write unaffected, failure logged. Pinned by test; documented in §3.2.                                                              |
| `AuthInfo.extra.userId` diverging from the bridged JWT subject   | Fails closed under RLS; `mcpActorId` throws on a malformed auth context.                                                                                       |
| MCP now writes to `notifications`, a table it never wrote before | Same policy, same role as the UI; proven by the new integration test and the existing RLS suite.                                                               |

---

## 10. Follow-ups (not this task)

- **The sibling audit** of non-cookie-invisible Server Action side effects (§2). Highest value.
- `peopleValueSchema`: cap `userIds` length and validate uuids.
- The `cell_values` trigger (Option B) if a third non-cookie writer appears.
- Dedupe-spec findings F2/F3/F4.
