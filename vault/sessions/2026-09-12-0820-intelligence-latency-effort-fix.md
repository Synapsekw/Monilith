---
type: session
date: 2026-09-12-0820
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-09-12-gotcha-104-an-adapter-routed-feature-silently-inherits-adaptive-thinking]]"
  - "[[2026-09-12-0745-intelligence-size-clamp-and-promote-122]]"
  - "[[2026-09-11-2124-board-intelligence-phase2-advise]]"
---

# Board Intelligence latency — effort, not disabled thinking

## What changed

- Merged `task/intelligence-latency` into `develop` at `38d0f4c0` (3 commits). Board Intelligence
  now asks for `effort: "low"` through a new `withEffort` helper in `providers/request.ts`, instead
  of inheriting `DEFAULT_SHAPE`'s effort `"high"`.
- Diagnosed from data, not feel: the single `board_intelligence_runs` row billed **5284 output
  tokens for a 2614-character payload** (~700 tokens). ~85% of the cost and of the two-minute wait
  was reasoning the call site never asked for and could not see.
- **The first fix was wrong and the whole-branch review caught it** — sixth session running. It sent
  `thinking: { type: "disabled" }`, following four existing precedents, and passed all four gates.
  Claude Fable 5/5.1 reject that with a 400, and both are **active** rows in `ai_models`; `pickModel`
  puts an org's default model above the feature's tier hint, so one admin choosing Fable in Settings
  would have made every run fail. Reverted in `c2783356`.
- Wrote [[2026-09-12-gotcha-104-an-adapter-routed-feature-silently-inherits-adaptive-thinking]].
- Nothing announced on `/updates` — see Open threads.

## Why

Latency was the owner's one standing complaint about a feature that is otherwise live and working.
The handover ranked it second behind manual verification, and it was the only queue item that did
not need a browser. The deeper find is that the precedents which made the wrong fix look obviously
right were written against the **raw Anthropic client on a pinned Sonnet model**; Board Intelligence
runs through a `ProviderAdapter` on **whatever model the org chose**. Same-looking code, different
constraint — which is exactly how a latent 400 nearly shipped behind four green gates.

## How to test

Not verified in a browser this session — the Chrome extension is down and the e2e provisioner
refuses DEV by design. The owner drives; this also collects the measurement the fix is owed.

1. Pull `develop` and run `pnpm dev`. Open any board with recent activity (the one with a run row is
   `10dff9ab-c576-40b1-876b-ce59c19d9896`).
2. Click **"Catch me up"** on the Intelligence strip. **Time it.** Baseline was ~2 minutes.
3. Read the real number, not the feeling:
   `select model, tokens_in, tokens_out, generated_at from board_intelligence_runs order by generated_at desc limit 2;`
   Compare `tokens_out` against the 5284 baseline. A large drop is the fix working.
4. Check the brief is still **good**: the prose should describe the last 7 days accurately, and the
   suggestion cards should point at real rows. Open a "why?" popover and confirm the evidence names
   items that exist.
5. Watch the dev terminal for `[intelligence] dropped suggestions`. That line is the degradation
   signal — if it appears, effort `"low"` is grounding worse and the step-up to `"medium"` is one
   word in `generate.ts`.
6. While you are there, the Phase 2 walkthrough (steps 4–12 of
   [[2026-09-11-2124-board-intelligence-phase2-advise]]) is still owed and unrun: Apply + Undo
   including a ranged due date where the END must move, Dismiss across reload, "Show rows" driving
   the strip chip and `?intel=`, viewer mode showing no write buttons, Nudge posting an update.

## Open threads

- **The measurement is owed.** The fix is merged unmeasured; step 3 above is the proof. Nothing was
  announced on `/updates` for exactly this reason — "faster briefs" is an outcome claim, and
  asserting it before observing it once is the thing this vault keeps warning about.
- **`requestShapeFor` is wrong about five active models — pre-existing, and bigger than this fix.**
  Its `/haiku/i` two-bucket split sends `effort: "high"` to `claude-sonnet-4.5`, `claude-sonnet-4`
  and `claude-opus-4` (all reject the key), adaptive thinking to `claude-opus-4.5` (pre-4.6, needs
  `budget_tokens`), and `budget_tokens` to `claude-3-haiku` (supports no thinking at all). Every
  adapter-routed feature is exposed, on `develop` today. Deliberately not fixed here — different
  blast radius, needs its own task. Likely repair: shape per model from the feed's
  `reasoning_options`, which already carries the fact.
- Six other `toRequestArgs` callers still run at effort `"high"` and unmeasured:
  `digest/narrative`, `board-generate`, `automation-generate`, `import-mapping-generate`,
  `ai/generate`, `reports/ai-draft`. Some probably want it. Measure each from `ai_usage` first.
- Phases 3 (Act) and 4 (Ask) remain specced, never planned.
- `develop` is unpromoted: the agent-dock rebuild, its review repairs, and now this.
- Still open from the handover: the OpenAI, openai-compatible and Google adapters pass the
  deprecated `system` option — same defect class as the four-day outage, and no test would catch it.

## Next session entry point

Get the owner through the walkthrough above — it closes both the latency measurement and the Phase 2
verification debt in one pass. Then `brainstorming` → `writing-plans` for Phase 3 (Act) from spec §5.
