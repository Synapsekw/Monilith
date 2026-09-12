import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

/**
 * The dock's presence dot (`animate-pulse-ring`, DockTiles.tsx) — spec §5/§7.
 * Read from the stylesheet so the utility can never drift from the class the
 * component uses, and so "nothing scales" is a check, not a comment.
 */
describe("presence pulse (agent dock)", () => {
  it("declares the pulse-ring utility in @theme and its keyframes", () => {
    expect(CSS).toMatch(
      /--animate-pulse-ring:\s*pulse-ring 1\.4s cubic-bezier\(0\.16, 1, 0\.3, 1\)\s+infinite;/,
    );
    expect(CSS).toMatch(/@keyframes pulse-ring \{/);
  });

  it("only ever animates box-shadow — nothing scales, ring 0 → 6px", () => {
    const block = /@keyframes pulse-ring \{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? "";
    expect(block).toContain("box-shadow: 0 0 0 0");
    expect(block).toContain("box-shadow: 0 0 0 6px transparent");
    expect(block).not.toMatch(/transform|scale\(/);
  });
});
