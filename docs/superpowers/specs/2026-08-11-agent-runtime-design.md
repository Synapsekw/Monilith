# Agent Runtime — design

**Date:** 2026-08-11
**Status:** approved (brainstorming)
**Scope:** Spec 2a of 4. Spec 1 (provider & model layer) shipped in PR #95. Agent knowledge —
reference templates and the memory layer — is **Spec 2b** and out of scope here (see "Out of
scope"). Orchestration & addressing remains Spec 3.

## Problem

Spec 1 made an agent's _model_ selectable. Nothing made an agent _do_ anything.

A personal agent today is a fixed three-step pipeline in
`src/app/api/ai/personal-agent/route.ts`: `buildBriefing` → `summariseBriefing` → email + thread. It
has **no tools at all**. It reads one RPC (`get_my_work_items`), sends that text to one model, and
emails the prose that comes back. Four limits follow:

1. **No tool loop.** The agent cannot look at a board it wasn't handed, cannot follow up on what it
   found, and cannot act.
2. **Anthropic only.** `assertToolLoopCapable` (`src/lib/ai/tool-capability.ts`) hard-gates every
   tool-using feature to Anthropic, because the three loops that exist
   (`ask/route.ts`, `write/actions.ts`, `agentic/decide.ts`) construct `new Anthropic()` directly and
   bypass adapters. Spec 1 landed `ai_models.supports_tools` covering 88 of 95 catalog models; not
   one of them is reachable by a tool loop.
3. **AI never writes directly.** `automation-gen-actions.ts:29` states the invariant plainly: the
   model produces a draft, _"the human reviews it and clicks Save — this action never writes."_
4. **Daily, and only daily.** `cadence text ... check (cadence in ('daily'))`.

The motivating scenario — _"a cron job in the morning that checks specific tasks on a specific
board, then executes and builds files and uploads them into a file section"_ — needs all four
removed.

### What already exists, and must be reused rather than rebuilt

Three findings from grepping the codebase before designing shaped this spec more than anything else.

- **A 24-tool owner-scoped tool suite already exists** in `src/lib/mcp/tools/`, with a perfectly
  uniform split: every module exports `xHandler(getClient, input, actorId?)` _and_
  `registerXTool(server, getClient, actorId?)`. It includes `attach_file` (inline base64 under
  128 KB, or a `storagePath` from `create_attachment_upload`), both delegating to
  `createAttachmentCore`. Only the name, description and `inputSchema` are welded into the
  `registerXTool` calls; the handlers themselves are already transport-agnostic.
- **MCP's `getClient` resolves through the same OAuth session bridge** that `owner-client.ts` uses
  for agents (`mintBridgeSecret` / `getBridgedClient`). The agent runtime and the MCP server are
  already two consumers of one owner-scoping mechanism.
- **The `attachments` table and private bucket are the "file section"** — path
  `<org_id>/<board_id>/<item_id>/<uuid>-<name>`, org-scoped storage RLS, no `allowed_mime_types`
  restriction, 50 MB ceiling.

The agent's tool surface is therefore mostly a **wiring** problem, not a building one.

## Decisions

| Question                      | Decision                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| Spec shape                    | Split Spec 2 at the do/know seam. **2a = runtime** (this doc); 2b = templates + memory.          |
| Ungranted capability at 07:00 | **Record & continue** — deny in-loop, persist a durable proposal, finish the run. Never suspend. |
| Grant scope                   | Per-agent set, under an org-wide ceiling, both narrowed by the owner's RLS.                      |
| Tool surface                  | Extract descriptors from all 24 MCP tools; MCP and the AI SDK agent share one definition.        |
| Artifacts                     | `create_file` takes **plain text**; the runtime encodes and delegates to `attachFileHandler`.    |
| Capabilities                  | `board.write`, `files.write`, `automation.create`, `time.log`.                                   |
| Board scope                   | Enforced in the tool wrapper, never in the prompt.                                               |
| Review UI                     | One `ProposalCard` in both the run detail and the briefing thread.                               |
| Catalog re-verification       | Daily refresh uses one stored key per provider, disclosed in the key-entry UI.                   |

## Architecture

### 0. Verified against the installed packages, not from memory

Spec 1 shipped four unverified external-API details into its plan; two were silent billing bugs and
none would have failed a type check. Every SDK claim below was checked against the installed package
on **2026-08-11**, and the load-bearing one was checked by _running it_.

- **The repo is on AI SDK v7, not v6.** `ai@7.0.58`, `@ai-sdk/anthropic@4.0.36`,
  `@ai-sdk/openai@4.0.36`, `@ai-sdk/google@4.0.39`, `@ai-sdk/openai-compatible@3.0.28`. Spec 1's
  prose says "AI SDK v6" throughout; the adapters were in fact built on v7. **This spec's design
  rests on v7-only primitives**, so the discrepancy is corrected here rather than inherited.
- **Exports confirmed present** (`require('ai')`): `ToolLoopAgent`, `tool`, `stepCountIs`,
  `hasToolCall`, `dynamicTool`, `lastAssistantMessageIsCompleteWithApprovalResponses`,
  `InvalidToolApprovalSignatureError`, `ToolCallNotFoundForApprovalError`.
- **`generateText` and `streamText` both accept** `toolApproval`, `experimental_toolApprovalSecret`,
  `stopWhen`, `activeTools`, `toolsContext`, `runtimeContext`, `prepareStep`,
  `onToolExecutionStart` / `onToolExecutionEnd` (checked in `node_modules/ai/dist/index.d.ts`).
- **Record-and-continue semantics proved by execution.** A `MockLanguageModelV4` run with
  `toolApproval: { attach_file: { type: 'denied', reason: '…' } }` produced: `steps.length === 2`,
  `finishReason: 'stop'`, the granted `query_items` executed, `attach_file` **not** executed, and the
  denied call fully recoverable from `result.toolCalls` as
  `{ toolCallId: 'c2', toolName: 'attach_file', input: { itemId, fileName } }`. Step content also
  carried `tool-approval-request` and `tool-approval-response` parts for an _automatic_ denial. This
  is the mechanism §2 and §6 are built on, and it is the first test unit E must reproduce.
- **The token-accounting trap is already solved and must not be re-solved.**
  `src/lib/ai/providers/usage.ts::toAiUsage` documents it: the SDK's `usage.inputTokens` is the
  _total_ input **including** cache reads and writes, while `AiUsageTokens.inputTokens` means the
  _uncached_ input, because `computeCostUsd` prices cache reads (0.1×) and writes (1.25×)
  separately and adds them on top. Passing the SDK value through bills every cached token twice.
  `toAiUsage` reads `inputTokenDetails.noCacheTokens` and clamps at 0. **Unit F reuses it; it does
  not write its own mapping.**

### 1. The agent becomes a loop

`personal-agent/route.ts`'s pipeline is replaced by:

```
claim slot  →  entitlement + caps  →  owner client  →  resolve model
            →  build tool set from grants
            →  generateText({ tools, toolApproval, stopWhen: stepCountIs(12) })
            →  persist effects + proposals  →  thread + email  →  finalize run
```

Everything outside the middle two lines is unchanged, and deliberately so. The slot claim
(`claimRun`, the real idempotency arbiter), `assertRunAllowedToday`, `getAgentOwnerClient`'s
`auth.getUser()` owner-scope invariant, `safeFinalize`, and the configuration-vs-fault error
taxonomy all survive verbatim. This spec changes what happens _between_ the claim and the finalize.

`buildBriefing` and `applyBoardScope` retire — the loop calls `get_my_work` itself, which is already
an MCP handler (`getMyWorkHandler`, `MY_WORK_TOOL_LIMIT = 200`). `bucketMyWork` stays; `/my-work`
shares it. The four starter templates in `AGENT_TEMPLATES` get their instructions updated to say
what to call.

**Step budget is `stepCountIs(12)`.** Existing precedents are 3 (`decide.ts`) and 6 (`propose.ts`);
a file-building agent needs headroom. `maxOutputTokens` is taken from the resolved
`ai_models.max_output_tokens`.

### 2. Two gates, and RLS underneath both

Effective permission is:

```
agent.capabilities  ∩  org.agent_capability_ceiling  ∩  what the owner's RLS allows
```

RLS is unchanged and remains **the** security boundary. A capability grant can only ever _narrow_;
it can never widen what the owner could already do. This is what keeps the relaxation of
`automation-gen-actions.ts:29` bounded: the agent gains the ability to write **as its owner**, never
beyond them.

The gate is a single `GenericToolApprovalFunction` closing over the resolved grant set:

| Case                               | Return                                                          | Side effect          |
| ---------------------------------- | --------------------------------------------------------------- | -------------------- |
| Tool needs no capability (a read)  | `undefined`                                                     | executes             |
| Capability granted                 | `undefined`                                                     | executes             |
| Capability ungranted               | `{ type: 'denied', reason: 'Recorded for your approval.' }`     | proposal row written |
| Capability outside the org ceiling | `{ type: 'denied', reason: '…disabled for this organization' }` | **no** proposal row  |

The ceiling case writes no proposal on purpose: a proposal nobody is permitted to approve is a
dead row that renders a button which can only fail.

The runtime-owned system preamble carries the AI SDK's own recommended instruction — _"when a tool
execution is not approved, do not retry it"_ — without which the model spends its step budget
re-proposing the same denied call.

`activeTools` is **not** the grant mechanism. Ungranted tools must stay visible to the model or it
can never propose them, which is the entire point of the proposal path.

### 3. One tool definition, two transports

Each `src/lib/mcp/tools/*.ts` gains an exported descriptor:

```ts
export const attachFileDescriptor = {
  name: "attach_file",
  title: "Attach file",
  description: "…", // moved verbatim out of registerAttachFileTool
  inputSchema: attachFileInput, // the existing Zod shape object
  capability: "files.write", // null for reads
} as const;
```

`registerXTool` consumes the descriptor (**no behaviour change** — the MCP server must serve byte-
identical tool metadata after this refactor), and a new `src/lib/agents/tools.ts` maps the same
descriptor onto an AI SDK `tool()` bound to the agent's owner client.

**`capability` is what makes a new tool fail closed.** A tool added later without a classification is
ungranted by construction rather than silently executable. The descriptor type makes the field
required, so this is a compile error, not a review question.

Classification of the 24 existing tools:

| Capability           | Tools                                                                                                                                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| _(none — always on)_ | `list_boards`, `get_board`, `list_items`, `search_items`, `get_item`, `list_organizations`, `get_my_work`, `list_time_allocations`, `get_time_summary`, `list_goals`, `get_goal`, `list_portfolios`, `get_portfolio`, `list_dashboards`, `get_dashboard`, `get_widget_data`, `get_workload`, `list_reports`, `get_report` (19) |
| `board.write`        | `create_item`, `update_item`                                                                                                                                                                                                                                                                                                   |
| `files.write`        | `attach_file`, `create_attachment_upload`                                                                                                                                                                                                                                                                                      |
| `time.log`           | `log_time_allocation`                                                                                                                                                                                                                                                                                                          |

Two tools are **new** and agent-only (not registered on the MCP server): `create_file` (§5) and
`create_automation` (§5).

One tool is classified but **not exposed to agents**: `create_attachment_upload` returns a signed
URL the caller must then `PUT` bytes to, and an agent inside a tool loop has no way to perform that
`PUT`. It keeps its `files.write` classification so the descriptor type stays total, and the agent
tool set excludes it explicitly. Agents write files only through `create_file`, under its 128 KB
ceiling.

**One caveat on `getClient`.** `shared.ts` documents that `GetClient` must be called exactly once per
handler invocation, because on the MCP path each call charges the rate limit and rotates the OAuth
bridge secret. The agent runtime passes a **pre-resolved** owner client wrapped in a thunk, so no
rotation occurs per tool call — the agent's bridge secret rotates once per run, in
`getAgentOwnerClient`, exactly as it does today.

### 4. Board scope is enforced in the wrapper, not the prompt

`user_agents.board_scope` is a safety boundary the user configured. Enforcing it by asking the model
nicely is not enforcement. Every board-addressed tool call is filtered against the agent's scope
**before** the handler runs; a call naming an out-of-scope board is refused in-loop with a reason
the model can act on, and the refusal is recorded on the run.

This is strictly narrower than RLS, which still independently prevents reading a board the owner
cannot see. Scope is a user preference; RLS is the security boundary. Both apply.

### 5. New tools

**`create_file(itemId, columnId?, fileName, format, content)`** — `format ∈ { md, txt, csv, html,
json }`, `content` is **plain text**. The runtime derives the mime type, base64-encodes, and
delegates to `attachFileHandler`, inheriting its 128 KB inline ceiling, its strict base64 decode,
its `resolveItemScope` check and every storage-RLS guard unchanged.

The plain-text signature is not a convenience. `attach_file` takes `contentBase64`, and base64 costs
~1.37 tokens/byte — a 20 KB document emitted directly by the model is ~27k output tokens of base64
it can silently corrupt, and `decodeBase64`'s strict length-and-charset check would reject it as a
flat failure. Taking text and encoding server-side removes the failure mode entirely.

`create_file` returns the byte count it wrote, so a document truncated by `maxOutputTokens` is
distinguishable from a complete one and the model can retry smaller.

Binary formats (pdf, docx, xlsx) are **out of scope**. `exceljs` is already a dependency and an
`xlsx` path is a plausible 2b addition; PDF would need a new renderer inside a serverless function.

**`create_automation(boardId, name?, trigger, actions, condition?)`** — gated on
`automation.create`.

This one carries a trap. `createAutomation` (`src/lib/boards/automation-actions.ts:85`) is a
`"use server"` action bound to cookie-based `createClient()`, so it **cannot** be called from an
agent run holding only a bridged client — the exact shape `mcp/tools/shared.ts` documents for
`upsertCell`. The fix is the precedented one: extract `createAutomationCore(supabase, input,
actorId)` mirroring `upsertCellCore`, and have both the server action and the tool call it.

**The webhook guard must survive the extraction.** `createAutomation` refuses webhook actions unless
the caller is an org admin (`actionsContainWebhook` + `isOrgAdmin`). The last time a handler
re-implemented instead of extracting, the `people` assignment fan-out was silently dropped —
gotcha-60. A test asserting an agent cannot create a webhook automation as a non-admin owner is
mandatory in unit E.

### 6. `user_agent_proposals`

```
id             uuid primary key default gen_random_uuid()
user_agent_id  uuid not null references public.user_agents (id) on delete cascade
run_id         uuid not null references public.user_agent_runs (id) on delete cascade
org_id         uuid not null references public.organizations (id) on delete cascade
owner_id       uuid not null references auth.users (id) on delete cascade
capability     text not null
tool_name      text not null
tool_call_id   text not null          -- the SDK's toolCallId
input          jsonb not null         -- exact tool input, incl. generated file text
summary        text not null          -- SERVER-derived, never model-authored
status         text not null check (status in
                 ('pending','approved','rejected','expired','failed'))
decided_at     timestamptz
decided_by     uuid references auth.users (id)
result         jsonb
expires_at     timestamptz not null
created_at     timestamptz not null default now()

unique (run_id, tool_call_id)
index (owner_id, status, created_at desc)   -- "my pending proposals"
index (user_agent_id, created_at desc)      -- run detail
```

Three rules are the whole security of this table:

1. **The stored `input` is re-validated against the tool's live `inputSchema` at approve time.** It
   is a blob that sat in a database for days and the schema may have moved since. A failure marks
   the row `failed` with the schema error; it is never replayed on trust.
2. **Execution runs as the approver**, through their ordinary cookie-scoped client. The owner is the
   one clicking, so RLS applies naturally and no `security definer` function is needed anywhere on
   this path.
3. **`summary` is derived server-side from the validated input**, never text the model wrote. A
   model-authored summary is a sentence the user approves that may not describe what executes.

`unique (run_id, tool_call_id)` makes a redelivered run unable to double-insert, mirroring
`user_agent_runs_slot_uniq`. Expiry is **7 days**, set at insert to `now() + interval '7 days'` and
enforced as a predicate at read and at approve time — a row past `expires_at` reads as expired
without anything having to update it. There is deliberately no sweep job: `status` therefore never
literally holds `'expired'` on a stored row unless a decision attempt wrote it there, and both the
list query and the approve action must apply the predicate rather than trusting `status` alone.

RLS: owner-scoped `select`; `update` restricted to the owner and to the decision columns
(`status`, `decided_at`, `decided_by`, `result`); **no authenticated `insert`** — rows are written
only by the service-role run, exactly as `user_agent_runs` is.

### 7. Grants, ceiling, cadence

```
user_agents.capabilities  text[] not null default '{}'
  check (capabilities <@ array['board.write','files.write',
                               'automation.create','time.log']::text[])

org_ai_settings.agent_capability_ceiling  text[] not null
  default array['board.write','files.write','automation.create','time.log']::text[]
```

A separate `user_agent_grants` table was considered for `granted_by` / `granted_at` audit and
rejected. Only the owner can edit their own agent, so `granted_by` is near-constant, and a toggle's
timestamp is weaker evidence than what actually happened. Instead **every run records the grant set
in force when it ran** (`user_agent_runs.grants`), which answers "what could this agent do at 07:00
on the 3rd?" — a question the toggle history cannot answer.

The ceiling defaults **open** and the per-agent set defaults **empty**. The system is still
deny-by-default overall, because the inner gate is closed; closing both would ship the feature
invisible and force every user to hunt for an admin setting before their first agent could act.

```
user_agents.cadence            check (cadence in ('daily','weekdays','weekly','monthly'))
user_agents.run_on_weekday     int check (run_on_weekday between 0 and 6)
user_agents.run_on_day_of_month int check (run_on_day_of_month between 1 and 28)
```

Capped at 28 so no month-length edge case exists. **The sweep's
`(user_agent_id, fire_date, fire_hour)` idempotency key is untouched** — `_personal_agent_sweep`
gains only a day predicate alongside its existing `run_at_local_hour` match, and the DST-correct
`p_now at time zone v_org.timezone` computation already yields the weekday and day-of-month it
needs. No `hourly` cadence: `max_agent_runs_per_user_per_day` defaults to 3, which would make it
dead config.

`user_agent_runs` gains `grants jsonb`, `steps int`, `tools_used text[]`, `output text`. A run
currently records tokens and a status and nothing about what it did, which is untenable once it can
write.

`instructions` widens from 2000 to 8000 characters (a `check` drop-and-re-add), with
`INSTRUCTIONS_MAX` in `agent-config.ts` moving in lockstep. The runtime-owned preamble — identity,
id-discipline, grant rules, the do-not-retry-denied instruction — stays non-negotiable; user text is
appended to it, never substituted for it. The prompt is the owner's own text executing under the
owner's own RLS, so its blast radius is already bounded by §2.

### 8. Provider portability

The agent loop goes provider-agnostic through the AI SDK, so `assertToolLoopCapable` is dropped
**for the agent feature** and replaced by a per-model `ai_models.supports_tools` read — the change
`tool-capability.ts`'s own comment anticipates.

The module does **not** die. `ask/route.ts` and `write/actions.ts` still construct `new Anthropic()`
and additionally stream (`ask-stream.ts`, `stream-protocol.ts`); converting them is a separate job.
`tool-capability.ts` survives serving exactly those two callers, with its comment corrected to say
so rather than claiming Spec 2 removed it.

User-visible consequence: `AgentEditor`'s warning — currently _"tool loops are Anthropic-only, so
that agent's runs would be recorded skipped"_ — becomes a `supports_tools` check, so pinning an
agent to Kimi K2 or Mistral Large works. That is 88 of 95 catalog models, up from 15.

### 9. Per-provider catalog re-verification

Spec 1's open thread: only Anthropic re-verifies after a daily refresh, because it is the one
provider with a platform key. For the other four, "new models without a deploy" is false until a
user re-saves their key by hand. That directly undercuts this spec — an agent can be pinned to any
model, but new Mistral/Kimi/Google models never reach a picker.

The daily refresh picks **one stored credential per provider** and makes a single read-only
`GET /v1/models` with it, reusing `listNativeModelIds` and `verifyProviderModels` unchanged. The
key-entry UI states plainly that a saved key is also used to keep that provider's model list
current. The calls are free and read-only; the disclosure is about consent, not cost.

Failure of any one provider's verification is logged and skipped — it must never abort the refresh
or, per Spec 1's guard, trigger retirement.

### 10. UI

- **Agent editor** gains capability toggles (each disabled with a reason when outside the org
  ceiling), the cadence controls, the wider instructions field, and the `supports_tools` warning
  replacing the Anthropic-only one.
- **`ProposalCard`** — one component, rendered in the agent's run detail under `/settings/agents`
  **and** inline in the briefing thread. It follows `ActionConfirmCard`'s existing shape (kicker,
  server-derived summary, warnings, Approve/Cancel) but is backed by a persisted row rather than
  client state.
- **Email** gains an "N actions await your approval" line linking to the run detail.
- **Settings → AI** gains the org ceiling control, admin-only, beside the existing per-user caps.

Per working agreement #5: the run detail loads its proposals server-side in one indexed read
(`(owner_id, status, created_at desc)`); approving is a Server Action with targeted revalidation,
because it genuinely changes server data. Capability toggles in the editor are client state until
save — **zero server round-trips per interaction**.

## Error handling

Every row below is a _recorded outcome_, never a crash. This runs unattended at 07:00 and a thrown
exception is a silently dead agent.

| Condition                                    | Behaviour                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------------- |
| Resolved model has no tool support           | Run `skipped`, naming the model and where to change it, **before** any spend            |
| No key for the pinned provider               | `skipped` (existing `PersonalAiKeyMissingError` / `ByoKeyMissingError` path, unchanged) |
| Tool call outside board scope                | Refused in-loop with the reason; run continues; refusal recorded                        |
| Ungranted capability                         | Denied in-loop, proposal row written, run continues, counted in the email               |
| Over the org ceiling                         | Denied in-loop, **no** proposal row                                                     |
| Step budget exhausted                        | Run `ran` with `steps = 12` and whatever completed — a partial result is still a result |
| `create_file` truncated by `maxOutputTokens` | Tool returns the byte count; model can retry smaller                                    |
| Tool handler throws                          | Error returned to the model as a tool result; the loop continues; recorded on the run   |
| Proposal approved after `expires_at`         | Refused with the expiry date; never silently executed                                   |
| Stored proposal input fails re-validation    | `failed` with the schema error; never replayed                                          |
| Thread write fails                           | Unchanged — returns null, email omits the link, run still succeeds                      |

## Testing

- **Unit:** the grant-gate matrix (no-capability / granted / ungranted / over-ceiling), each
  asserting both the return value and whether a proposal row was written; the board-scope wrapper
  refusing an out-of-scope board id; `create_file`'s format→mime mapping and its delegation to
  `attachFileHandler`; the cadence day predicate across all four cadences; proposal re-validation
  rejecting a stale-shape input; the descriptor extraction producing byte-identical MCP tool
  metadata before and after.
- **The test that proves the central claim:** the loop under `MockLanguageModelV4` asserting that a
  denied tool call leaves the loop running, does not execute, and leaves its input recoverable from
  `result.toolCalls`. The harness is already written and passing (§0).
- **The test that proves the security boundary:** an RLS integration test showing an agent whose
  owner lost access to a board reads nothing from it — enforced by RLS, not by grants, and therefore
  true even with every capability granted.
- **The webhook-guard test:** an agent whose owner is not an org admin cannot create a webhook
  automation through `create_automation` (§5, gotcha-60's failure mode).
- **RLS integration:** proposal owner-isolation; no authenticated insert; the decision update
  restricted to the owner and to decision columns only.
- **Regression:** an agent with zero grants performs zero writes, still completes, and still emails —
  proving the relaxation of `automation-gen-actions.ts:29` is opt-in and that existing agents are
  unaffected by the migration's `default '{}'` backfill.
- **Metering:** a multi-step run's usage is summed through `toAiUsage`, asserting cached input is not
  double-billed.

Note that RLS integration suites correctly SKIP without `PULSE_TEST_DB` (gotcha-81) and must never
be forced.

## Execution DAG (working agreement #6)

| Unit | Work                                                                                                                                                  | Produces                                       | Depends on |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------- |
| A    | Extract descriptors from 24 `registerXTool` calls; MCP consumes them                                                                                  | tool descriptors + `capability` classification | —          |
| B    | Migration 1: capabilities, ceiling, cadence, sweep predicate, instructions cap                                                                        | `user_agents` / `org_ai_settings` columns      | —          |
| C    | Migration 2: `user_agent_proposals` + run-effect columns                                                                                              | proposals table, run columns                   | —          |
| D    | Per-provider re-verification in the daily refresh + key-UI disclosure                                                                                 | verified models for all 5 providers            | —          |
| E    | Agent tool runtime: descriptors → AI SDK tools, board-scope wrapper, `create_file`, `createAutomationCore` + `create_automation`, `toolApproval` gate | `agents/tools.ts`, the grant gate              | A, B       |
| F    | Rewrite `personal-agent/route.ts` onto the loop; retire `buildBriefing`; `toAiUsage`; write effects + proposal rows                                   | the working agent run                          | C, E       |
| G    | Agent editor: capability toggles, cadence controls, wider instructions, `supports_tools` warning                                                      | editor UI                                      | B          |
| H    | `ProposalCard` + decide action (re-validate → execute as approver); run detail + briefing thread; email line                                          | review UI                                      | A, C       |
| I    | Org ceiling admin UI in Settings → AI                                                                                                                 | admin UI                                       | B          |

- **Batch 1 (parallel):** A, B, C, D
- **Batch 2 (parallel):** E, G, H, I
- **Batch 3:** F
- **Critical path:** A → E → F

Migrations B and C are deliberately **disjoint** — B touches `user_agents` / `org_ai_settings` /
the sweep function, C touches `user_agent_proposals` / `user_agent_runs` — so they can be built in
parallel worktrees without a rebase conflict. Both are minted via `scripts/new-migration.sh`,
applied to DEV through the `supabase-dev` MCP with the **same version + name** as the committed
file, and verified with `pnpm db:ledger-check`. Types regenerate through the MCP's
`generate_typescript_types` + prettier — `pnpm db:types` throws `LegacyProjectNotLinkedError` inside
a worktree.

Unit A is a 24-file mechanical touch and unit H depends on it only for `inputSchema`; if A slips, H
can be unblocked by landing the descriptors for the five write tools first.

## Performance & data-fetching budget (working agreement #5)

- **First paint** of `/settings/agents`: the roster, plus each agent's pending-proposal count from
  one indexed read on `(owner_id, status, created_at desc)`. The run detail loads its proposals
  server-side in one bounded read.
- **Interactions:** capability toggles, cadence selection and the model picker are client state
  until save — 0 new server round-trips. Approving a proposal _does_ change server data, so it is a
  Server Action with targeted revalidation, not a navigation.
- **Hot-path reads are bounded over indexed columns:** proposals are read by
  `(owner_id, status, created_at desc)` or `(user_agent_id, created_at desc)`; `get_my_work` is
  capped at `MY_WORK_TOOL_LIMIT = 200`; `list_items` at `LIST_ITEMS_MAX_LIMIT = 200` with cursor
  pagination. No unbounded `select *` is introduced.

## Out of scope

**Spec 2b — agent knowledge** (depends on 2a)

- **Reference templates:** user-uploaded documents an agent must follow. The tension to resolve
  there is unchanged — a template is _structure_, so it wants verbatim injection under a token
  budget, not RAG chunking, which destroys the very structure the agent imitates. Retrieval is the
  fallback for corpora too large to inject. The budget check is served by `ai_models.context_length`
  and `max_output_tokens`, and now competes for the same window as this spec's tool schemas — which
  is precisely why 2b must own that arithmetic in one place.
- **Memory layer:** what an agent carries between runs, and who writes it (agent scratchpad vs.
  user-curated facts vs. auto-summarised run history). `user_agent_runs.output` (§7) is the raw
  material an auto-summariser would consume.
- Candidate additions: an `xlsx` artifact format (`exceljs` is already a dependency), and converting
  `ask/route.ts` / `write/actions.ts` off `new Anthropic()` so `tool-capability.ts` can finally be
  deleted.

**Spec 3 — orchestration & addressing** (depends on 2a, not on 2b — agents-as-tools needs the
runtime, not the knowledge layer)

Unchanged from Spec 1 §10: a default per-user orchestrator agent delegating to other agents as
tools, `@handle` addressing across mention surfaces, and a renameable built-in assistant.

**Deliberately deferred from this spec's capability set:** `agent.create` and `schedule.create`. An
agent that creates agents _is_ the orchestration problem — nested runs, nested spend, depth and
fan-out caps — and belongs with Spec 3's machinery rather than ahead of it.

### Forward constraints this spec must respect

Agents-as-tools means nested runs and nested spend, so `runAi`'s ledger will need a parent-run
correlation id. **Verified 2026-08-11 that the path stays open:** `record_ai_usage` already has
precedent for additive optional parameters — `p_cache_read_tokens integer default 0` and
`p_cache_write_tokens integer default 0` were added in `20260801092356_ai_usage_cache_tokens.sql` by
drop-and-recreate. `runAi` calls it with named parameters, so PostgREST resolves the overload by
name and a further defaulted parameter is safe.

One trap that migration documents in a comment, recorded here so Spec 3 does not relearn it:
**grants do not survive the drop.** Both the `revoke ... from public, anon, authenticated` and the
`grant execute ... to service_role` must be re-asserted against the new signature, or every metered
call fails at runtime with a permission error that no type check can catch.

This spec changes nothing about `record_ai_usage`. `user_agent_runs` likewise gains no
`parent_run_id` here — but nothing in §6's `run_id` foreign key or §7's run columns makes adding one
harder.
