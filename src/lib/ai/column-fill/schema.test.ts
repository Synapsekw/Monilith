import { describe, expect, it } from "vitest";
import {
  COLUMN_FILL_JSON_SCHEMA,
  COLUMN_FILL_MAX,
} from "@/lib/ai/column-fill/schema";

// Regression guard for the structured-output schema, mirroring
// proposal-schema.test.ts's discipline: the model obeys the JSON schema, not
// the prose in the system prompt, so `rows` and each row's fields MUST be
// required — a permissive shape would let the model emit `{ rows: [] }` (or
// omit `optionId`) and ignore the prompt entirely.
describe("COLUMN_FILL_JSON_SCHEMA", () => {
  type JsonSchema = {
    type?: string | string[];
    required?: string[];
    properties?: Record<string, JsonSchema>;
    additionalProperties?: boolean;
    items?: JsonSchema;
  };
  const schema = COLUMN_FILL_JSON_SCHEMA as unknown as JsonSchema;

  it("requires rows and forbids additional top-level properties", () => {
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["rows"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("requires itemId and optionId on every row, forbidding an empty-object escape", () => {
    const rowSchema = schema.properties!.rows.items!;
    expect(rowSchema.type).toBe("object");
    expect(rowSchema.additionalProperties).toBe(false);
    expect(rowSchema.required).toEqual(
      expect.arrayContaining(["itemId", "optionId"]),
    );
  });

  it("makes optionId nullable (string or null), never a freeform escape", () => {
    const optionIdSchema = schema.properties!.rows.items!.properties!.optionId;
    expect(optionIdSchema.type).toEqual(
      expect.arrayContaining(["string", "null"]),
    );
  });

  it("itemId stays a plain required string", () => {
    const itemIdSchema = schema.properties!.rows.items!.properties!.itemId;
    expect(itemIdSchema.type).toBe("string");
  });
});

describe("COLUMN_FILL_MAX", () => {
  it("is the documented hard row cap", () => {
    expect(COLUMN_FILL_MAX).toBe(200);
  });
});
