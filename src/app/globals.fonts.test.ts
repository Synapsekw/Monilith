import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");

describe("type system", () => {
  it("maps the sans + heading tokens to Inter", () => {
    expect(css).toContain("--font-sans: var(--font-inter)");
    expect(css).toContain("--font-heading: var(--font-inter)");
    expect(css).not.toContain("--font-nunito-sans");
  });

  it("keeps JetBrains Mono as the mono face", () => {
    expect(css).toContain("--font-mono: var(--font-jetbrains-mono)");
  });

  it("loads Inter in the root layout and exposes it as --font-inter", () => {
    expect(layout).toContain('from "next/font/google"');
    expect(layout).toMatch(/Inter\(\s*\{/);
    expect(layout).toContain('variable: "--font-inter"');
    expect(layout).not.toContain("Nunito_Sans");
  });

  it("keeps the wordmark on Nunito 800 (lib/fonts), deliberately", () => {
    const fonts = readFileSync(join(process.cwd(), "src/lib/fonts.ts"), "utf8");
    expect(fonts).toContain("Nunito");
    expect(fonts).toContain('weight: ["800"]');
  });
});
