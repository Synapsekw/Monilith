import { describe, expect, it } from "vitest";
import {
  cellValueSchema,
  columnSettingsSchema,
  dateValueSchema,
  dropdownSettingsSchema,
  dropdownValueSchema,
  numbersSettingsSchema,
  numbersValueSchema,
  peopleValueSchema,
  statusSettingsSchema,
  statusValueSchema,
  textValueSchema,
} from "./boards";

describe("column settings schemas", () => {
  it("status settings accepts an options array", () => {
    const r = statusSettingsSchema.safeParse({
      options: [{ id: "1", label: "Done", color: "#00c875" }],
    });
    expect(r.success).toBe(true);
  });

  it("status settings defaults options to []", () => {
    const r = statusSettingsSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.options).toEqual([]);
  });

  it("status settings rejects an option missing a label", () => {
    const r = statusSettingsSchema.safeParse({
      options: [{ id: "1", color: "#fff" }],
    });
    expect(r.success).toBe(false);
  });

  it("dropdown settings mirrors status settings", () => {
    const r = dropdownSettingsSchema.safeParse({
      options: [{ id: "a", label: "A", color: "#000" }],
    });
    expect(r.success).toBe(true);
  });

  it("numbers settings accepts optional unit + precision", () => {
    expect(numbersSettingsSchema.safeParse({}).success).toBe(true);
    expect(
      numbersSettingsSchema.safeParse({ unit: "$", precision: 2 }).success,
    ).toBe(true);
  });

  it("numbers settings rejects a non-integer precision", () => {
    expect(numbersSettingsSchema.safeParse({ precision: 1.5 }).success).toBe(
      false,
    );
  });

  it("columnSettingsSchema dispatches by kind", () => {
    expect(columnSettingsSchema("text").safeParse({}).success).toBe(true);
    expect(columnSettingsSchema("people").safeParse({}).success).toBe(true);
    expect(columnSettingsSchema("date").safeParse({}).success).toBe(true);
    expect(
      columnSettingsSchema("status").safeParse({ options: [] }).success,
    ).toBe(true);
  });
});

describe("cell value schemas", () => {
  it("text value requires a string", () => {
    expect(textValueSchema.safeParse({ text: "hi" }).success).toBe(true);
    expect(textValueSchema.safeParse({ text: 3 }).success).toBe(false);
  });

  it("status value accepts an optionId or null", () => {
    expect(statusValueSchema.safeParse({ optionId: "x" }).success).toBe(true);
    expect(statusValueSchema.safeParse({ optionId: null }).success).toBe(true);
  });

  it("dropdown value is an array of option ids", () => {
    expect(
      dropdownValueSchema.safeParse({ optionIds: ["a", "b"] }).success,
    ).toBe(true);
    expect(dropdownValueSchema.safeParse({ optionIds: "a" }).success).toBe(
      false,
    );
  });

  it("people value is an array of user ids", () => {
    expect(peopleValueSchema.safeParse({ userIds: ["u1"] }).success).toBe(true);
  });

  it("date value requires an ISO date and allows an optional end", () => {
    expect(dateValueSchema.safeParse({ date: "2026-06-15" }).success).toBe(
      true,
    );
    expect(
      dateValueSchema.safeParse({ date: "2026-06-15", end: "2026-06-20" })
        .success,
    ).toBe(true);
    expect(dateValueSchema.safeParse({ date: "not-a-date" }).success).toBe(
      false,
    );
  });

  it("numbers value requires a finite number", () => {
    expect(numbersValueSchema.safeParse({ n: 42 }).success).toBe(true);
    expect(numbersValueSchema.safeParse({ n: "42" }).success).toBe(false);
  });

  it("cellValueSchema dispatches by kind", () => {
    expect(cellValueSchema("text").safeParse({ text: "x" }).success).toBe(true);
    expect(cellValueSchema("numbers").safeParse({ n: 1 }).success).toBe(true);
    expect(cellValueSchema("date").safeParse({ text: "x" }).success).toBe(
      false,
    );
  });
});
