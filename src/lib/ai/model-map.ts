import type { ModelTier } from "@/lib/ai/models/feed-parse";

/**
 * Per-feature model routing.
 *
 * This file used to emit a concrete model id — `claude-sonnet-5` for eleven of
 * the thirteen features — which was harmless only because the OpenAI and Google
 * adapters discarded the requested model and ran a fixed constant. Every
 * adapter now honours it, so a Claude id emitted into an OpenAI-keyed org is a
 * 404. The map therefore emits an abstract TIER, and `resolveModel`
 * (`src/lib/ai/models/resolve.ts`) turns that tier into a concrete model from
 * the chosen provider's own catalog.
 *
 * The request-shape half of the map (`ModelChoice`) is a separate concern and
 * still lives here — see its own doc comment below.
 */

/** Anything unmapped: the conservative middle. */
export const DEFAULT_TIER: ModelTier = "standard";

const FEATURE_TIERS = Object.freeze(
  Object.assign(Object.create(null) as Record<string, ModelTier>, {
    // Tool-use loops — quality-sensitive.
    ask_pulse: "standard",
    conversational_action: "standard",
    automation_ai_step: "standard",
    autopilot_run: "standard",
    // Structured generation — moderate difficulty.
    dashboard_gen: "standard",
    board_gen: "standard",
    automation_gen: "standard",
    import_mapping: "standard",
    report_narrative: "standard",
    thread_summary: "standard",
    personal_agent_run: "standard",
    // Short classification / rewrite — high volume, low difficulty.
    item_assist: "cheap",
    column_fill: "cheap",
  } satisfies Record<string, ModelTier>),
);

export const AI_FEATURES = Object.keys(FEATURE_TIERS);

export function tierForFeature(feature: string): ModelTier {
  return FEATURE_TIERS[feature] ?? DEFAULT_TIER;
}

/**
 * The REQUEST-SHAPE half of the map: models do not accept the same knobs, and
 * that is orthogonal to which model a feature deserves. Haiku 4.5 rejects
 * `output_config.effort` and requires the older `{ type: "enabled",
 * budget_tokens }` thinking form — sending the Sonnet/Opus request shape to
 * Haiku returns a 400.
 *
 * These are ANTHROPIC-shaped knobs, which is why `toRequestArgs` flattens them
 * rather than passing a `ModelChoice` to adapters.
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

/**
 * DEPRECATED — the `model` field is a hardcoded Anthropic id and must not
 * survive. It is kept only so the call sites that still read it keep
 * compiling; `resolveModel` + {@link tierForFeature} replace it, and the
 * gateway task threads the resolved model to those call sites.
 *
 * Every model id emitted here must exist in pricing.ts's FALLBACK_RATES —
 * computeCostUsd returns 0 for null rates, so an unpriced model bills nothing
 * at all. model-map.test.ts enforces this.
 *
 * @deprecated Use {@link tierForFeature} with `resolveModel`.
 */
export const DEFAULT_MODEL_CHOICE: ModelChoice = SONNET;

const FEATURE_MODELS = Object.freeze(
  Object.assign(Object.create(null) as Record<string, ModelChoice>, {
    ask_pulse: SONNET,
    conversational_action: SONNET,
    automation_ai_step: SONNET,
    autopilot_run: SONNET,
    dashboard_gen: SONNET,
    board_gen: SONNET,
    automation_gen: SONNET,
    import_mapping: SONNET,
    report_narrative: SONNET,
    thread_summary: SONNET,
    personal_agent_run: SONNET,
    item_assist: HAIKU,
    column_fill: HAIKU,
  }),
);

/** @deprecated Use {@link tierForFeature} with `resolveModel`. */
export function modelFor(feature: string): ModelChoice {
  return FEATURE_MODELS[feature] ?? DEFAULT_MODEL_CHOICE;
}
