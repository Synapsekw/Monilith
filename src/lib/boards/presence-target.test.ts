import { describe, expect, it } from "vitest";
import { presenceTarget } from "./presence-target";

describe("presenceTarget", () => {
  it("builds stable composite ids per surface", () => {
    expect(presenceTarget.cell("i1", "c1")).toBe("cell:i1:c1");
    expect(presenceTarget.card("i1")).toBe("card:i1");
    expect(presenceTarget.event("i1")).toBe("event:i1");
    expect(presenceTarget.field("i1", "name")).toBe("field:i1:name");
  });
});
