import { describe, it, expect } from "vitest";
import { defaultColumn } from "@/lib/boards/column-defaults";

describe("defaultColumn", () => {
  it("uses the per-kind default name when none is given", () => {
    expect(defaultColumn("text").name).toBe("Text");
    expect(defaultColumn("status").name).toBe("Status");
    expect(defaultColumn("people").name).toBe("People");
    expect(defaultColumn("date").name).toBe("Date");
    expect(defaultColumn("numbers").name).toBe("Numbers");
    expect(defaultColumn("dropdown").name).toBe("Dropdown");
  });
  it("trims and prefers an explicit name", () => {
    expect(defaultColumn("text", "  Notes ").name).toBe("Notes");
  });
  it("seeds Status with the three standard options (with ids)", () => {
    const s = defaultColumn("status").settings as {
      options: { id: string; label: string; color: string }[];
    };
    expect(s.options.map((o) => o.label)).toEqual([
      "Working on it",
      "Stuck",
      "Done",
    ]);
    expect(s.options.every((o) => o.id.length > 0)).toBe(true);
  });
  it("seeds Dropdown with a small usable option set", () => {
    const s = defaultColumn("dropdown").settings as { options: unknown[] };
    expect(s.options.length).toBeGreaterThanOrEqual(2);
  });
  it("gives plain kinds an empty settings object", () => {
    expect(defaultColumn("text").settings).toEqual({});
    expect(defaultColumn("date").settings).toEqual({});
    expect(defaultColumn("numbers").settings).toEqual({});
    expect(defaultColumn("people").settings).toEqual({});
  });
});
