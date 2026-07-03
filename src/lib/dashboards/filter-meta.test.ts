import { describe, expect, it } from "vitest";
import {
  operatorsForKind,
  valueControlFor,
  OPERATOR_LABEL,
} from "./filter-meta";

describe("operatorsForKind", () => {
  it("status offers is / is_not / empties only", () => {
    expect(operatorsForKind("status")).toEqual([
      "is",
      "is_not",
      "is_empty",
      "not_empty",
    ]);
  });
  it("numbers offers numeric comparisons + empties", () => {
    expect(operatorsForKind("numbers")).toEqual([
      "num_eq",
      "num_ne",
      "gt",
      "lt",
      "is_empty",
      "not_empty",
    ]);
  });
  it("dropdown/people only offer empties (value match deferred)", () => {
    expect(operatorsForKind("dropdown")).toEqual(["is_empty", "not_empty"]);
    expect(operatorsForKind("people")).toEqual(["is_empty", "not_empty"]);
  });
  it("unknown kind offers empties only", () => {
    expect(operatorsForKind("mystery")).toEqual(["is_empty", "not_empty"]);
  });
  it("currency filters like numbers", () => {
    expect(operatorsForKind("currency")).toEqual([
      "num_eq",
      "num_ne",
      "gt",
      "lt",
      "is_empty",
      "not_empty",
    ]);
  });
});

describe("valueControlFor", () => {
  it("empties need no value control", () => {
    expect(valueControlFor("status", "is_empty")).toBe("none");
    expect(valueControlFor("numbers", "not_empty")).toBe("none");
  });
  it("status non-empty → option picker", () => {
    expect(valueControlFor("status", "is")).toBe("option");
  });
  it("numbers → number; date → date; text → text", () => {
    expect(valueControlFor("numbers", "gt")).toBe("number");
    expect(valueControlFor("date", "before")).toBe("date");
    expect(valueControlFor("text", "contains")).toBe("text");
  });
  it("currency → number", () => {
    expect(valueControlFor("currency", "gt")).toBe("number");
    expect(valueControlFor("currency", "num_eq")).toBe("number");
  });
});

describe("OPERATOR_LABEL", () => {
  it("labels every operator", () => {
    for (const op of [
      "is",
      "is_not",
      "contains",
      "eq",
      "num_eq",
      "num_ne",
      "gt",
      "lt",
      "before",
      "after",
      "on",
      "is_empty",
      "not_empty",
    ] as const) {
      expect(OPERATOR_LABEL[op]).toBeTruthy();
    }
  });
});
