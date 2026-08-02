import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

/** Extract the custom-property names declared inside a top-level block. */
function tokensIn(selector: string): Set<string> {
  // Match `selector {` up to the matching close at column 0 (`\n}`).
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in globals.css`);
  const end = CSS.indexOf("\n}", start);
  const body = CSS.slice(start, end);
  return new Set(
    [...body.matchAll(/^\s{2}(--[a-z0-9-]+):/gm)].map((m) => m[1]),
  );
}

const NEW_TOKENS = [
  "--app-wash",
  "--app-bloom",
  "--content-edge",
  "--content-lift",
  "--state-hover",
  "--state-active",
  "--state-selected",
];

/**
 * Tokens deliberately declared once in `:root` because they do not vary by
 * theme. `--radius` is the only pre-existing one; keep this list short and
 * justified — it is the escape hatch that could hide a real parity bug.
 */
const THEME_INVARIANT = new Set(["--radius"]);

describe("Keystone token contract", () => {
  it("declares every wash/state token in both themes", () => {
    const root = tokensIn(":root");
    const dark = tokensIn(".dark");
    for (const token of NEW_TOKENS) {
      expect(root, `${token} missing from :root`).toContain(token);
      expect(dark, `${token} missing from .dark`).toContain(token);
    }
  });

  it("keeps light and dark palettes at parity", () => {
    const root = tokensIn(":root");
    const dark = tokensIn(".dark");
    const onlyLight = [...root].filter(
      (t) => !dark.has(t) && !THEME_INVARIANT.has(t),
    );
    const onlyDark = [...dark].filter(
      (t) => !root.has(t) && !THEME_INVARIANT.has(t),
    );
    expect({ onlyLight, onlyDark }).toEqual({ onlyLight: [], onlyDark: [] });
  });

  it("registers the tokens Tailwind needs to emit utilities", () => {
    for (const entry of [
      "--color-state-hover:",
      "--color-state-active:",
      "--color-state-selected:",
      "--color-content-edge:",
      "--shadow-content-lift:",
      "--text-2xs:",
      "--text-3xs:",
    ]) {
      expect(CSS, `${entry} not registered in @theme`).toContain(entry);
    }
  });

  it("declares the named motion scale", () => {
    for (const d of [
      "--duration-instant: 120ms",
      "--duration-fast: 180ms",
      "--duration-standard: 240ms",
      "--duration-arrival: 500ms",
      "--ease-standard: cubic-bezier(0.25, 1, 0.5, 1)",
    ]) {
      expect(CSS).toContain(d);
    }
  });
});
