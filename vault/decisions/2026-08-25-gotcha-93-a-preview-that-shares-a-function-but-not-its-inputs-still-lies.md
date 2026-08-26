---
type: adr
date: 2026-08-25
status: accepted
tags: [decision, gotcha, ai, agents]
related:
  - "[[2026-08-25-1932-agent-reference-documents-spec-2b]]"
---

# gotcha-93 — a preview that shares a function but not its inputs still lies

## Context

Spec 2b's context-budget meter exists for one reason: to tell an owner, at attach time, whether the
documents they are attaching will actually fit in their agent's prompt at 07:00. Its whole value is
that it cannot disagree with the run loop.

The design took the obvious precaution. `document-budget.ts` owns the arithmetic, both call sites
import the same `documentBudget`, the same `estimateTokens`, and the same `ASSUMED_PREFIX_TOKENS`
constant — the constant was deliberately hoisted into that module so two implementers could not
write `9_000` independently. Reviewers checked this and confirmed it held.

The meter still lied, in the most common case there is.

## What actually went wrong

`AgentEditor` passed `contextLength={selectedModelOption?.contextLength ?? null}`. That is `null`
whenever the agent is **unpinned** — the state every new agent starts in, meaning "inherit the org
default" — and also whenever a pin names a since-retired model, because `buildModelOptions` excludes
retired rows. `documentBudget` then applied `NULL_CONTEXT_FALLBACK = 32_000`.

That fallback is **optimistic**, which is the one thing it must not be. The minimum context among
active tool-capable models is **16,385** — *below* the fallback. So the meter could show ~9,098
tokens available while the run resolved a model whose true budget was 2,461, and `selectDocuments`'
all-or-nothing rule dropped **every** attached document. Silently, at 07:00, with no error.

A second, narrower instance survived the first fix: the editor resolved `defaultModelId` from org
settings, but `gateway.ts` only honours that default when its provider matches the provider the run
resolves (`managed` ⇒ anthropic, `org_byo` ⇒ `byoProvider`). A permitted configuration — org default
set to a 1M-context OpenAI model under managed mode — made the meter budget ~490k against a real
200k.

## Decision

**Sharing the function is not enough. A preview must be fed the same inputs the real computation
will receive, and where it cannot be, it must disclose rather than guess.**

Concretely, in this codebase:

- `unpinnedDefaultModel()` (`src/lib/ai/org-settings.ts`) mirrors `resolveAiAdapter`'s
  provider-resolution branch for branch, so the editor resolves the same model the run will.
- Where resolution is genuinely unpredictable from page-load data — an org that never set a default,
  so `pickModel` falls through to tier-default or cheapest — the meter returns `null` and the UI says
  *"Assuming a 32,000-token context"* instead of promising a fit.

## Rationale

The failure is not arithmetic and no amount of sharing arithmetic prevents it. Both sides ran
identical code on different data, which is indistinguishable from correct until the data diverges.
Four gates and ~5,900 tests passed over it; two rounds of task-scoped review passed over it, because
each task's inputs looked right in isolation. It took a whole-branch reviewer tracing *both* call
sites against `gateway.ts` to see it.

Note also which direction the fallback pointed. A conservative fallback (assume the smallest context
in the catalog) would have degraded to "you have less room than you probably do" — annoying, never
wrong in a way that loses work. The optimistic one converts a missing input into a false promise.

## Consequences

- Positive: the meter's guarantee is now structural, and the residual unpredictable case is
  disclosed rather than silently guessed.
- Negative: `org-settings.ts` now duplicates `gateway.ts`'s provider-resolution branch, and the two
  must be changed together. Eight branch tests pin it; a comment in each points at the other.
- **Generalisable:** any client-side preview of a server-side decision — a cost estimate, a quota
  bar, a "this will fit" indicator — must be audited for *input* divergence, not just logic
  divergence. Ask what the preview does when an input is absent, and make sure the answer is
  pessimistic or disclosed, never optimistic.
