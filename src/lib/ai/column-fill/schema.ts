/** Hard cap on rows a single classify call will accept — cost + latency guard.
 *  `validateClassifications` re-enforces this against raw model output.
 *
 *  If this is ever raised past the cheap tier's context budget, re-introduce a
 *  tier escalation in actions.ts: every row is serialised into ONE user
 *  message, so the batch size and the model's context window are the same
 *  constraint. (There was one, keyed on a 2000-row threshold this cap made
 *  unreachable; it was deleted rather than left as a dead branch.) */
export const COLUMN_FILL_MAX = 200;

/**
 * Per-row prompt budget for Smart Fill classification. Text columns can hold
 * up to 20,000 characters (see `CHAR_CAP` in `LongTextEditor.tsx` /
 * `textValueSchema`), and a classify call reads up to `COLUMN_FILL_MAX` (200)
 * rows in one batch — unbounded, that's up to 4,000,000 characters in a
 * single `runAi` call, easily enough to hard-fail the request rather than
 * just degrade. Classification only needs enough prose to place a row into
 * one of a handful of target options, which a few sentences settles — 500
 * characters of stripped text is generous for that signal while keeping a
 * full 200-row batch well within any model's context window.
 */
export const CLASSIFY_TEXT_CHAR_BUDGET = 500;

export type ClassifyRow = { itemId: string; text: string };
export type TargetOption = { id: string; label: string };
/** `optionId: null` means no confident match — never force a guess. */
export type Classification = { itemId: string; optionId: string | null };

// JSON schema handed to the model (output_config.format).
//
// CRITICAL: under strict structured output the model obeys THIS schema, not
// the prose in the system prompt (see proposal-schema.ts). A permissive
// `rows: {type: array}` with no required item fields lets the model emit
// `{ rows: [] }` and ignore the prompt. So `rows` is required at the top
// level, and every row requires both `itemId` and `optionId` — `optionId` is
// a nullable string (`["string", "null"]`), never an omittable/freeform
// escape, so "no confident match" is an explicit `null`, not a dropped row.
export const COLUMN_FILL_JSON_SCHEMA = {
  type: "object",
  required: ["rows"],
  additionalProperties: false,
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        required: ["itemId", "optionId"],
        additionalProperties: false,
        properties: {
          itemId: { type: "string" },
          optionId: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;
