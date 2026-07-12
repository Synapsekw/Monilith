export const DESCRIPTION_MAX = 2000; // chars
export const SUBTASKS_MAX = 8; // count
export const SUBTASK_NAME_MAX = 200; // chars per subtask

/** Which assist outputs the caller is requesting (task-scoped prompt). */
export type ItemAssistWant = {
  description?: { columnId: string }; // draft into this text column
  subtasks?: boolean; // suggest child items
  status?: { columnId: string }; // propose an option for this status/dropdown column
};

export type ItemAssistProposal = {
  description?: string;
  subtasks?: string[];
  status?: { columnId: string; optionId: string };
};

/**
 * JSON schema handed to the model (output_config.format), built per-request
 * from `want` so only the requested sub-parts are ever askable.
 *
 * CRITICAL (mirrors PROPOSAL_JSON_SCHEMA in proposal-schema.ts): under strict
 * structured output the model obeys THIS schema, not the prose in the system
 * prompt. A permissive `{}`-shaped field lets the model emit an empty value
 * and ignore the prompt. So every requested field is fully specified here
 * (`additionalProperties: false`, non-empty `required`), and fields NOT
 * requested are omitted from `properties` entirely — the model has no slot
 * to emit them in.
 *
 * `status.optionId` is constrained to an `enum` of the real option ids when
 * they're known, so the model can only pick a real option (validateItemAssist
 * still re-checks it — never trust raw model output).
 */
export function buildItemAssistJsonSchema(
  want: ItemAssistWant,
  statusOptionIds: string[] = [],
) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  if (want.description) {
    properties.description = {
      type: "string",
      minLength: 1,
      maxLength: DESCRIPTION_MAX,
    };
    required.push("description");
  }

  if (want.subtasks) {
    properties.subtasks = {
      type: "array",
      minItems: 1,
      maxItems: SUBTASKS_MAX,
      items: { type: "string", minLength: 1, maxLength: SUBTASK_NAME_MAX },
    };
    required.push("subtasks");
  }

  if (want.status) {
    properties.status = {
      type: "object",
      additionalProperties: false,
      required: ["optionId"],
      properties: {
        optionId: statusOptionIds.length
          ? { type: "string", enum: statusOptionIds }
          : { type: "string" },
      },
    };
    required.push("status");
  }

  return {
    type: "object",
    additionalProperties: false,
    required,
    properties,
  } as const;
}
