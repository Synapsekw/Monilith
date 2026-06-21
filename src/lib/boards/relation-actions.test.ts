import { describe, expect, it } from "vitest";
import { setRelationLinksSchema } from "@/lib/validations/board-actions";

const uuid = "00000000-0000-0000-0000-000000000000";

describe("setRelationLinks schema", () => {
  it("rejects a bad itemId/columnId uuid", () => {
    expect(
      setRelationLinksSchema.safeParse({
        itemId: "x",
        columnId: "y",
        linkedItemIds: [],
      }).success,
    ).toBe(false);
  });

  it("rejects non-uuid linked ids", () => {
    expect(
      setRelationLinksSchema.safeParse({
        itemId: uuid,
        columnId: uuid,
        linkedItemIds: ["not-a-uuid"],
      }).success,
    ).toBe(false);
  });

  it("accepts an empty list (unlink-all) and a list of uuids", () => {
    expect(
      setRelationLinksSchema.safeParse({
        itemId: uuid,
        columnId: uuid,
        linkedItemIds: [],
      }).success,
    ).toBe(true);
    expect(
      setRelationLinksSchema.safeParse({
        itemId: uuid,
        columnId: uuid,
        linkedItemIds: [uuid],
      }).success,
    ).toBe(true);
  });

  it("caps the linked-id array at 200", () => {
    expect(
      setRelationLinksSchema.safeParse({
        itemId: uuid,
        columnId: uuid,
        linkedItemIds: Array.from({ length: 201 }, () => uuid),
      }).success,
    ).toBe(false);
  });
});
