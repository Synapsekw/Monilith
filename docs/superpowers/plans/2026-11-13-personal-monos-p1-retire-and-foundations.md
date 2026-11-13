# Personal Monos, Plan 1: retire the old agents and lay foundations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the old agent system, delete its code without breaking kept surfaces, prove how a Mono gets its own Supabase session, and ship the colour-parameterised Mono avatar component.

**Architecture:** Spec `docs/superpowers/specs/2026-11-13-personal-monos-design.md`, units Z, X, S and V. Plan 2 (identity, owner-only rules, inbox, approvals, MCP, rail) is written after this plan merges, because unit I depends on the spike's outcome. Database tables of the old system are kept in this plan and dropped in a later plan (unit D).

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres, RLS, pg_cron, GoTrue), TypeScript strict, Vitest, React 19, Canvas 2D.

## Global Constraints

- Work happens in a worktree: `scripts/start-task.sh monos-p1`, then build inside `.claude/worktrees/monos-p1`. Implementer subagents **must not** run `scripts/finish-task.sh`, merge, push, `git stash` or switch branches. The orchestrator commits by path and finishes.
- Migrations are minted only with `scripts/new-migration.sh <slug>`, applied to DEV through the `supabase-dev` MCP `apply_migration` with the same version and name, then checked with `pnpm db:ledger-check`. DEV serves live users: no destructive experiments.
- After a migration, regenerate types with the `supabase-dev` MCP `generate_typescript_types`, write to `src/types/database.types.ts`, and run `npx prettier --write src/types/database.types.ts` (`pnpm db:types` fails in worktrees).
- Commit messages: conventional commits, lower-case subject, header at most 100 characters, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage by explicit path only.
- Every Bash call in the worktree starts with `cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/monos-p1 &&`. Run `pnpm test` in the foreground with a 600000 ms timeout.
- Gates for every task that touches code: `pnpm typecheck && pnpm lint && pnpm test`. `pnpm build` runs in Task 5 and before finishing.
- Kept and untouched: `src/lib/assistant/*` behaviour, the board dock and its Intelligence tab, `/ask`, the MCP server's tool behaviour, `src/lib/ai/*` provider layer, the landing page's Mono (`src/components/landing/assembly-mono/*`).
- User-facing copy never says "Pulse".

---

## File structure

| Path                                                              | Responsibility                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `supabase/migrations/<ts>_stop_personal_agents.sql`               | Disable all old agents, stop orchestrator seeding, unschedule both sweeps |
| `src/lib/mcp/tools/capabilities.ts`                               | Capability vocabulary (moved from `src/lib/agents/capabilities.ts`)       |
| `src/lib/assistant/target-board.ts`                               | `resolveTargetBoardId` (moved from `src/lib/agents/board-scope-guard.ts`) |
| `src/lib/assistant/proposal-summary.ts`                           | `summariseProposal` (moved from `src/lib/agents/proposal-summary.ts`)     |
| `src/lib/ai/estimate-tokens.ts`                                   | `estimateTokens` (moved from `src/lib/agents/document-budget.ts`)         |
| `src/lib/mcp/oauth/session-bridge.ts`                             | Gains exported `mintSessionForUser` and `clientFromAccessToken`           |
| `src/lib/mono/session.ts`                                         | `getMonoClient(monoUserId)`: fresh session per hour, never refreshes      |
| `vault/decisions/2026-11-13-decision-44-mono-identity-session.md` | Spike result                                                              |
| `src/components/mono/mono-palette.ts`                             | Pure colour derivation from one hex                                       |
| `src/components/mono/mono-renderer.ts`                            | Canvas renderer ported from the landing Mono, parameterised by palette    |
| `src/components/mono/mono-clock.ts`                               | One shared animation clock per page                                       |
| `src/components/mono/MonoAvatar.tsx`                              | Client component: `<MonoAvatar color mood size label />`                  |

## Execution DAG

- Task 1 (stop the old agents): no dependencies.
- Task 2 (move kept symbols): no dependencies.
- Task 3 (remove agent surfaces from /ask, dock, mentions, comments): depends on Task 2.
- Task 4 (remove settings, Autopilot, proxy and notification surfaces): depends on Task 2.
- Task 5 (delete the retire set): depends on Tasks 1, 3, 4.
- Task 6 (spike: Mono session): no dependencies.
- Task 7 (Mono avatar component): no dependencies.

**Parallel batches:** (1, 2, 6, 7), then (3, 4), then 5. Tasks 3 and 4 touch disjoint files. Parallel implementers each get their own worktree off `task/monos-p1`; the orchestrator rebases and fast-forwards them one at a time.

**Critical path:** 2, 3, 5.

---

### Task 1: Stop the old agents

**Files:**

- Create: `supabase/migrations/<ts>_stop_personal_agents.sql` (via `scripts/new-migration.sh stop_personal_agents`)
- Modify: `src/types/database.types.ts` (regenerated; may be unchanged)

**Interfaces:**

- Consumes: nothing.
- Produces: after this migration no cron job calls `/api/ai/personal-agent` or `/api/ai/autopilot`, no new `user_agents` rows are seeded, and every `user_agents` / `board_agents` row has `enabled = false`. Task 5 relies on this before deleting the routes.

- [ ] **Step 1: Confirm the objects exist on DEV (read-only)**

Run through `supabase-dev` MCP `execute_sql`:

```sql
select jobname, schedule from cron.job where jobname in ('personal-agent-sweep','autopilot-sweep');
select tgname from pg_trigger where tgname = 'org_members_seed_builtin_agent';
select count(*) filter (where enabled) as enabled_user_agents from public.user_agents;
select count(*) filter (where enabled) as enabled_board_agents from public.board_agents;
```

Expected: both jobs listed, the trigger listed, `enabled_user_agents` = 1 (Aria), `enabled_board_agents` = 0.

- [ ] **Step 2: Mint the migration and write it**

Run: `scripts/new-migration.sh stop_personal_agents`

Content:

```sql
-- Personal Monos, Plan 1 / unit Z. Stops the old agent system without
-- dropping its tables (dropped later, unit D).
--
-- 1. No more built-in orchestrator per membership: 26 were seeded, none ever ran.
drop trigger if exists org_members_seed_builtin_agent on public.org_members;
drop function if exists public.seed_builtin_agent_trigger();

-- 2. Nothing runs any more. Aria (the only real agent) has failed every
--    scheduled run since 2026-09-15 with an invalid refresh token.
update public.user_agents set enabled = false where enabled;
update public.board_agents set enabled = false where enabled;

-- 3. The hourly sweeps would otherwise keep POSTing to routes that Plan 1
--    deletes. Unschedule by name, tolerating a job that is already gone.
do $$
begin
  perform cron.unschedule(jobid) from cron.job
   where jobname in ('personal-agent-sweep', 'autopilot-sweep');
end
$$;
```

- [ ] **Step 3: Check it in a rolled-back transaction on DEV**

Run through `execute_sql` the migration body wrapped in `begin; … ; select …; rollback;` with these checks before `rollback`:

```sql
select count(*) from cron.job where jobname in ('personal-agent-sweep','autopilot-sweep'); -- expect 0
select count(*) from pg_trigger where tgname = 'org_members_seed_builtin_agent';          -- expect 0
select count(*) from public.user_agents where enabled;                                     -- expect 0
```

- [ ] **Step 4: Apply and verify the ledger**

Apply with `supabase-dev` MCP `apply_migration` using the exact version and name from the file. Run Step 1's queries again: expect no jobs, no trigger, 0 enabled. Run: `pnpm db:ledger-check`. Expected: clean.

- [ ] **Step 5: Regenerate types and commit**

Regenerate `src/types/database.types.ts` (see Global Constraints). Then:

```bash
git add supabase/migrations/*_stop_personal_agents.sql src/types/database.types.ts
git commit -m "feat(agents): stop old agent sweeps, seeding and runs"
```

---

### Task 2: Move the symbols kept code still needs

**Files:**

- Create: `src/lib/mcp/tools/capabilities.ts`, `src/lib/assistant/target-board.ts`, `src/lib/ai/estimate-tokens.ts`, `src/lib/ai/estimate-tokens.test.ts`
- Move (git mv): `src/lib/agents/proposal-summary.ts` → `src/lib/assistant/proposal-summary.ts`, and its `.test.ts`
- Modify: `src/lib/mcp/tools/descriptor.ts:4`, `src/lib/mcp/tools/descriptor.test.ts:10`, `src/lib/assistant/tools.ts:10-11`, `src/lib/assistant/catalog.ts` (capability import), `src/lib/ai/org-settings.ts:5`, `src/lib/ai/settings-actions.ts:25`, `src/lib/ai/board-snapshot.ts:2`, `src/lib/ai/board-intelligence/transcript.ts:1`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `src/lib/mcp/tools/capabilities.ts`: `export const AGENT_CAPABILITIES` (same 8 values, same order) and `export type AgentCapability`.
  - `src/lib/assistant/target-board.ts`: `export async function resolveTargetBoardId(client: SupabaseClient<Database>, descriptor: ToolDescriptor, input: Record<string, unknown>): Promise<string | null>` (identical body).
  - `src/lib/assistant/proposal-summary.ts`: `summariseProposal`, `PROPOSAL_SUMMARY_MAX_LENGTH` (unchanged).
  - `src/lib/ai/estimate-tokens.ts`: `export function estimateTokens(text: string): number`.
  - After this task no file outside `src/lib/agents`, `src/components/agents`, `src/app/api/ai/personal-agent`, `src/app/api/ai/autopilot` and `src/app/(app)/settings/agents` imports these four symbols from their old paths.

- [ ] **Step 1: Write the failing test for `estimateTokens`**

`src/lib/ai/estimate-tokens.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { estimateTokens } from "./estimate-tokens";

describe("estimateTokens", () => {
  it("rounds characters / 4 up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});
```

Run: `pnpm vitest run src/lib/ai/estimate-tokens.test.ts`. Expected: FAIL, cannot resolve `./estimate-tokens`.

- [ ] **Step 2: Create the new modules**

`src/lib/ai/estimate-tokens.ts`:

```ts
/**
 * ~4 characters per token. Crude, provider-independent, and deliberately the
 * only estimator in the codebase.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
```

`src/lib/mcp/tools/capabilities.ts`: copy `src/lib/agents/capabilities.ts` verbatim (the `AGENT_CAPABILITIES` array and the `AgentCapability` type), replacing its header comment with:

```ts
/**
 * The capability vocabulary every catalog descriptor's `capability` field
 * uses. A null capability is a read; anything else is a write, and
 * `board.destroy` is destructive (see `src/lib/assistant/catalog.ts`).
 * Free of `server-only` so client code may import it.
 */
```

`src/lib/assistant/target-board.ts`: copy `resolveTargetBoardId` and its doc comment from `src/lib/agents/board-scope-guard.ts` (lines 22 to the end of that function) with these imports, and nothing else from that file:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { scopeFor, type ToolDescriptor } from "@/lib/mcp/tools/descriptor";
import { resolveItemScope } from "@/lib/collaboration/attachment-core";
```

Then: `git mv src/lib/agents/proposal-summary.ts src/lib/assistant/proposal-summary.ts` and `git mv src/lib/agents/proposal-summary.test.ts src/lib/assistant/proposal-summary.test.ts`. Fix any relative import inside the moved test.

- [ ] **Step 3: Repoint every kept importer**

| File                                            | Old import                                | New import                     |
| ----------------------------------------------- | ----------------------------------------- | ------------------------------ |
| `src/lib/mcp/tools/descriptor.ts:4`             | `@/lib/agents/capabilities`               | `./capabilities`               |
| `src/lib/mcp/tools/descriptor.test.ts:10`       | `@/lib/agents/capabilities`               | `./capabilities`               |
| `src/lib/assistant/catalog.ts`                  | `@/lib/agents/capabilities` (if imported) | `@/lib/mcp/tools/capabilities` |
| `src/lib/assistant/tools.ts:10`                 | `@/lib/agents/board-scope-guard`          | `./target-board`               |
| `src/lib/assistant/tools.ts:11`                 | `@/lib/agents/proposal-summary`           | `./proposal-summary`           |
| `src/lib/ai/org-settings.ts:5`                  | `@/lib/agents/capabilities`               | `@/lib/mcp/tools/capabilities` |
| `src/lib/ai/settings-actions.ts:25`             | `@/lib/agents/capabilities`               | `@/lib/mcp/tools/capabilities` |
| `src/lib/ai/board-snapshot.ts:2`                | `@/lib/agents/document-budget`            | `@/lib/ai/estimate-tokens`     |
| `src/lib/ai/board-intelligence/transcript.ts:1` | `@/lib/agents/document-budget`            | `@/lib/ai/estimate-tokens`     |

Make `src/lib/agents/capabilities.ts` re-export so retire-set files keep compiling until Task 5:

```ts
export {
  AGENT_CAPABILITIES,
  type AgentCapability,
} from "@/lib/mcp/tools/capabilities";
```

In `src/lib/agents/board-scope-guard.ts`, replace the body of `resolveTargetBoardId` with a re-export: delete the function and add `export { resolveTargetBoardId } from "@/lib/assistant/target-board";`. Any `src/lib/agents/*` file importing `./proposal-summary` is repointed to `@/lib/assistant/proposal-summary`.

- [ ] **Step 4: Verify**

Run: `pnpm vitest run src/lib/ai/estimate-tokens.test.ts src/lib/assistant src/lib/mcp/tools/descriptor.test.ts`. Expected: PASS.

Run: `grep -rnE "@/lib/agents/(capabilities|board-scope-guard|proposal-summary|document-budget)" src --include=*.ts --include=*.tsx | grep -vE "^src/(lib/agents|components/agents|app/api/ai/(personal-agent|autopilot)|app/\(app\)/settings/agents)/"`. Expected: no output except `src/lib/ai/settings-actions.ts` (its `capabilitySchema` import from `agent-config` is removed in Task 4) and the `/ask` and collaboration files handled in Task 3.

Run: `pnpm typecheck && pnpm lint && pnpm test`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp/tools/capabilities.ts src/lib/assistant/target-board.ts src/lib/assistant/proposal-summary.ts src/lib/assistant/proposal-summary.test.ts src/lib/ai/estimate-tokens.ts src/lib/ai/estimate-tokens.test.ts src/lib/agents/capabilities.ts src/lib/agents/board-scope-guard.ts src/lib/agents/proposal-summary.ts src/lib/agents/proposal-summary.test.ts src/lib/mcp/tools/descriptor.ts src/lib/mcp/tools/descriptor.test.ts src/lib/assistant/tools.ts src/lib/assistant/catalog.ts src/lib/ai/org-settings.ts src/lib/ai/settings-actions.ts src/lib/ai/board-snapshot.ts src/lib/ai/board-intelligence/transcript.ts
git commit -m "refactor(agents): move symbols kept code needs out of lib/agents"
```

(Also stage any `src/lib/agents/*` file whose import was repointed in Step 3; `git status` lists them.)

---

### Task 3: Remove agent surfaces from /ask, the board dock, mentions and comments

**Files:**

- Modify: `src/app/ask/[conversationId]/page.tsx` (+ `page.test.tsx`), `src/app/ask/page.tsx`, `src/components/ai/ask/AskChat.tsx` (+ test), `src/app/api/ask/route.ts` (+ test), `src/lib/ai/ask/conversation-actions.ts`, `src/lib/ai/ask/persona-routing.ts`, `src/components/ai/ask/Composer.tsx`, `src/components/ai/ask/ThreadHeader.tsx`, `src/components/ai/ask/MessageList.tsx`
- Modify: `src/app/(app)/boards/[boardId]/page.tsx:51,151`, `src/components/boards/dock/BoardDock.tsx`, `DockBody.tsx`, `DockTiles.tsx`, `DockThreadList.tsx` (+ their tests)
- Modify: `src/lib/collaboration/mentions.ts` (+ test), `src/components/**/MentionTextarea.tsx`, `src/components/**/UpdatesTab.tsx`, `src/lib/collaboration/actions.ts` (+ test)
- Delete: `src/lib/ai/ask/agent-knowledge.ts` (+ test), `src/lib/ai/ask/owner-agents.ts` (+ test), `src/lib/rate-limit/agent-mention-rate-limit.ts` (+ test)

**Interfaces:**

- Consumes: Task 2's moved modules.
- Produces: no file in this list imports from `src/lib/agents/*`, `src/components/agents/*`, or reads `user_agents`. `MentionTarget` becomes the person-only type below; Plan 2 adds the Mono variant back with its own rules.

Decisions this task implements (from the spec: no saved agents, the org assistant unchanged):

1. `/ask` stops showing briefing-run proposals: remove `loadRunProposals`, the `agentProposals` prop, and the `ProposalCard` render (`AskChat.tsx:504-516`). Old threads still render their messages.
2. `/ask` stops composing an agent persona: in `src/app/api/ask/route.ts` remove the `user_agents` persona read (around lines 296-367) and the `agent_id` stamp (around line 466); every `/ask` turn is the org assistant. Remove persona routing (`persona-routing.ts`) and the agent pickers in `Composer.tsx`, `ThreadHeader.tsx`, `MessageList.tsx`.
3. The board dock stops showing agent tiles and the "From your agents" thread group; `boards/[boardId]/page.tsx` stops reading `user_agents`.
4. Mentions are people only until Plan 2.
5. Comments no longer summon agents: remove the agent branch from `postUpdate` in `src/lib/collaboration/actions.ts` (lines ~124-175). The return type keeps `agentRun`, `agentHandle` and `reason` out; callers that read them are updated.

- [ ] **Step 1: Write the failing tests**

In `src/lib/collaboration/mentions.test.ts` add:

```ts
import { mentionLabel, type MentionTarget } from "./mentions";

it("mentions are people only", () => {
  const t: MentionTarget = {
    kind: "user",
    userId: "u1",
    fullName: "Mira Kovač",
  };
  expect(mentionLabel(t)).toBe("@Mira Kovač");
  expect(mentionLabel({ kind: "user", userId: "u2", fullName: null })).toBe(
    "@Someone",
  );
});
```

In `src/lib/collaboration/actions.test.ts` add a test that posting an update whose body names a former agent handle succeeds, and that `user_agents` is never queried. Use the file's existing Supabase mock and assert:

```ts
expect(fromSpy).not.toHaveBeenCalledWith("user_agents");
expect(result).toEqual({ ok: true, data: { updateId: expect.any(String) } });
```

In `src/components/boards/dock/DockBody.test.tsx` add a test that renders the dock without an `agents` prop and asserts `screen.queryByText(/from your agents/i)` is null.

Run: `pnpm vitest run src/lib/collaboration src/components/boards/dock`. Expected: the new tests FAIL (types or behaviour still include agents).

- [ ] **Step 2: Make mentions person-only**

Replace the type block at the top of `src/lib/collaboration/mentions.ts` (lines 1-35) with:

```ts
/** A mention target is a person. Plan 2 adds the owner's own Mono. */
export type UserMentionTarget = {
  kind: "user";
  userId: string;
  fullName: string | null;
};
export type MentionTarget = UserMentionTarget;

/** The text a mention writes into the body, including the leading `@`. */
export function mentionLabel(target: MentionTarget): string {
  return `@${target.fullName ?? "Someone"}`;
}
```

Remove `isAgentMention` and fix every importer (`MentionTextarea.tsx`, `UpdatesTab.tsx`, `Composer.tsx`, `ThreadHeader.tsx`, `MessageList.tsx`, `persona-routing.ts`, `BoardDock.tsx`, `DockBody.tsx`, `DockTiles.tsx`) by deleting the agent branch where it is used. Find them with `grep -rn "isAgentMention\|AgentMentionTarget\|kind: \"agent\"" src`. Expected after edits: no output.

- [ ] **Step 3: Remove the comment agent trigger**

In `src/lib/collaboration/actions.ts` delete the block from `// ── The agent trigger` to just before `return {`, delete the imports of `claimAgentRun`, `ClaimOutcome`, `CLAIM_REFUSAL_COPY`, `dispatchAgentRun` and `checkAgentMentionRateLimit`, and return:

```ts
return { ok: true, data: { updateId: data.id } };
```

Update the function's result type and any caller that read `agentRun`, `agentHandle` or `reason` (find with `grep -rn "agentRun\|agentHandle" src`).

- [ ] **Step 4: Remove agent surfaces from /ask and the dock**

Apply decisions 1-3 above. Delete `src/lib/ai/ask/agent-knowledge.ts`, `owner-agents.ts`, `persona-routing.ts` and their tests once nothing imports them. Remove the corresponding `vi.mock` lines from `src/app/ask/[conversationId]/page.test.tsx` (lines 43, 47) and `AskChat.test.tsx` (line 111).

- [ ] **Step 5: Verify**

Run: `grep -rnE "@/lib/agents|@/components/agents|user_agents|owner-agents|agent-knowledge|persona-routing" src/app/ask src/app/api/ask src/components/ai src/components/boards src/lib/ai/ask src/lib/collaboration "src/app/(app)/boards"`. Expected: no output.

Run: `pnpm typecheck && pnpm lint && pnpm test`. Expected: all pass, including the new tests from Step 1.

- [ ] **Step 6: Commit**

Stage every modified and deleted path listed by `git status` for this task (explicit paths), then:

```bash
git commit -m "refactor(agents): remove agent personas, tiles and summons from ask, dock and comments"
```

---

### Task 4: Remove settings, Autopilot, proxy and notification surfaces

**Files:**

- Modify: `src/app/(app)/settings/settings-nav-groups.ts:21`, `src/app/(app)/settings/ai/page.tsx:18,143` (+ `page.test.tsx:56`), `src/lib/ai/settings-actions.ts` (remove `setAgentCapabilityCeiling` and the `capabilitySchema` import), `src/lib/ai/org-settings.ts` (stop reading `agent_capability_ceiling`), `src/components/boards/automations/AutomationsDialog.tsx:42,633`, `src/proxy.ts:72-73`, `src/proxy.test.ts:365+`, `src/lib/settings/notification-prefs.ts:16,38-40`, `src/app/(app)/settings/notifications/page.tsx`
- Delete: `src/components/settings/OrgAgentCeiling.tsx` (+ test), `src/components/settings/BriefingPreferenceForm.tsx` (+ test if present)

**Interfaces:**

- Consumes: Task 2's `src/lib/mcp/tools/capabilities.ts`.
- Produces: no file in this list imports from the retire set; `/api/ai/personal-agent` and `/api/ai/autopilot` are no longer public prefixes.

Decisions:

1. Remove the "Agent setup" nav entry. Plan 2 adds "My Mono".
2. Remove the org capability ceiling control and its action. The DB column stays until unit D.
3. Remove `<AutopilotCard>` from the automations dialog.
4. Remove the two public prefixes from `src/proxy.ts`.
5. Remove `agent_reply` from notification preferences. `NotificationsList.tsx` keeps rendering existing `agent_reply` rows (historical data).
6. Remove the briefing email preference form from the notifications settings page. The digest unsubscribe route is not changed.

- [ ] **Step 1: Write the failing tests**

In `src/proxy.test.ts`, the test that collects cron endpoints from migrations must exclude retired routes. Add:

```ts
it("does not expose retired agent routes", () => {
  for (const path of ["/api/ai/personal-agent", "/api/ai/autopilot"]) {
    expect(isPublicPath(path)).toBe(false);
  }
});
```

(Use the helper the file already uses to test `PUBLIC_PREFIXES`; if it tests through `proxy(request)`, assert the response redirects to sign-in instead.)

In `src/app/(app)/settings/ai/page.test.tsx` replace the ceiling assertion at line 56 with `expect(screen.queryByText(/agent capabilities/i)).toBeNull();`.

Run: `pnpm vitest run src/proxy.test.ts "src/app/(app)/settings/ai"`. Expected: FAIL.

- [ ] **Step 2: Implement decisions 1-6**

In `src/proxy.ts` remove the two lines `"/api/ai/autopilot",` and `"/api/ai/personal-agent",`. In `src/proxy.test.ts` (around line 365) the endpoint list derived from migration URLs must skip those two paths:

```ts
const RETIRED = new Set(["/api/ai/personal-agent", "/api/ai/autopilot"]);
// …when building the list:
.filter((path) => !RETIRED.has(path))
```

Make the remaining edits listed under Files.

- [ ] **Step 3: Verify**

Run: `grep -rnE "OrgAgentCeiling|setAgentCapabilityCeiling|AutopilotCard|BriefingPreferenceForm|/settings/agents" src --include=*.ts --include=*.tsx | grep -vE "^src/(lib/agents|components/agents|app/\(app\)/settings/agents)/"`. Expected: no output.

Run: `pnpm typecheck && pnpm lint && pnpm test`. Expected: pass.

- [ ] **Step 4: Commit**

Stage the paths from `git status` for this task explicitly, then:

```bash
git commit -m "refactor(agents): remove agent settings, autopilot card and public agent routes"
```

---

### Task 5: Delete the retire set

**Files:**

- Delete: `src/app/(app)/settings/agents/`, `src/components/agents/`, `src/lib/agents/`, `src/app/api/ai/personal-agent/`, `src/app/api/ai/autopilot/`, `src/lib/ai/agentic/autopilot.ts` (+ test), `src/lib/ai/agentic/autopilot-config.ts`, `src/lib/ai/agentic/board-agents-db.ts`, `src/lib/ai/agentic/board_agents.rls.integration.test.ts`, `src/lib/boards/autopilot-actions.ts`, `src/components/boards/automations/AutopilotCard.tsx` (+ test), `src/lib/validations/agent-documents.ts`, `src/lib/validations/agent-memory.ts` (+ test), `src/lib/documents/extract-text.ts` (+ test, `__fixtures__`), `src/lib/documents/sheet-extract-actions.ts` (+ test), `src/lib/mcp/tools/board-build-scope.test.ts`
- Modify: `src/lib/ai/agentic/context.ts` (delete `buildAgentContext` at line 79 only; keep `buildJobContext`)

**Interfaces:**

- Consumes: Tasks 1, 3, 4 (nothing kept imports the retire set; no cron calls the deleted routes).
- Produces: a codebase with no `src/lib/agents` and no `src/components/agents`.

- [ ] **Step 1: Confirm nothing kept imports the retire set**

Run:

```bash
grep -rlnE "@/lib/agents|@/components/agents|ai/agentic/(autopilot|board-agents-db)|boards/autopilot-actions|validations/agent-(documents|memory)|documents/(extract-text|sheet-extract-actions)" src \
  | grep -vE "^src/(lib/agents|components/agents|app/api/ai/(personal-agent|autopilot)|app/\(app\)/settings/agents|lib/ai/agentic/(autopilot|board-agents-db|board_agents)|lib/boards/autopilot-actions|lib/validations/agent-|lib/documents/(extract-text|sheet-extract-actions)|components/boards/automations/AutopilotCard)"
```

Expected: no output. If anything prints, fix that importer before deleting.

- [ ] **Step 2: Delete**

```bash
git rm -r "src/app/(app)/settings/agents" src/components/agents src/lib/agents src/app/api/ai/personal-agent src/app/api/ai/autopilot
git rm src/lib/ai/agentic/autopilot.ts src/lib/ai/agentic/autopilot.test.ts src/lib/ai/agentic/autopilot-config.ts src/lib/ai/agentic/board-agents-db.ts src/lib/ai/agentic/board_agents.rls.integration.test.ts src/lib/boards/autopilot-actions.ts src/components/boards/automations/AutopilotCard.tsx src/components/boards/automations/AutopilotCard.test.tsx src/lib/validations/agent-documents.ts src/lib/validations/agent-memory.ts src/lib/validations/agent-memory.test.ts src/lib/mcp/tools/board-build-scope.test.ts
git rm -r src/lib/documents/extract-text.ts src/lib/documents/extract-text.test.ts src/lib/documents/__fixtures__ src/lib/documents/sheet-extract-actions.ts src/lib/documents/sheet-extract-actions.test.ts
```

Before removing `src/lib/documents/__fixtures__`, run `grep -rn "__fixtures__" src/lib/documents` and keep any fixture a remaining test uses. Delete `buildAgentContext` from `src/lib/ai/agentic/context.ts` and any import only it used.

- [ ] **Step 3: Clean stale comments**

Update comments that point at deleted paths so readers are not sent to missing files: `src/lib/mcp/oauth/session-bridge.ts:53`, `src/lib/mcp/tools/descriptor.ts:9,54`, `src/lib/ai/agentic/hmac.ts:120-122`, `src/lib/ai/gateway.ts:136,147`, `src/lib/ai/errors.ts:18`, `src/lib/ai/models/resolve.ts:157`, `src/test/agent-tool-exec.ts` (doc comment). Comment-only edits.

- [ ] **Step 4: Run all gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Expected: all pass. A failing test that only exercised deleted code is deleted with a one-line note in the commit body; a failing test of kept behaviour is a bug to fix, not delete.

- [ ] **Step 5: Commit**

```bash
git add -u src
git commit -m "refactor(agents): delete the old personal and board agent system"
```

(`git add -u` stages only modifications and deletions of tracked files under `src`; run `git status` first and confirm every path belongs to this task.)

---

### Task 6: Spike: a Mono's own Supabase session

**Files:**

- Modify: `src/lib/mcp/oauth/session-bridge.ts` (extract and export two helpers; `mintBridgeSecret` behaviour unchanged)
- Create: `src/lib/mono/session.ts`, `src/lib/mono/session.test.ts`
- Create: `vault/decisions/2026-11-13-decision-44-mono-identity-session.md`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `src/lib/mcp/oauth/session-bridge.ts`: `export async function mintSessionForUser(userId: string): Promise<Session>` and `export function clientFromAccessToken(accessToken: string): SupabaseClient<Database>`.
  - `src/lib/mono/session.ts`: `export async function getMonoClient(monoUserId: string): Promise<SupabaseClient<Database>>` and `export function __resetMonoSessionCache(): void` (tests only).
  - The ADR records the chosen mechanism for Plan 2.

**Why this approach.** Research on 2026-11-13: nothing in the repo mints JWTs; DEV uses asymmetric ES256 signing keys whose private key cannot be exported, so minting our own tokens would require importing a key and rotating signing for every user on the live project. The existing MCP bridge (`generateLink` + `verifyOtp`) produces a real session without that change. Aria broke because it stored and rotated refresh tokens. A Mono therefore mints a fresh session when its cached access token is near expiry and never calls `refreshSession`.

- [ ] **Step 1: Write the failing test**

`src/lib/mono/session.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mint = vi.fn();
const fromToken = vi.fn((token: string) => ({ token }));
vi.mock("@/lib/mcp/oauth/session-bridge", () => ({
  mintSessionForUser: (id: string) => mint(id),
  clientFromAccessToken: (t: string) => fromToken(t),
}));

import { __resetMonoSessionCache, getMonoClient } from "./session";

const session = (token: string, expiresInSec: number) => ({
  access_token: token,
  expires_at: Math.floor(Date.now() / 1000) + expiresInSec,
});

describe("getMonoClient", () => {
  beforeEach(() => {
    __resetMonoSessionCache();
    mint.mockReset();
    fromToken.mockClear();
  });

  it("mints once and reuses the access token while it is fresh", async () => {
    mint.mockResolvedValue(session("t1", 3600));
    await getMonoClient("mono-1");
    await getMonoClient("mono-1");
    expect(mint).toHaveBeenCalledTimes(1);
    expect(fromToken).toHaveBeenLastCalledWith("t1");
  });

  it("mints a new session instead of refreshing when near expiry", async () => {
    mint
      .mockResolvedValueOnce(session("old", 60))
      .mockResolvedValueOnce(session("new", 3600));
    await getMonoClient("mono-1");
    await getMonoClient("mono-1");
    expect(mint).toHaveBeenCalledTimes(2);
    expect(fromToken).toHaveBeenLastCalledWith("new");
  });

  it("shares one in-flight mint between concurrent callers", async () => {
    mint.mockResolvedValue(session("t", 3600));
    await Promise.all([getMonoClient("mono-1"), getMonoClient("mono-1")]);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed mint", async () => {
    mint
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValueOnce(session("t", 3600));
    await expect(getMonoClient("mono-1")).rejects.toThrow("rate limited");
    await getMonoClient("mono-1");
    expect(mint).toHaveBeenCalledTimes(2);
  });
});
```

Run: `pnpm vitest run src/lib/mono/session.test.ts`. Expected: FAIL, cannot resolve `./session`.

- [ ] **Step 2: Extract the bridge helpers**

In `src/lib/mcp/oauth/session-bridge.ts`, move the `getUserById` → `generateLink` → `verifyOtp` sequence out of `mintBridgeSecret` into:

```ts
/**
 * Mints a real GoTrue session for `userId` without sending email
 * (generateLink + verifyOtp, gated behind the service-role key). The user
 * must have an email address. Callers decide whether to store anything.
 */
export async function mintSessionForUser(userId: string): Promise<Session> {
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();
  const admin = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: userRes, error: userErr } =
    await admin.auth.admin.getUserById(userId);
  if (userErr || !userRes.user?.email)
    throw new Error(userErr?.message ?? "User has no email; cannot bridge.");
  const { data: linkData, error: linkErr } =
    await admin.auth.admin.generateLink({
      type: "magiclink",
      email: userRes.user.email,
    });
  if (linkErr || !linkData)
    throw new Error(linkErr?.message ?? "generateLink failed.");
  const { data: sessionData, error: verifyErr } =
    await anonClient().auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: "magiclink",
    });
  if (verifyErr || !sessionData.session)
    throw new Error(verifyErr?.message ?? "verifyOtp failed.");
  return sessionData.session;
}
```

`mintBridgeSecret` becomes: `const session = await mintSessionForUser(userId);` followed by its existing Vault store using `payloadFromSession(session)`. Add `export` to `clientFromAccessToken`. Run `pnpm vitest run src/lib/mcp/oauth`. Expected: PASS (behaviour unchanged).

- [ ] **Step 3: Implement `getMonoClient`**

`src/lib/mono/session.ts`:

```ts
import "server-only";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  clientFromAccessToken,
  mintSessionForUser,
} from "@/lib/mcp/oauth/session-bridge";

/**
 * A request-scoped client authenticated as a Mono (a no-login bot user), so
 * RLS judges every read and write by the Mono's own memberships.
 *
 * Never refreshes. A cached access token is reused until it is within
 * REMINT_BUFFER_MS of expiry, then a brand-new session is minted. Nothing is
 * stored outside this process, so there is no refresh token to rotate,
 * race or lose (the failure that silently broke the old scheduled agents).
 */
const REMINT_BUFFER_MS = 5 * 60 * 1000;

type Cached = { accessToken: string; expiresAt: number };
const cache = new Map<string, Cached>();
const inflight = new Map<string, Promise<Cached>>();

function toCached(session: Session): Cached {
  const expiresAt = session.expires_at
    ? session.expires_at * 1000
    : Date.now() + (session.expires_in ?? 3600) * 1000;
  return { accessToken: session.access_token, expiresAt };
}

async function freshToken(monoUserId: string): Promise<Cached> {
  const hit = cache.get(monoUserId);
  if (hit && hit.expiresAt - Date.now() > REMINT_BUFFER_MS) return hit;
  const pending = inflight.get(monoUserId);
  if (pending) return pending;
  const p = mintSessionForUser(monoUserId)
    .then((s) => {
      const c = toCached(s);
      cache.set(monoUserId, c);
      return c;
    })
    .finally(() => inflight.delete(monoUserId));
  inflight.set(monoUserId, p);
  return p;
}

export async function getMonoClient(
  monoUserId: string,
): Promise<SupabaseClient<Database>> {
  const { accessToken } = await freshToken(monoUserId);
  return clientFromAccessToken(accessToken);
}

export function __resetMonoSessionCache(): void {
  cache.clear();
  inflight.clear();
}
```

Run: `pnpm vitest run src/lib/mono/session.test.ts`. Expected: PASS.

- [ ] **Step 4: Prove it on DEV with a throwaway bot (orchestrator runs this, not a subagent)**

Write a one-off script at `node_modules/.cache/mono-spike.mjs` inside the worktree (not committed). It imports only `@supabase/supabase-js`, reads `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from `.env.local` (run with `node --env-file=.env.local node_modules/.cache/mono-spike.mjs`), and repeats the same three calls `mintSessionForUser` makes. App modules are not imported because `server-only` and `@/` aliases do not resolve outside Next.

1. Create the bot with the admin API: `admin.auth.admin.createUser({ email: "mono-spike-" + crypto.randomUUID() + "@monolith.internal", email_confirm: true })`.
2. `generateLink({ type: "magiclink", email })`, then `anon.auth.verifyOtp({ token_hash, type: "magiclink" })`. Build a client with `Authorization: Bearer <access_token>` and select `from("profiles").select("id").eq("id", bot.id)` and `from("org_members").select("org_id").limit(1)`. Expected: the bot's own profile row is visible (RLS sees `auth.uid() = bot.id`), and no org membership rows (it belongs to no org).
3. Mint 5 times in a row and record whether any call is rate limited.
4. Delete the bot: `admin.auth.admin.deleteUser(bot.id)`, then confirm with `execute_sql`: `select count(*) from auth.users where email like 'mono-spike-%@monolith.internal';` expected 0. Delete the script.

- [ ] **Step 5: Record the decision**

`vault/decisions/2026-11-13-decision-44-mono-identity-session.md` with frontmatter (`type: decision`, `date: 2026-11-13`, `status: accepted`, `tags: [decision, mono, auth]`) and sections: Context (no JWT minting; ES256 keys; Aria's refresh-token failure), Decision (fresh bridge session per hour per Mono via `getMonoClient`, never refresh; bot users need an internal email `mono-<uuid>@monolith.internal`), Evidence (Step 4 results, including rate-limit observations), Consequences (each mint leaves a GoTrue session row; Plan 2 must sign out superseded sessions or accept the growth, and must give every Mono an email).

If Step 4 failed (RLS did not see the bot, or minting was rate limited at 5 calls), write the ADR with status `rejected` instead and state the spec's fallback (service-role client plus explicit membership checks in a definer applier) as the decision for Plan 2.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mcp/oauth/session-bridge.ts src/lib/mono/session.ts src/lib/mono/session.test.ts vault/decisions/2026-11-13-decision-44-mono-identity-session.md
git commit -m "feat(mono): own session per mono without stored refresh tokens"
```

---

### Task 7: Mono avatar component

**Files:**

- Create: `src/components/mono/mono-palette.ts`, `mono-palette.test.ts`, `mono-renderer.ts`, `mono-clock.ts`, `MonoAvatar.tsx`, `MonoAvatar.test.tsx`

**Interfaces:**

- Consumes: the drawing code in `src/components/landing/assembly-mono/avatar.js` (read only; the landing page keeps its own copy).
- Produces:
  - `export type MonoMood = "idle" | "hello" | "listening" | "thinking" | "needsyou" | "done" | "dozing"`
  - `export type MonoPalette = { glow: string; glowRgb: [number, number, number]; beltDark: string; beltDeep: string; beltLight: string; beltHighlight: string; eyeBloomRgb: [number, number, number] }`
  - `export function monoPalette(hex: string): MonoPalette` (throws on a non `#rrggbb` value)
  - `export const MONO_PRESET_COLORS: readonly { name: string; hex: string }[]` (Periwinkle `#7395ff`, Ember `#ff8a4c`, Mint `#3fe0a5`, Rose `#ff6fa8`, Violet `#a77bff`, Sun `#ffc94d`, Ice `#5fd4ff`)
  - `export function MonoAvatar(props: { color: string; mood?: MonoMood; size: number; label: string; className?: string }): JSX.Element` (client component; `size` is the width in px, height is `size * 1.06`)

**Rules from the spec:** one shared clock per page; avatars under 40 px draw a still frame and animate only in `thinking` and `needsyou`; `prefers-reduced-motion` draws still frames; off-screen avatars do not draw.

- [ ] **Step 1: Write the failing tests**

`src/components/mono/mono-palette.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MONO_PRESET_COLORS, monoPalette } from "./mono-palette";

describe("monoPalette", () => {
  it("derives every shade from one hex", () => {
    const p = monoPalette("#7395ff");
    expect(p.glow).toBe("#7395ff");
    expect(p.glowRgb).toEqual([115, 149, 255]);
    expect(p.beltDeep).toBe("rgb(17,22,38)"); // 85% towards black
    expect(p.beltLight).toBe("rgb(178,197,255)"); // 45% towards white
  });

  it("rejects anything but #rrggbb", () => {
    expect(() => monoPalette("blue")).toThrow();
    expect(() => monoPalette("#abc")).toThrow();
  });

  it("ships seven presets, all valid", () => {
    expect(MONO_PRESET_COLORS).toHaveLength(7);
    for (const c of MONO_PRESET_COLORS)
      expect(() => monoPalette(c.hex)).not.toThrow();
  });
});
```

`src/components/mono/MonoAvatar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MonoAvatar } from "./MonoAvatar";

describe("MonoAvatar", () => {
  it("is an accessible image carrying its mood", () => {
    render(
      <MonoAvatar
        color="#7395ff"
        mood="thinking"
        size={32}
        label="Nova, Danijel's Mono"
      />,
    );
    const img = screen.getByRole("img", { name: "Nova, Danijel's Mono" });
    expect(img.dataset.mood).toBe("thinking");
    expect(img.style.width).toBe("32px");
  });

  it("defaults to idle and survives a missing canvas context (jsdom)", () => {
    render(<MonoAvatar color="#3fe0a5" size={24} label="Pip" />);
    expect(screen.getByRole("img", { name: "Pip" }).dataset.mood).toBe("idle");
  });
});
```

Run: `pnpm vitest run src/components/mono`. Expected: FAIL, modules missing.

- [ ] **Step 2: Implement the palette**

`src/components/mono/mono-palette.ts`:

```ts
export type MonoPalette = {
  glow: string;
  glowRgb: [number, number, number];
  beltDark: string;
  beltDeep: string;
  beltLight: string;
  beltHighlight: string;
  eyeBloomRgb: [number, number, number];
};

export const MONO_PRESET_COLORS = [
  { name: "Periwinkle", hex: "#7395ff" },
  { name: "Ember", hex: "#ff8a4c" },
  { name: "Mint", hex: "#3fe0a5" },
  { name: "Rose", hex: "#ff6fa8" },
  { name: "Violet", hex: "#a77bff" },
  { name: "Sun", hex: "#ffc94d" },
  { name: "Ice", hex: "#5fd4ff" },
] as const;

const HEX = /^#[0-9a-f]{6}$/i;

function toRgb(hex: string): [number, number, number] {
  if (!HEX.test(hex)) throw new Error(`Invalid Mono colour: ${hex}`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function mixRgb(
  c: [number, number, number],
  toward: 0 | 255,
  amount: number,
): [number, number, number] {
  return c.map((v) => Math.round(v + (toward - v) * amount)) as [
    number,
    number,
    number,
  ];
}

const css = (c: [number, number, number]) => `rgb(${c.join(",")})`;

export function monoPalette(hex: string): MonoPalette {
  const rgb = toRgb(hex);
  return {
    glow: hex.toLowerCase(),
    glowRgb: rgb,
    beltDark: css(mixRgb(rgb, 0, 0.45)),
    beltDeep: css(mixRgb(rgb, 0, 0.85)),
    beltLight: css(mixRgb(rgb, 255, 0.45)),
    beltHighlight: css(mixRgb(rgb, 255, 0.7)),
    eyeBloomRgb: mixRgb(rgb, 255, 0.55),
  };
}
```

Worked values for the test: `#7395ff` → `[115,149,255]`; 85% towards black → `[17,22,38]`; 45% towards white → `[178,197,255]`. Run: `pnpm vitest run src/components/mono/mono-palette.test.ts`. Expected: PASS.

- [ ] **Step 3: Port the renderer**

`src/components/mono/mono-renderer.ts`: copy `pose()` and `drawMono()` from `src/components/landing/assembly-mono/avatar.js` (lines 75-447) into an exported function:

```ts
export function drawMono(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mood: MonoMood,
  t: number,
  blinkAge: number,
  palette: MonoPalette,
): void;
```

with `personality = { expressiveness: 1.35, glow: 1.5 }` as a module constant, `hover` fixed at 0, and these exact substitutions in the copied code (everything else, including shell and face colours, unchanged):

| Original literal                                                                                                      | Replacement                                                             |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| pool stops `rgba(125,157,255,…)`, `rgba(65,111,255,…)`, `rgba(47,82,255,…)`, `rgba(39,70,245,0)`                      | `rgba(${glowRgb},…)` with the same alphas                               |
| side shade stops `rgba(58,78,116,.45)`, `rgba(108,138,236,.6)`                                                        | `rgba(${glowRgb},.3)`, `rgba(${glowRgb},.6)`                            |
| belt glow `#5277ff` (stroke and both `shadowColor`)                                                                   | `palette.glow`                                                          |
| belt base `#101833`                                                                                                   | `palette.beltDeep`                                                      |
| belt gradient `#3750a9`, `#688aff`, `#7395ff`, `#abc2ff`                                                              | `palette.beltDark`, `palette.glow`, `palette.glow`, `palette.beltLight` |
| thinking sweep `rgba(170,190,255,0)`, `rgba(193,208,255,.98)`, shadow `#6488ff`                                       | `rgba(${glowRgb},0)`, `palette.beltHighlight`, `palette.glow`           |
| eye bloom `rgba(255,237,181,…)`, `rgba(255,226,160,…)`, `rgba(255,218,149,0)`, eye `shadowColor rgba(255,230,161,.9)` | `rgba(${eyeBloomRgb},…)` with the same alphas                           |

Moods not in `MonoMood` (`ribbon`, `wake`, `ritual`) are dropped. `hello` and `done` return to `idle` after 2 s and 2.7 s, as in the original.

- [ ] **Step 4: Shared clock**

`src/components/mono/mono-clock.ts`:

```ts
type Tick = (dt: number) => void;
const subscribers = new Set<Tick>();
let raf = 0;
let last = 0;

function loop(now: number) {
  if (!last) last = now;
  const dt = Math.min((now - last) / 1000, 0.1);
  if (dt >= 1 / 30) {
    last = now;
    if (!document.hidden) subscribers.forEach((fn) => fn(dt));
  }
  raf = subscribers.size ? requestAnimationFrame(loop) : 0;
}

/** One requestAnimationFrame loop for every Mono on the page. */
export function subscribeMonoClock(fn: Tick): () => void {
  subscribers.add(fn);
  if (!raf) {
    last = 0;
    raf = requestAnimationFrame(loop);
  }
  return () => {
    subscribers.delete(fn);
    if (!subscribers.size && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}
```

- [ ] **Step 5: The component**

`src/components/mono/MonoAvatar.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useRef } from "react";
import { subscribeMonoClock } from "./mono-clock";
import { monoPalette } from "./mono-palette";
import { drawMono, type MonoMood } from "./mono-renderer";

const SMALL = 40;
const ALWAYS_ANIMATE: MonoMood[] = ["thinking", "needsyou"];

export function MonoAvatar({
  color,
  mood = "idle",
  size,
  label,
  className,
}: {
  color: string;
  mood?: MonoMood;
  size: number;
  label: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const palette = useMemo(() => monoPalette(color), [color]);
  const height = Math.round(size * 1.06);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d") ?? null;
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let t = 0;
    let blinkAge = 0;
    let nextBlink = 3 + Math.random() * 4;
    let visible = true;
    const render = () => {
      ctx.clearRect(0, 0, size, height);
      drawMono(ctx, size, height, mood, t, blinkAge, palette);
    };
    render();

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const animate =
      !reduced && (size >= SMALL || ALWAYS_ANIMATE.includes(mood));
    if (!animate) return;

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
    });
    io.observe(canvas);
    const unsubscribe = subscribeMonoClock((dt) => {
      if (!visible) return;
      t += dt;
      if (blinkAge > 0) {
        blinkAge += dt;
        if (blinkAge > 0.16) blinkAge = 0;
      } else if ((nextBlink -= dt) <= 0) {
        blinkAge = 0.001;
        nextBlink = 4.5 + Math.random() * 4;
      }
      render();
    });
    return () => {
      unsubscribe();
      io.disconnect();
    };
  }, [mood, palette, size, height]);

  return (
    <span
      role="img"
      aria-label={label}
      data-mood={mood}
      className={className}
      style={{
        display: "inline-block",
        position: "relative",
        width: `${size}px`,
        height: `${height}px`,
        flex: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </span>
  );
}
```

Run: `pnpm vitest run src/components/mono`. Expected: PASS. (jsdom returns null from `getContext`, so the effect exits early; that is the second test's case.)

- [ ] **Step 6: Look at it in a browser**

jsdom draws nothing. Add a temporary page only in the worktree (not committed), `src/app/mono-preview/page.tsx`, that renders every mood at sizes 24, 40 and 96 for two preset colours, run `pnpm dev`, and check it in Chrome: shapes match the landing Mono, the belt and glow take the colour, 24 px idle avatars are still, 24 px `thinking` animates. Delete the page afterwards and revert any `AGENTS.md` change `next dev` made.

- [ ] **Step 7: Gates and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`. Expected: pass.

```bash
git add src/components/mono
git commit -m "feat(mono): colourable animated mono avatar"
```

---

## Finishing (orchestrator)

1. Whole-branch review of `task/monos-p1` against the spec units Z, X, S, V before merging.
2. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` on the merged state.
3. `scripts/finish-task.sh` from the worktree.
4. Tell the owner how to test: on `develop` locally, `/settings` shows no "Agent setup" entry; a board's dock shows no agent tiles and `/ask` works as before; posting a comment containing `@aria` does nothing special; `select count(*) from cron.job where jobname like '%agent%'` on DEV returns 0. The Mono avatar is not visible in the app until Plan 2.
5. Write Plan 2 from the spec (units I, O, B, A, C, R, P) using the ADR from Task 6.
