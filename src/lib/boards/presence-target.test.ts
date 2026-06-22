import { describe, expect, it } from "vitest";
import { presenceTarget } from "./presence-target";

describe("presenceTarget", () => {
  it("builds stable composite ids per surface", () => {
    expect(presenceTarget.cell("i1", "c1")).toBe("cell:i1:c1");
    expect(presenceTarget.card("i1")).toBe("card:i1");
    expect(presenceTarget.event("i1")).toBe("event:i1");
    expect(presenceTarget.field("i1", "name")).toBe("field:i1:name");
  });

  it("builds an item target keyed on the item id", () => {
    expect(presenceTarget.item("abc")).toBe("item:abc");
  });

  it("item targets are distinct from card targets for the same id", () => {
    expect(presenceTarget.item("abc")).not.toBe(presenceTarget.card("abc"));
  });
});
