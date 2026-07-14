import { describe, expect, it } from "vitest";
import { buildItemAssistJsonSchema } from "@/lib/ai/item-assist/schema";

// Regression guard mirroring proposal-schema.test.ts: under strict structured
// output the model obeys the JSON schema, not the prose in the system prompt.
// A permissive `{}`-shaped field lets the model emit an empty value and
// ignore the prompt, so every requested field must be fully specified
// (non-empty `required`, `additionalProperties: false`) — and fields NOT
// requested must not appear in `properties` at all.
describe("buildItemAssistJsonSchema", () => {
  it("requires description when want.description is set, and excludes subtasks/status", () => {
    const schema = buildItemAssistJsonSchema({
      description: { columnId: "col-desc" },
    });
    expect(schema.required).toEqual(["description"]);
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties)).toEqual(["description"]);
    const desc = schema.properties.description as {
      type: string;
      maxLength: number;
    };
    expect(desc.type).toBe("string");
    expect(desc.maxLength).toBe(2000);
  });

  it("requires subtasks (non-empty array, capped) when want.subtasks is set", () => {
    const schema = buildItemAssistJsonSchema({ subtasks: true });
    expect(schema.required).toEqual(["subtasks"]);
    const subtasks = schema.properties.subtasks as {
      type: string;
      minItems: number;
      maxItems: number;
      items: { type: string; maxLength: number };
    };
    expect(subtasks.type).toBe("array");
    expect(subtasks.minItems).toBeGreaterThan(0); // cannot be an empty array
    expect(subtasks.maxItems).toBe(8);
    expect(subtasks.items.maxLength).toBe(200);
  });

  it("requires status.optionId, constrained to an enum of the real option ids", () => {
    const schema = buildItemAssistJsonSchema(
      { status: { columnId: "col-status" } },
      ["opt-1", "opt-2"],
    );
    expect(schema.required).toEqual(["status"]);
    const status = schema.properties.status as {
      type: string;
      additionalProperties: boolean;
      required: string[];
      properties: { optionId: { type: string; enum?: string[] } };
    };
    expect(status.type).toBe("object");
    expect(status.additionalProperties).toBe(false);
    expect(status.required).toEqual(["optionId"]); // cannot be `{}`
    expect(status.properties.optionId.enum).toEqual(["opt-1", "opt-2"]);
  });

  it("combines multiple requested fields, each fully specified", () => {
    const schema = buildItemAssistJsonSchema({
      description: { columnId: "c1" },
      subtasks: true,
    });
    expect(schema.required.sort()).toEqual(["description", "subtasks"]);
    expect(Object.keys(schema.properties).sort()).toEqual([
      "description",
      "subtasks",
    ]);
  });

  it("emits no properties/required for an empty want", () => {
    const schema = buildItemAssistJsonSchema({});
    expect(schema.required).toEqual([]);
    expect(Object.keys(schema.properties)).toEqual([]);
  });
});
