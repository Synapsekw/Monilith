import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("web app manifest (installability contract)", () => {
  const m = manifest();

  it("carries the app identity", () => {
    expect(m.name).toBe("Monolith — Work OS");
    expect(m.short_name).toBe("Monolith");
    expect(m.description).toBeTruthy();
  });

  it("declares a standalone, root-scoped launch", () => {
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.background_color).toBe("#0d0d0f");
    expect(m.theme_color).toBe("#0d0d0f");
  });

  it("ships the icon sizes Chromium installability requires", () => {
    const sizes = (m.icons ?? []).map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    const purposes = (m.icons ?? []).map((i) => i.purpose);
    expect(purposes).toContain("maskable");
  });
});
