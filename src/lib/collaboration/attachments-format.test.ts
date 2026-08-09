import { describe, it, expect } from "vitest";
import {
  formatSize,
  fileKind,
  fileTypeLabel,
  fileTypeTone,
  isPreviewable,
  isPdf,
  isDocx,
  isSheetParseable,
  isInlineParseable,
  canPreviewInline,
} from "@/lib/collaboration/attachments-format";

describe("formatSize", () => {
  it("formats bytes/KB/MB", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(900)).toBe("900 B");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(5_242_880)).toBe("5 MB");
  });
});

describe("fileKind", () => {
  it("classifies by mime then by extension", () => {
    expect(fileKind("image/png", "a.png")).toBe("image");
    expect(fileKind("video/mp4", "a.mp4")).toBe("video");
    expect(fileKind("application/pdf", "a.pdf")).toBe("pdf");
    expect(fileKind("application/zip", "a.zip")).toBe("archive");
    expect(fileKind("application/octet-stream", "a.xlsx")).toBe("sheet");
    expect(fileKind("application/octet-stream", "a.docx")).toBe("doc");
    expect(fileKind("application/octet-stream", "a.bin")).toBe("other");
  });
});

describe("isPreviewable", () => {
  it("allows raster images and mp4/webm video", () => {
    for (const m of [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "video/mp4",
      "video/webm",
    ])
      expect(isPreviewable(m)).toBe(true);
  });
  it("treats SVG as NOT previewable (navigated SVG can execute script)", () => {
    expect(isPreviewable("image/svg+xml")).toBe(false);
  });
  it("treats pdf/other as not previewable inline", () => {
    expect(isPreviewable("application/pdf")).toBe(false);
    expect(isPreviewable("application/octet-stream")).toBe(false);
  });
});

describe("isPdf", () => {
  it("is true only for application/pdf (case-insensitive)", () => {
    expect(isPdf("application/pdf")).toBe(true);
    expect(isPdf("APPLICATION/PDF")).toBe(true);
    expect(isPdf("image/png")).toBe(false);
  });
});

describe("fileKind — slides", () => {
  it.each(["deck.pptx", "deck.ppt", "deck.key", "deck.odp"])(
    "classifies %s as slides",
    (name) => {
      expect(fileKind("application/octet-stream", name)).toBe("slides");
    },
  );

  it("classifies .ods as a sheet and .odt as a doc", () => {
    expect(fileKind("application/octet-stream", "b.ods")).toBe("sheet");
    expect(fileKind("application/octet-stream", "b.odt")).toBe("doc");
  });

  it("does not treat an extensionless name as its own extension", () => {
    // "zip" with no dot must NOT classify as an archive.
    expect(fileKind("application/octet-stream", "zip")).toBe("other");
  });
});

describe("fileTypeLabel", () => {
  it.each([
    ["report.pdf", "PDF"],
    ["deck.pptx", "PPT"],
    ["deck.ppt", "PPT"],
    ["notes.docx", "DOC"],
    ["notes.doc", "DOC"],
    ["budget.xlsx", "XLS"],
    ["budget.xls", "XLS"],
    ["rows.csv", "CSV"],
    ["bundle.tar", "ZIP"],
    ["photo.jpeg", "JPG"],
    ["clip.mp4", "MP4"],
  ])("labels %s as %s", (name, expected) => {
    expect(fileTypeLabel(name, "application/octet-stream")).toBe(expected);
  });

  it("caps an unknown long extension at 4 characters", () => {
    expect(fileTypeLabel("a.sketchfile", "application/octet-stream")).toBe(
      "SKET",
    );
  });

  it("falls back to the mime subtype when there is no extension", () => {
    expect(fileTypeLabel("noextension", "image/png")).toBe("PNG");
  });

  it("falls back to FILE when it has neither", () => {
    expect(fileTypeLabel("noextension", "")).toBe("FILE");
  });
});

describe("fileTypeTone", () => {
  it.each([
    ["a.pdf", "pdf"],
    ["a.docx", "doc"],
    ["a.doc", "doc"],
    ["a.rtf", "doc"],
    ["a.xlsx", "xls"],
    ["a.csv", "xls"],
    ["a.pptx", "ppt"],
    ["a.key", "ppt"],
    ["a.zip", "zip"],
    ["a.tar", "zip"],
    ["a.mp4", "media"],
    ["a.png", "media"],
    ["a.bin", "generic"],
  ])("tones %s as %s", (name, expected) => {
    expect(fileTypeTone(name, "application/octet-stream")).toBe(expected);
  });

  it("tones by mime when the name has no useful extension", () => {
    expect(fileTypeTone("noext", "application/pdf")).toBe("pdf");
    expect(fileTypeTone("noext", "image/png")).toBe("media");
  });
});

describe("inline-parse allow-list", () => {
  const DOCX =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const XLSX =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  it("accepts docx by mime or by extension", () => {
    expect(isDocx(DOCX, "a.bin")).toBe(true);
    expect(isDocx("application/octet-stream", "a.docx")).toBe(true);
  });

  it("rejects legacy binary .doc — docx-preview cannot parse it", () => {
    expect(isDocx("application/msword", "a.doc")).toBe(false);
  });

  it("accepts xlsx/xls/csv as sheets", () => {
    expect(isSheetParseable(XLSX, "a.bin")).toBe(true);
    expect(isSheetParseable("application/octet-stream", "a.xls")).toBe(true);
    expect(isSheetParseable("text/csv", "a.csv")).toBe(true);
  });

  it("gates the signable set to pdf + docx + sheets", () => {
    expect(isInlineParseable("application/pdf", "a.pdf")).toBe(true);
    expect(isInlineParseable(DOCX, "a.docx")).toBe(true);
    expect(isInlineParseable("text/csv", "a.csv")).toBe(true);
    // Not parseable — must never be signed for inline fetch.
    expect(isInlineParseable("image/svg+xml", "a.svg")).toBe(false);
    expect(isInlineParseable("application/zip", "a.zip")).toBe(false);
    expect(isInlineParseable("application/vnd.ms-powerpoint", "a.pptx")).toBe(
      false,
    );
  });
});

describe("canPreviewInline", () => {
  it("covers the raster/video allow-list plus the parseable set", () => {
    expect(canPreviewInline("image/png", "a.png")).toBe(true);
    expect(canPreviewInline("video/mp4", "a.mp4")).toBe(true);
    expect(canPreviewInline("application/pdf", "a.pdf")).toBe(true);
    expect(canPreviewInline("text/csv", "a.csv")).toBe(true);
    expect(canPreviewInline("image/svg+xml", "a.svg")).toBe(false);
    expect(canPreviewInline("application/zip", "a.zip")).toBe(false);
  });
});
