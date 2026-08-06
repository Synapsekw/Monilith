import { describe, expect, it } from "vitest";
import {
  cellValueSchema,
  columnKindSchema,
  columnSettingsSchema,
  currencySettingsSchema,
  currencyValueSchema,
  dateValueSchema,
  dropdownSettingsSchema,
  dropdownValueSchema,
  numbersSettingsSchema,
  numbersValueSchema,
  peopleValueSchema,
  priorityValueSchema,
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

describe("6b cell value schemas", () => {
  it("checkbox accepts a boolean", () => {
    expect(
      cellValueSchema("checkbox").safeParse({ checked: true }).success,
    ).toBe(true);
    expect(
      cellValueSchema("checkbox").safeParse({ checked: "yes" }).success,
    ).toBe(false);
  });
  it("rating is an int 1..5", () => {
    expect(cellValueSchema("rating").safeParse({ rating: 5 }).success).toBe(
      true,
    );
    expect(cellValueSchema("rating").safeParse({ rating: 0 }).success).toBe(
      false,
    );
    expect(cellValueSchema("rating").safeParse({ rating: 6 }).success).toBe(
      false,
    );
  });
  it("link requires a valid url, label optional", () => {
    expect(
      cellValueSchema("link").safeParse({ url: "https://a.com" }).success,
    ).toBe(true);
    expect(
      cellValueSchema("link").safeParse({ url: "https://a.com", text: "A" })
        .success,
    ).toBe(true);
    expect(
      cellValueSchema("link").safeParse({ url: "not-a-url" }).success,
    ).toBe(false);
  });
  it("link rejects non-http(s) schemes (XSS guard)", () => {
    for (const url of [
      "javascript:alert(1)",
      "mailto:a@b.com",
      "ftp://x.com",
      "data:text/html,<script>1</script>",
    ]) {
      expect(cellValueSchema("link").safeParse({ url }).success).toBe(false);
    }
  });
  it("email validates format", () => {
    expect(
      cellValueSchema("email").safeParse({ email: "a@b.com" }).success,
    ).toBe(true);
    expect(cellValueSchema("email").safeParse({ email: "nope" }).success).toBe(
      false,
    );
  });
  it("phone is a non-empty trimmed string", () => {
    expect(
      cellValueSchema("phone").safeParse({ phone: "+1 555" }).success,
    ).toBe(true);
    expect(cellValueSchema("phone").safeParse({ phone: "" }).success).toBe(
      false,
    );
  });
  it("new kinds use empty settings", () => {
    for (const k of [
      "checkbox",
      "rating",
      "link",
      "email",
      "phone",
      "files",
    ] as const) {
      expect(columnSettingsSchema(k).safeParse({}).success).toBe(true);
    }
  });
});

describe("time_tracking validation", () => {
  it("accepts time_tracking as a kind", () => {
    expect(columnKindSchema.safeParse("time_tracking").success).toBe(true);
  });
  it("estimate cell value requires a positive int", () => {
    const s = cellValueSchema("time_tracking");
    expect(s.safeParse({ estimateSeconds: 3600 }).success).toBe(true);
    expect(s.safeParse({ estimateSeconds: 0 }).success).toBe(false);
    expect(s.safeParse({ estimateSeconds: 1.5 }).success).toBe(false);
  });
});

describe("relation validation", () => {
  const uuid = "00000000-0000-0000-0000-000000000000";

  it("accepts relation as a kind", () => {
    expect(columnKindSchema.safeParse("relation").success).toBe(true);
  });
  it("settings require a target_board_id uuid", () => {
    const s = columnSettingsSchema("relation");
    expect(s.safeParse({ target_board_id: "not-a-uuid" }).success).toBe(false);
    expect(s.safeParse({ target_board_id: uuid }).success).toBe(true);
  });
  it("settings default allow_multiple to true", () => {
    const parsed = columnSettingsSchema("relation").parse({
      target_board_id: uuid,
    });
    expect(parsed).toMatchObject({ allow_multiple: true });
  });
  it("relation cell value carries no data (derives from relation_links)", () => {
    const s = cellValueSchema("relation");
    expect(s.safeParse({}).success).toBe(true);
    expect(s.safeParse({ anything: 1 }).success).toBe(false);
  });
});

describe("mirror column validation", () => {
  it("accepts mirror as a column kind", () => {
    expect(columnKindSchema.safeParse("mirror").success).toBe(true);
  });
  it("validates mirror settings", () => {
    // zod 4's .uuid() enforces a valid version+variant nibble, so use real v4
    // UUIDs here (the all-1s/all-2s placeholders fail the variant check).
    const ok = columnSettingsSchema("mirror").safeParse({
      source_relation_column_id: "11111111-1111-4111-8111-111111111111",
      target_column_id: "22222222-2222-4222-8222-222222222222",
    });
    expect(ok.success).toBe(true);
    const bad = columnSettingsSchema("mirror").safeParse({
      source_relation_column_id: "not-a-uuid",
    });
    expect(bad.success).toBe(false);
  });
  it("mirror cell value is empty-strict (no cell_values row)", () => {
    expect(cellValueSchema("mirror").safeParse({}).success).toBe(true);
    expect(cellValueSchema("mirror").safeParse({ x: 1 }).success).toBe(false);
  });
});

describe("percent column validation", () => {
  it("accepts percent as a column kind", () => {
    expect(columnKindSchema.safeParse("percent").success).toBe(true);
  });
  it("percent cell value requires a number in 0..100", () => {
    const s = cellValueSchema("percent");
    expect(s.safeParse({ percent: 0 }).success).toBe(true);
    expect(s.safeParse({ percent: 75 }).success).toBe(true);
    expect(s.safeParse({ percent: 100 }).success).toBe(true);
    expect(s.safeParse({ percent: -1 }).success).toBe(false);
    expect(s.safeParse({ percent: 101 }).success).toBe(false);
    expect(s.safeParse({ percent: "50" }).success).toBe(false);
  });
  it("percent uses empty settings", () => {
    expect(columnSettingsSchema("percent").safeParse({}).success).toBe(true);
  });
});

describe("6d-3 summary_aggregation settings", () => {
  it("accepts a valid summary_aggregation on any kind's settings", () => {
    // empty-settings kind (text) — the base field merges in
    expect(
      columnSettingsSchema("text").safeParse({ summary_aggregation: "count" })
        .success,
    ).toBe(true);
    // numbers
    expect(
      columnSettingsSchema("numbers").safeParse({ summary_aggregation: "sum" })
        .success,
    ).toBe(true);
    // status (alongside its own options field)
    expect(
      columnSettingsSchema("status").safeParse({
        options: [],
        summary_aggregation: "distribution",
      }).success,
    ).toBe(true);
  });

  it("settings without summary_aggregation still validate (backward compatible)", () => {
    expect(columnSettingsSchema("text").safeParse({}).success).toBe(true);
    expect(columnSettingsSchema("numbers").safeParse({}).success).toBe(true);
  });

  it("rejects an unknown aggregation id", () => {
    expect(
      columnSettingsSchema("numbers").safeParse({
        summary_aggregation: "median",
      }).success,
    ).toBe(false);
  });

  it("empty-settings kinds still reject unknown keys", () => {
    expect(
      columnSettingsSchema("text").safeParse({ bogus: true }).success,
    ).toBe(false);
  });
});

describe("currency column", () => {
  it("kind enum includes currency", () => {
    expect(columnKindSchema.safeParse("currency").success).toBe(true);
  });
  it("settings require a known ISO code", () => {
    expect(currencySettingsSchema.safeParse({ currency: "KWD" }).success).toBe(
      true,
    );
    expect(currencySettingsSchema.safeParse({ currency: "ZZZ" }).success).toBe(
      false,
    );
    expect(currencySettingsSchema.safeParse({}).success).toBe(false);
  });
  it("settings accept the shared summary_aggregation", () => {
    expect(
      currencySettingsSchema.safeParse({
        currency: "USD",
        summary_aggregation: "sum",
      }).success,
    ).toBe(true);
  });
  it("settings accept the optional dirham_sign display flag", () => {
    expect(
      currencySettingsSchema.safeParse({ currency: "AED", dirham_sign: false })
        .success,
    ).toBe(true);
    expect(
      currencySettingsSchema.safeParse({ currency: "AED", dirham_sign: "no" })
        .success,
    ).toBe(false);
  });
  it("cell value is a finite amount", () => {
    expect(currencyValueSchema.safeParse({ amount: 1234.5 }).success).toBe(
      true,
    );
    expect(currencyValueSchema.safeParse({ amount: -20 }).success).toBe(true);
    expect(currencyValueSchema.safeParse({ amount: Infinity }).success).toBe(
      false,
    );
    expect(currencyValueSchema.safeParse({ amount: "12" }).success).toBe(false);
    expect(currencyValueSchema.safeParse({}).success).toBe(false);
  });
  it("dispatchers route the currency kind", () => {
    expect(columnSettingsSchema("currency")).toBe(currencySettingsSchema);
    expect(cellValueSchema("currency")).toBe(currencyValueSchema);
  });
});

describe("priority column kind", () => {
  it("is a known column kind", () => {
    expect(columnKindSchema.safeParse("priority").success).toBe(true);
  });
  it("accepts normal and critical levels", () => {
    expect(priorityValueSchema.safeParse({ level: "normal" }).success).toBe(
      true,
    );
    expect(priorityValueSchema.safeParse({ level: "critical" }).success).toBe(
      true,
    );
  });
  it("rejects unknown levels and junk", () => {
    expect(priorityValueSchema.safeParse({ level: "urgent" }).success).toBe(
      false,
    );
    expect(priorityValueSchema.safeParse({}).success).toBe(false);
    expect(
      cellValueSchema("priority").safeParse({ level: "high" }).success,
    ).toBe(false);
  });
  it("uses empty settings (fixed vocabulary, no options)", () => {
    expect(columnSettingsSchema("priority").safeParse({}).success).toBe(true);
    expect(
      columnSettingsSchema("priority").safeParse({ options: [] }).success,
    ).toBe(false); // strict: no options array on priority
  });
  it("dispatchers route the priority kind", () => {
    expect(cellValueSchema("priority")).toBe(priorityValueSchema);
  });
});

describe("textValueSchema cap", () => {
  it("accepts a value at exactly the cap", () => {
    expect(
      textValueSchema.safeParse({ text: "x".repeat(20_000) }).success,
    ).toBe(true);
  });

  it("rejects a value one character over the cap", () => {
    expect(
      textValueSchema.safeParse({ text: "x".repeat(20_001) }).success,
    ).toBe(false);
  });

  it("still accepts an empty string", () => {
    expect(textValueSchema.safeParse({ text: "" }).success).toBe(true);
  });

  it("still accepts multi-line markdown", () => {
    expect(textValueSchema.safeParse({ text: "**a**\n- b\n- c" }).success).toBe(
      true,
    );
  });
});
