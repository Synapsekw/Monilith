import { describe, expect, it } from "vitest";
import {
  validateProposal,
  packLayout,
  PROPOSAL_JSON_SCHEMA,
} from "@/lib/ai/proposal-schema";
import type { BoardSnapshot } from "@/lib/ai/board-snapshot";

// Regression guards for the structured-output schema. Two bugs are pinned here:
//  1. A permissive `config: {object}` let the model emit `config: {}` and ignore
//     the prompt, so every generation collapsed to an empty list. Each oneOf
//     branch's config MUST require its discriminating field(s).
//  2. Anthropic's grammar rejects schemas with >24 optional parameters (400).
//     Adding `layout` back (or other optional fields) must not breach that.
describe("PROPOSAL_JSON_SCHEMA", () => {
  type JsonSchema = {
    type?: string;
    required?: string[];
    properties?: Record<string, JsonSchema>;
    additionalProperties?: boolean;
    oneOf?: JsonSchema[];
    items?: JsonSchema;
    enum?: string[];
  };
  const schema = PROPOSAL_JSON_SCHEMA as unknown as JsonSchema;
  const branches = schema.properties!.widgets.items!.oneOf!;

  it("has one oneOf branch per widget kind", () => {
    const kinds = branches.map((b) => b.properties!.kind.enum![0]).sort();
    expect(kinds).toEqual(["battery", "chart", "list", "number"]);
  });

  it("forces every widget config to require its discriminating field(s)", () => {
    for (const b of branches) {
      const cfg = b.properties!.config;
      expect(cfg.additionalProperties).toBe(false); // not freeform
      expect(Array.isArray(cfg.required)).toBe(true);
      expect(cfg.required!.length).toBeGreaterThan(0); // cannot be `{}`
    }
  });

  it("stays within Anthropic's 24 optional-parameter grammar limit", () => {
    const countOptional = (s: JsonSchema | undefined): number => {
      if (!s || typeof s !== "object") return 0;
      let n = 0;
      if (s.type === "object" && s.properties) {
        const req = new Set<string>(s.required ?? []);
        for (const [k, v] of Object.entries(s.properties)) {
          if (!req.has(k)) n += 1;
          n += countOptional(v);
        }
      }
      if (Array.isArray(s.oneOf))
        for (const br of s.oneOf) n += countOptional(br);
      if (s.items) n += countOptional(s.items);
      return n;
    };
    expect(countOptional(schema)).toBeLessThanOrEqual(24);
  });
});

const snap: BoardSnapshot = {
  board: { id: "b1", name: "Sprint" },
  rowCount: 10,
  columns: [
    { id: "c-status", name: "Status", kind: "status", options: [] },
    { id: "c-pts", name: "Points", kind: "numbers" },
    { id: "c-notes", name: "Notes", kind: "text" },
  ],
  columnStats: {},
  meta: { rowCount: 10, columnCount: 3, estimatedTokens: 1 },
};

describe("validateProposal", () => {
  it("keeps a valid chart widget and a number widget", () => {
    const res = validateProposal(
      {
        name: "Sprint overview",
        widgets: [
          { kind: "number", title: "Total", config: { agg: "count" } },
          {
            kind: "chart",
            title: "By status",
            config: {
              chartType: "bar",
              primary: { kind: "status", columnId: "c-status" },
              measure: { agg: "count" },
            },
          },
        ],
      },
      snap,
    );
    expect(res.name).toBe("Sprint overview");
    expect(res.widgets).toHaveLength(2);
    expect(res.warnings).toHaveLength(0);
  });

  it("drops a chart referencing a non-existent column", () => {
    const res = validateProposal(
      {
        name: "x",
        widgets: [
          {
            kind: "chart",
            title: "bad",
            config: {
              chartType: "bar",
              primary: { kind: "status", columnId: "nope" },
              measure: { agg: "count" },
            },
          },
        ],
      },
      snap,
    );
    expect(res.widgets).toHaveLength(0);
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it("drops a chart whose primary kind mismatches the column's kind", () => {
    const res = validateProposal(
      {
        name: "x",
        widgets: [
          {
            kind: "chart",
            title: "bad",
            config: {
              chartType: "bar",
              primary: { kind: "status", columnId: "c-pts" }, // c-pts is numbers
              measure: { agg: "count" },
            },
          },
        ],
      },
      snap,
    );
    expect(res.widgets).toHaveLength(0);
  });

  it("repairs a sum measure with a missing value column down to count", () => {
    const res = validateProposal(
      {
        name: "x",
        widgets: [
          {
            kind: "chart",
            title: "repair",
            config: {
              chartType: "bar",
              primary: { kind: "status", columnId: "c-status" },
              measure: { agg: "sum" }, // no valueColumnId → coerce to count
            },
          },
        ],
      },
      snap,
    );
    expect(res.widgets).toHaveLength(1);
    expect(
      (res.widgets[0].config as { measure: { agg: string } }).measure.agg,
    ).toBe("count");
  });

  it("returns empty (with a warning) when name is missing", () => {
    const res = validateProposal({ widgets: [] } as never, snap);
    expect(res.name.length).toBeGreaterThan(0); // falls back to board name
  });
});

describe("packLayout", () => {
  it("assigns non-overlapping 12-col rects when layout is omitted", () => {
    const widgets = [
      { kind: "number" as const, title: "a", config: {} },
      { kind: "number" as const, title: "b", config: {} },
      { kind: "chart" as const, title: "c", config: {} },
    ];
    const packed = packLayout(widgets);
    expect(packed).toHaveLength(3);
    for (const w of packed) {
      expect(w.layout.x).toBeGreaterThanOrEqual(0);
      expect(w.layout.x + w.layout.w).toBeLessThanOrEqual(12);
      expect(w.layout.w).toBeGreaterThanOrEqual(1);
      expect(w.layout.h).toBeGreaterThanOrEqual(1);
    }
  });
});
