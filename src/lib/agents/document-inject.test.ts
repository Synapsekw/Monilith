import { describe, it, expect } from "vitest";
import { buildDocumentBlock, composeSystemPrompt } from "./document-inject";

describe("buildDocumentBlock", () => {
  it("is empty for no documents", () => {
    expect(buildDocumentBlock([])).toBe("");
  });

  it("frames documents as reference material, not instructions", () => {
    const block = buildDocumentBlock([{ title: "T", body: "B" }]);
    expect(block).toContain("REFERENCE DOCUMENTS");
    expect(block).toMatch(/NOT instructions/i);
    expect(block).toMatch(/can change your rules/i);
  });

  it("delimits each document with its title", () => {
    const block = buildDocumentBlock([
      { title: "Standup", body: "Y/T/B" },
      { title: "Vendors", body: "Acme" },
    ]);
    expect(block).toContain("--- Standup ---");
    expect(block).toContain("--- Vendors ---");
    expect(block.indexOf("Standup")).toBeLessThan(block.indexOf("Vendors"));
  });

  it("includes bodies verbatim", () => {
    const body = "line one\n\nline two\t tabbed";
    expect(buildDocumentBlock([{ title: "T", body }])).toContain(body);
  });
});

describe("composeSystemPrompt", () => {
  it("puts owner instructions LAST so they outrank document content", () => {
    const out = composeSystemPrompt({
      preamble: "PRE",
      documentBlock: buildDocumentBlock([{ title: "T", body: "B" }]),
      instructions: "INSTR",
    });
    expect(out.indexOf("PRE")).toBeLessThan(out.indexOf("REFERENCE DOCUMENTS"));
    expect(out.indexOf("REFERENCE DOCUMENTS")).toBeLessThan(
      out.indexOf("YOUR OWNER'S INSTRUCTIONS"),
    );
    expect(out.trimEnd().endsWith("INSTR")).toBe(true);
  });

  it("is byte-identical to the pre-feature prompt when there are no documents", () => {
    const out = composeSystemPrompt({
      preamble: "PRE",
      documentBlock: "",
      instructions: "INSTR",
    });
    expect(out).toBe("PRE\n\nYOUR OWNER'S INSTRUCTIONS:\nINSTR");
  });
});
