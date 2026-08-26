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
 * the chosen provider's own catalog. `runAi` is the one place that runs it.
 *
 * The request-shape half is a separate concern and still lives here — see
 * {@link requestShapeFor} below.
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
    digest_narrative: "standard",
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
 * rather than handing adapters a shape object: the other three wire formats
 * ignore them entirely.
 */
export type ThinkingConfig =
  | { type: "adaptive" }
  | { type: "enabled"; budget_tokens: number };

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type ModelRequestShape = {
  thinking: ThinkingConfig;
  /** Omitted for models that reject output_config.effort (Haiku 4.5). */
  effort?: Effort;
};

// Haiku 4.5: no effort knob, older thinking shape, 200K context (not 1M).
const HAIKU_SHAPE: ModelRequestShape = {
  thinking: { type: "enabled", budget_tokens: 1024 },
};

const DEFAULT_SHAPE: ModelRequestShape = {
  thinking: { type: "adaptive" },
  effort: "high",
};

/**
 * Which request knobs THIS model accepts.
 *
 * Keyed on the model, not on the feature, because that is what the constraint
 * actually is: the old `modelFor(feature)` returned a model id AND its shape
 * together, which is why every feature was pinned to a hardcoded `claude-*` id.
 * The model now comes from the catalog (`resolveModel`), so the shape has to be
 * derivable from whatever that returns.
 *
 * Matching on the Haiku family covers both id namespaces — the Gateway's
 * `claude-haiku-4.5` and Anthropic's native `claude-haiku-4-5` — and a
 * non-Anthropic model simply never reaches an adapter that reads these fields.
 */
export function requestShapeFor(model: string): ModelRequestShape {
  return /haiku/i.test(model) ? HAIKU_SHAPE : DEFAULT_SHAPE;
}
