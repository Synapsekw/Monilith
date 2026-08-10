/**
 * Appends an arbitrary JSON Schema to a user prompt, for a provider whose
 * native structured-output channel cannot carry our schemas.
 *
 * Only the Google adapter still needs this — Gemini's `responseSchema` is an
 * OpenAPI-3.0 subset with no `oneOf`, which `proposal-schema.ts` and
 * `automation-gen-schema.ts` both use (see google.ts for the full note). The
 * model output is re-validated/repaired downstream, so schema drift is
 * tolerated.
 */
export function withSchemaObject(user: string, schema: object): string {
  return `${user}\n\nReturn ONLY a JSON object matching this JSON Schema (no prose):\n${JSON.stringify(
    schema,
  )}`;
}
