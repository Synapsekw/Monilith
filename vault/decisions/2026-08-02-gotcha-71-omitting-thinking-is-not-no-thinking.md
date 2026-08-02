---
type: adr
status: accepted
date: 2026-08-02
tags: [project/monolith, adr, gotcha, ai, anthropic, model-migration, silent-failure]
related:
  - "[[2026-07-27-1254-ask-stream-honesty-drop-recovery-thinking]]"
  - "[[2026-08-01-gotcha-70-an-interactive-path-reused-unattended-fails-silently]]"
---

# Gotcha 71 — Omitting `thinking` is not "no thinking": a model swap silently spent the response budget and dropped conversation history

## Context

The AI-COGS branch redefined one shared constant:

```diff
-export const MODEL = "claude-opus-4-8";
+// routed per feature via model-map.ts → claude-sonnet-5
```

Six raw `messages.create` / `.stream` call sites omitted `thinking` entirely. Under Opus 4.8 that
meant no thinking. **Sonnet 5 runs _adaptive_ thinking when `thinking` is omitted**, at effort
`"high"` — so the same request JSON now means something different.

`max_tokens` caps **thinking plus response text**, and those budgets were sized for a model that
did no thinking:

| Call site | `max_tokens` | Failure once thinking turned on |
| --- | --- | --- |
| `ask/context.ts` — conversation summarize | **512** | thinking eats the whole budget; `stop_reason: "max_tokens"`, **no text block** |
| `ask/ask-stream.ts` — capped final call | 1024 | truncated / empty answer |
| `write/propose.ts` | 4096 | a turn with no `tool_use` |
| `agentic/decide.ts`, `agentic/autopilot.ts`, `summarize/` | various | truncated structural output |

The worst case is data loss, not degradation. When summarize returns no text block, `textOf()`
returns `""`, and `/api/ask` **persists that empty summary while advancing `summarized_upto`**. The
folded turns are gone — permanently, with no error raised anywhere. The user sees a conversation
that quietly forgot its own beginning.

None of this is visible to `typecheck`, `lint`, `test`, or `build`. The types are identical, the
mocks return whatever the fixture says, and the call sites did not change.

## Decision

**Every raw Anthropic request states `thinking` explicitly. Never rely on the model default.**

- The short and structural calls pass `{ type: "disabled" }` — `generateTitle`, both summarize
  implementations, `decide`, `autopilot`, `propose` — reproducing pre-branch behaviour with their
  budgets untouched.
- **Ask keeps thinking ON deliberately**: a Sonnet-tier model with thinking disabled reaches for
  tools noticeably less, which degrades Ask. Its budgets rise to make room — streaming rounds
  4096 → 8192, capped final call 1024 → 4096.
- `propose.ts` chose `disabled` on purpose: its 4096 budget was sized for a no-thinking model, its
  system prompt already prescribes the tool sequence step by step, and its failure mode degrades to
  a user-visible clarification rather than lost work.

Pinned by a **source-scan** test, `src/lib/ai/model-request-shape.test.ts`: no Anthropic request may
omit `thinking`, and every feature reaching `runAi` must be routed by the model map. It scans source
rather than exercising behaviour because the defect lives in what the code _doesn't_ say.

## Rationale

**A model id is not a drop-in parameter.** Request-shape defaults differ per model, so the same body
means different things to different models. The map already encoded one instance of this (Haiku 4.5
rejects `output_config.effort` and needs the older `{ type: "enabled", budget_tokens }` form) — this
gotcha is the same lesson arriving through the default rather than through a 400.

**`max_tokens` is a shared budget, not a response-length knob.** Turning thinking on without raising
`max_tokens` silently trades output for reasoning. There is no error; the response is simply shorter,
or empty.

**Empty-string-is-a-valid-value is the amplifier.** A degraded response became irreversible data loss
only because the pipeline advanced a cursor without ever asking "did we actually get text?". Any code
that commits an irreversible state change on the strength of a model response needs that check —
same shape as [[2026-08-01-gotcha-70-an-interactive-path-reused-unattended-fails-silently]]: a path
that succeeds structurally while doing nothing useful.

The same review wave caught a sibling of this bug: metering `choice.model` when **only the Anthropic
adapter honours `choice`** billed a BYO org running Gemini ($0.10/$0.40 per MTok) at Sonnet 5's
$3/$15 — roughly 30× over their credit ceiling. Both bugs are "a value that used to be true about
the whole system is now true of only one branch of it".

## Consequences

- Positive: the source-scan test fails on any new raw Anthropic call that omits `thinking`, which is
  the only moment the omission is visible.
- Positive: measured live on 2026-08-02 — cost fell 75% ($0.167 → $0.041/turn) and **output tokens
  went down** (1858 → 1114 avg), so the feared thinking-inflation did not materialise.
- Negative / follow-up: `ThinkingConfig` in `src/lib/ai/model-map.ts` has **no `disabled` variant**,
  so call sites pass the literal `{ type: "disabled" }` and 4 of 12 map entries carry a `thinking`
  value that is deliberately ignored. Inert config is a fresh trap in its own right; the source-scan
  test does not guard it.
- **Checklist for the next model migration** — changing any model id requires re-answering, per call
  site: (1) does the new model's *default* `thinking` differ? (2) is `max_tokens` still enough for
  thinking **plus** the output that site needs? (3) does the new model accept the same knobs
  (`effort`, thinking shape)? (4) does anything downstream treat an empty response as a valid value?

## Related

- `[[2026-07-27-1254-ask-stream-honesty-drop-recovery-thinking]]` — earlier round on the same
  surface; Ask's thinking behaviour has now bitten twice.
- `docs/superpowers/specs/2026-08-01-ai-cogs-reduction-design.md` and
  `docs/superpowers/plans/2026-08-01-ai-cogs-reduction.md`
- `[[2026-08-01-gotcha-69-a-cookie-gate-turns-a-cron-post-into-a-silent-405]]` — same family: a
  green signal that means "did nothing", not "did the thing".
