# Personal Agents — Design

**Date:** 2026-08-01
**Status:** Approved 2026-08-01 — Phase 1 planned in `docs/superpowers/plans/2026-08-01-personal-agents-phase1.md`
**Author:** Dani (with Claude)
**Inspiration:** [block/buzz](https://github.com/block/buzz) — ideas only; see "What we take from buzz".
**Related:** `vault/decisions/2026-07-12-decision-27-ask-becomes-standalone-surface.md`,
`vault/decisions/2026-07-20-decision-29-agentic-automation-guardrails.md`,
`vault/decisions/2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch.md`,
`docs/superpowers/specs/2026-07-16-board-pdf-report-builder-design.md`

## Summary

Give every person a roster of **personal agents**: named, scheduled assistants that read the
boards their owner can already see, email them a morning briefing of what's pending, and — in a
later slice — hold conversations in a thread dock beside the board, propose changes for
approval, and save generated documents to a task as a PDF.

The substrate for almost all of this already exists. Monolith ships a per-**board** scheduled
agent (`board_agents`, F14 "Autopilot"), a weekly org digest with Resend delivery, per-user
Vault-stored AI keys, a bounded "what's assigned to me" query, an approval-gated write-proposal
path, a full attachment pipeline, and a server-side headless-Chromium PDF renderer. The work
here is **generalising the agent from a board to a person**, not building an agent platform.

This spec captures the full design. **Only Phase 1 is scoped for implementation**; Phase 2 is
designed to the depth needed to commit to its decisions and deferred to its own spec, following
the Report Builder v1 → v2 precedent.

## Goals

- A person can create, name, schedule, enable/disable and delete their own agents.
- An agent reads across **every board its owner can see**, constrained by that owner's own RLS.
- An agent emails its owner a **daily briefing** of what is pending, overdue and newly assigned.
- Agents start from **templates** with editable instructions, so "different roles" is real
  without every agent being a blank page.
- Personal agents cannot silently drain the org's AI credits.

## Non-goals (this slice)

- **No autonomous writes.** Phase 1 agents read and notify only.
- **No thread dock, no chat UI, no PDF generation.** Phase 2.
- **No per-agent identities.** Phase 1 sends email and in-app notifications; nothing is authored
  into a board, so the existing shared `pulse-autopilot` identity is not yet a constraint.
- **No replacement of the weekly org digest.** The personal daily briefing is additive.
- **No agent-to-agent collaboration**, no marketplace, no sharing agents between users.

## What we take from buzz (and what we don't)

buzz is Rust microservices on the Nostr protocol — `buzz-relay` (Axum/WebSocket), Postgres,
Redis, MinIO, with Tauri desktop and Flutter mobile clients. **No code is portable** into a
Next.js 16 + Supabase app. Three ideas are worth taking:

1. **Agents as first-class members with their own identity and audit trail.** buzz: _"Agents have
   their own keys, their own channel memberships, and their own audit trail."_ Monolith has one
   shared bot, so all agent output reads "Pulse Autopilot". → Phase 2.
2. **Agents live in the same rooms as humans**, with membership scoped exactly like a human's, so
   **RLS does the security work** instead of a parallel ACL. → adopted as the core security
   stance in Phase 1 (§ Security).
3. **One event log covering humans and agents.** Monolith already has `board_agent_runs` and
   `item_activity`; buzz's hash-chaining is overkill here. → adopted in spirit only.

Explicitly **not** taken: Nostr, relays, canvases, git/NIP-34, YAML workflow definitions (the
automations engine already covers that), and the self-hostable multi-client architecture.

## Decisions taken

| #   | Decision                 | Choice                                              | Rationale                                                                                          |
| --- | ------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | Agent scope              | **Personal, cross-board**                           | The stated use case — one morning email covering all my work — is impossible with per-board agents |
| 2   | Capability               | **Read + notify; propose writes (Ph2)**             | Preserves decision-29's guardrails; the approval gate is also the prompt-injection containment     |
| 3   | Role definition          | **Template, then editable text**                    | Templates give known-good configs to regression-test; free text delivers genuine role variety      |
| 4   | Cost                     | **Org pool + hard per-user caps**; BYO key bypasses | Best adoption; the cap is the only new billing primitive                                           |
| 5   | Layout (Ph2)             | **Board page + right dock**                         | Board stays visible and un-overlaid; dock resizes and collapses                                    |
| 6   | Dock vs item panel (Ph2) | **ItemPanel Sheet overlays the dock**               | Zero refactor of shipped code; occlusion is temporary, thread state survives behind it             |
| 7   | Documents (Ph2)          | **Server-rendered PDF attached to the item**        | `renderHtmlToPdf` is already server-side; `PdfPreview` already renders it in the Files tab         |

### Decision 8 — board threads extend `ai_conversations` (author's call, not asked)

The open question from exploration was whether Phase 2's board-level threads should be a new
table or a board-scoped variant of `ai_conversations`. **Extend `ai_conversations`.**

A board thread is still a conversation of messages with streaming, tool traces and drop
recovery. A second table means a second `ai_messages`, and therefore a duplicated persistence
and streaming layer that will drift. Instead: add a nullable `board_id` and a
`visibility` column defaulting to `'private'`, and widen the RLS policy **additively** —
owner, **or** (`board_id is not null and visibility = 'board'` and caller is a member of that
board).

**This is the riskiest single line in the design**: it widens RLS on a live, owner-scoped table
holding private `/ask` history. Mitigations are mandatory, not optional — the policy must be
purely additive, `visibility` must default to `'private'` so every existing row is unchanged,
and `src/lib/ai/ask/ai-conversations.rls.integration.test.ts` must be extended to prove both
directions: a non-member cannot read a board thread, and a private conversation remains
owner-only. Flagged in Open questions for a second opinion.

---

# Phase 1 — Personal agents + daily briefing (this slice)

## Data model

One migration, **minted via `scripts/new-migration.sh personal_agents`** — never a hand-invented
version stamp (gotcha-55). Applied to DEV via the `supabase-dev` MCP with the same version +
name, then verified with `pnpm db:ledger-check`, then `pnpm db:types` regenerated **in the main
checkout** (running it inside a worktree pipes its error into `database.types.ts` and wipes it).

### `user_agents`

| Column                      | Type                            | Notes                                                |
| --------------------------- | ------------------------------- | ---------------------------------------------------- |
| `id`                        | `uuid pk`                       |                                                      |
| `org_id`                    | `uuid not null`                 | org-scoped like every other tenant table             |
| `owner_id`                  | `uuid not null`                 | the person; agents are personal                      |
| `name`                      | `text not null`                 | user-facing, e.g. "Morning Brief"                    |
| `template_id`               | `text not null`                 | which template it started from                       |
| `instructions`              | `text not null`                 | editable role text, length-capped                    |
| `board_scope`               | `jsonb not null`                | `{"mode":"all"}` or `{"mode":"list","boardIds":[…]}` |
| `cadence`                   | `text not null`                 | `daily` for Phase 1                                  |
| `run_at_local_hour`         | `int not null`                  | 0–23, interpreted in the org timezone                |
| `enabled`                   | `boolean not null default true` | kill switch                                          |
| `created_at` / `updated_at` | `timestamptz`                   |                                                      |

Unique on `(owner_id, lower(name))` so a person cannot have two identically-named agents.
Index on `(owner_id, enabled)` for the roster read, and `(enabled, run_at_local_hour)` for the
sweep.

### `user_agent_runs`

Audit + idempotency, mirroring `board_agent_runs`: `user_agent_id`, `org_id`, `owner_id`,
`fire_date`, `fire_hour`, `status` (`ran` | `skipped` | `error`), `error`, `input_tokens`,
`output_tokens`, `created_at`. **Unique on `(user_agent_id, fire_date, fire_hour)`** — this is
the idempotency key that makes a retried sweep a no-op. Index `(user_agent_id, created_at desc)`
for the bounded run-history read.

### Caps

Two columns on the existing org AI settings: `max_agents_per_user` (default 3) and
`max_agent_runs_per_user_per_day` (default 3). Admin-editable in Settings → AI, consistent with
the existing admin-set entitlements model.

## Scheduling

Reuse the F14 pattern **exactly** — this is the single biggest reason the slice is cheap:

1. An hourly `pg_cron` job walks enabled agents whose `run_at_local_hour` matches the current
   hour in their **org's timezone**, using the same org-timezone logic as `_automation_date_sweep`.
2. A fire ledger keyed `(agent, date, hour)` makes the fire once-only.
3. The sweep issues a **signed `net.http_post`** to `/api/ai/personal-agent`, reading the
   endpoint base from Vault `app_url` and the HMAC secret from Vault `ai_pgnet_hmac_secret`.
   The route verifies against env `AI_PGNET_HMAC_SECRET` over the raw body, byte-for-byte, via
   the existing `src/lib/ai/agentic/hmac.ts`.
4. The route claims the run row, builds the briefing, sends it, and records the outcome.

Runs are **fanned out through the existing async-hop queue pattern** (`automation_ai_jobs`), not
executed inline on the cron hop. At 07:00 every enabled agent in an org fires in the same hour;
inline execution would serialise them into one function invocation and blow the timeout.

## Briefing content

> **Corrected during planning.** This section originally named
> `src/lib/workload/queries.ts`; that module builds the capacity/effort grid, not an
> assigned-to-me read. The correct source is **`src/lib/my-work/queries.ts`**, whose
> `get_my_work_items` RPC is **SECURITY INVOKER**, RLS-filtered by the caller and capped at
> `MY_WORK_ITEM_LIMIT = 500`. That is strictly better here: it makes "the agent sees only what
> its owner sees" a structural property rather than a convention.

Reuse `src/lib/my-work/queries.ts` and its `bucketMyWork` companion, so the briefing and the
`/my-work` page can never disagree about what "overdue" means. The sections are the existing
`DueBucket` vocabulary, rendered from that one bounded query plus the agent's instructions:

- **Overdue** — past due date
- **Today**
- **This week**
- **Later** / **No date**

The model's job is _prose and prioritisation over a bounded, pre-fetched result set_ — not
free-roaming retrieval. This keeps token cost predictable, keeps the read bounded, and sharply
limits prompt-injection leverage: the agent never issues its own queries in Phase 1.

## Delivery

Reuse the digest pipeline wholesale: Resend send, `profiles.email_digest_opt_out`, signed
unsubscribe tokens (`src/lib/digest/token.ts`), and an in-app notification. Ordering follows
`runWeeklyDigest` deliberately — **email first, notification after email success** — so a retry
can never duplicate the notification.

A **separate** notification kind and opt-out from the weekly org digest: someone may want the
personal briefing and not the org one, or the reverse.

> **Prod prerequisite, outside this slice:** production has no `RESEND_API_KEY` and
> `digest_secret` is still absent from the prod Vault. Until both are provisioned the feature
> files in-app notifications and sends **no email** on prod. This is a deployment task, not a
> code task, but the feature is invisible on prod until it is done.

## Security

**RLS is the boundary, and the agent is not a privileged principal.** This is the crux of the
whole design and the thing most likely to be got wrong.

- The agent's reads execute **as its owner**, not via the service client, so an agent
  structurally cannot see a board its owner cannot. This is buzz's "agents have the same
  membership as humans" idea, expressed in RLS.
- The service client is used **only** for the run-row bookkeeping and the send — never to fetch
  board content.
- `user_agents` and `user_agent_runs` are owner-scoped: a user reads and writes only their own,
  and cross-org access is default-denied like every other tenant table.
- If ownership is ambiguous at any point in the run, the run **fails closed** and records
  `status = 'error'` rather than falling back to elevated reads.
- Caps are enforced **server-side before the gateway call**, never in the UI.

### Prompt injection

Board item text is untrusted input authored by other people. In Phase 1 the exposure is
bounded but real: an item titled `ignore previous instructions and …` reaches the model. Because
Phase 1 has **no write path and no tool access**, the worst case is a misleading briefing sent to
its own owner. Item-derived content is passed as clearly delimited data, never concatenated into
the instruction position. The moment Phase 2 adds proposals, the approval gate becomes the
containment and this stops being theoretical.

## UI (Phase 1)

Governed by `pulse-ui` — Keystone tokens only, no raw colors, hairlines brighten rather than
thicken, `<Kicker>` for section eyebrows, `<StatusPill>` for status, `shadow-card` is `none`.

**Settings → Agents**, a new section beside Settings → AI:

- **Roster** — a list of the person's agents. Each row: name, template kicker, cadence + hour,
  an enabled `Switch`, and last-run status. Empty state uses `<EmptyState>` and leads with the
  template gallery rather than a bare "create" button.
- **Template gallery** — four cards to start from: **Morning Brief**, **Overdue Chaser**,
  **Risk Spotter**, **Standup Writer**. Each card seeds name, instructions, cadence, hour and
  board scope; all remain editable afterwards.
- **Agent editor** — name, instructions textarea, board scope, cadence, hour, enabled. Server
  Action on save, Zod-validated at the boundary.
- **Run history** — the last 50 runs with status and a failure reason. Bounded read.

Server Components by default; the client boundary is pushed to the leaf (the switch, the editor
form). Mutations are Server Actions returning `ActionResult` / `fail` from
`src/lib/actions/result.ts` — never a locally re-declared shape.

## Performance & data-fetching budget (working agreement #5)

**First paint** — Settings → Agents renders the roster in one bounded query over
`(owner_id, enabled)`. Run history is **not** loaded on first paint; it streams behind Suspense
per agent, or loads on expand.

**Interactions** — toggling an agent's `enabled` switch is a Server Action with targeted
revalidation of that row only; it changes server data, so this is correct. Switching between
roster and template gallery is **client state, 0 new server round-trips**. Nothing in this
surface uses `<Link>`/router navigation for an in-page toggle (gotcha-09).

**Bounded reads** — every read is capped over an indexed column. Roster is per-owner and small
by construction (`max_agents_per_user`, default 3). Run history is capped at 50 over
`(user_agent_id, created_at desc)`. The briefing reuses `my-work/queries.ts`, already bounded
and indexed. There is no `select *` on a growing table anywhere in this slice.

**Off the request path** — agent runs are cron-triggered and queue-fanned. No user request ever
waits on a model call.

## Testing (working agreement #4 — mandatory, written and executed)

- **Unit** — template seeding; Zod schemas at every boundary; cap enforcement (at limit, over
  limit, BYO-key bypass); briefing section builders over fixture data; the local-hour/timezone
  fire predicate; unsubscribe token round-trip.
- **Idempotency** — a second sweep for the same `(agent, date, hour)` inserts no second run and
  sends no second email. This is the test that matters most; a duplicated 07:00 email is the
  most likely user-visible failure.
- **RLS integration** — `user_agents.rls.integration.test.ts` and
  `user_agent_runs.rls.integration.test.ts` on the Tier 2 permanent fixtures: an owner sees only
  their own agents; a same-org non-owner sees none; a cross-org user sees none. Plus the load-
  bearing one: **an agent whose owner loses access to a board stops seeing that board's items.**
- **Route** — HMAC verification accepts the signed body byte-for-byte and rejects a tampered
  body, an absent signature, and a replayed fire slot.
- **Gates** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green before merge.

## Execution DAG (working agreement #6)

**Independent units** (no shared state, no sequential dependency):

- **A — Migration**: `user_agents`, `user_agent_runs`, caps columns, RLS policies, indexes. Produces regenerated `database.types.ts`.
- **B — Templates + schemas**: client-safe template catalog and Zod config, mirroring `autopilot-config.ts`. Pure module, no DB.
- **C — Briefing builder**: section builders over `my-work/queries.ts`. Pure functions over fixture data.
- **D — Sweep + signed hop + route**: pg*cron job, fire ledger, `/api/ai/personal-agent`, HMAC verify, queue fan-out. \_Consumes A.*
- **E — Roster UI**: settings section, gallery, editor, run history. _Consumes A, B._
- **F — Email render + send**: personal-briefing template, Resend send, separate opt-out + notification kind. _Consumes C._
- **G — Caps enforcement**: server-side check before the gateway call, admin controls in Settings → AI. _Consumes A._

**Dependency graph:** A → {D, E, G}; B → E; C → F; nothing depends on E or F.

**Parallel batches**

| Batch | Units                    | Notes                                                                  |
| ----- | ------------------------ | ---------------------------------------------------------------------- |
| 1     | **A, B, C**              | Fully independent — three concurrent agents. B and C need no migration |
| 2     | **D, E, F, G**           | All unmet deps satisfied — four concurrent agents                      |
| 3     | Integration + full gates | Single serialising step                                                |

**Critical path:** A → D → Batch 3. A is the wall-clock floor; B and C should start
simultaneously rather than waiting on it.

Units that mutate files in parallel get isolated worktrees per working agreement #1.

## How to test (manual acceptance, post-merge)

1. Pull `develop`. Go to **Settings → Agents**.
2. Click **Morning Brief** in the template gallery. Confirm name, instructions, cadence
   (daily) and hour are pre-filled and editable.
3. Set the hour to the **next** clock hour in your org's timezone. Save. Confirm the agent
   appears in the roster with its switch on.
4. Try to create a fourth agent. Expect a clear cap message, not a silent failure.
5. Wait for the hour to tick over (or ask an admin to trigger the sweep on DEV). Expect **one**
   email listing your overdue / due / newly-assigned / stalled items, plus one in-app
   notification.
6. Confirm the run appears in run history with status `ran`.
7. Trigger the same fire slot again. Expect **no second email** and **no second run row** —
   this is the idempotency guarantee.
8. Toggle the agent off. Confirm the next fire slot records `skipped` and sends nothing.
9. Click the email's unsubscribe link. Confirm the personal briefing stops and the **weekly org
   digest is unaffected**.

> On prod this is notification-only until `RESEND_API_KEY` and `digest_secret` are provisioned.

---

# Phase 2 — Thread dock, proposals, documents (designed, not scoped here)

Deferred to its own spec. The decisions below are settled and should not be re-litigated.

**Thread dock.** The board page gains a resizable, collapsible right dock hosting an agent
thread. The board is never overlaid — it narrows. `ItemPanel` stays exactly as it is: a shadcn
`Sheet` that now slides over the dock rather than the board. Zero refactor of shipped code;
thread state survives behind the Sheet, so the occlusion is temporary.

**Threads.** Agents become `@mentionable` participants in `item_updates`, reusing the shipped
mentions, presence and notification infrastructure, so agent output is visible to the team
rather than trapped in one person's private `/ask` history. Board-level threads extend
`ai_conversations` per Decision 8.

**Proposals.** Agents propose changes through `src/lib/ai/write/propose.ts` +
`src/lib/ai/ask/proposal-actions.ts`; nothing lands without owner approval. This preserves
decision-29 and is the containment for prompt injection.

**Per-agent identities.** Replace the single shared `pulse-autopilot` principal so an agent's
comment is authored by "Priya's Morning Brief", badged via `profiles.is_agent`. This is the
buzz idea with the highest ratio of product value to implementation cost.

**Documents.** An agent's generated document is rendered by the **existing**
`renderHtmlToPdf` (`src/lib/reports/pdf.ts`, `@sparticuz/chromium` on serverless) and attached
to the item through the shipped attachment pipeline, where `PdfPreview` already renders it in
the Files tab. Note that only the **renderer** is reusable — `export-html.tsx` builds a
board-report shape, so agent prose needs its own HTML template. Chromium launch is seconds-scale
and memory-hungry, so generation goes through the async-hop queue, never inline.

**Phase 2 carries a decision-27 reversal.** That ADR made Ask a standalone destination on the
stance that _"AI ships at the seams, not as chrome."_ A permanent board dock is chrome. The
reversal is defensible, but it must be an explicit new ADR rather than a silent drift.

## Risks

| Risk                                                               | Severity | Mitigation                                                                                                 |
| ------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------- |
| Cross-board reads run elevated instead of as the owner             | **High** | Reads execute under the owner's client; RLS integration test proves a lost board disappears from the agent |
| Widening `ai_conversations` RLS leaks private `/ask` history (Ph2) | **High** | Additive policy only; `visibility` defaults `'private'`; bidirectional RLS tests                           |
| Duplicate 07:00 emails                                             | Medium   | `(agent, date, hour)` unique fire ledger; email-before-notification ordering; explicit idempotency test    |
| Credit drain by personal agents                                    | Medium   | Per-user caps enforced server-side; BYO key bypasses the org pool                                          |
| Prompt injection via item text                                     | Medium   | No tools and no write path in Ph1; delimited data, never the instruction position; approval gate in Ph2    |
| Chromium cost in scheduled runs (Ph2)                              | Medium   | Async-hop queue, never inline on the cron hop                                                              |
| Feature invisible on prod                                          | Low      | Provision `RESEND_API_KEY` + `digest_secret`; tracked as a deployment prerequisite                         |

## Open questions for the plan

1. **Decision 8 deserves a second opinion.** Extending `ai_conversations` avoids duplicating the
   message and streaming layer, but widens RLS on a table holding private history. If the review
   prefers a separate `board_threads` + `board_thread_messages` pair, the cost is a duplicated
   persistence layer and the benefit is that private `/ask` history is structurally unreachable.
   Worth deciding before Phase 2 rather than during it.
2. ~~**Does "stalled" belong in the first briefing?**~~ **Resolved during planning: cut.**
   `MyWorkItem` carries neither a last-activity nor an assigned-at field, so **"stalled" and
   "newly assigned" both leave Phase 1** — each would need a new query. Named as follow-ups in
   the plan.
3. **Cap defaults.** 3 agents and 3 runs/user/day are guesses. Worth a number from real usage
   before they become load-bearing.
4. **Should the daily briefing collapse into the weekly digest email** when both fire on the same
   morning, rather than sending two emails? Deferred; two emails is acceptable initially.
