import { describe, it, expect } from "vitest";
import {
  sanitizeFileName,
  buildStoragePath,
} from "@/lib/collaboration/attachments-path";

const ORG = "11111111-1111-4111-8111-111111111111";
const BOARD = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";

describe("sanitizeFileName", () => {
  it("takes the basename (drops path segments) and strips control chars, keeping the extension", () => {
    // basename of the path is `pa ss\x00wd.PNG`; the NUL is removed, the space
    // becomes a hyphen → `pa-sswd.PNG`.
    expect(sanitizeFileName("../../etc/pa ss\x00wd.PNG")).toBe("pa-sswd.PNG");
  });
  it("collapses whitespace and trims", () => {
    expect(sanitizeFileName("  my   report .pdf ")).toBe("my-report.pdf");
  });
  it("falls back to 'file' for an empty/all-stripped name", () => {
    expect(sanitizeFileName("///")).toBe("file");
  });
  it("strips characters outside the safe set", () => {
    expect(sanitizeFileName("ré$umé (final)!.pdf")).toBe("rum-final.pdf");
  });
  it("caps the length while preserving the extension", () => {
    const long = "a".repeat(300) + ".txt";
    const out = sanitizeFileName(long);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith(".txt")).toBe(true);
  });
});

describe("buildStoragePath", () => {
  it("prefixes org/board/item then a uuid-<name> object key", () => {
    const path = buildStoragePath({
      orgId: ORG,
      boardId: BOARD,
      itemId: ITEM,
      fileName: "Design Spec.pdf",
    });
    expect(path).toMatch(
      new RegExp(`^${ORG}/${BOARD}/${ITEM}/[0-9a-f-]{36}-Design-Spec\\.pdf$`),
    );
  });
});
