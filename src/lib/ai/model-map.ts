/**
 * Per-feature model routing. Maps the `feature` string threaded through runAi
 * to a model plus its request-shape config, so no new plumbing is needed at
 * call sites.
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

const FEATURE_MODELS = Object.freeze(
  Object.assign(Object.create(null) as Record<string, ModelChoice>, {
    // Tool-use loops — quality-sensitive, Sonnet 5 is near-Opus on agentic work.
    ask_pulse: SONNET,
    conversational_action: SONNET,
    automation_ai_step: SONNET,
    autopilot_run: SONNET,
    // Structured generation — moderate difficulty.
    dashboard_gen: SONNET,
    board_gen: SONNET,
    automation_gen: SONNET,
    import_mapping: SONNET,
    report_narrative: SONNET,
    thread_summary: SONNET,
    personal_agent_run: SONNET,
    // Short classification / rewrite.
    item_assist: HAIKU,
    column_fill: HAIKU,
  }),
);

export const AI_FEATURES = Object.keys(FEATURE_MODELS);

export function modelFor(feature: string): ModelChoice {
  return FEATURE_MODELS[feature] ?? DEFAULT_MODEL_CHOICE;
}
