import { candidateNativeIds, stripDateSuffix } from "@/lib/ai/models/model-ids";

export type AiUsageTokens = {
  inputTokens: number;
  outputTokens: number;
  /** Prompt-cache hits. Billed at 0.10x the model's input rate, absent an explicit cache rate. */
  cacheReadTokens?: number;
  /** Prompt-cache writes. Billed at 1.25x the model's input rate, absent an explicit cache rate. */
  cacheWriteTokens?: number;
};

/**
 * Anthropic-wide cache multipliers. Retained as the FALLBACK for any model
 * whose catalog row carries no explicit cache rate (Mistral publishes none).
 * Falling back to the multiplier rather than to zero means a provider that
 * returns cache tokens without publishing a cache price is still billed at
 * today's rates instead of silently free.
 */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export type ModelRates = {
  input: number;
  output: number;
  cacheRead: number | null;
  cacheWrite: number | null;
};

/**
 * The seeded price FLOOR, formerly MODEL_PRICES_PER_MTOK and formerly the sole
 * source of truth. The `ai_models` catalog is authoritative now, but this table
 * still binds it in two ways — see {@link applyRateFloor}:
 *
 *   1. A catalog row with no usable price for a model listed here bills at
 *      these rates, not $0.
 *   2. For a model listed here, each of the four components is billed at
 *      `max(catalogRate, floorRate)` — including the two CACHE components,
 *      whose floor is derived (`floorInput x 0.1` / `x 1.25`) when this table
 *      states none, because every entry below leaves them null.
 *
 * Rule 2 is deliberately GENERAL rather than a special case keyed on one model
 * id, which would rot the moment someone edits this table. Its origin is
 * concrete: Anthropic's Sonnet 5 carries an introductory $2/$10 that expires
 * 2026-08-31, and the repo has always billed the STANDARD $3/$15 so users do
 * not hit a price cliff the day the promo ends. Once the Gateway feed became
 * authoritative, a published promo rate would have silently reversed that
 * decision. Generalising it means the same protection applies to every model
 * listed here: a feed that under-reports a price cannot quietly cut what we
 * charge, while a genuine price RISE is still honoured (the floor is a floor,
 * not a cap). Lowering a price on purpose therefore means editing this table.
 *
 * The cache components matter as much as input/output — a tool loop's tokens
 * are mostly cache reads — so a floor that stopped at input/output would let
 * the promo rate back in through the biggest component. Since every entry here
 * leaves `cacheRead`/`cacheWrite` null, their floor is DERIVED from the floored
 * input at the same multipliers `computeCostUsd` uses. If you ever add a model
 * whose provider charges LESS than 0.1x input for a cached read, state its
 * `cacheRead` explicitly here rather than letting the derivation over-bill it.
 */
export const FALLBACK_RATES: Readonly<Record<string, ModelRates>> = {
  "claude-opus-4-8": {
    input: 5,
    output: 25,
    cacheRead: null,
    cacheWrite: null,
  },
  // $3/$15 is the STANDARD rate. Anthropic's introductory $2/$10 expires
  // 2026-08-31; billing the promo rate would cliff every user's costs that
  // day. Do not "correct" this to whatever the Gateway feed publishes.
  "claude-sonnet-5": {
    input: 3,
    output: 15,
    cacheRead: null,
    cacheWrite: null,
  },
  "claude-haiku-4-5": {
    input: 1,
    output: 5,
    cacheRead: null,
    cacheWrite: null,
  },
  "gpt-4o": { input: 2.5, output: 10, cacheRead: null, cacheWrite: null },
  "gemini-2.0-flash": {
    input: 0.1,
    output: 0.4,
    cacheRead: null,
    cacheWrite: null,
  },
  // Fixed platform embedding model (E5 · F15). Input-only.
  "text-embedding-3-small": {
    input: 0.02,
    output: 0,
    cacheRead: null,
    cacheWrite: null,
  },
};

/** Every model id the model map may emit must be priced here. */
export const PRICED_MODELS = Object.keys(FALLBACK_RATES);

export function ratesForModel(model: string): ModelRates | null {
  // Object.hasOwn, not `FALLBACK_RATES[model] ?? null`: FALLBACK_RATES is an
  // object literal, so it inherits Object.prototype. A plain index lookup for
  // "constructor"/"toString"/"valueOf"/"hasOwnProperty" returns a Function
  // (truthy, and TypeScript's index signature can't see the prototype chain),
  // which would sail past computeCostUsd's `if (!rates)` guard and produce
  // NaN cost/credits instead of the null this function promises.
  return Object.hasOwn(FALLBACK_RATES, model) ? FALLBACK_RATES[model] : null;
}

/** How a catalog row identifies itself — both ids, because neither alone finds
 *  the floor. See {@link floorKeyCandidates}. */
export type ModelIdentity = { modelId: string; nativeModelId?: string | null };

/**
 * The lookup keys to try against {@link FALLBACK_RATES}, in order, first hit
 * wins.
 *
 * FALLBACK_RATES is hand-written in the PROVIDER's spelling
 * (`claude-haiku-4-5`). A catalog row carries two other spellings: the
 * Gateway's key (`claude-haiku-4.5`) and the verified native id, which for
 * Anthropic is a dated snapshot (`claude-haiku-4-5-20251001`). Matching only
 * the literal catalog key meant the floor found `claude-sonnet-5` and missed
 * `claude-haiku-4.5` and `claude-opus-4.8` — it protected one of Anthropic's
 * three floored models, by coincidence of spelling, while reading as though it
 * protected all of them.
 *
 * The order is least-to-most inferred, so a model that names itself exactly is
 * never overridden by a normalisation. Only an 8-digit DATE is stripped from a
 * native id — a bare prefix is never enough, or `gpt-4-turbo` would borrow
 * `gpt-4`'s floor.
 */
export function floorKeyCandidates(
  modelId: string,
  nativeModelId?: string | null,
): string[] {
  const out = candidateNativeIds(modelId);
  for (const candidate of nativeModelId
    ? [nativeModelId, stripDateSuffix(nativeModelId)]
    : [])
    if (!out.includes(candidate)) out.push(candidate);
  return out;
}

/** `null` means "absent", so it loses to any number rather than to zero. */
function higher(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/**
 * Bind catalog rates to {@link FALLBACK_RATES} — the two rules documented on
 * that table, in one place so a caller cannot implement only half of them.
 *
 * `catalog` is null when the row published no usable price at all, in which
 * case the floor is used verbatim. A model in neither the catalog nor the floor
 * yields null, which `computeCostUsd` bills as $0 — the case the
 * `needs_pricing` quarantine exists to prevent.
 */
export function applyRateFloor(
  model: string | ModelIdentity,
  catalog: ModelRates | null,
): ModelRates | null {
  // A catalog row must pass BOTH ids ({@link ModelIdentity}) — the bare string
  // form finds a floor only when the id is already spelled the table's way, and
  // exists for the fixed-model callers (runEmbedding) that have no second id.
  // Object.hasOwn inside ratesForModel guards the prototype-chain keys.
  const keys =
    typeof model === "string"
      ? floorKeyCandidates(model)
      : floorKeyCandidates(model.modelId, model.nativeModelId);
  const floor = keys.reduce<ModelRates | null>(
    (found, key) => found ?? ratesForModel(key),
    null,
  );
  if (!floor) return catalog;
  // The floor's own cache components are null, so computeCostUsd derives them
  // from floor.input at the same multipliers used below — the two branches
  // agree by construction.
  if (!catalog) return floor;

  const input = Math.max(catalog.input, floor.input);

  // Derived from the FLOORED input, not from `floor.input`. Using the raw
  // floor would make a genuine price RISE cut the cache rate: a feed reporting
  // input 4 against a floor of 3 would pin cache reads at 0.30 when this
  // model's own (risen) input implies 0.40 — the opposite of rule 2. Deriving
  // from `input` keeps a null-cache row billing exactly what computeCostUsd
  // would have computed for it, so materialising the value changes nothing.
  const cacheReadFloor = floor.cacheRead ?? input * CACHE_READ_MULTIPLIER;
  const cacheWriteFloor = floor.cacheWrite ?? input * CACHE_WRITE_MULTIPLIER;

  return {
    input,
    output: Math.max(catalog.output, floor.output),
    cacheRead: higher(catalog.cacheRead, cacheReadFloor),
    cacheWrite: higher(catalog.cacheWrite, cacheWriteFloor),
  };
}

/**
 * Cost in USD for one call, from rates supplied by the caller (which reads the
 * catalog). Deliberately PURE and SYNCHRONOUS: making it async to read the
 * catalog itself would ripple into every metering call site.
 *
 * Null rates cost 0 — tokens are still logged. This is now only reachable for
 * a model missing from BOTH the catalog and the fallback floor, which the
 * needs_pricing quarantine is designed to prevent.
 */
export function computeCostUsd(
  rates: ModelRates | null,
  usage: AiUsageTokens,
): number {
  if (!rates) return 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const readRate = rates.cacheRead ?? rates.input * CACHE_READ_MULTIPLIER;
  const writeRate = rates.cacheWrite ?? rates.input * CACHE_WRITE_MULTIPLIER;
  return (
    (usage.inputTokens * rates.input +
      usage.outputTokens * rates.output +
      cacheRead * readRate +
      cacheWrite * writeRate) /
    1_000_000
  );
}

/** 1 credit = $0.01, rounded to 2 decimal places. */
export function costToCredits(costUsd: number): number {
  // USD → credits (×100), then round to 2dp
  return Math.round(costUsd * 10000) / 100;
}
