---
type: session
date: 2026-08-14-0808
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  [
    "[[2026-08-11-1501-provider-model-layer-spec-1]]",
    "[[2026-08-14-gotcha-91-a-guard-written-for-a-human-actor-does-not-survive-an-ai-actor]]",
  ]
---

# Agent runtime — Spec 2a merged

## What changed

- **Spec 2a shipped: agents are a bounded tool loop, not a fixed briefing pipeline** (30 commits, merged `939b0c1d`). `personal-agent/route.ts` moved from `buildBriefing → summariseBriefing` onto `generateText({tools, toolApproval, stopWhen: stepCountIs(12)})`. The 24 MCP tool handlers now export descriptors consumed by **both** transports, plus two agent-only tools (`create_file`, `create_automation`).
- **Capability grants + org ceiling + proposals.** Three migrations (all additive, ledger 141/141). `user_agents.capabilities` defaults `'{}'`, so every pre-existing agent stays exactly as read-only as it was — the relaxation is opt-in by construction, not by vigilance. Ungranted → deny in-loop, write a `user_agent_proposals` row, **finish the run**.
- **Four UI surfaces:** capability toggles + cadence controls in the agent editor, an admin ceiling in `/settings/ai`, proposal cards in run detail and the briefing thread, and a per-agent pending badge from one indexed read.
- **Two extras pulled into the branch by owner ruling:** the Anthropic prompt-caching regression (verified on the wire) and HMAC replay hardening on `/api/ai/models/refresh`.
- **10 task reviews + a whole-branch review, 5 fix rounds.** The final review found one **Critical** no task review could see (below). Announced on `/updates`.

## Why

Spec 1 gave agents a provider and a model. Everything after it was inert: an agent could be configured but could still only write a summary. 2a is the task that made the feature real — and the first code path where a model can cause writes to real user data, unattended, on a schedule.

## How to test (for the user)

1. Pull `develop`. Local runs need a BYO key at `/settings/ai` (`ANTHROPIC_API_KEY` is in Vercel, not local `.env.local`); pick a model whose catalog row has `supports_tools`.
2. `/settings/ai` as an org admin → new **agent capability ceiling**, four toggles, all on. Turn **"Create board automations"** off. Non-admins should not see the control.
3. `/settings/agents` → new agent. Grant **"Create and attach files"**, leave **"Create and update items"** off. "Create board automations" should render **disabled** with *"Disabled for this organization by an admin."*
4. Switch cadence to **Weekly** → weekday select appears; **Monthly** → day-of-month select, capped at 28; **Daily** → neither.
5. Instructions that force one granted and one ungranted action, e.g. *"Call get_my_work, attach a markdown summary to the first item, then create an item called 'Test item' in that item's group."* Save, then **Run now**.
6. Run finishes **ran**, not error, and does not hang — that is record-and-continue.
7. The `.md` file is on the item's **Files** tab; the withheld write appears as a proposal card naming the **resolved group name**, not an id. Roster shows a pending badge.
8. **Approve** → the item is created as you, card goes terminal, and stays decided after a reload. **Reject** on a second run → nothing is created.
9. Any agent that existed before this branch still behaves identically: writes nothing, emails its summary.

## Open threads

- **`call_webhook` is the lesson, not just the bug** — see [[2026-08-14-gotcha-91-a-guard-written-for-a-human-actor-does-not-survive-an-ai-actor]]. Worth re-reading every existing "requires an org admin" gate with the same question.
- **`gotcha-55` fired 4 of 4 migrations this session** — it is no longer an occasional trap, it is the default behaviour of `apply_migration`. [[2026-07-11-gotcha-55-mcp-apply-migration-version-drifts-from-committed-file]] should say so; budget the reconcile every time.
- **HMAC residual is 300s** and reasoned, not measured — `net._http_response` rows had aged out. If someone samples real signed→delivered latency and it is sub-5s, it tightens to 60s with a one-line change and no migration. The nonce is not a replay detector; no store was built.
- **Second cache breakpoint deferred** (needs `prepareStep` on the hot path against a 4-breakpoint limit). The system-block breakpoint — the larger half — shipped.
- ~15 follow-up minors triaged "should fix soon" by the final review: quote-lookalike stripping (`＂ „ ‟ « »`), bidi/zero-width in `oneLine`, `Object.freeze` on `DEFAULT_ORG_AI_SETTINGS`, no test of the `(run_id, tool_call_id)` redelivery defence, an arg-blind `automation-fake-client`, org-level keys outside the sweep, and the silent approval transition for assistive tech.
- **Not promoted.** `develop` is ahead of `main`; the feature and its `/updates` entries go live together on the next promotion.
- `/updates` coverage still flags **2026-08-10** (Spec 1's provider layer — a prior session's gap) and **2026-08-12** (this branch's migrations/descriptor day, which is infra-only and is covered conceptually by the 2026-08-13 announcement). `2026-07-31` is lint/prettier chores, correctly unannounced.

## Next session entry point

Brainstorm **Spec 2b — agent knowledge** (reference templates + memory), owner-chosen over Spec 3 for depth before breadth. There is no spec yet; start with `superpowers:brainstorming`. Spec 3 (orchestration, `@handle` addressing, the renameable built-in assistant, and the deferred `agent.create`/`schedule.create`) follows 2b.
