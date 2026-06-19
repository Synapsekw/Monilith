import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ASSET = resolve(process.cwd(), "public/email/monolith-logo@2x.png");

describe("email logo asset", () => {
  it("exists, is non-trivial, and is a real PNG", () => {
    expect(existsSync(ASSET)).toBe(true);
    const buf = readFileSync(ASSET);
    expect(buf.length).toBeGreaterThan(1000);
    // PNG magic number.
    expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });
});
