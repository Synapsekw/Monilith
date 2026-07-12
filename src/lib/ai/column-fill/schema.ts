/** Hard cap on rows a single classify call will accept — cost + latency guard.
 *  `validateClassifications` re-enforces this against raw model output. */
export const COLUMN_FILL_MAX = 200;

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
