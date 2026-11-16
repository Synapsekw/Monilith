import { describe, expect, it } from "vitest";
import { pickDoneOption, withDueDate } from "./row-actions";

const OPTIONS = [
  { id: "o1", label: "Working on it" },
  { id: "o2", label: "Cancelled" },
  { id: "o3", label: "Not done" },
  { id: "o4", label: "Done" },
  { id: "o5", label: "Shipped" },
];

describe("pickDoneOption", () => {
  it("guesses the first done-looking option that is not a cancellation", () => {
    expect(pickDoneOption(OPTIONS, { doneOptionIds: null })?.id).toBe("o4");
  });

  it("never picks a negated label ('Not done') under the guess", () => {
    expect(
      pickDoneOption([OPTIONS[0], OPTIONS[2]], { doneOptionIds: null }),
    ).toBeUndefined();
  });

  it("falls back to a cancellation only when it is the sole done option", () => {
    expect(
      pickDoneOption([OPTIONS[0], OPTIONS[1]], { doneOptionIds: null })?.id,
    ).toBe("o2");
  });

  it("uses the configured done options, whatever their labels say", () => {
    // "Shipped" does not look done; Work tracking says it is. "Done" is not
    // configured, so it is not what gets written.
    expect(pickDoneOption(OPTIONS, { doneOptionIds: ["o5"] })?.id).toBe("o5");
  });

  it("prefers a configured option that is not a cancellation, in column order", () => {
    expect(
      pickDoneOption(OPTIONS, { doneOptionIds: ["o5", "o2", "o4"] })?.id,
    ).toBe("o4");
  });

  it("is undefined when the configured ids no longer exist on the column", () => {
    expect(
      pickDoneOption(OPTIONS, { doneOptionIds: ["gone"] }),
    ).toBeUndefined();
    // An empty configured list means nothing is done: no guess is used.
    expect(pickDoneOption(OPTIONS, { doneOptionIds: [] })).toBeUndefined();
  });
});

describe("withDueDate", () => {
  it("writes a single day for an empty or single-day cell", () => {
    expect(withDueDate(null, "2026-11-20")).toEqual({ date: "2026-11-20" });
    expect(withDueDate({ date: "2026-11-10" }, "2026-11-20")).toEqual({
      date: "2026-11-20",
    });
  });

  it("moves the end of a range and keeps its start", () => {
    expect(
      withDueDate({ date: "2026-11-10", end: "2026-11-14" }, "2026-11-20"),
    ).toEqual({ date: "2026-11-10", end: "2026-11-20" });
    // Earlier than the old end but still after the start: still a range.
    expect(
      withDueDate({ date: "2026-11-10", end: "2026-11-14" }, "2026-11-12"),
    ).toEqual({ date: "2026-11-10", end: "2026-11-12" });
  });

  it("collapses a range to one day when the due date is not after its start", () => {
    expect(
      withDueDate({ date: "2026-11-10", end: "2026-11-14" }, "2026-11-10"),
    ).toEqual({ date: "2026-11-10" });
    expect(
      withDueDate({ date: "2026-11-10", end: "2026-11-14" }, "2026-11-03"),
    ).toEqual({ date: "2026-11-03" });
  });

  it("treats an empty end or a malformed start as a single day", () => {
    expect(withDueDate({ date: "2026-11-10", end: "" }, "2026-11-20")).toEqual({
      date: "2026-11-20",
    });
    expect(
      withDueDate({ date: "TBD", end: "2026-11-14" }, "2026-11-20"),
    ).toEqual({ date: "2026-11-20" });
    expect(withDueDate("nonsense", "2026-11-20")).toEqual({
      date: "2026-11-20",
    });
  });
});
