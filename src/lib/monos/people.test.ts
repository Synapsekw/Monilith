import { describe, expect, it } from "vitest";
import { peopleOnly } from "./people";

describe("peopleOnly", () => {
  it("drops Mono rows and keeps people in order", () => {
    const rows = [
      { userId: "u1" },
      { userId: "m1", mono: { color: "#7395ff" } },
      { userId: "u2", mono: undefined },
    ];
    expect(peopleOnly(rows).map((r) => r.userId)).toEqual(["u1", "u2"]);
  });
});
