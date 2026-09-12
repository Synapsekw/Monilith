---
type: adr
date: 2026-09-12
status: accepted
tags: [decision, gotcha, ai, providers, performance, cost]
related:
  - "[[2026-09-12-0745-intelligence-size-clamp-and-promote-122]]"
  - "[[2026-09-11-2124-board-intelligence-phase2-advise]]"
  - "[[2026-09-12-gotcha-103-a-limit-the-model-was-never-told-is-a-permanent-paid-failure]]"
---

# Gotcha 104 — an adapter-routed feature silently inherits effort "high"

## What happened

The owner's one complaint about Board Intelligence was that a brief takes about two minutes. The
obvious reading — "the model is slow" — was wrong, and the numbers said so before any code was read.

The first real run stored `tokens_in 14818, tokens_out 5284` in `board_intelligence_runs`. The
payload it stored was 2614 characters, roughly 700 tokens. So about **85% of the billed output, and
of the wall-clock the user was waiting through, was reasoning nobody chose.**

Nobody chose it because nobody could see it. `generateBoardIntelligence` never passed `thinking` or
`effort`, so `toRequestArgs` called `requestShapeFor(model)`, which for any non-Haiku model returns
`DEFAULT_SHAPE = { thinking: { type: "adaptive" }, effort: "high" }`. Every call reasoned at the
maximum-but-one setting, and the call site said nothing about it at all.

## The wrong fix, and why it was wrong

The first attempt sent `thinking: { type: "disabled" }`, following the four features that already do
exactly that — `ask/context`, `write/propose`, `summarize`, `agentic/decide`. It passed all four
gates. **The whole-branch review caught it, for the sixth session running.**

Turning thinking off is not portable:

- **Claude Fable 5 / 5.1 reject `{ type: "disabled" }` with a 400 outright.** Thinking is always on
  there; the parameter must be omitted or sent as `adaptive`.
- **Claude Opus 5 accepts it only at effort `high` or below** — `xhigh`/`max` with disabled thinking
  is a 400. It worked only by accident of `DEFAULT_SHAPE.effort` happening to be `"high"`.
- Even where accepted, disabling thinking on Opus 5 is documented to make the model occasionally
  write a tool call into its **visible text** instead of a `tool_use` block, and to leak `<thinking>`
  tags into the response.

`claude-fable-5` and `claude-fable-5.1` are **active** rows in `ai_models`, and `pickModel` puts an
org's `orgDefaultModelId` **above** the feature's tier hint. So one admin choosing Fable in
Settings → AI → Default model would have turned every Board Intelligence run into a hard 400 — on a
path that ran fine before the "fix". No org has a Fable default today, which is exactly what makes
it the dangerous kind of defect: latent, invisible to every gate, and armed by a settings change
made months later by someone who will never connect the two.

The four precedents were not wrong — they were written against the **raw Anthropic client**, pinned
to a Sonnet-tier model, with a tight `max_tokens` that a thinking block would have eaten whole.
Board Intelligence goes through a `ProviderAdapter` that runs **whatever model the org chose**. The
lesson did not transfer because the constraint is not the same constraint.

## Decision

**A feature tunes reasoning with `effort`, never by turning thinking off.**

- Board Intelligence sends `effort: "low"` via a new `withEffort` helper in
  `providers/request.ts`, and leaves `thinking` on the model's own shape.
- `withEffort` overrides the **level** only where the model already accepts the knob. Haiku 4.5
  rejects `output_config.effort` entirely, which is why `requestShapeFor` leaves it `undefined`
  there — the helper preserves that absence rather than introducing the key.
- `"low"` rather than `"medium"` because degradation here is **visible**:
  `validateIntelligenceOutput` drops any suggestion not grounded in a real item id and logs
  `[intelligence] dropped suggestions`. If that line starts appearing, step up to `"medium"` — and
  measure it from `board_intelligence_runs.tokens_out`, not by feel.

The general rule: **the model's default shape is a property of the MODEL; the reasoning level is a
decision about the FEATURE.** Only the second belongs at a call site, and only through a knob every
model in the catalog accepts.

## Still open

`toRequestArgs` has six other callers, none of which state `effort`, and all of which therefore run
at `"high"`:

`digest/narrative`, `board-generate`, `automation-generate`, `import-mapping-generate`,
`ai/generate`, `reports/ai-draft`.

Some of those probably *want* high effort — board generation is creative work, and a background
digest is not waiting on a user. That is the point: it should be a decision per feature, recorded at
the call site, not an inherited default. Each needs its own measurement from `ai_usage` before
anything changes; **do not sweep them.**

## How to spot it next time

Two rules, both cheap:

1. **Before blaming a model for latency, divide.** Read `tokens_out` from the feature's own run
   table and compare it to the size of what was actually stored. A large gap is not the model being
   slow — it is reasoning the call site never asked for and cannot see.
2. **A provider knob is only safe if every model in the catalog accepts it.** `ai_models` holds rows
   from four families and an org admin picks between them at runtime, so "it works on Sonnet" is not
   evidence. Check the per-model rules before hard-coding any request parameter — and remember that
   `pickModel` lets the org default outrank the tier the feature asked for.
