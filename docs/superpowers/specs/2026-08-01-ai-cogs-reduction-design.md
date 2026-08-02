# AI COGS reduction — design

- **Date:** 2026-08-01
- **Status:** approved (design), plan pending
- **Depends on:** nothing. No Stripe credentials, no new infrastructure.
- **Blocks:** `2026-08-01-billing-and-monetization-design.md` — the price points in that spec assume the unit economics this one delivers.

## Context

Monolith is about to sell AI as a metered product. Before a price can be set, the
cost has to be known and controlled. It currently is neither.

Every AI call in the product runs on a single model constant —
`MODEL = "claude-opus-4-8"` (`src/lib/ai/providers/anthropic.ts:17`) at **$5 / $25 per
MTok** — and only the system prompt is cached. These are the measured per-call costs
from the `ai_usage` ledger:

| feature                 | avg input tok | avg output tok | avg $/call |
| ----------------------- | ------------: | -------------: | ---------: |
| `ask_pulse`             |        26,124 |          1,446 |  **0.167** |
| `conversational_action` |        10,005 |            312 |  **0.058** |
| `import_mapping`        |         2,062 |            581 |      0.025 |
| `dashboard_gen`         |         1,214 |            561 |      0.020 |
| `report_narrative`      |           789 |            519 |      0.017 |
| `automation_gen`        |         1,479 |            328 |      0.016 |
| `item_assist`           |           366 |             90 |      0.004 |

Two facts drive the whole design:

1. **Ask Monolith is 78% input cost.** 26k input tokens × $5/MTok = $0.131 of the
   $0.167. It is an agentic tool-use loop pulling board data into context, and that
   context is re-sent on every turn of a conversation, so cost grows superlinearly
   within a single Ask session.
2. **`item_assist` sends 366 input tokens to a frontier model.** There is no quality
   argument for that; it is simply the only model wired up.

Projected managed cost per user per month today: **$3.60 light** (20 Asks + 30 small
assists), **$18.70 heavy** (100 Asks + 200 assists). The heavy figure exceeds the
entire seat price of every competing product, which makes a managed AI tier
unsellable until it moves.

## Goal

Cut per-call AI COGS by 60–80% with no user-visible quality regression, and make the
metering ledger correct under caching. Target post-change: **~$1.70 light / ~$8.40
heavy** per user per month.

## Non-goals

- Changing what any AI feature _does_. This is cost and correctness only.
- Streaming, prompt engineering, or context-window management rewrites.
- Anything touching `org_ai_settings`, entitlements, or the credit ceiling
  semantics — those are the billing spec's territory.
- BYO/`per_user` behaviour. The model map applies to managed calls; BYO orgs pay
  their own bill and inherit the same defaults without special-casing.

## Design

Three changes. They are independent of each other except that (3) must land in the
same release as (2), for the correctness reason given below.

### 1. Per-feature model map

`MODEL` is a single exported constant, consumed both directly
(`ask-stream.ts`, `agentic/decide.ts`, `agentic/autopilot.ts`, `column-fill/classify.ts`,
`agentic/actions.ts`) and as `anthropicAdapter.defaultModel`. Replace it with a map
keyed by the same `feature` string already threaded through `runAi`.

```ts
// src/lib/ai/model-map.ts
export type ModelChoice = {
  model: string;
  /** Request-shape config — NOT every model accepts the same knobs. */
  thinking: { type: "adaptive" } | { type: "enabled"; budget_tokens: number };
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
};

export function modelFor(feature: string): ModelChoice;
```

Assignment:

| feature                                                                                   | model              | rationale                                                                    |
| ----------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| `ask_pulse`, `conversational_action`, agentic `decide`/`autopilot`                        | `claude-sonnet-5`  | tool-use loops; Sonnet 5 reaches near-Opus quality on agentic work at $3/$15 |
| `dashboard_gen`, `board_generate`, `automation_gen`, `import_mapping`, `report_narrative` | `claude-sonnet-5`  | structured generation, moderate difficulty                                   |
| `item_assist`, `column_fill`                                                              | `claude-haiku-4-5` | short classification/rewrite at $1/$5                                        |

**Two implementation traps this map exists to absorb:**

- `anthropicAdapter.generateStructured` hardcodes `thinking: { type: "adaptive" }` **and**
  `output_config.effort` (`anthropic.ts:45-49`). Haiku 4.5 accepts neither — `effort`
  errors on it, and it requires the older `thinking: { type: "enabled", budget_tokens: N }`
  form. Sending the current request shape to Haiku returns a 400. The map therefore
  carries request-shape config, not just an ID, and the adapter reads it rather than
  hardcoding.
- Haiku 4.5's context window is **200K**, not 1M. `column_fill` over a very wide board
  must bound its input or fall back to Sonnet. The bound belongs in `classify.ts`.

Opus 4.8 → Sonnet 5 is **token-neutral** (same tokenizer family), so no re-baselining of
`max_tokens` or context budgets is needed on that move. Haiku 4.5 uses an older
tokenizer; its two features send small inputs, so the difference is immaterial.

A fourth, cheap lever available in the same map: `effort` is currently `"high"`
everywhere. Dropping the structured-generation features to `"medium"` reduces thinking
spend further and should be swept per-feature after the model move lands, not
speculatively bundled into it.

### 2. Extend prompt caching past the system prompt

`anthropic.ts:51` sets `cache_control` on the system text block only. Ask's 26k input
is tool definitions and board context, which cache not at all.

Restructure the Ask request so the render order is `tools` → `system` → `messages`
with a `cache_control` breakpoint on the **last stable block before per-turn content**.
Cache reads bill at **~0.1× input**, writes at **1.25×**, so a conversation of three or
more turns is strongly net-positive; a single-turn Ask pays the write premium and
breaks roughly even.

Hard requirements, all of which are silent failures if missed:

- **The cacheable prefix must be byte-stable.** No timestamps, no request IDs, no
  non-deterministic JSON key order, no per-user string interpolated ahead of the
  breakpoint. Tool definitions must be serialized in a fixed order.
- **Minimum cacheable prefix is 1,024 tokens on Sonnet 5.** Shorter prefixes silently
  do not cache — no error, just `cache_creation_input_tokens: 0`.
- **A breakpoint walks back at most 20 content blocks.** Ask's tool-use loop can add
  more than 20 blocks in one turn, at which point the next request's breakpoint finds
  nothing and silently misses. Long turns need an intermediate breakpoint.
- **Max 4 breakpoints per request.**

Verification is not optional and is not a code review: assert
`usage.cache_read_input_tokens > 0` on the second and subsequent turns of a
conversation. If it is zero across identical-prefix requests, a silent invalidator is
present.

### 3. Cache-aware pricing and metering — must ship with (2)

`AiUsageTokens` is `{ inputTokens, outputTokens }` (`pricing.ts:1`), `MODEL_PRICES_PER_MTOK`
is `{ input, output }`, and `anthropic.ts:61-64` maps only `message.usage.input_tokens` /
`output_tokens`. Anthropic returns `cache_read_input_tokens` and
`cache_creation_input_tokens` as **separate fields**, and — critically —
`usage.input_tokens` is the **uncached remainder only**.

So the moment change (2) lands without this one, `computeCostUsd` sees a small fraction
of the real prompt and bills for that fraction. Cache reads (0.1× cost) and cache
writes (1.25× cost) are metered at **zero**. This is a margin leak in the vendor's
favour-not-ours direction: we pay Anthropic for tokens the ledger never records, and
the monthly credit ceiling — the mechanism that caps our exposure per org — stops
seeing the spend it exists to cap. Under a managed-billing model that is a correctness
bug, not a rounding error.

Changes:

```ts
export type AiUsageTokens = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number; // billed at input × 0.10
  cacheWriteTokens?: number; // billed at input × 1.25
};

const MODEL_PRICES_PER_MTOK = {
  "claude-sonnet-5": { input: 3, output: 15 }, // std rate; intro $2/$10 to 2026-08-31
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-4-8": { input: 5, output: 25 }, // retained: historical ledger rows
  // …existing entries unchanged
};
```

`computeCostUsd` derives cache rates from the model's `input` rate rather than storing
four columns per model — the 0.10 / 1.25 multipliers are Anthropic-wide, not
per-model. The new fields are **optional**, so every existing call site and every
existing test keeps compiling and passing unchanged; adapters that do not report cache
tokens simply omit them.

**Price table posture:** list Sonnet 5 at the standard **$3 / $15**, not the
introductory $2 / $10 that expires 2026-08-31. Under-stating our own cost would
over-charge credits against customers and create a cliff when the intro rate ends.
The intro period is a temporary margin bonus, not a number to build on.

**Migration.** `record_ai_usage` takes `p_input_tokens` / `p_output_tokens` and
`ai_usage` has matching columns. Add nullable `cache_read_tokens` and
`cache_write_tokens` columns plus two nullable RPC parameters. Nullable and additive so
historical rows stay valid and the RPC signature change is backward-compatible.

Minted via `scripts/new-migration.sh`, applied to DEV through the `supabase-dev` MCP
with the same version + name, then `pnpm db:ledger-check`. Regenerate types with
`pnpm db:types` **from the main checkout, never from a task worktree** — an unlinked
worktree pipes its own error into `database.types.ts` and wipes it.

## Interfaces

- **Consumes:** `runAi` / `runEmbedding` in `src/lib/ai/gateway.ts` (unchanged signature),
  `record_ai_usage` RPC (two new nullable params), `ProviderAdapter` in
  `src/lib/ai/providers/types.ts`.
- **Produces:** `src/lib/ai/model-map.ts` (`modelFor`, `ModelChoice`); an extended
  `AiUsageTokens`; an extended `MODEL_PRICES_PER_MTOK`; a migration adding two
  `ai_usage` columns.
- **`MODEL` is retained** as `modelFor("__default__").model` so `anthropicAdapter.defaultModel`
  and the existing tests that assert on `"claude-opus-4-8"` have a defined migration path
  rather than breaking on import.

## Performance & data-fetching budget

No UI surface, so working agreement #5's first-paint/interaction clauses do not apply.
The relevant budget is **latency per call**, which improves in the same direction as
cost: Sonnet 5 and Haiku 4.5 are both faster than Opus 4.8, and cache reads cut
time-to-first-token on repeat turns. No new database reads on any hot path; the two new
`ai_usage` columns are write-only from the RPC and are never read on a request path.
`ai_credits_used_this_month` continues to aggregate over the existing indexed
`(org_id, created_at)` access pattern.

## Testing

- **Unit — `pricing.test.ts`:** cache-read tokens bill at 0.10×; cache-write at 1.25×;
  a usage object with the cache fields absent produces byte-identical output to today
  (regression guard for every existing call site).
- **Unit — `model-map.test.ts`:** every feature string used in a `runAi` call resolves
  to a model present in `MODEL_PRICES_PER_MTOK`. This is the guard against the
  `computeCostUsd` unknown-model path, which returns **cost 0** — an unmapped model
  silently bills nothing.
- **Unit — adapter:** Haiku-mapped features produce a request with no `output_config.effort`
  and the `{ type: "enabled", budget_tokens }` thinking shape; Sonnet-mapped features
  produce `{ type: "adaptive" }` with `effort`.
- **Integration — caching:** a two-turn Ask conversation reports
  `cache_read_input_tokens > 0` on turn two, and the ledger row for turn two records a
  non-zero `cache_read_tokens`. This is the only test that actually proves the change
  works; the rest prove it does not break anything.
- **Cost regression:** a scripted comparison of the seven features' measured
  `avg_cost_usd` before and after, run against DEV, recorded in the session note.

Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, plus
`pnpm db:ledger-check` for the migration.

## Independent units (for the execution DAG)

Three units with no shared state:

- **A — model map + adapter request-shape config.** Touches `model-map.ts` (new),
  `providers/anthropic.ts`, and the five direct `MODEL` importers.
- **B — pricing + ledger migration.** Touches `pricing.ts`, the migration, `record_ai_usage`,
  and `gateway.ts`'s two `record_ai_usage` call sites.
- **C — Ask prompt-caching restructure.** Touches `ask/context.ts` and `ask/ask-stream.ts`.

A and B are fully parallel. **C must merge after B** — shipping caching before
cache-aware metering opens the leak described above. The critical path is B → C.
