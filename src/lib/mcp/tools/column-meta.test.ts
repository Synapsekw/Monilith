import { describe, expect, it } from "vitest";
import { columnKindSchema, cellValueSchema } from "@/lib/validations/boards";
import type { ColumnKind } from "@/lib/validations/boards";
import { describeColumn } from "./column-meta";

describe("describeColumn", () => {
  it("emits options with color for a status column", () => {
    expect(
      describeColumn({
        id: "c1",
        name: "Status",
        kind: "status",
        settings: {
          options: [{ id: "s1", label: "Working on it", color: "amber" }],
          summary_aggregation: "distribution",
        },
      }),
    ).toEqual({
      id: "c1",
      name: "Status",
      kind: "status",
      writable: true,
      valueShape: "{ optionId: string | null }",
      note: "optionId must be an id from this column's options[]",
      options: [{ id: "s1", label: "Working on it", color: "amber" }],
    });
  });

  it("omits internal settings keys and emits only the allow-list", () => {
    const desc = describeColumn({
      id: "c2",
      name: "Budget",
      kind: "currency",
      settings: {
        currency: "KWD",
        dirham_sign: true,
        summary_aggregation: "sum",
      },
    });
    expect(desc.settings).toEqual({ currency: "KWD" });
  });

  it("marks relation, mirror and files as not writable", () => {
    for (const kind of ["relation", "mirror", "files"] as const) {
      const desc = describeColumn({
        id: "c3",
        name: kind,
        kind,
        settings: {},
      });
      expect(desc.writable).toBe(false);
      expect(desc.valueShape).toBeNull();
    }
  });

  it("still emits relation wiring even though relation is not writable", () => {
    const desc = describeColumn({
      id: "c4",
      name: "Linked",
      kind: "relation",
      settings: { target_board_id: "b2", allow_multiple: true },
    });
    expect(desc.settings).toEqual({
      target_board_id: "b2",
      allow_multiple: true,
    });
  });

  it("degrades to the base description when settings are malformed", () => {
    expect(
      describeColumn({
        id: "c5",
        name: "Status",
        kind: "status",
        settings: "corrupt",
      }),
    ).toEqual({
      id: "c5",
      name: "Status",
      kind: "status",
      writable: true,
      valueShape: "{ optionId: string | null }",
      note: "optionId must be an id from this column's options[]",
    });
  });

  it("omits options and settings entirely when there are none", () => {
    const desc = describeColumn({
      id: "c6",
      name: "Title",
      kind: "text",
      settings: {},
    });
    expect(desc).not.toHaveProperty("options");
    expect(desc).not.toHaveProperty("settings");
  });
});

/**
 * ANTI-DRIFT GATE.
 *
 * `valueShape` is documentation an autonomous agent acts on, and a confidently
 * wrong hint is worse than no hint. These tests pin every advertised shape to
 * the REAL `cellValueSchema(kind)` — the same schema the MCP write path runs.
 * Change a value schema without changing its hint and this suite fails.
 */
const SAMPLES: Record<ColumnKind, { valid: unknown; invalid: unknown } | null> =
  {
    text: { valid: { text: "hello" }, invalid: { text: 5 } },
    status: { valid: { optionId: "s1" }, invalid: { optionId: 5 } },
    dropdown: { valid: { optionIds: ["s1"] }, invalid: { optionIds: "s1" } },
    people: { valid: { userIds: ["u1"] }, invalid: { userIds: "u1" } },
    date: { valid: { date: "2026-08-06" }, invalid: { date: "06/08/2026" } },
    numbers: { valid: { n: 42 }, invalid: { n: "42" } },
    checkbox: { valid: { checked: true }, invalid: { checked: "yes" } },
    rating: { valid: { rating: 4 }, invalid: { rating: 9 } },
    percent: { valid: { percent: 50 }, invalid: { percent: 101 } },
    currency: { valid: { amount: 12.5 }, invalid: { amount: "12.5" } },
    priority: { valid: { level: "critical" }, invalid: { level: "urgent" } },
    link: {
      valid: { url: "https://example.com" },
      invalid: { url: "javascript:alert(1)" },
    },
    email: { valid: { email: "a@b.com" }, invalid: { email: "nope" } },
    phone: { valid: { phone: "+965 1234" }, invalid: { phone: "" } },
    time_tracking: {
      valid: { estimateSeconds: 3600 },
      invalid: { estimateSeconds: -1 },
    },
    files: null,
    relation: null,
    mirror: null,
  };

describe("valueShape hints match the real cellValueSchema", () => {
  it("covers every ColumnKind with no gaps", () => {
    for (const kind of columnKindSchema.options) {
      expect(SAMPLES).toHaveProperty(kind);
    }
  });

  for (const kind of columnKindSchema.options) {
    it(`${kind}: hint is honest`, () => {
      const sample = SAMPLES[kind];
      const desc = describeColumn({
        id: "c",
        name: kind,
        kind,
        settings: {},
      });
      if (sample === null) {
        expect(desc.writable).toBe(false);
        expect(desc.valueShape).toBeNull();
        return;
      }
      expect(desc.writable).toBe(true);
      expect(desc.valueShape).toBeTruthy();
      expect(cellValueSchema(kind).safeParse(sample.valid).success).toBe(true);
      expect(cellValueSchema(kind).safeParse(sample.invalid).success).toBe(
        false,
      );
    });
  }
});
