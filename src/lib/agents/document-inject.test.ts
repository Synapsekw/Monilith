import { describe, it, expect } from "vitest";
import {
  buildDocumentBlock,
  composeSystemPrompt,
  INSTRUCTIONS_SENTINEL,
  DOCUMENT_BLOCK_SENTINEL,
  PROMPT_SENTINELS,
} from "./document-inject";

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

// The sentinels are exported so `documentInputSchema` can reject a document
// that forges them. Only `INSTRUCTIONS_SENTINEL` is actually rejected at save
// time (a body carrying it would close the reference block and read as
// owner-authored instruction); `DOCUMENT_BLOCK_SENTINEL` opens the block
// rather than closing it, so it's kept here as a structurally meaningful
// constant but is NOT part of the save-time rejection (see
// src/lib/validations/agent-documents.ts). That check is only sound if these
// constants really are the strings the prompt is built from — a drift here
// would leave the schema guarding a delimiter nothing uses.
describe("prompt sentinels", () => {
  it("are the literal delimiters the prompt is composed from", () => {
    const block = buildDocumentBlock([{ title: "T", body: "B" }]);
    expect(block.startsWith(DOCUMENT_BLOCK_SENTINEL)).toBe(true);

    const out = composeSystemPrompt({
      preamble: "PRE",
      documentBlock: block,
      instructions: "INSTR",
    });
    expect(out).toContain(`\n\n${INSTRUCTIONS_SENTINEL}\nINSTR`);
  });

  it("covers both delimiters, so the schema can check one list", () => {
    expect([...PROMPT_SENTINELS]).toEqual([
      INSTRUCTIONS_SENTINEL,
      DOCUMENT_BLOCK_SENTINEL,
    ]);
  });
});
