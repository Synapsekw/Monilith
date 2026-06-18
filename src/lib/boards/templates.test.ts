import { describe, it, expect } from "vitest";
import { BOARD_TEMPLATES, getTemplate } from "@/lib/boards/templates";
import { columnKindSchema } from "@/lib/validations/boards";

describe("board templates catalog", () => {
  it("has four templates with unique ids incl. 'blank'", () => {
    const ids = BOARD_TEMPLATES.map((t) => t.id);
    expect(ids).toContain("blank");
    expect(new Set(ids).size).toBe(ids.length);
    expect(BOARD_TEMPLATES).toHaveLength(4);
  });

  it("uses only valid Pulse column kinds", () => {
    for (const t of BOARD_TEMPLATES)
      for (const c of t.columns)
        expect(columnKindSchema.safeParse(c.kind).success).toBe(true);
  });

  it("every column ref + group ref is unique within a template", () => {
    for (const t of BOARD_TEMPLATES) {
      const cols = t.columns.map((c) => c.ref);
      const grps = t.groups.map((g) => g.ref);
      expect(new Set(cols).size).toBe(cols.length);
      expect(new Set(grps).size).toBe(grps.length);
    }
  });

  it("only status/dropdown columns carry options; numbers may carry settings", () => {
    for (const t of BOARD_TEMPLATES)
      for (const c of t.columns) {
        if (c.options) expect(["status", "dropdown"]).toContain(c.kind);
        if (c.options)
          expect(new Set(c.options.map((o) => o.ref)).size).toBe(
            c.options.length,
          );
      }
  });

  it("every item references a real group, and every cell a real column + option", () => {
    for (const t of BOARD_TEMPLATES) {
      const groupRefs = new Set(t.groups.map((g) => g.ref));
      const colByRef = new Map(t.columns.map((c) => [c.ref, c]));
      for (const item of t.items) {
        expect(groupRefs.has(item.groupRef)).toBe(true);
        for (const [colRef, value] of Object.entries(item.cells)) {
          const col = colByRef.get(colRef);
          expect(col, `${t.id}:${colRef}`).toBeDefined();
          const optRefs = new Set((col!.options ?? []).map((o) => o.ref));
          if ("optionRef" in value)
            expect(optRefs.has(value.optionRef)).toBe(true);
          if ("optionRefs" in value)
            for (const r of value.optionRefs) expect(optRefs.has(r)).toBe(true);
        }
      }
    }
  });

  it("getTemplate returns by id and undefined for unknown", () => {
    expect(getTemplate("blank")?.id).toBe("blank");
    expect(getTemplate("nope")).toBeUndefined();
  });
});
