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

# Gotcha 104 — an adapter-routed feature silently inherits adaptive thinking

## What happened

The owner's one complaint about Board Intelligence was that a brief takes about two minutes. The
obvious reading — "the model is slow" — was wrong, and the numbers said so before any code was read.

The first real run stored `tokens_in 14818, tokens_out 5284` in `board_intelligence_runs`. The
payload it stored was 2614 characters, roughly 700 tokens. So about **85% of the billed output, and
of the wall-clock the user was waiting through, was extended thinking nobody chose.**

Nobody chose it because nobody could see it. `generateBoardIntelligence` never passed `thinking`, so
`toRequestArgs` called `requestShapeFor(model)`, which for any non-Haiku model returns
`DEFAULT_SHAPE = { thinking: { type: "adaptive" }, effort: "high" }`. The feature was thinking at
effort "high" on every call, and the call site said nothing at all about thinking.

The second half is what made it un-fixable rather than merely unnoticed: **`ThinkingConfig` had no
`disabled` member.** The four features that already turn thinking off — `ask/context`,
`write/propose`, `summarize`, `agentic/decide` — all talk to the raw Anthropic SDK client, where
`{ type: "disabled" }` is just a wire value. Every feature routed through a `ProviderAdapter` shared
one union that could express "adaptive" and "enabled" and nothing else. The type system did not
merely fail to warn about the default; it made the override unrepresentable.

This is why the comment discipline in those four files never spread: they were written against a
different seam, and the lesson stopped at the seam's edge.

## Decision

**A feature that meters a model call states its `thinking` explicitly. The default shape is a
property of the MODEL, never a decision about the FEATURE.**

- `ThinkingConfig` gains `{ type: "disabled" }`. `requestShapeFor` still never returns it — it is
  there so a call site can override, which is the only place the judgement belongs.
- Board Intelligence sends `thinking: { type: "disabled" }`. Disabled rather than a small budget
  because **degradation here is visible**: `validateIntelligenceOutput` drops any suggestion not
  grounded in a real item id and logs `[intelligence] dropped suggestions`. A model that grounds
  worse with thinking off announces itself in the logs instead of quietly shipping a worse brief.
  That log line is the thing to watch before concluding the trade was good.
- `effort` is deliberately NOT overridden. It is an `output_config` knob, orthogonal to thinking,
  and Haiku rejects the key entirely — it must keep riding the model's own shape.

## The test that can actually catch this

A fake `generateObject` cannot. `providerOptions` are parsed by a zod schema that **strips unknown
keys instead of throwing**, so a thinking shape the SDK does not recognise disappears with no error:
the code reads "thinking off" while the model keeps thinking and the user keeps waiting. This is the
same mechanism as the four-day structured-output outage — a silently dropped option, no exception,
no failing test.

So the assertion lives in the real-`generateObject` harness in `anthropic.test.ts`, reading the
actual request body off a faked `fetch`, and it asserts **both halves**: that the override reaches
the wire as `{ type: "disabled" }`, and that the same call *without* the override still sends
`{ type: "adaptive" }`. Without the control half, a regression that dropped `thinking` entirely
would leave the first assertion passing for the wrong reason.

## Still open

`toRequestArgs` has six other callers, none of which state `thinking`, and all of which therefore
run adaptive at effort "high":

`digest/narrative`, `board-generate`, `automation-generate`, `import-mapping-generate`,
`ai/generate`, `reports/ai-draft`.

Some of those probably *want* thinking — board generation is creative work, and a background digest
is not waiting on a user. That is exactly the point: it should be a decision per feature, recorded
at the call site, not an inherited default. Each one needs its own measurement from `ai_usage`
before anything is changed; **do not sweep them.**

## How to spot it next time

Before blaming a model for latency, divide. Read `tokens_out` from the feature's own run table and
compare it to the size of what was actually stored. A large gap is not the model being slow — it is
reasoning the call site never asked for and cannot see.
