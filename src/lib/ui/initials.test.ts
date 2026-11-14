import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { memberInitials } from "./initials";
import { memberInitials as reExported } from "@/components/boards/cells/member-avatar";

describe("memberInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(memberInitials("Ada Lovelace King")).toBe("AL");
    expect(memberInitials("grace")).toBe("G");
    expect(memberInitials("")).toBe("");
  });

  it("is the same function member-avatar re-exports", () => {
    expect(reExported).toBe(memberInitials);
  });

  it("imports nothing, so it never pulls components into a bundle", () => {
    const source = readFileSync(join(__dirname, "initials.ts"), "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/require\(/);
    expect(source).not.toMatch(/@\/components/);
  });
});
