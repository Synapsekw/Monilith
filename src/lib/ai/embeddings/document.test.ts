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

  it("keeps a long text cell's later paragraphs searchable (part cap = 6,000)", () => {
    // Below the old 2,000-char cap this content would have been truncated
    // mid-cell; it must now survive intact up to 6,000 chars.
    const longCell = "a".repeat(5_999) + "Z";
    const doc = buildItemDocument({ name: "x", textCells: [longCell] });
    expect(doc).toContain("Z");
    expect(doc.length).toBeGreaterThan(2_000);
  });

  it("truncates a single part at exactly MAX_PART_CHARS (6,000)", () => {
    const longCell = "a".repeat(7_000);
    const doc = buildItemDocument({ name: "", textCells: [longCell] });
    expect(doc.length).toBe(6_000);
  });

  it("does not let a handful of long cells exhaust the doc budget before labels (doc cap = 16,000)", () => {
    // Four long-ish cells that would have blown through the old 8,000-char
    // doc cap on their own, plus trailing comments/labels that must still
    // survive in the final document.
    const cells = Array.from({ length: 4 }, (_, i) => `cell-${i} `.repeat(500));
    const doc = buildItemDocument({
      name: "Item name",
      textCells: cells,
      comments: ["a trailing comment"],
      statusLabels: ["In Progress"],
    });
    expect(doc).toContain("In Progress");
    expect(doc).toContain("a trailing comment");
  });

  it("truncates the whole document at MAX_DOC_CHARS (16,000)", () => {
    const cells = Array.from({ length: 4 }, () => "x".repeat(6_000));
    const doc = buildItemDocument({ name: "", textCells: cells });
    expect(doc.length).toBe(16_000);
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
