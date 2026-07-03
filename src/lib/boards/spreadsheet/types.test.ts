import { describe, it, expect } from "vitest";
import { SUBTASK_MARKER, IMPORTABLE_KINDS, MAX_COLS } from "./types";

describe("spreadsheet types", () => {
  it("exposes the subtask marker and caps", () => {
    expect(SUBTASK_MARKER).toBe("↳ ");
    expect(MAX_COLS).toBe(40);
  });
  it("lists 13 importable kinds without people/relation/mirror/files/time_tracking", () => {
    expect(IMPORTABLE_KINDS).toHaveLength(13);
    expect(IMPORTABLE_KINDS).toContain("currency");
    expect(IMPORTABLE_KINDS).toContain("priority");
    expect(IMPORTABLE_KINDS).not.toContain("people");
  });
});
