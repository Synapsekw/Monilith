import { generateObject, jsonSchema, type Schema } from "ai";
import type { AdapterClient } from "@/lib/ai/providers/types";

/**
 * The two tiny pieces every adapter shares when talking to the AI SDK. Kept in
 * one module so the (single, unavoidable) schema cast is written once.
 */

/** The AI SDK entry point, swappable by a test via `GenerateArgs.client`. */
export function generateObjectFn(
  client?: AdapterClient,
): typeof generateObject {
  return client?.generateObject ?? generateObject;
}

/**
 * Wrap one of our hand-written JSON Schema objects for the SDK.
 *
 * The cast is unavoidable: our schemas are typed `object` (they are plain
 * literals in `proposal-schema.ts` et al.), while `jsonSchema()` wants
 * `JSONSchema7` from `@ai-sdk/provider` — a transitive package this app does
 * not depend on directly. Deriving the parameter type from the function keeps
 * us honest if the SDK ever changes it.
 */
export function toSdkSchema(schema: object): Schema<unknown> {
  return jsonSchema(schema as Parameters<typeof jsonSchema>[0]);
}
