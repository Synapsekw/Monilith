import { describe, expect, it } from "vitest";
import { allowedAggregations, COUNT_FAMILY } from "./aggregation";
import type { ColumnKind } from "@/lib/validations/boards";

const ALL_KINDS: ColumnKind[] = [
  "text",
  "status",
  "people",
  "date",
  "numbers",
  "dropdown",
  "checkbox",
  "rating",
  "link",
  "email",
  "phone",
  "files",
  "time_tracking",
  "relation",
  "mirror",
];

describe("allowedAggregations", () => {
  it("offers the count family on every kind", () => {
    for (const kind of ALL_KINDS) {
      const allowed = allowedAggregations(
        kind,
        kind === "mirror" ? "numbers" : undefined,
      );
      for (const c of COUNT_FAMILY) {
        expect(allowed, `${kind} should allow ${c}`).toContain(c);
      }
    }
  });

  it("puts the sensible default first", () => {
    expect(allowedAggregations("numbers")[0]).toBe("sum");
    expect(allowedAggregations("rating")[0]).toBe("avg");
    expect(allowedAggregations("status")[0]).toBe("distribution");
    expect(allowedAggregations("dropdown")[0]).toBe("distribution");
    expect(allowedAggregations("checkbox")[0]).toBe("checked_total");
    expect(allowedAggregations("date")[0]).toBe("date_range");
    expect(allowedAggregations("people")[0]).toBe("count_unique");
    expect(allowedAggregations("time_tracking")[0]).toBe("total_tracked");
    expect(allowedAggregations("files")[0]).toBe("count_filled");
    expect(allowedAggregations("relation")[0]).toBe("count_filled");
    expect(allowedAggregations("text")[0]).toBe("count");
  });

  it("only offers the count family for free-text kinds", () => {
    for (const kind of ["text", "link", "email", "phone"] as ColumnKind[]) {
      expect(allowedAggregations(kind)).toEqual([...COUNT_FAMILY]);
    }
  });

  it("numbers exposes the numeric aggregations", () => {
    const allowed = allowedAggregations("numbers");
    expect(allowed).toContain("sum");
    expect(allowed).toContain("avg");
    expect(allowed).toContain("min");
    expect(allowed).toContain("max");
  });

  it("mirror delegates to the target column's kind", () => {
    expect(allowedAggregations("mirror", "numbers")).toEqual(
      allowedAggregations("numbers"),
    );
    expect(allowedAggregations("mirror", "status")).toEqual(
      allowedAggregations("status"),
    );
  });

  it("mirror falls back to the count family without a target", () => {
    expect(allowedAggregations("mirror")).toEqual([...COUNT_FAMILY]);
  });

  it("mirror does not recurse on a mirror target", () => {
    expect(allowedAggregations("mirror", "mirror")).toEqual([...COUNT_FAMILY]);
  });
});
