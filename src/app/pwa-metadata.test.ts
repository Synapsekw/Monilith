import { describe, expect, it } from "vitest";
import { metadata, viewport } from "./layout";

describe("root PWA metadata", () => {
  it("sets a media-split theme color in the viewport export", () => {
    const tc = viewport.themeColor;
    expect(tc).toBeDefined();
    const colors = Array.isArray(tc)
      ? tc.map((t) => (typeof t === "string" ? t : t.color))
      : [typeof tc === "string" ? tc : tc?.color];
    expect(colors).toContain("#0e0e10");
  });

  it("declares itself an installable apple web app", () => {
    expect(metadata.appleWebApp).toMatchObject({
      capable: true,
      title: "Monolith",
    });
  });

  it("links the web manifest", () => {
    expect(metadata.manifest).toBe("/manifest.webmanifest");
  });

  it("does NOT lock user zoom (a11y + iPad pinch-zoom)", () => {
    expect(viewport.userScalable).not.toBe(false);
    expect(viewport.maximumScale).toBeUndefined();
  });
});
