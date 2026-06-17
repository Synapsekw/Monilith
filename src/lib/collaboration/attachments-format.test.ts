import { describe, it, expect } from "vitest";
import {
  formatSize,
  fileKind,
  isPreviewable,
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
