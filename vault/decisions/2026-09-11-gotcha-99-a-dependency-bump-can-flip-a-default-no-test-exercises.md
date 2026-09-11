---
type: adr
status: accepted
date: 2026-09-11
tags: [adr, gotcha, ai, dependencies, testing]
related:
  - "[[2026-09-11-2124-board-intelligence-phase2-advise]]"
  - "[[2026-08-11-gotcha-89-five-tests-that-could-not-fail-in-one-plan]]"
---

# Gotcha 99 — a dependency bump can flip a default that no test exercises

## What happened

Every Anthropic-routed structured AI feature (dashboard, board and automation generation, import
mapping, report and digest narratives, and the new board brief) failed in production from
2026-09-07 with the generic "AI generation failed" copy. The owner found it on the first click of
"Catch me up". The server action's catch mapped the exception to that copy and logged nothing, and no
`ai_usage` row existed because the throw came before the request was sent.

Root cause: dependabot PR #112 moved `ai` to 7.0.92, whose `standardizePrompt` rejects a
`role: "system"` entry inside `messages` unless `allowSystemInMessages` is set ("Use the instructions
option instead"). The Anthropic adapter built exactly that message on purpose, to carry the
ephemeral `cache_control` breakpoint via `providerOptions`. The OpenAI, compatible and Google adapters
pass the deprecated `system` string, which the SDK still maps to `instructions`, so they kept working
and the ledger showed only OpenAI traffic.

## Why nothing caught it

- Every adapter test injects a fake `generateObject` and asserts the arguments we pass, so the SDK's
  own prompt guard never ran. The one real-`generateObject` test in the repo covered the compatible
  adapter, which did not build a system message.
- `pnpm typecheck` cannot see it: `system` is deprecated, not removed, and `messages` still accepts a
  system-role entry at the type level.
- The dependabot PR's CI was green for the same reason.

## Decision

1. The Anthropic adapter sends the system prompt as `instructions: [SystemModelMessage]`; the SDK
   maps it to the top-level `system` block with `providerOptions` intact, so the cache breakpoint
   survives (`convertToLanguageModelPrompt`).
2. Each adapter carries at least one test that runs the REAL `generateObject` with a fake `fetch`
   and asserts the wire body — the shape `openai-compatible.test.ts` already had. That is the only
   test layer the SDK's own validation passes through.
3. `runBoardIntelligence` logs the real exception; an action that maps every error to one sentence
   must at least leave the cause in the server log.

## The generalisable rule

A minor dependency bump can change a runtime default without changing a type. A test that fakes the
library boundary proves what you send, never what the library accepts. For every third-party call
that a feature depends on, keep one test that lets the library run and fakes only the transport —
and when a catch collapses errors into user copy, log the original.
