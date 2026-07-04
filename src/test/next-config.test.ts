import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Source-grep assertions on next.config.ts (importing it under vitest would
// evaluate `path.join(__dirname)` and the Next config typing, which is out of
// scope here — the real gates are `pnpm build` and `ANALYZE=true pnpm build`).
// Mirrors the compiled-source assertion style used in BoardViews.test.tsx /
// monolith-scene.test.tsx.
const source = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");

describe("next.config.ts (Task D)", () => {
  it("barrel-optimizes radix-ui via experimental.optimizePackageImports", () => {
    expect(source).toContain("optimizePackageImports");
    expect(source).toMatch(/optimizePackageImports:\s*\[\s*"radix-ui"\s*\]/);
  });

  it("does NOT list packages that Next already optimizes by default", () => {
    // lucide-react and recharts are default-optimized — listing them is a no-op
    // smell. Keep them out of the explicit array.
    const arrayMatch = source.match(/optimizePackageImports:\s*\[([^\]]*)\]/);
    expect(arrayMatch).not.toBeNull();
    const inside = arrayMatch?.[1] ?? "";
    expect(inside).not.toContain("lucide-react");
    expect(inside).not.toContain("recharts");
  });

  it("wraps the export in an ANALYZE-gated bundle analyzer (inert by default)", () => {
    expect(source).toContain("@next/bundle-analyzer");
    expect(source).toMatch(/enabled:\s*process\.env\.ANALYZE\s*===\s*"true"/);
    expect(source).toContain("export default withBundleAnalyzer(nextConfig)");
  });
});

describe("next.config.ts security headers", () => {
  it("defines an async headers() applied to every route", () => {
    expect(source).toMatch(/async headers\(\)/);
    expect(source).toMatch(/source:\s*"\/\(\.\*\)"/);
  });

  it("sets the four baseline security response headers", () => {
    expect(source).toMatch(/"X-Frame-Options"[^]*?"DENY"/);
    expect(source).toMatch(/"X-Content-Type-Options"[^]*?"nosniff"/);
    expect(source).toMatch(
      /"Referrer-Policy"[^]*?"strict-origin-when-cross-origin"/,
    );
    expect(source).toMatch(
      /"Strict-Transport-Security"[^]*?"max-age=63072000; includeSubDomains"/,
    );
  });

  it("does NOT enforce a Content-Security-Policy (deliberate follow-up)", () => {
    // An enforced CSP breaks Next's inline scripts without a nonce pipeline;
    // it is intentionally deferred and documented as such.
    expect(source).not.toMatch(/key:\s*"Content-Security-Policy"/);
    expect(source).toMatch(/CSP is\s*[\s\S]*?follow-up/i);
  });
});
