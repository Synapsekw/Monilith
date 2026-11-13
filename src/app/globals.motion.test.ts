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

/**
 * The status pill pop (`animate-pill-pop`, components/ui/done-burst.tsx) —
 * visual refresh spec 4.7. One 380ms run on the keystone curve; transform only,
 * so it can never trigger layout in a board row.
 */
describe("status pill pop", () => {
  it("declares the pill-pop utility in @theme and its keyframes", () => {
    expect(CSS).toMatch(
      /--animate-pill-pop:\s*pill-pop 0\.38s cubic-bezier\(0\.16, 1, 0\.3, 1\);/,
    );
    expect(CSS).toMatch(/@keyframes pill-pop \{/);
  });

  it("runs once — never an infinite loop on a board row", () => {
    const decl = /--animate-pill-pop:([^;]+);/.exec(CSS)?.[1] ?? "";
    expect(decl).not.toMatch(/infinite/);
  });

  it("only ever animates transform, and starts and ends at rest", () => {
    const block = /@keyframes pill-pop \{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? "";
    const properties = [...block.matchAll(/^\s+([a-z-]+):/gm)].map((m) => m[1]);
    expect(properties.length).toBeGreaterThan(0);
    expect(new Set(properties)).toEqual(new Set(["transform"]));
    expect(block).toMatch(/0%,\s*100% \{\s*transform: scale\(1\);/);
  });

  it("is named by the class the celebration helper toggles", async () => {
    const { PILL_POP_CLASS } = await import("@/components/ui/done-burst");
    expect(PILL_POP_CLASS).toBe("animate-pill-pop");
  });
});
