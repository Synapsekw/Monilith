import { describe, expect, it } from "vitest";
import { buildItemDocument, contentHash } from "./document";

describe("buildItemDocument", () => {
  it("composes name + text cells + recent comments + status labels", () => {
    const doc = buildItemDocument({
      name: "Onboard Dana",
      textCells: ["Send laptop"],
      comments: ["welcome!"],
      statusLabels: ["To do"],
    });
    expect(doc).toContain("Onboard Dana");
    expect(doc).toContain("Send laptop");
    expect(doc).toContain("welcome!");
    expect(doc).toContain("To do");
  });

  it("orders sections deterministically: name first", () => {
    const doc = buildItemDocument({
      name: "Title here",
      textCells: ["cell text"],
      statusLabels: ["Done"],
    });
    expect(doc.indexOf("Title here")).toBe(0);
    expect(doc.indexOf("Title here")).toBeLessThan(doc.indexOf("cell text"));
  });

  it("drops empty/whitespace parts and never emits ids", () => {
    const doc = buildItemDocument({
      name: "Only name",
      textCells: ["", "   "],
      comments: [],
      statusLabels: [],
    });
    expect(doc).toBe("Only name");
  });

  it("keeps only the most recent comments (cap = 10)", () => {
    const comments = Array.from({ length: 15 }, (_, i) => `comment-${i}`);
    const doc = buildItemDocument({ name: "x", comments });
    expect(doc).toContain("comment-14"); // newest kept
    expect(doc).not.toContain("comment-0"); // oldest dropped
  });
});

describe("contentHash", () => {
  it("is stable for identical input", () => {
    const doc = buildItemDocument({ name: "x" });
    expect(contentHash(doc)).toBe(contentHash(doc));
  });

  it("changes when the document text changes", () => {
    const a = buildItemDocument({ name: "x" });
    const b = buildItemDocument({ name: "y" });
    expect(contentHash(a)).not.toBe(contentHash(b));
  });
});
