/**
 * Appends an arbitrary JSON Schema to a user prompt for providers that use JSON
 * mode rather than native structured output (OpenAI, Gemini). The model output
 * is re-validated/repaired downstream, so schema drift is tolerated.
 */
export function withSchemaObject(user: string, schema: object): string {
  return `${user}\n\nReturn ONLY a JSON object matching this JSON Schema (no prose):\n${JSON.stringify(
    schema,
  )}`;
}
