# Embedding Unblock, Promotion & Debt Paydown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement **Phase B** task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Phase A is NOT agent work.** It is a verification-gated production runbook. An agent may draft and verify, but every action against production is executed by the owner. Do not automate it.

**Goal:** Drain the prod embedding backfill so the changelog's semantic-search claims are true, promote `develop → main`, then retire the technical debt the 2026-08-01 audit found.

**Architecture:** Three phases. Phase A verifies three preconditions that fail _silently_, then enqueues and confirms drain. Phase B is the `develop → main` promotion, which is a net deletion and introduces no new debt. Phase C is a `task/debt-paydown` worktree: remove two orphaned `"use server"` endpoints, restore the migration-ledger gate, and add unit tests to the seven genuinely-untested server-action modules.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Supabase Postgres + RLS + Vault + pg_cron/pg_net, Vitest, Zod.

## Global Constraints

- Commit identity is **`Danijel Jovanovic <info@synapse-solutions.ai>`** — any other email makes Vercel silently skip the deploy.
- Commit subjects are **lowercase** after `type(scope):`; every commit needs a descriptive body plus the `Co-Authored-By` trailer.
- **Stage explicitly by path.** Never `git add -A` / `git add .` / `git commit -a`.
- Phase C runs in a worktree created by `scripts/start-task.sh debt-paydown` and closed by `scripts/finish-task.sh`. Never build on `develop` directly.
- All four gates must pass before finish: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- `pnpm lint` legitimately emits **one** warning (`max-lines` on `landing-sections.tsx`). That is the deliberate tripwire — do not silence it, and do not treat it as a failure.
- Test UUIDs must be **v4-shaped** (`00000000-0000-4000-8000-…`) or Zod's `.uuid()` rejects them before the assertion under test runs.

---

# Phase A — Unblock prod embeddings (owner-executed)

**Why this is gated:** `_embed_sweep_ping()` (`supabase/migrations/20260720093437_item_embed_queue.sql:73`) reads `app_url` and `ai_pgnet_hmac_secret` from Vault. If either is absent it calls `raise notice` and returns. **A notice is not an error** — `cron.job_run_details` records the job as _succeeded_. Enqueue 439 items against an under-provisioned Vault and every sweep reports green forever while the queue never drains. The north-star's "no secret handling needed" is incorrect on this point.

A second silent edge: the endpoint verifies with `AI_PGNET_HMAC_SECRET` (`src/app/api/ai/embed/route.ts:36`), which must **equal** the Vault copy. On mismatch the endpoint returns 401, but `net.http_post` is fire-and-forget — the database never learns it failed.

**So: verify first, enqueue second, confirm drain third.** Do not reorder.

### A1 — Verify the three preconditions

- [ ] **Step 1: Confirm both Vault secrets exist on PROD.** Paste into the prod SQL editor (`supabase-prod` MCP is read-only, `25006`):

```sql
select name,
       case when decrypted_secret is null or decrypted_secret = ''
            then 'MISSING' else 'present' end as status
from vault.decrypted_secrets
where name in ('app_url', 'ai_pgnet_hmac_secret');
```

Expected: **two rows, both `present`**. Fewer than two rows means the missing name is absent entirely — that is the silent-skip condition. Stop and provision it before continuing.

- [ ] **Step 2: Confirm `app_url` has no trailing slash.** The function concatenates `v_url || '/api/ai/embed'`, so a trailing slash produces a double-slash URL.

```sql
select decrypted_secret as app_url,
       (decrypted_secret like '%/') as has_trailing_slash
from vault.decrypted_secrets where name = 'app_url';
```

Expected: `has_trailing_slash = false`.

- [ ] **Step 3: Confirm the Vercel prod env vars exist.** In the Vercel dashboard (Production scope), confirm both are set: `AI_PGNET_HMAC_SECRET` and `OPENAI_EMBEDDING_API_KEY`. The latter was provisioned 2026-07-25; re-confirm rather than assume.

- [ ] **Step 4: Confirm the two HMAC secrets match.** This cannot be read from Vercel, so compare fingerprints — reveal the Vercel value, and compare its SHA-256 against the Vault copy's:

```sql
select encode(extensions.digest(decrypted_secret, 'sha256'), 'hex') as fingerprint
from vault.decrypted_secrets where name = 'ai_pgnet_hmac_secret';
```

Expected: identical to `echo -n "<vercel value>" | sha256sum`. A mismatch here is the failure mode that produces a permanently-full queue with green cron runs.

**GATE: do not proceed to A2 unless Steps 1–4 all pass.**

### A2 — Enqueue the backlog

- [ ] **Step 1: Count what will be enqueued (read-only, run first).**

```sql
select count(*) as live_items from public.items where archived_at is null;
select count(*) as already_queued from public.item_embed_queue;
select count(*) as already_embedded from public.item_embeddings;
```

Record these three numbers. Expected roughly: ~439 live items, 0 queued, 0 embedded.

- [ ] **Step 2: Enqueue every live item.** Idempotent — `item_id` is the primary key, so `on conflict do nothing` makes a re-run free.

```sql
insert into public.item_embed_queue (item_id, org_id, board_id, enqueued_at)
select i.id, i.org_id, i.board_id, now()
from public.items i
where i.archived_at is null
on conflict (item_id) do nothing;
```

- [ ] **Step 3: Confirm the queue depth matches the live-item count.**

```sql
select count(*) as queued from public.item_embed_queue;
```

Expected: equal to `live_items` from Step 1.

### A3 — Confirm the drain (this is the step that catches a silent failure)

The cron runs every 2 minutes and drains 50, so ~439 items take roughly **18 minutes**.

- [ ] **Step 1: Wait ~5 minutes, then confirm the queue is actually shrinking.**

```sql
select (select count(*) from public.item_embed_queue)  as remaining,
       (select count(*) from public.item_embeddings)   as embedded;
```

Expected after ~5 min: `remaining` down by roughly 100–150, `embedded` up by the same. **If `remaining` is unchanged after two sweep windows, the sweep is silently skipping** — go to Step 2.

- [ ] **Step 2 (only if not draining): read the cron's own record.**

```sql
select jobid, runid, status, return_message, start_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'embed-sweep')
order by start_time desc limit 5;
```

A `status = 'succeeded'` with the queue unmoved means the Vault lookup returned null (A1 Step 1 lied or the secret is empty-string) or the endpoint is rejecting the signature (A1 Step 4). Re-run A1 before touching anything else.

- [ ] **Step 3: Confirm full drain.** Expected end state: `remaining = 0`, `embedded ≈ live_items`.

- [ ] **Step 4: Verify the user-visible claim is now true.** In prod, open any board item and confirm **Find similar items** returns results. This is the acceptance test for the whole phase — the queue emptying is necessary but not sufficient.

---

# Phase B — Promote `develop → main`

**Precondition: Phase A Step A3.4 passed.** The promotion publishes 133 lines of changelog including _"Find similar items"_ and _"Ask AI searches by meaning"_. Promoting before the drain ships a false claim to users.

**What this promotion actually contains:** `65 files, +523/−851` in `src/`, **zero migrations**, no user-facing behavior change. It is a net deletion — it removes five dead `"use server"` endpoints (`renamePortfolio`, `deletePortfolio`, `updatePortfolioMapping`, `reorderGoal`, `askPulse`) from production. Delaying it keeps those live.

> **Sequencing note (recorded 2026-08-01, after Phase C began).** Phase C is not blocked on anything and Phase A is blocked on the owner, so **Phase C merges into `develop` as soon as it is green rather than waiting for this promotion** — holding a green branch open only invites rebase conflicts. The consequence: this promotion will almost certainly carry Phase C too, so the description above is no longer complete. It becomes _documentation, plus two more dead endpoints removed from production, plus the new server-action test coverage_. Still no behavior change, still safe. The inverse ordering — holding C back to keep the promotion "clean" — would buy a tidier changelog entry at the cost of leaving two live bulk hard-delete endpoints in production for another cycle, and is the wrong trade.

- [ ] **Step 1: Confirm `develop` is green and synced.**

```bash
git fetch origin
git -C . status --short          # expect: no unexpected modifications
git rev-parse develop origin/develop   # expect: identical shas
```

- [ ] **Step 2: Run the promotion.** Use the existing skill — it opens the `develop → main` PR and watches CI:

```
/promote
```

- [ ] **Step 3: Confirm the Vercel production deploy actually ran.** A commit authored under the wrong email makes Vercel skip silently. Confirm a new production deployment appears and succeeds.

- [ ] **Step 4: Spot-check prod.** Load the changelog surface and confirm the 19 entries render.

---

# Phase C — Debt paydown

Run in a worktree: `scripts/start-task.sh debt-paydown`, then `EnterWorktree({ path: ".claude/worktrees/debt-paydown" })`.

## Scope decisions (read before starting)

The audit reported "10 untested server-action modules." Verification narrowed that:

| Module                                             | Verdict                                                                                                                                                                                                                                                               |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/boards/spreadsheet/structure-validate.ts` | **Not an endpoint** — `"use server"` appears only in a comment. Pure function. Test anyway (Task C8, cheap).                                                                                                                                                          |
| `src/lib/mcp/tools/shared.ts`                      | **Not an endpoint** — same comment match. Out of scope.                                                                                                                                                                                                               |
| `src/lib/platform/search-action.ts`                | **Deliberately skipped.** 45 lines of one-line delegations to `src/lib/platform/actions.ts`, which already has four test files including `guard.test.ts` covering the `isPlatformAdmin` fail-closed path. Tests here would assert that a pass-through passes through. |

That leaves **seven** modules genuinely needing tests, plus the two orphaned endpoints and the ledger gate.

**Test depth:** each task adds representative coverage — invalid input rejected _before_ any DB call, the happy path, and error propagation — not exhaustive per-branch coverage. This is the level the existing `view-actions.test.ts` sets, and matching the house standard matters more than maximizing count.

---

### Task C1: Remove the two orphaned `"use server"` endpoints

`bulkDeleteItems` and `bulkPurgeItems` are referenced only by their own test file. `bulkDeleteItems` carries its own removal condition in a comment — _"Retained until callers move to the reversible bulkArchiveItems below"_ — and callers have moved: `use-bulk-mutations.ts` wires archive/restore/move/setCell only. Both still compile to live POST endpoints with stable action IDs. This is gotcha-66's exact shape, and one of the two is a bulk hard-delete.

**Files:**

- Modify: `src/lib/boards/bulk-actions.ts:62-74` (remove `bulkDeleteItems`), `:103-114` (remove `bulkPurgeItems`)
- Modify: `src/lib/boards/bulk-actions.ts:14,19` (drop the two now-unused schema imports)
- Modify: `src/lib/validations/board-actions.ts:65,81` (remove `bulkDeleteItemsSchema`, `bulkPurgeItemsSchema`)
- Modify: `src/lib/boards/bulk-actions.test.ts` (remove the two `describe` blocks and the two imports)

**Interfaces:**

- Consumes: nothing.
- Produces: `src/lib/boards/bulk-actions.ts` exporting exactly `bulkArchiveItems`, `bulkRestoreItems`, `bulkMoveItems`, `bulkSetCell` (plus the `BulkOutcome` type).

- [ ] **Step 1: Prove they are unreferenced before deleting.**

```bash
grep -rn "bulkDeleteItems\|bulkPurgeItems" src/
```

Expected: hits only in `bulk-actions.ts`, `bulk-actions.test.ts`, and `validations/board-actions.ts`. **If any other file appears, stop** — a caller exists and this task's premise is wrong.

- [ ] **Step 2: Remove the two exported functions** from `src/lib/boards/bulk-actions.ts`, including the doc comment above each.

- [ ] **Step 3: Remove the two now-unused schema imports** from the import block at the top of `bulk-actions.ts`, and the two schema declarations from `src/lib/validations/board-actions.ts`:

```ts
export const bulkDeleteItemsSchema = z.object({ itemIds: bulkItemIds });
export const bulkPurgeItemsSchema = z.object({ itemIds: bulkItemIds });
```

- [ ] **Step 4: Remove their tests.** Delete the `describe("bulkDeleteItems", …)` and `describe("bulkPurgeItems", …)` blocks from `bulk-actions.test.ts`, and drop `bulkDeleteItems` / `bulkPurgeItems` from its import list. Leave the `deleteItem` and `purgeItem` mocks in place only if a surviving test still uses them — otherwise remove those too.

- [ ] **Step 5: Run the suite for this file.**

```bash
pnpm vitest run --project unit src/lib/boards/bulk-actions.test.ts
```

Expected: PASS, with the remaining four `describe` blocks green.

- [ ] **Step 6: Confirm nothing else broke.**

```bash
pnpm typecheck
```

Expected: 0 errors. A failure here means a caller existed that Step 1 missed.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/boards/bulk-actions.ts src/lib/boards/bulk-actions.test.ts src/lib/validations/board-actions.ts
git commit -m "refactor(boards): remove the orphaned bulk hard-delete endpoints

bulkDeleteItems and bulkPurgeItems had zero call sites outside their own
test, yet each compiled to a live POST endpoint with a stable action id.
bulkDeleteItems documented its own removal condition -- retained until
callers move to bulkArchiveItems -- and callers moved when the soft-delete
work landed. Same shape as gotcha-66; one of the two was a bulk hard delete.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task C2: Restore the `db:ledger-check` gate

`pnpm db:ledger-check` has not run for two sessions because `psql` is not on PATH. It does **not** fail silently — `scripts/finish-task.sh:129-137` treats exit 3 as a loud non-blocking warning, deliberately, so a network blip can't wedge every future task. The fix is configuration, not installation: `psql` is already present at `/c/Program Files/PostgreSQL/17/bin/psql.exe`, and `scripts/check-migration-ledger.mjs:338` reads a `PG_BIN` override.

**Files:**

- Modify: `.env.prod.local` (untracked, machine-local — create if absent)

**Interfaces:**

- Consumes: nothing.
- Produces: a working `pnpm db:ledger-check` on this machine. No tracked-file change.

- [ ] **Step 1: Confirm the gate is currently broken and why.**

```bash
pnpm db:ledger-check; echo "exit=$?"
```

Expected: exit `3` with "psql not found on PATH (set PG_BIN in .env.prod.local)".

- [ ] **Step 2: Point `PG_BIN` at the existing install.** Append to `.env.prod.local` (note: no trailing slash, and the path contains a space, so quote it):

```
PG_BIN="C:\Program Files\PostgreSQL\17\bin"
```

- [ ] **Step 3: Re-run and confirm it now actually checks.**

```bash
pnpm db:ledger-check; echo "exit=$?"
```

Expected: exit `0` ("ok"). Exit `2` means genuine ledger drift — that is a real finding, stop and report it rather than working around it. Exit `3` again means the path is wrong.

- [ ] **Step 4: Record the requirement so the next machine doesn't rediscover it.** Add one line to `CONTRIBUTING.md` under the migrations section noting that `db:ledger-check` needs `psql` on PATH or `PG_BIN` set in `.env.prod.local`.

- [ ] **Step 5: Commit** (only `CONTRIBUTING.md` — `.env.prod.local` is untracked and must stay that way).

```bash
git add CONTRIBUTING.md
git commit -m "docs(contributing): note the PG_BIN requirement for db:ledger-check

The ledger gate exits 3 (could-not-check) when psql is absent from PATH.
finish-task.sh treats that as a non-blocking warning by design, so the
check can go unrun for sessions without anyone noticing. Document the
PG_BIN escape hatch the script already supports.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task C3: Test `src/app/oauth/consent/actions.ts`

Highest-value test target in this phase: `approveConsent` issues OAuth authorization codes and is the only thing standing between a malicious `redirect_uri` and a leaked code. It already validates against the registered client's `redirect_uris` — that guard is correct and **untested**, which means a future refactor can silently remove it.

**Files:**

- Create: `src/app/oauth/consent/actions.test.ts`

**Interfaces:**

- Consumes: `approveConsent(formData: FormData): Promise<void>` from `./actions`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const requireUser = vi.fn();
const getOauthClient = vi.fn();
const createAuthorizationCode = vi.fn();
const redirect = vi.fn();

vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/mcp/oauth/client-store", () => ({
  getOauthClient: (...a: unknown[]) => getOauthClient(...a),
}));
vi.mock("@/lib/mcp/oauth/code-store", () => ({
  createAuthorizationCode: (...a: unknown[]) => createAuthorizationCode(...a),
}));
vi.mock("next/navigation", () => ({
  redirect: (...a: unknown[]) => redirect(...a),
}));

import { approveConsent } from "./actions";

const VALID_REDIRECT = "https://client.example.com/callback";

function form(over: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("client_id", "client-1");
  fd.set("redirect_uri", VALID_REDIRECT);
  fd.set("code_challenge", "a".repeat(43));
  fd.set("response_type", "code");
  fd.set("state", "xyz");
  for (const [k, v] of Object.entries(over)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "user-1" });
  getOauthClient.mockResolvedValue({ redirect_uris: [VALID_REDIRECT] });
  createAuthorizationCode.mockResolvedValue("the-code");
});

describe("approveConsent", () => {
  it("refuses a redirect_uri the client did not register", async () => {
    await expect(
      approveConsent(form({ redirect_uri: "https://evil.example.com/steal" })),
    ).rejects.toThrow(/Unknown client or redirect_uri/);
    expect(createAuthorizationCode).not.toHaveBeenCalled();
  });

  it("refuses an unknown client_id", async () => {
    getOauthClient.mockResolvedValue(null);
    await expect(approveConsent(form())).rejects.toThrow(
      /Unknown client or redirect_uri/,
    );
    expect(createAuthorizationCode).not.toHaveBeenCalled();
  });

  it("issues a code and redirects with code + state on the happy path", async () => {
    await approveConsent(form());
    expect(createAuthorizationCode).toHaveBeenCalledWith({
      clientId: "client-1",
      userId: "user-1",
      redirectUri: VALID_REDIRECT,
      codeChallenge: "a".repeat(43),
    });
    const target = new URL(redirect.mock.calls[0][0] as string);
    expect(target.origin + target.pathname).toBe(VALID_REDIRECT);
    expect(target.searchParams.get("code")).toBe("the-code");
    expect(target.searchParams.get("state")).toBe("xyz");
  });

  it("rejects a malformed request before looking up the client", async () => {
    await expect(approveConsent(form({ client_id: "" }))).rejects.toThrow(
      /Invalid authorization request/,
    );
    expect(getOauthClient).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails for the right reason.**

```bash
pnpm vitest run --project unit src/app/oauth/consent/actions.test.ts
```

Expected: fails on mock/shape mismatch, **not** on the redirect_uri assertion. If the redirect_uri test fails, the guard is broken — that is a real security finding, stop and report it.

- [ ] **Step 3: Adjust the mocks to match reality.** Read `src/lib/validations/mcp-oauth.ts` and align the `form()` fixture with `authorizeRequestSchema`'s actual required fields. Do not weaken an assertion to make it pass.

- [ ] **Step 4: Run to green.**

```bash
pnpm vitest run --project unit src/app/oauth/consent/actions.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit.**

```bash
git add src/app/oauth/consent/actions.test.ts
git commit -m "test(oauth): cover the consent redirect_uri and client guards

approveConsent issues authorization codes and validates redirect_uri
against the client's registered list. That guard was correct but untested,
so a refactor could have removed it silently.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task C4: Test `src/lib/boards/actions/board.ts`

Nine actions including `deleteBoard`, `archiveBoard`, `purgeBoard`. 295 lines, zero tests.

**Files:**

- Create: `src/lib/boards/actions/board.test.ts`

**Interfaces:**

- Consumes: `createBoard`, `renameBoard`, `reorderBoard`, `deleteBoard`, `archiveBoard`, `restoreBoard`, `purgeBoard`, `duplicateBoard`, `createBoardFromTemplate` from `./board`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test.** Mirrors the mock shape in `src/lib/boards/view-actions.test.ts`.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
const invalidateMyBoards = vi.fn();
const updateTag = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc, from }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
  updateTag: (...a: unknown[]) => updateTag(...a),
}));
vi.mock("@/lib/boards/actions/internal", () => ({
  invalidateMyBoards: () => invalidateMyBoards(),
}));
vi.mock("@/lib/auth/session", () => ({ getUser: async () => ({ id: "u1" }) }));

import { createBoard, renameBoard } from "./board";

const WS_ID = "11111111-1111-4111-8111-111111111111";
const BOARD_ID = "22222222-2222-4222-8222-222222222222";

/** `.from("x").update({…}).eq("id", …)` resolving to `{ error }`. */
function updateChain(error: unknown = null) {
  const eq = vi.fn().mockResolvedValue({ error });
  return { chain: { update: () => ({ eq }) }, eq };
}

/** `.from("x").select("y").eq("z", …)` resolving to `{ data }`. */
function selectChain(data: unknown[] = []) {
  return { select: () => ({ eq: vi.fn().mockResolvedValue({ data }) }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockReset();
  from.mockReset();
});

describe("createBoard", () => {
  it("rejects an invalid workspace id without calling the RPC", async () => {
    const res = await createBoard({ workspaceId: "nope", name: "B" });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls create_board and returns the new id", async () => {
    rpc.mockResolvedValue({ data: { id: "b1" }, error: null });
    const res = await createBoard({ workspaceId: WS_ID, name: "Roadmap" });
    expect(rpc).toHaveBeenCalledWith("create_board", {
      p_workspace_id: WS_ID,
      p_name: "Roadmap",
    });
    expect(res).toEqual({ ok: true, data: { boardId: "b1" } });
    expect(invalidateMyBoards).toHaveBeenCalled();
  });

  it("propagates the RPC error and does not invalidate the cache", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    const res = await createBoard({ workspaceId: WS_ID, name: "Roadmap" });
    expect(res).toEqual({ ok: false, error: "denied" });
    expect(invalidateMyBoards).not.toHaveBeenCalled();
  });
});

describe("renameBoard", () => {
  it("expires every board_members grantee's shared-boards tag", async () => {
    const { chain } = updateChain(null);
    from.mockImplementation((table: string) =>
      table === "boards"
        ? chain
        : selectChain([{ user_id: "u2" }, { user_id: "u3" }]),
    );
    const res = await renameBoard({ boardId: BOARD_ID, name: "New" });
    expect(res.ok).toBe(true);
    expect(updateTag).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledWith(`/boards/${BOARD_ID}`);
  });

  it("propagates an update error before any tag work", async () => {
    const { chain } = updateChain({ message: "rls" });
    from.mockReturnValue(chain);
    const res = await renameBoard({ boardId: BOARD_ID, name: "New" });
    expect(res).toEqual({ ok: false, error: "rls" });
    expect(updateTag).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it.**

```bash
pnpm vitest run --project unit src/lib/boards/actions/board.test.ts
```

Expected: FAIL — the mock chains will not match on the first attempt.

- [ ] **Step 3: Align the chain helpers with the real call shapes.** Read `src/lib/boards/actions/board.ts:77-116` and adjust `updateChain`/`selectChain` until they mirror the actual builder calls. Add mocks for `@/lib/boards/queries`, `@/lib/boards/templates`, `@/lib/boards/template-payload`, and `@/lib/collaboration/attachment-cleanup` **only** when a test you are writing reaches them.

- [ ] **Step 4: Run to green.** Expected: 5 passed.

- [ ] **Step 5: Extend to the destructive three.** Add one `describe` each for `archiveBoard`, `restoreBoard`, and `purgeBoard`, asserting for each: an invalid `boardId` is rejected before any DB call, and a DB error propagates as `{ ok: false }`. These are the actions where a silent regression is most costly.

- [ ] **Step 6: Run to green.**

```bash
pnpm vitest run --project unit src/lib/boards/actions/board.test.ts
```

- [ ] **Step 7: Commit.**

```bash
git add src/lib/boards/actions/board.test.ts
git commit -m "test(boards): cover the board server actions

295 lines and nine actions -- including deleteBoard, archiveBoard and
purgeBoard -- had no direct test. Covers input rejection before any DB
call, the create/rename happy paths, error propagation, and the
shared-boards tag fan-out on rename.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task C5: Test `src/lib/boards/actions/column.ts`

Eight actions, 240 lines. Every mutating action funnels through a `columnBoardId` lookup that returns `null` for a column the caller cannot see — the org-scoping choke point, and untested.

**Files:**

- Create: `src/lib/boards/actions/column.test.ts`

**Interfaces:**

- Consumes: `createColumn`, `renameColumn`, `resizeColumn`, `reorderColumn`, `resizeNameColumn`, `updateColumnSettings`, `removeColumnOption`, `deleteColumn` from `./column`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
}));

import { renameColumn, resizeColumn } from "./column";

const COLUMN_ID = "33333333-3333-4333-8333-333333333333";
const BOARD_ID = "44444444-4444-4444-8444-444444444444";

/** The `columnBoardId` lookup: `.from("columns").select(...).eq(...).single()`. */
function boardIdLookup(boardId: string | null) {
  return {
    select: () => ({
      eq: () => ({
        single: vi.fn().mockResolvedValue({
          data: boardId ? { board_id: boardId } : null,
          error: boardId ? null : { message: "not found" },
        }),
      }),
    }),
  };
}

function updateOk(error: unknown = null) {
  return { update: () => ({ eq: vi.fn().mockResolvedValue({ error }) }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  from.mockReset();
});

describe("renameColumn", () => {
  it("rejects an invalid column id before touching the database", async () => {
    const res = await renameColumn({ columnId: "nope", name: "Status" });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("fails closed when the column is not visible to the caller", async () => {
    from.mockReturnValue(boardIdLookup(null));
    const res = await renameColumn({ columnId: COLUMN_ID, name: "Status" });
    expect(res).toEqual({ ok: false, error: "Column not found." });
  });

  it("updates the name once the column resolves", async () => {
    let call = 0;
    from.mockImplementation(() =>
      ++call === 1 ? boardIdLookup(BOARD_ID) : updateOk(),
    );
    const res = await renameColumn({ columnId: COLUMN_ID, name: "Status" });
    expect(res.ok).toBe(true);
  });
});

describe("resizeColumn", () => {
  it("fails closed when the column is not visible to the caller", async () => {
    from.mockReturnValue(boardIdLookup(null));
    const res = await resizeColumn({ columnId: COLUMN_ID, width: 200 });
    expect(res).toEqual({ ok: false, error: "Column not found." });
  });

  it("propagates an update error", async () => {
    let call = 0;
    from.mockImplementation(() =>
      ++call === 1 ? boardIdLookup(BOARD_ID) : updateOk({ message: "rls" }),
    );
    const res = await resizeColumn({ columnId: COLUMN_ID, width: 200 });
    expect(res).toEqual({ ok: false, error: "rls" });
  });
});
```

- [ ] **Step 2: Run it.**

```bash
pnpm vitest run --project unit src/lib/boards/actions/column.test.ts
```

Expected: FAIL. Read `columnBoardId` in `src/lib/boards/actions/column.ts` and align `boardIdLookup` with its real builder chain.

- [ ] **Step 3: Run to green.** Expected: 5 passed.

- [ ] **Step 4: Add the `deleteColumn` fail-closed case** — same `boardIdLookup(null)` shape, asserting no delete is issued when the column does not resolve.

- [ ] **Step 5: Run to green, then commit.**

```bash
git add src/lib/boards/actions/column.test.ts
git commit -m "test(boards): cover the column server actions

Every mutating column action funnels through a columnBoardId lookup that
returns null for a column the caller cannot see. That fail-closed path was
the org-scoping choke point and had no test.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task C6: Test `src/lib/portfolios/actions.ts` and `src/lib/workload/actions.ts`

Grouped: 121 + 74 lines, seven actions, same mock shape, and neither is large enough to warrant its own review gate.

**Files:**

- Create: `src/lib/portfolios/actions.test.ts`
- Create: `src/lib/workload/actions.test.ts`

**Interfaces:**

- Consumes: `createPortfolio`, `addBoardToPortfolio`, `removePortfolioBoard`, `updatePortfolioPlacement`, `getStatusColumnsForBoard` from `@/lib/portfolios/actions`; `upsertMemberCapacity`, `setWorkloadDefaults` from `@/lib/workload/actions`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Read both modules** and note for each action whether it goes through `supabase.rpc(...)` or a `.from(...)` builder chain. The mock shape follows from that — `rpc` mocks are a single `mockResolvedValue`; builder chains need a helper like Task C5's.

- [ ] **Step 2: Write `src/lib/portfolios/actions.test.ts`** with, for each of the five actions: one test that an invalid UUID is rejected before any DB call, and one that a DB error surfaces as `{ ok: false, error }`. Use the `vi.mock("@/lib/supabase/server", …)` header from Task C4 verbatim.

- [ ] **Step 3: Run it.**

```bash
pnpm vitest run --project unit src/lib/portfolios/actions.test.ts
```

Expected: green, 10 tests.

- [ ] **Step 4: Write `src/lib/workload/actions.test.ts`** covering `upsertMemberCapacity` (invalid id rejected; capacity persisted on the happy path; error propagated) and `setWorkloadDefaults` (same three).

- [ ] **Step 5: Run it.**

```bash
pnpm vitest run --project unit src/lib/workload/actions.test.ts
```

Expected: green, 6 tests.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/portfolios/actions.test.ts src/lib/workload/actions.test.ts
git commit -m "test(portfolios,workload): cover the untested server actions

Seven actions across two modules had no direct test. Covers input
rejection before any DB call and error propagation for each.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task C7: Test `src/lib/ai/agentic/actions.ts` and `src/lib/boards/board-payload-action.ts`

**Files:**

- Create: `src/lib/ai/agentic/actions.test.ts`
- Create: `src/lib/boards/board-payload-action.test.ts`

**Interfaces:**

- Consumes: the single exported action from each module.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write `src/lib/boards/board-payload-action.test.ts`** — small but worth pinning, because `fetchBoardPayload` returning `null` on a bad id is what stops the board cache clearing itself on a malformed resync.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getBoardPayload = vi.fn();
vi.mock("@/lib/boards/queries", () => ({
  getBoardPayload: (...a: unknown[]) => getBoardPayload(...a),
}));

import { fetchBoardPayload } from "./board-payload-action";

const BOARD_ID = "55555555-5555-4555-8555-555555555555";

beforeEach(() => vi.clearAllMocks());

describe("fetchBoardPayload", () => {
  it("returns null for a malformed board id without querying", async () => {
    expect(await fetchBoardPayload("not-a-uuid")).toBeNull();
    expect(getBoardPayload).not.toHaveBeenCalled();
  });

  it("delegates to the bounded getBoardPayload read", async () => {
    getBoardPayload.mockResolvedValue({ board: { id: BOARD_ID } });
    const res = await fetchBoardPayload(BOARD_ID);
    expect(getBoardPayload).toHaveBeenCalledWith(BOARD_ID);
    expect(res).toEqual({ board: { id: BOARD_ID } });
  });

  it("passes through null when the board is no longer visible", async () => {
    getBoardPayload.mockResolvedValue(null);
    expect(await fetchBoardPayload(BOARD_ID)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it.**

```bash
pnpm vitest run --project unit src/lib/boards/board-payload-action.test.ts
```

Expected: 3 passed.

- [ ] **Step 3: Read `src/lib/ai/agentic/actions.ts`** and identify its single exported action, its Zod schema, and every collaborator it calls.

- [ ] **Step 4: Write `src/lib/ai/agentic/actions.test.ts`** covering: invalid input rejected before any model or DB work; the happy path delegating with the parsed values; a collaborator error surfacing as `{ ok: false }`. Mock the AI gateway rather than letting any test reach a live model.

- [ ] **Step 5: Run to green, then commit.**

```bash
git add src/lib/ai/agentic/actions.test.ts src/lib/boards/board-payload-action.test.ts
git commit -m "test(ai,boards): cover the agentic and board-payload actions

Both were live endpoints with no direct test. board-payload-action's
null-on-bad-id path is what keeps the board cache from clearing itself
on a malformed resync.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task C8: Test `findStructureValidationError`

Not an endpoint — a pure function whose own doc comment says it lives in a separate module _"so it can be exported for unit testing"_. It was never tested. Cheapest task here and the one with the clearest intent.

**Files:**

- Create: `src/lib/boards/spreadsheet/structure-validate.test.ts`

**Interfaces:**

- Consumes: `findStructureValidationError(table, groups, structure): string | null`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the test.**

```ts
import { describe, it, expect } from "vitest";
import { findStructureValidationError } from "./structure-validate";
import type { ParsedTable, ImportGroup, RowStructureEntry } from "./types";

const groups: ImportGroup[] = [{ key: "g1" } as ImportGroup];
const table = (rowIndices: number[]) => ({ rowIndices }) as ParsedTable;
const entry = (
  gridIndex: number,
  type: "item" | "subitem",
  groupKey = "g1",
): RowStructureEntry => ({ gridIndex, type, groupKey }) as RowStructureEntry;

describe("findStructureValidationError", () => {
  it("returns null when every subitem follows an item in its group", () => {
    const res = findStructureValidationError(table([0, 1]), groups, [
      entry(0, "item"),
      entry(1, "subitem"),
    ]);
    expect(res).toBeNull();
  });

  it("flags a subitem with no item above it, using 1-based row numbers", () => {
    const res = findStructureValidationError(table([0]), groups, [
      entry(0, "subitem"),
    ]);
    expect(res).toContain("1 subitem row(s)");
    expect(res).toContain("row 1");
  });

  it("scopes the parent check per group", () => {
    const res = findStructureValidationError(
      table([0, 1]),
      [{ key: "g1" }, { key: "g2" }] as ImportGroup[],
      [entry(0, "item", "g1"), entry(1, "subitem", "g2")],
    );
    expect(res).toContain("row 2");
  });

  it("truncates to five rows and reports the overflow count", () => {
    const idx = [0, 1, 2, 3, 4, 5, 6];
    const res = findStructureValidationError(
      table(idx),
      groups,
      idx.map((i) => entry(i, "subitem")),
    );
    expect(res).toContain("+2 more");
  });
});
```

- [ ] **Step 2: Run it.**

```bash
pnpm vitest run --project unit src/lib/boards/spreadsheet/structure-validate.test.ts
```

Expected: 4 passed. If the type casts fight you, read `./types` and build real fixtures rather than widening the casts.

- [ ] **Step 3: Commit.**

```bash
git add src/lib/boards/spreadsheet/structure-validate.test.ts
git commit -m "test(import): cover the orphan-subitem structure guard

The module's own comment says it was split out so it could be unit
tested; it never was. Covers the happy path, the orphan case, per-group
scoping, and the five-row truncation.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task C9: Close the branch

- [ ] **Step 1: Run all four gates.**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: typecheck 0 errors · lint exactly **1** warning (the deliberate `max-lines` tripwire) · test all green with the suite count **up** from 3669 by the number of tests added · build succeeds.

- [ ] **Step 2: Confirm the orphan detector is now clean.** Re-run the check that found this debt:

```bash
for f in $(grep -rl '"use server"' src/ --include="*.ts" | grep -v "\.test\."); do
  head -1 "$f" | grep -q '"use server"' || continue
  for fn in $(grep -oE "^export (async )?function ([a-zA-Z0-9_]+)" "$f" | awk '{print $NF}'); do
    base=$(echo "$f" | sed 's/\.ts$//')
    hits=$(grep -rl "\b$fn\b" src/ --include="*.ts" --include="*.tsx" | grep -v "^$f$" | grep -v "^$base\.test\.ts$" | wc -l)
    [ "$hits" -eq 0 ] && echo "STILL UNCALLED: $fn ($f)"
  done
done
```

Expected: no output.

- [ ] **Step 3: Finish.**

```bash
scripts/finish-task.sh
```

This rebases onto the latest `develop`, re-runs the gates against the merged state, runs the ledger check (now working, per Task C2), merges, pushes, and removes the worktree.

- [ ] **Step 4: Confirm closure.** `git worktree list` must not show `debt-paydown`, and `git branch -a` must not show `task/debt-paydown`. If either remains, the task is **not** complete — say so explicitly.

- [ ] **Step 5: Hand over the manual-test guide.** Phase C changes no user-facing behavior — it removes two endpoints that had no UI and adds tests. The correct handover line is: _"No user-facing behaviour to test — verified by the gates, with the suite count up from 3669 and the orphaned-endpoint detector clean."_

---

## Execution DAG

**Dependency graph**

```
A1 ──> A2 ──> A3 ──> B(promote)          [owner-executed, strictly sequential]

C1 ─┐
C2 ─┤
C3 ─┤
C4 ─┼──> C9 (close)                      [C1–C8 mutually independent]
C5 ─┤
C6 ─┤
C7 ─┤
C8 ─┘
```

**Parallel batches**

| Batch | Tasks                          | Notes                                                                       |
| ----- | ------------------------------ | --------------------------------------------------------------------------- |
| 1     | A1 → A2 → A3                   | Sequential by nature; each step gates the next. Owner-executed.             |
| 2     | B                              | Blocked on A3 Step 4 passing.                                               |
| 3     | C1, C2, C3, C4, C5, C6, C7, C8 | **Eight-way parallel.** Every task creates or modifies a disjoint file set. |
| 4     | C9                             | Barrier — needs all of batch 3 merged.                                      |

**Critical path:** `A1 → A2 → A3 (~18 min of cron drain) → B → C9`. Phase C's batch 3 is _not_ on it — those eight tasks can run concurrently with Phase A's waiting, since they touch no production state and no file Phase A or B touches. If you dispatch batch 3 in parallel, use `superpowers:dispatching-parallel-agents`; the tasks are file-disjoint so a single shared worktree is sufficient — per-task worktrees would be overhead with no benefit.

**The one ordering constraint that matters:** C9's `finish-task.sh` rebases onto `develop`. If the promotion (B) has already merged `develop → main`, that is a no-op for C. If C finishes _before_ B, the promotion simply carries C's commits too — also fine, but then B's "net deletion, no behavior change" description no longer holds and the promotion note should say so.

---

## Self-review

**Spec coverage.** Audit finding → task: orphaned endpoints → C1. Ledger gate → C2. Eight untested endpoint modules → C3 (oauth), C4 (board), C5 (column), C6 (portfolios + workload), C7 (agentic + board-payload); `platform/search-action.ts` deliberately skipped with rationale. The two comment-match modules → C8 covers `structure-validate.ts`; `mcp/tools/shared.ts` is out of scope as it is not an endpoint. Prod embedding backfill → A1–A3. Promotion → B. Unused type exports and `as unknown as` casts are **not** covered — both were assessed as cheap surface and deliberately left standing; re-opening them is a separate decision.

**Placeholders.** None. Every code step carries runnable code; the three steps that say "read the module first" (C6 Step 1, C7 Step 3, C4 Step 3) are genuine investigation steps whose output shapes the following step, not deferred work.

**Type consistency.** `ActionResult` shape is `{ ok: true, data }` / `{ ok: false, error }` throughout, matching `src/lib/actions/result.ts`. The `boardIdLookup` helper name is used consistently in C5. All fixture UUIDs are v4-shaped. `updateChain`/`selectChain` in C4 and `updateOk` in C5 are deliberately separate helpers in separate files — no shared test util is introduced, matching the codebase's existing per-file mock style.

**Known soft spot.** C4, C5, C6 and C7 each contain a "align the mocks with the real call shapes" step, because Supabase builder chains cannot be mocked accurately without reading the exact call sequence. Those steps are where the time will actually go. They are honest about that rather than pretending the first-draft mocks will pass.
