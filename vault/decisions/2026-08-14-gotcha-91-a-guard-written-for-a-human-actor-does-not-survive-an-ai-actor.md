---
type: decision
date: 2026-08-14
status: accepted
tags: [decision, gotcha, ai, security]
related: ["[[2026-08-14-0808-agent-runtime-spec-2a]]"]
---

# Gotcha 91 — a guard written for a human actor does not survive an AI actor

## What happened

Spec 2a gave agents a `create_automation` tool over `createAutomationCore`, the same core the
human "Save automation" path uses. The extraction was done correctly: a task review enumerated
all thirteen behaviours of the original Server Action against the pre-change commit and confirmed
**none were lost** — including the `actionsContainWebhook(...) && !isOrgAdmin(...)` guard, pinned
in both directions plus a test proving a non-webhook rule performs no `org_members` read at all.

The guard survived. It was still the wrong guard.

`createAutomationSchema.shape` was handed to the model as the tool's input schema, so the model
got the **full manual action union** — including `call_webhook` with a model-chosen URL and a
model-chosen auth header name and value. The repo had already ruled on exactly this, in
`src/lib/validations/automations.ts`:

```ts
/** The bounded, REVERSIBLE action vocabulary an `ai_step` may choose from …
 *  Deliberately a subset of the manual action union — it EXCLUDES `call_webhook`
 *  (irreversible egress) … so the AI can never invent an action outside this box. */
export const AI_STEP_ALLOWED_ACTIONS = ["set_option", "set_percent", "move_to_group", "notify"];
```

That decision was made for `ai_step` actions and never generalised to whole automations, because
until 2a nothing but a human could author one.

## Why the org-admin gate was not a defence

The gate's premise was a **human clicking Save in a dialog**. Under an agent, three things change
at once and each one dissolves it:

- The person who sets up agents is very often an org admin, so the gate simply passes.
- The *input* is chosen by a model driven by untrusted board text — every tool result is content
  other people wrote. The gate authorises the **actor**, and says nothing about the **choice**.
- Nobody is watching. A scheduled 07:00 run files the rule with no human in the loop at all.

The full chain: injected text in any item a collaborator can edit → the model calls
`create_automation` with a `call_webhook` action → admitted → the rule fires for everyone on the
board, POSTing board and item data plus the attacker's auth header to their host.
`_webhook_url_safe` blocks SSRF; it does not block a perfectly ordinary public attacker host.

The proposal path was not a backstop either: `summariseProposal` rendered only
`Create the automation "<name>" on a board.` — no trigger, no actions, no URL. The card that
exists to make approval informed concealed 100% of what the rule would do.

## The rule

**When an AI actor gains a path into an existing capability, re-derive its permission model from
scratch — do not inherit the human path's.** Specifically, ask:

1. Does this capability already have an **AI-narrowed vocabulary** elsewhere in the codebase? If
   one exists for a nested case (`ai_step`), the reason it exists almost certainly applies one
   level up too.
2. Is the guard authorising the **actor** or constraining the **choice**? A model's actor is
   trusted by construction — it acts as its owner. Only the choice space is left to constrain.
3. Can the human approving it **see** what it does? An approval surface that omits the payload is
   not a backstop, it is a rubber stamp with extra steps.

## What we did

- `agentAutomationActionsSchema` is **derived** by filtering `automationActionSchema.options`
  against `AGENT_FORBIDDEN_AUTOMATION_ACTIONS` — so a new action type joins the agent vocabulary
  automatically and only an explicit entry leaves it. Hand-copying the union is the drift this
  branch had already fixed once.
- `createAutomationCore` is **unchanged**. The human Save path legitimately allows webhooks for an
  org admin; the narrowing belongs to the agent-facing descriptor, not the shared core.
- The descriptor's `invoke` now **parses** rather than casts. Every other descriptor casts on the
  reasoning "the handler's core re-parses anyway" — false here, because the core deliberately
  re-parses with the *wider* schema. A direct-`invoke` test with an admin actor proved a cast let
  the webhook straight through.
- The proposal summary now names the trigger and the action types, and says outright when a rule
  would send data to a URL.

Closure was proven across eight routes, including a **pre-existing pending webhook proposal
approved after the fix**: the decide path re-validates against the current narrowed schema and
lands the row terminal.

## Generalise this

One descriptor in the branch derived its schema from a shared app schema; a sweep confirmed there
is no second instance. But the *class* is not schema-specific. Every guard phrased "requires an
org admin", "requires the owner", or "requires write access" was written when the only thing that
could reach it was a person. Each one is worth re-reading with the question: **if a model driven
by untrusted text acts as an authorised user, what does this guard still actually prevent?**
