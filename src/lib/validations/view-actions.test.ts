import { describe, it, expect } from "vitest";
import { timelineConfigSchema } from "@/lib/validations/view-actions";

describe("timelineConfigSchema", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";

  it("accepts end_column_id and color_column_id", () => {
    const parsed = timelineConfigSchema.safeParse({
      date_column_id: uuid,
      end_column_id: uuid,
      color_column_id: uuid,
      zoom: "week",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts null for the new keys", () => {
    const parsed = timelineConfigSchema.safeParse({
      end_column_id: null,
      color_column_id: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a non-uuid color_column_id", () => {
    const parsed = timelineConfigSchema.safeParse({ color_column_id: "nope" });
    expect(parsed.success).toBe(false);
  });
});
