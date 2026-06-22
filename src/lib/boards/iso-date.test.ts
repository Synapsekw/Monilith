import { describe, expect, it } from "vitest";
import { isoToLocalDate, localDateToISO } from "./iso-date";

describe("iso-date helpers", () => {
  it("parses a YYYY-MM-DD string into a local Date at midnight", () => {
    const d = isoToLocalDate("2026-06-20");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // June (0-indexed)
    expect(d.getDate()).toBe(20);
  });

  it("formats a local Date back to a zero-padded YYYY-MM-DD string", () => {
    const d = new Date(2026, 0, 5); // 2026-01-05 local
    expect(localDateToISO(d)).toBe("2026-01-05");
  });

  it("round-trips a date without an off-by-one drift", () => {
    expect(localDateToISO(isoToLocalDate("2026-06-20"))).toBe("2026-06-20");
    expect(localDateToISO(isoToLocalDate("2026-12-31"))).toBe("2026-12-31");
  });
});
