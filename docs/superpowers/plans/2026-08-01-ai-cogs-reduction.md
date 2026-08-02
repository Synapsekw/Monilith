# AI COGS Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut measured per-call AI cost by 60–80% by routing each feature to an appropriately-sized model and caching Ask's large prompt prefix — without letting the usage ledger under-bill once caching lands.

**Architecture:** A new `model-map.ts` module maps the `feature` string already threaded through `runAi` to a model plus its request-shape config (models do not accept the same knobs). `pricing.ts` grows optional cache-token fields so `computeCostUsd` can price cache reads at 0.10× and cache writes at 1.25× of the input rate. Ask's system prompt becomes a cacheable content block and its accumulated tool results get a rolling cache breakpoint.

**Tech Stack:** TypeScript (strict), Next.js 16 App Router, `@anthropic-ai/sdk`, Vitest, Supabase Postgres migrations.

**Spec:** `docs/superpowers/specs/2026-08-01-ai-cogs-reduction-design.md`

## Global Constraints

- **Never widen `AiUsageTokens` with required fields.** Every new field is optional so all existing call sites and tests compile and pass unchanged.
- **An unknown model costs $0.** `computeCostUsd` returns 0 for models absent from `MODEL_PRICES_PER_MTOK` — an unmapped model silently bills nothing. Every model the map can emit must exist in the price table, enforced by a test.
- **Price Sonnet 5 at the standard $3 / $15**, never the introductory $2 / $10 that expires 2026-08-31. Under-stating our cost over-charges customer credits and creates a cliff.
- **Haiku 4.5 rejects `output_config.effort`** and requires `thinking: { type: "enabled", budget_tokens: N }`. Sending the Sonnet/Opus request shape to Haiku returns a 400.
- **Haiku 4.5's context window is 200K**, not 1M.
- **Anthropic's `usage.input_tokens` is the uncached remainder only.** `cache_read_input_tokens` and `cache_creation_input_tokens` are separate fields and must be captured or the ledger under-bills.
- **Prompt caching minimum is 1,024 tokens on Sonnet 5**; shorter prefixes silently do not cache. Max **4** breakpoints per request; a breakpoint looks back at most **20** content blocks.
- **Migrations are minted only via `scripts/new-migration.sh <slug>`** — never hand-stamp a version. Apply to DEV via the `supabase-dev` MCP with the **same version + name** as the committed file, then verify with `pnpm db:ledger-check`.
- **Run `pnpm db:types` only from the main checkout**, never a task worktree — an unlinked worktree pipes its own error into `database.types.ts` and wipes ~2,900 lines.
- **Commit identity is `Danijel Jovanovic <info@synapse-solutions.ai>`.** Stage explicitly by path; never `git add -A`.
- **Commit subjects are lowercase after `type(scope):`**, with a descriptive body and the `Co-Authored-By` trailer, or husky rejects the commit.
- Test a single file with `pnpm vitest run --project unit <path>`.

## Execution DAG

| batch | tasks                  | note                            |
| ----- | ---------------------- | ------------------------------- |
| 1     | **Task 1**, **Task 3** | no dependencies; fully parallel |
| 2     | **Task 2**, **Task 4** | Task 2 needs 1; Task 4 needs 3  |
| 3     | **Task 5**             | needs 4                         |
| 4     | **Task 6**             | needs 2 and 5                   |
| 5     | **Task 7**             | needs everything                |

Critical path: **1 → 2 → 6 → 7**.

---

### Task 1: Cache-aware pricing

**Files:**

- Modify: `src/lib/ai/pricing.ts`
- Test: `src/lib/ai/pricing.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `type AiUsageTokens = { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }`; `computeCostUsd(model: string, usage: AiUsageTokens): number` (unchanged signature); `costToCredits(costUsd: number): number` (unchanged); `MODEL_PRICES_PER_MTOK` gains `claude-sonnet-5` and `claude-haiku-4-5`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/ai/pricing.test.ts`, inside the existing `describe("pricing", …)`:

```ts
it("prices sonnet-5 and haiku-4-5 at their standard per-MTok rates", () => {
  expect(
    computeCostUsd("claude-sonnet-5", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    }),
  ).toBeCloseTo(18, 6);
  expect(
    computeCostUsd("claude-haiku-4-5", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    }),
  ).toBeCloseTo(6, 6);
});

it("prices cache reads at 0.10x and cache writes at 1.25x the input rate", () => {
  // sonnet-5 input is $3/MTok -> read $0.30/MTok, write $3.75/MTok
  expect(
    computeCostUsd("claude-sonnet-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
    }),
  ).toBeCloseTo(0.3, 6);
  expect(
    computeCostUsd("claude-sonnet-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 1_000_000,
    }),
  ).toBeCloseTo(3.75, 6);
});

it("sums uncached input, cache reads, cache writes and output", () => {
  expect(
    computeCostUsd("claude-sonnet-5", {
      inputTokens: 1000, // 0.003
      outputTokens: 500, // 0.0075
      cacheReadTokens: 20_000, // 0.006
      cacheWriteTokens: 4_000, // 0.015
    }),
  ).toBeCloseTo(0.0315, 6);
});

it("is byte-identical to the pre-cache behaviour when cache fields are absent", () => {
  // Regression guard: every existing call site omits the new fields.
  expect(
    computeCostUsd("claude-opus-4-8", { inputTokens: 2000, outputTokens: 500 }),
  ).toBeCloseTo(0.0225, 6);
});

it("returns 0 for an unknown model even when cache tokens are present", () => {
  expect(
    computeCostUsd("some-future-model", {
      inputTokens: 1000,
      outputTokens: 1000,
      cacheReadTokens: 50_000,
      cacheWriteTokens: 10_000,
    }),
  ).toBe(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run --project unit src/lib/ai/pricing.test.ts`
Expected: FAIL — the two new models price to 0, and the cache assertions return 0 because the fields are ignored.

- [ ] **Step 3: Implement**

Replace the body of `src/lib/ai/pricing.ts`:

```ts
export type AiUsageTokens = {
  inputTokens: number;
  outputTokens: number;
  /** Prompt-cache hits. Billed at 0.10x the model's input rate. */
  cacheReadTokens?: number;
  /** Prompt-cache writes. Billed at 1.25x the model's input rate. */
  cacheWriteTokens?: number;
};

/** Anthropic-wide cache multipliers, applied to each model's input rate. */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/**
 * USD per million tokens, by model id. Source of truth for metering.
 * Maintain alongside the provider catalog when models change.
 *
 * Sonnet 5 is listed at its STANDARD $3/$15, not the introductory $2/$10 that
 * expires 2026-08-31 — under-stating our own cost would over-charge customer
 * credits and create a cliff when the intro rate ends.
 */
const MODEL_PRICES_PER_MTOK: Readonly<
  Record<string, Readonly<{ input: number; output: number }>>
> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  // Fixed platform embedding model (E5 · F15). Input-only: embeddings emit no
  // completion tokens, so output is 0 and computeCostUsd is input-only arithmetic.
  "text-embedding-3-small": { input: 0.02, output: 0 },
};

/** Every model id the model map may emit must be priced here. */
export const PRICED_MODELS = Object.keys(MODEL_PRICES_PER_MTOK);

/** Cost in USD for one call. Unknown models cost 0 (tokens are still logged). */
export function computeCostUsd(model: string, usage: AiUsageTokens): number {
  const price = MODEL_PRICES_PER_MTOK[model];
  if (!price) return 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      cacheRead * price.input * CACHE_READ_MULTIPLIER +
      cacheWrite * price.input * CACHE_WRITE_MULTIPLIER) /
    1_000_000
  );
}

/** 1 credit = $0.01, rounded to 2 decimal places. */
export function costToCredits(costUsd: number): number {
  // USD → credits (×100), then round to 2dp
  return Math.round(costUsd * 10000) / 100;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run --project unit src/lib/ai/pricing.test.ts`
Expected: PASS — all nine tests, including the four pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/pricing.ts src/lib/ai/pricing.test.ts
git commit -m "feat(ai): price prompt-cache reads and writes

Adds optional cacheReadTokens/cacheWriteTokens to AiUsageTokens and prices
them at 0.10x and 1.25x the model's input rate. Adds claude-sonnet-5 and
claude-haiku-4-5 at standard rates. Fields are optional so every existing
call site is unchanged.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `ai_usage` cache columns + `record_ai_usage` rebuild

**Files:**

- Create: `supabase/migrations/<generated>_ai_usage_cache_tokens.sql`
- Modify: `src/lib/ai/gateway.ts:92-102` and `src/lib/ai/gateway.ts:143-153`
- Modify: `src/types/database.types.ts` (regenerated, never hand-edited)
- Test: `src/lib/ai/gateway.test.ts`

**Interfaces:**

- Consumes: `AiUsageTokens` with cache fields, `computeCostUsd` (Task 1).
- Produces: `record_ai_usage(uuid, uuid, text, text, text, integer, integer, numeric, numeric, integer, integer)` — the two new trailing params are `p_cache_read_tokens` and `p_cache_write_tokens`, both nullable with default 0.

> **`create or replace function` will NOT replace this function.** The existing declaration is a 9-argument signature, and a different argument list produces an **overload** — two `record_ai_usage` functions, an ambiguous PostgREST RPC, and revoked grants that no longer match. The migration must `drop function` by its full signature first. This is [[2026-06-19-gotcha-18-create-or-replace-function-overload]].

- [ ] **Step 1: Mint the migration**

Run: `scripts/new-migration.sh ai_usage_cache_tokens`
Expected: a new empty file under `supabase/migrations/`. Note its exact version + name — you need both when applying to DEV.

- [ ] **Step 2: Write the migration SQL**

```sql
-- Cache-aware metering. Anthropic reports cache reads/writes as separate token
-- buckets from input_tokens (which is the UNCACHED remainder), so pricing that
-- ignores them under-bills once prompt caching is enabled.
alter table public.ai_usage
  add column if not exists cache_read_tokens integer,
  add column if not exists cache_write_tokens integer;

-- Drop before create: a different argument list would create an OVERLOAD
-- rather than replacing the function, leaving an ambiguous PostgREST RPC.
drop function if exists public.record_ai_usage(
  uuid, uuid, text, text, text, integer, integer, numeric, numeric
);

create function public.record_ai_usage(
  p_org uuid, p_user uuid, p_feature text, p_provider text, p_model text,
  p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric, p_credits numeric,
  p_cache_read_tokens integer default 0, p_cache_write_tokens integer default 0
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.ai_usage
    (org_id, user_id, feature, provider, model, input_tokens, output_tokens,
     cost_usd, credits, cache_read_tokens, cache_write_tokens)
  values
    (p_org, p_user, p_feature, p_provider, p_model, p_input_tokens, p_output_tokens,
     p_cost_usd, p_credits, coalesce(p_cache_read_tokens, 0), coalesce(p_cache_write_tokens, 0));
$$;

-- Grants do not survive the drop — re-assert them for the NEW signature.
revoke all on function public.record_ai_usage(
  uuid, uuid, text, text, text, integer, integer, numeric, numeric, integer, integer
) from public, anon, authenticated;
grant execute on function public.record_ai_usage(
  uuid, uuid, text, text, text, integer, integer, numeric, numeric, integer, integer
) to service_role;
```

- [ ] **Step 3: Apply to DEV and verify the ledger**

Apply via the `supabase-dev` MCP `apply_migration` tool using the **same version and name** as the committed file (a drifted version label is [[2026-07-11-gotcha-55-mcp-apply-migration-version-drifts-from-committed-file]]).

Run: `pnpm db:ledger-check`
Expected: file count == DEV row count, no drift reported.

- [ ] **Step 4: Regenerate types**

Run from the **main checkout** (never a worktree): `pnpm db:types`
Expected: `src/types/database.types.ts` gains `cache_read_tokens` / `cache_write_tokens` on `ai_usage` and the two new `record_ai_usage` args. Confirm the file is still ~2,900 lines — if it collapsed to an error string, `git checkout` it and re-run from the linked checkout.

- [ ] **Step 5: Write the failing gateway test**

Append to `src/lib/ai/gateway.test.ts`:

```ts
it("passes cache token counts through to record_ai_usage", async () => {
  const rpc = vi.fn().mockResolvedValue({ error: null });
  // (Reuse this file's existing service-client mock; only the rpc spy is new.)
  await runAi({ orgId: "org-1", userId: "user-1", feature: "ask_pulse" }, () =>
    Promise.resolve({
      result: "ok",
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 20_000,
        cacheWriteTokens: 4_000,
      },
      model: "claude-sonnet-5",
    }),
  );

  expect(rpc).toHaveBeenCalledWith(
    "record_ai_usage",
    expect.objectContaining({
      p_model: "claude-sonnet-5",
      p_input_tokens: 1000,
      p_output_tokens: 500,
      p_cache_read_tokens: 20_000,
      p_cache_write_tokens: 4_000,
      p_cost_usd: 0.0315,
      p_credits: 3.15,
    }),
  );
});

it("defaults cache token counts to 0 when the adapter omits them", async () => {
  const rpc = vi.fn().mockResolvedValue({ error: null });
  await runAi(
    { orgId: "org-1", userId: "user-1", feature: "item_assist" },
    () =>
      Promise.resolve({
        result: "ok",
        usage: { inputTokens: 100, outputTokens: 50 },
        model: "claude-haiku-4-5",
      }),
  );

  expect(rpc).toHaveBeenCalledWith(
    "record_ai_usage",
    expect.objectContaining({
      p_cache_read_tokens: 0,
      p_cache_write_tokens: 0,
    }),
  );
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm vitest run --project unit src/lib/ai/gateway.test.ts`
Expected: FAIL — `p_cache_read_tokens` is not present in the RPC payload.

- [ ] **Step 7: Wire the gateway**

In `src/lib/ai/gateway.ts`, in **both** `runAi` (the `svc.rpc("record_ai_usage", …)` call) and `runEmbedding` (the `typedRpc(svc, "record_ai_usage", …)` call), add two properties immediately after `p_output_tokens`:

```ts
    p_cache_read_tokens: usage.cacheReadTokens ?? 0,
    p_cache_write_tokens: usage.cacheWriteTokens ?? 0,
```

Nothing else in either function changes — `computeCostUsd` and `costToCredits` already read the new fields.

- [ ] **Step 8: Run to verify it passes**

Run: `pnpm vitest run --project unit src/lib/ai/gateway.test.ts`
Expected: PASS, including the file's pre-existing assertions.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations src/types/database.types.ts src/lib/ai/gateway.ts src/lib/ai/gateway.test.ts
git commit -m "feat(ai): record cache token counts in the usage ledger

Adds nullable cache_read_tokens/cache_write_tokens to ai_usage and rebuilds
record_ai_usage with two defaulted trailing params. Dropped before create:
a changed argument list would overload rather than replace, leaving an
ambiguous PostgREST RPC and stale grants.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Model map module

**Files:**

- Create: `src/lib/ai/model-map.ts`
- Test: `src/lib/ai/model-map.test.ts`

**Interfaces:**

- Consumes: `PRICED_MODELS` from `src/lib/ai/pricing.ts` (Task 1) — used only by the test.
- Produces: `type ThinkingConfig`, `type ModelChoice`, `modelFor(feature: string): ModelChoice`, `DEFAULT_MODEL_CHOICE`, `AI_FEATURES` (the list of every feature string the app passes to `runAi`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/ai/model-map.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  AI_FEATURES,
  DEFAULT_MODEL_CHOICE,
  modelFor,
} from "@/lib/ai/model-map";
import { PRICED_MODELS, computeCostUsd } from "@/lib/ai/pricing";

describe("model-map", () => {
  it("routes conversational and agentic features to sonnet-5", () => {
    for (const f of [
      "ask_pulse",
      "conversational_action",
      "agentic_decide",
      "agentic_autopilot",
    ]) {
      expect(modelFor(f).model).toBe("claude-sonnet-5");
    }
  });

  it("routes short classification features to haiku-4-5", () => {
    expect(modelFor("item_assist").model).toBe("claude-haiku-4-5");
    expect(modelFor("column_fill").model).toBe("claude-haiku-4-5");
  });

  it("gives haiku the enabled-thinking shape and NO effort (haiku rejects effort)", () => {
    const haiku = modelFor("item_assist");
    expect(haiku.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
    expect(haiku.effort).toBeUndefined();
  });

  it("gives sonnet adaptive thinking with an effort level", () => {
    const sonnet = modelFor("ask_pulse");
    expect(sonnet.thinking).toEqual({ type: "adaptive" });
    expect(sonnet.effort).toBe("high");
  });

  it("falls back to the default choice for an unmapped feature", () => {
    expect(modelFor("not_a_feature")).toEqual(DEFAULT_MODEL_CHOICE);
  });

  // The guard that matters: computeCostUsd returns 0 for an unpriced model, so
  // an unmapped model silently bills NOTHING.
  it("only emits models that are priced", () => {
    for (const f of AI_FEATURES) {
      expect(PRICED_MODELS).toContain(modelFor(f).model);
      expect(
        computeCostUsd(modelFor(f).model, {
          inputTokens: 1_000_000,
          outputTokens: 0,
        }),
      ).toBeGreaterThan(0);
    }
    expect(PRICED_MODELS).toContain(DEFAULT_MODEL_CHOICE.model);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run --project unit src/lib/ai/model-map.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/model-map`.

- [ ] **Step 3: Implement**

Create `src/lib/ai/model-map.ts`:

```ts
/**
 * Per-feature model routing. Keyed by the SAME `feature` string already
 * threaded through runAi, so no new plumbing is needed at call sites.
 *
 * Carries request-shape config, not just a model id: models do not accept the
 * same knobs. Haiku 4.5 rejects `output_config.effort` and requires the older
 * `{ type: "enabled", budget_tokens }` thinking form — sending the Sonnet/Opus
 * request shape to Haiku returns a 400.
 *
 * NOTE: every model emitted here must exist in MODEL_PRICES_PER_MTOK.
 * computeCostUsd returns 0 for an unknown model, so an unpriced model bills
 * nothing at all. model-map.test.ts enforces this.
 */

export type ThinkingConfig =
  | { type: "adaptive" }
  | { type: "enabled"; budget_tokens: number };

export type ModelChoice = {
  model: string;
  thinking: ThinkingConfig;
  /** Omitted for models that reject output_config.effort (Haiku 4.5). */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
};

const SONNET: ModelChoice = {
  model: "claude-sonnet-5",
  thinking: { type: "adaptive" },
  effort: "high",
};

// Haiku 4.5: no effort knob, older thinking shape, 200K context (not 1M).
const HAIKU: ModelChoice = {
  model: "claude-haiku-4-5",
  thinking: { type: "enabled", budget_tokens: 1024 },
};

/** Anything unmapped: the conservative, highest-quality choice. */
export const DEFAULT_MODEL_CHOICE: ModelChoice = SONNET;

const FEATURE_MODELS: Readonly<Record<string, ModelChoice>> = {
  // Tool-use loops — quality-sensitive, Sonnet 5 is near-Opus on agentic work.
  ask_pulse: SONNET,
  conversational_action: SONNET,
  agentic_decide: SONNET,
  agentic_autopilot: SONNET,
  // Structured generation — moderate difficulty.
  dashboard_gen: SONNET,
  board_generate: SONNET,
  automation_gen: SONNET,
  import_mapping: SONNET,
  report_narrative: SONNET,
  // Short classification / rewrite.
  item_assist: HAIKU,
  column_fill: HAIKU,
};

export const AI_FEATURES = Object.keys(FEATURE_MODELS);

export function modelFor(feature: string): ModelChoice {
  return FEATURE_MODELS[feature] ?? DEFAULT_MODEL_CHOICE;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run --project unit src/lib/ai/model-map.test.ts`
Expected: PASS — six tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/model-map.ts src/lib/ai/model-map.test.ts
git commit -m "feat(ai): add per-feature model map

Routes each runAi feature to a model plus its request-shape config. Haiku
entries omit effort and use the enabled-thinking form, because Haiku 4.5
rejects output_config.effort. A test asserts every emitted model is priced —
computeCostUsd returns 0 for unknown models, so an unpriced model would
silently bill nothing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Adapter accepts a per-call model choice

**Files:**

- Modify: `src/lib/ai/providers/types.ts:26-42`
- Modify: `src/lib/ai/providers/anthropic.ts:15-76`
- Test: `src/lib/ai/providers/anthropic.test.ts` (create if absent)

**Interfaces:**

- Consumes: `ModelChoice`, `modelFor`, `DEFAULT_MODEL_CHOICE` (Task 3).
- Produces: `generateStructured` and `generateProposal` accept an optional `choice?: ModelChoice`; when omitted they use `DEFAULT_MODEL_CHOICE`. Both now return `usage` including `cacheReadTokens` / `cacheWriteTokens`. `MODEL` remains exported as `DEFAULT_MODEL_CHOICE.model` for the call sites Task 5 has not yet migrated.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ai/providers/anthropic.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { anthropicAdapter } from "@/lib/ai/providers/anthropic";
import { modelFor } from "@/lib/ai/model-map";

function fakeClient(captured: Record<string, unknown>[]) {
  return {
    messages: {
      parse: vi.fn(async (params: Record<string, unknown>) => {
        captured.push(params);
        return {
          content: [{ type: "text", text: "{}" }],
          parsed_output: {},
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 900,
            cache_creation_input_tokens: 100,
          },
        };
      }),
    },
  } as never;
}

describe("anthropicAdapter.generateStructured", () => {
  it("sends the haiku request shape with no effort key", async () => {
    const captured: Record<string, unknown>[] = [];
    await anthropicAdapter.generateStructured({
      apiKey: "sk-ant-test",
      system: "s",
      user: "u",
      schema: {},
      choice: modelFor("item_assist"),
      client: fakeClient(captured),
    });
    expect(captured[0].model).toBe("claude-haiku-4-5");
    expect(captured[0].thinking).toEqual({
      type: "enabled",
      budget_tokens: 1024,
    });
    expect(
      (captured[0].output_config as Record<string, unknown>).effort,
    ).toBeUndefined();
  });

  it("sends the sonnet request shape with effort", async () => {
    const captured: Record<string, unknown>[] = [];
    await anthropicAdapter.generateStructured({
      apiKey: "sk-ant-test",
      system: "s",
      user: "u",
      schema: {},
      choice: modelFor("dashboard_gen"),
      client: fakeClient(captured),
    });
    expect(captured[0].model).toBe("claude-sonnet-5");
    expect((captured[0].output_config as Record<string, unknown>).effort).toBe(
      "high",
    );
  });

  it("reports cache tokens in usage", async () => {
    const { usage } = await anthropicAdapter.generateStructured({
      apiKey: "sk-ant-test",
      system: "s",
      user: "u",
      schema: {},
      client: fakeClient([]),
    });
    expect(usage.cacheReadTokens).toBe(900);
    expect(usage.cacheWriteTokens).toBe(100);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run --project unit src/lib/ai/providers/anthropic.test.ts`
Expected: FAIL — `choice` and `client` are not accepted, and `usage` has no cache fields.

- [ ] **Step 3: Update the interface**

In `src/lib/ai/providers/types.ts`, add the import and widen both method signatures:

```ts
import type { ModelChoice } from "@/lib/ai/model-map";
```

```ts
  generateProposal(args: {
    apiKey: string;
    system: string;
    user: string;
    /** Per-feature model + request shape. Defaults to the adapter's default. */
    choice?: ModelChoice;
    client?: unknown; // DI for tests
  }): Promise<{ proposal: DashboardProposal; usage: AiUsageTokens }>;

  generateStructured<T = unknown>(args: {
    apiKey: string;
    system: string;
    user: string;
    schema: object;
    choice?: ModelChoice;
    client?: unknown; // DI for tests
  }): Promise<{ data: T; usage: AiUsageTokens }>;
```

- [ ] **Step 4: Implement in the Anthropic adapter**

In `src/lib/ai/providers/anthropic.ts`, replace the `MODEL` constant and both methods:

```ts
import { DEFAULT_MODEL_CHOICE, type ModelChoice } from "@/lib/ai/model-map";

/** Retained for call sites not yet routed through the model map (Task 5). */
export const MODEL = DEFAULT_MODEL_CHOICE.model;
```

```ts
  async generateStructured({ apiKey, system, user, schema, choice, client }) {
    const c = (client as Anthropic) ?? new Anthropic({ apiKey });
    const m = choice ?? DEFAULT_MODEL_CHOICE;
    const message = await c.messages.parse({
      model: m.model,
      max_tokens: 16000,
      thinking: m.thinking,
      output_config: {
        // Haiku 4.5 rejects `effort` — omit the key entirely rather than
        // sending undefined, which the SDK would still serialize.
        ...(m.effort ? { effort: m.effort } : {}),
        format: jsonSchemaOutputFormat(schema as never),
      },
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: user }],
    } as never);
    const textBlock = message.content.find((b) => b.type === "text");
    const parsed =
      (message as { parsed_output?: unknown }).parsed_output ??
      JSON.parse(textBlock && "text" in textBlock ? textBlock.text : "{}");
    return {
      data: parsed,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      },
    };
  },
  async generateProposal({ apiKey, system, user, choice, client }) {
    const { data, usage } = await this.generateStructured({
      apiKey,
      system,
      user,
      schema: PROPOSAL_JSON_SCHEMA,
      choice,
      client,
    });
    return { proposal: data as DashboardProposal, usage };
  },
```

Also set `defaultModel: DEFAULT_MODEL_CHOICE.model` (it currently reads `MODEL`, which now resolves to the same value — leave the property, change nothing else).

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run --project unit src/lib/ai/providers/anthropic.test.ts`
Expected: PASS — three tests.

- [ ] **Step 6: Run the full unit suite for regressions**

Run: `pnpm test:unit`
Expected: PASS. Existing tests assert `defaultModel: "claude-opus-4-8"` in several mock adapters (`actions.test.ts`, `board-actions.test.ts`, `automation-gen-actions.test.ts`, `import-mapping-actions.test.ts`) — those are **local mocks**, not the real adapter, so they keep passing untouched. If any real-adapter assertion on `"claude-opus-4-8"` fails, update it to `"claude-sonnet-5"`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/providers/types.ts src/lib/ai/providers/anthropic.ts src/lib/ai/providers/anthropic.test.ts
git commit -m "feat(ai): let the adapter take a per-call model choice

generateStructured/generateProposal accept an optional ModelChoice and omit
the effort key entirely when the model rejects it. Usage now reports cache
read/write tokens so the ledger can price them.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Route the non-Ask features through the map

**Files:**

- Modify: `src/lib/ai/column-fill/classify.ts:40-69`
- Modify: `src/lib/ai/item-assist/assist.ts:85-101`
- Modify: `src/lib/ai/actions.ts:134`, `src/lib/ai/board-actions.ts:66`, `src/lib/ai/automation-gen-actions.ts:68`, `src/lib/ai/import-mapping-actions.ts:106`
- Test: `src/lib/ai/column-fill/classify.test.ts`, `src/lib/ai/item-assist/assist.test.ts`

**Interfaces:**

- Consumes: `modelFor` (Task 3); the widened adapter signature (Task 4).
- Produces: no new exports. Each call site now returns the model it actually used, so `runAi` meters against the right price row.

- [ ] **Step 1: Write the failing test for column fill**

Append to `src/lib/ai/column-fill/classify.test.ts`:

```ts
it("classifies on haiku with the enabled-thinking shape and no effort", async () => {
  const captured: Record<string, unknown>[] = [];
  const client = {
    messages: {
      parse: async (params: Record<string, unknown>) => {
        captured.push(params);
        return {
          content: [{ type: "text", text: '{"rows":[]}' }],
          parsed_output: { rows: [] },
          usage: {
            input_tokens: 10,
            output_tokens: 2,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };
      },
    },
  } as never;

  const { usage } = await classifyColumn({
    apiKey: "sk-ant-test",
    rows: [],
    targetOptions: [],
    client,
  });

  expect(captured[0].model).toBe("claude-haiku-4-5");
  expect(captured[0].thinking).toEqual({
    type: "enabled",
    budget_tokens: 1024,
  });
  expect(
    (captured[0].output_config as Record<string, unknown>).effort,
  ).toBeUndefined();
  expect(usage.cacheReadTokens).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run --project unit src/lib/ai/column-fill/classify.test.ts`
Expected: FAIL — model is `claude-opus-4-8` and `effort: "high"` is present.

- [ ] **Step 3: Implement in `classify.ts`**

Replace the `MODEL` import with the map, and the `client.messages.parse` call's model/thinking/effort/usage:

```ts
import { modelFor } from "@/lib/ai/model-map";
```

```ts
const choice = modelFor("column_fill");
const message = await client.messages.parse({
  model: choice.model,
  max_tokens: 16000,
  thinking: choice.thinking,
  output_config: {
    ...(choice.effort ? { effort: choice.effort } : {}),
    format: jsonSchemaOutputFormat(COLUMN_FILL_JSON_SCHEMA as never),
  },
  system: [
    { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
  ],
  messages: [{ role: "user", content: user }],
} as never);
```

and the returned usage:

```ts
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    },
```

Then update `src/lib/ai/column-fill/actions.ts:140`, which returns `model: MODEL` — change it to `model: modelFor("column_fill").model`.

> **Haiku 4.5's context window is 200K, not 1M.** `classifyColumn` serializes every row into one user message. Add a guard immediately before the call: if `args.rows.length > 2000`, fall back to `modelFor("dashboard_gen")` (Sonnet) for that batch. Two thousand rows of short free text sits comfortably inside 200K; beyond that, take the more expensive model rather than a 400.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run --project unit src/lib/ai/column-fill/classify.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for item assist**

Append to `src/lib/ai/item-assist/assist.test.ts`:

```ts
it("assists on haiku with the enabled-thinking shape and no effort", async () => {
  const captured: Record<string, unknown>[] = [];
  const client = {
    messages: {
      parse: async (params: Record<string, unknown>) => {
        captured.push(params);
        return {
          content: [{ type: "text", text: "{}" }],
          parsed_output: { description: "d" },
          usage: {
            input_tokens: 20,
            output_tokens: 8,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };
      },
    },
  } as never;

  const { usage } = await proposeItemAssist({
    apiKey: "sk-ant-test",
    itemName: "Ship billing",
    want: { description: true },
    client,
  });

  expect(captured[0].model).toBe("claude-haiku-4-5");
  expect(captured[0].thinking).toEqual({
    type: "enabled",
    budget_tokens: 1024,
  });
  expect(
    (captured[0].output_config as Record<string, unknown>).effort,
  ).toBeUndefined();
  expect(usage.cacheWriteTokens).toBe(0);
});
```

Match the exported function name and required argument shape already used by the other tests in this file — `proposeItemAssist` and the `want` object above are the shape at `assist.ts:70-78`; if the local name differs, use the file's own.

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm vitest run --project unit src/lib/ai/item-assist/assist.test.ts`
Expected: FAIL — model is `claude-opus-4-8` and `effort: "high"` is present.

- [ ] **Step 7: Implement in `assist.ts`**

Replace the `MODEL` import with `import { modelFor } from "@/lib/ai/model-map";`, then replace the `client.messages.parse` call at `assist.ts:85-101`:

```ts
const choice = modelFor("item_assist");
const message = await client.messages.parse({
  model: choice.model,
  max_tokens: 4096,
  thinking: choice.thinking,
  output_config: {
    ...(choice.effort ? { effort: choice.effort } : {}),
    format: jsonSchemaOutputFormat(schema as never),
  },
  system: [
    {
      type: "text",
      text: buildSystemPrompt(args.want),
      cache_control: { type: "ephemeral" },
    },
  ],
  messages: [{ role: "user", content: buildUserPrompt(args) }],
} as never);
```

and the returned usage at the end of the function:

```ts
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    },
```

Then update the `runAi` wrapper in `src/lib/ai/item-assist/actions.ts` so its returned `model` is `modelFor("item_assist").model` rather than `MODEL`.

- [ ] **Step 8: Run to verify it passes**

Run: `pnpm vitest run --project unit src/lib/ai/item-assist/assist.test.ts`
Expected: PASS.

- [ ] **Step 9: Pass the choice at the four adapter call sites**

In `src/lib/ai/actions.ts:134`, `board-actions.ts:66`, `automation-gen-actions.ts:68`, and `import-mapping-actions.ts:106`, each currently returns `model: adapter.defaultModel` after calling `generateStructured`/`generateProposal`. In each, pass the feature's choice into the adapter call and return that model instead. Example for `import-mapping-actions.ts`:

```ts
const choice = modelFor("import_mapping");
const { data, usage } = await resolved.adapter.generateStructured({
  apiKey: resolved.apiKey,
  system,
  user,
  schema,
  choice,
});
return { result: suggestions, usage, model: choice.model };
```

Use `modelFor("dashboard_gen")` in `actions.ts`, `modelFor("board_generate")` in `board-actions.ts`, `modelFor("automation_gen")` in `automation-gen-actions.ts`.

- [ ] **Step 10: Run the full unit suite**

Run: `pnpm test:unit`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/lib/ai/column-fill src/lib/ai/item-assist src/lib/ai/actions.ts src/lib/ai/board-actions.ts src/lib/ai/automation-gen-actions.ts src/lib/ai/import-mapping-actions.ts
git commit -m "perf(ai): route non-ask features through the model map

Item assist and column fill drop to haiku-4-5; structured generation moves
to sonnet-5. Each call site now returns the model it actually used so the
ledger meters against the right price row. Column fill falls back to sonnet
above 2000 rows because haiku's context window is 200K, not 1M.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Ask — model routing + prompt caching

**Files:**

- Modify: `src/lib/ai/ask/ask-stream.ts:52-175`
- Test: `src/lib/ai/ask/ask-stream.test.ts`

**Interfaces:**

- Consumes: `modelFor` (Task 3); `AiUsageTokens` with cache fields (Task 1); the ledger wiring (Task 2).
- Produces: `askPulseStream` unchanged in signature; its returned `usage` now carries `cacheReadTokens` / `cacheWriteTokens`.

This is the task the whole plan exists for — Ask is 78% input cost at 26k input tokens per call.

**Two breakpoints, never more.** Render order is `tools` → `system` → `messages`, so a breakpoint on the last system block caches the tool definitions _and_ the system prompt together. A second breakpoint on the last block of the most recent message caches the accumulated tool results across rounds. That is 2 of the allowed 4 — and the message breakpoint must be **moved**, not added, each round, or a six-round loop would emit six breakpoints and be rejected.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/ai/ask/ask-stream.test.ts`:

```ts
it("caches tools+system via a system content block and reports cache usage", async () => {
  const captured: Record<string, unknown>[] = [];
  const client = {
    messages: {
      stream: (params: Record<string, unknown>) => {
        captured.push(params);
        return {
          on: () => {},
          finalMessage: async () => ({
            stop_reason: "end_turn",
            content: [{ type: "text", text: "done" }],
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              cache_read_input_tokens: 24_000,
              cache_creation_input_tokens: 1_500,
            },
          }),
        };
      },
    },
  } as never;

  const { usage } = await askPulseStream({
    apiKey: "sk-ant-test",
    orgId: "org-1",
    workspaceId: "ws-1",
    messages: [{ role: "user", content: "hi" }],
    system: "You are Ask.",
    emit: () => {},
    client,
  });

  expect(captured[0].model).toBe("claude-sonnet-5");
  expect(captured[0].system).toEqual([
    {
      type: "text",
      text: "You are Ask.",
      cache_control: { type: "ephemeral" },
    },
  ]);
  expect(usage.cacheReadTokens).toBe(24_000);
  expect(usage.cacheWriteTokens).toBe(1_500);
});

it("keeps exactly one message breakpoint across tool rounds", async () => {
  const captured: Record<string, unknown>[] = [];
  let round = 0;
  const client = {
    messages: {
      stream: (params: Record<string, unknown>) => {
        captured.push(structuredClone(params));
        const useTool = round++ < 2;
        return {
          on: () => {},
          finalMessage: async () => ({
            stop_reason: useTool ? "tool_use" : "end_turn",
            content: useTool
              ? [
                  {
                    type: "tool_use",
                    id: `t${round}`,
                    name: "list_boards",
                    input: {},
                  },
                ]
              : [{ type: "text", text: "done" }],
            usage: { input_tokens: 10, output_tokens: 2 },
          }),
        };
      },
    },
  } as never;

  await askPulseStream({
    apiKey: "sk-ant-test",
    orgId: "org-1",
    workspaceId: "ws-1",
    messages: [{ role: "user", content: "hi" }],
    system: "You are Ask.",
    emit: () => {},
    client,
  });

  // Anthropic rejects more than 4 breakpoints; 1 system + 1 message is the budget.
  const last = captured[captured.length - 1];
  const msgs = last.messages as { content: unknown }[];
  const marked = JSON.stringify(msgs).split('"cache_control"').length - 1;
  expect(marked).toBe(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run --project unit src/lib/ai/ask/ask-stream.test.ts`
Expected: FAIL — model is `claude-opus-4-8`, `system` is a bare string, `usage` has no cache fields.

- [ ] **Step 3: Add the breakpoint helper**

At the top of `src/lib/ai/ask/ask-stream.ts`, below `textOf`:

```ts
/**
 * Move the single message-level cache breakpoint to the last content block of
 * the last message. MOVE, not add: Anthropic allows 4 breakpoints per request
 * and MAX_ROUNDS is 6, so appending one per round would blow the budget. The
 * system block carries the other breakpoint (tools render before system, so
 * one marker there caches the whole tool+system prefix).
 */
function moveMessageBreakpoint(messages: Anthropic.MessageParam[]): void {
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content as Record<string, unknown>[])
      delete b.cache_control;
  }
  const last = messages[messages.length - 1];
  if (!last || !Array.isArray(last.content) || last.content.length === 0)
    return;
  const blocks = last.content as Record<string, unknown>[];
  blocks[blocks.length - 1].cache_control = { type: "ephemeral" };
}
```

- [ ] **Step 4: Implement in `askPulseStream`**

Replace the `MODEL` import with `import { modelFor } from "@/lib/ai/model-map";`, then:

Before the loop:

```ts
const choice = modelFor("ask_pulse");
const system: Anthropic.TextBlockParam[] = [
  { type: "text", text: args.system, cache_control: { type: "ephemeral" } },
];
const usage: AiUsageTokens = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};
```

In the stream call, replace `model: MODEL` with `model: choice.model` and `system: args.system` with `system`.

After `const final = await stream.finalMessage();`, extend the accumulation:

```ts
usage.inputTokens += final.usage.input_tokens;
usage.outputTokens += final.usage.output_tokens;
usage.cacheReadTokens =
  (usage.cacheReadTokens ?? 0) + (final.usage.cache_read_input_tokens ?? 0);
usage.cacheWriteTokens =
  (usage.cacheWriteTokens ?? 0) +
  (final.usage.cache_creation_input_tokens ?? 0);
```

Immediately after `messages.push({ role: "user", content: toolResults });`, add:

```ts
moveMessageBreakpoint(messages);
```

In the capped final call, use `model: choice.model`, `system`, and add the same four-line usage accumulation.

> **The system prompt must be byte-stable or none of this caches.** `composeSystem` (`ask/context.ts:31`) appends the rolling conversation summary to the base prompt, so the system block changes whenever the summary is refolded. That is correct and unavoidable — the summary only changes every `KEEP_RECENT` (10) turns, so the prefix is stable across the rounds within a turn and across most turns. Do **not** add a timestamp, user name, or request id to the system prompt; doing so would silently reduce the cache hit rate to zero with no error.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run --project unit src/lib/ai/ask/ask-stream.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full unit suite**

Run: `pnpm test:unit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/ask/ask-stream.ts src/lib/ai/ask/ask-stream.test.ts
git commit -m "perf(ai): cache ask's tool+system prefix and route it to sonnet-5

Moves the system prompt into a content block with a cache_control breakpoint
(tools render first, so one marker caches the whole tool+system prefix) and
keeps a single rolling breakpoint on the newest message so accumulated tool
results cache across rounds. Exactly two breakpoints — MAX_ROUNDS is 6 and
Anthropic allows 4, so the message marker moves rather than accumulating.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Verify the cost reduction against real calls

**Files:**

- Modify: none (measurement only)

**Interfaces:**

- Consumes: everything above.
- Produces: a before/after cost table for the session note.

Unit tests prove the request shape is right. Only a live call proves caching actually engages — a silent invalidator produces zero errors and zero cache hits.

- [ ] **Step 1: Run every gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all four PASS. A cold `pnpm typecheck` can fail on `cacheLife("nav"/"guard")` until `pnpm build` has generated `.next/types` — if so, run `pnpm build` first and re-run typecheck. That is not a real break.

- [ ] **Step 2: Verify the ledger**

Run: `pnpm db:ledger-check`
Expected: file count == DEV row count both ways.

- [ ] **Step 3: Exercise Ask against DEV**

Start the app, open `/ask`, and run a **three-turn** conversation against a workspace with real boards. One turn is not enough — turn one pays the cache write, turn two is the first that can read.

- [ ] **Step 4: Confirm caching actually engaged**

Query DEV:

```sql
select feature, model, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, cost_usd
from ai_usage
where feature = 'ask_pulse'
order by created_at desc
limit 5;
```

Expected: the most recent rows show `model = 'claude-sonnet-5'` and **`cache_read_tokens > 0` on the second and later turns**. If it is 0 across all rows, a silent invalidator is present — diff the rendered system block between two requests before assuming the code is correct.

- [ ] **Step 5: Record the before/after**

```sql
select feature, model, count(*) as calls,
       round(avg(cost_usd)::numeric, 5) as avg_cost_usd
from ai_usage
group by feature, model
order by feature;
```

Compare against the spec's baseline table (`ask_pulse` $0.167, `item_assist` $0.004, etc.) and record both in the `/wrapup` session note. The target is **60–80% reduction** on `ask_pulse` and roughly **5×** on `item_assist`.

- [ ] **Step 6: Finish the task branch**

Run `scripts/finish-task.sh` from inside the worktree. It rebases onto the latest `develop`, runs the gates against the merged state, merges, pushes, and removes the worktree. If it fails on a missing module after the rebase, run `pnpm install` in the worktree and re-run — a sibling session may have added a dependency.

---

## Self-review

**Spec coverage.** Spec unit A (model map + adapter request shape) → Tasks 3, 4, 5. Unit B (pricing + ledger migration) → Tasks 1, 2. Unit C (Ask caching) → Task 6. The spec's ordering constraint — C must land after B, because caching without cache-aware metering under-bills — is enforced by the DAG (Task 6 depends on Task 2). The spec's five named tests all appear: pricing cache math (Task 1), the every-emitted-model-is-priced guard (Task 3), the Haiku request-shape assertion (Tasks 4 and 5), the two-turn cache-read integration check (Task 7 Step 4), and the cost regression comparison (Task 7 Step 5). The spec's deferred `effort` sweep is correctly **not** a task — it is explicitly to be done after the model move lands.

**Type consistency.** `AiUsageTokens` gains `cacheReadTokens` / `cacheWriteTokens` in Task 1 and is consumed under those exact names in Tasks 2, 4, 5, and 6. `ModelChoice` / `modelFor` / `DEFAULT_MODEL_CHOICE` are defined in Task 3 and used unchanged in 4, 5, and 6. The RPC params `p_cache_read_tokens` / `p_cache_write_tokens` are named identically in the Task 2 migration and the Task 2 gateway wiring. `PRICED_MODELS` is exported in Task 1 and consumed only by Task 3's test.

**Placeholder scan.** One violation found and fixed: Task 5's item-assist step originally read "apply the identical shape" — the forbidden "similar to Task N" pattern. It now carries its own failing test, its own implementation block, and its own run steps, so a subagent handed only Task 5 can execute it without reading any other task.

**One judgement call the implementer should know about.** Task 5's item-assist test names `proposeItemAssist` and a `want: { description: true }` argument, read from `assist.ts:70-78`. If the exported symbol in that file differs, use the file's own name — the assertions (model, thinking shape, absent `effort`, cache usage) are what the test is for, not the call signature.
