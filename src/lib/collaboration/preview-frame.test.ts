import { describe, it, expect } from "vitest";
import {
  presetFrame,
  measuredFrame,
  frameStyle,
} from "@/lib/collaboration/preview-frame";

describe("presetFrame", () => {
  it("gives PDFs a portrait page shape", () => {
    const f = presetFrame("pdf");
    expect(f.maxWidthPx).toBe(900);
    expect(f.aspect).toBeCloseTo(1 / 1.414, 3);
  });

  it("gives decks a wide 16:9 shape", () => {
    expect(presetFrame("slides")).toEqual({
      maxWidthPx: 1200,
      aspect: 16 / 9,
    });
  });

  it("gives sheets the widest shape", () => {
    expect(presetFrame("sheet").maxWidthPx).toBe(1400);
  });

  it("lets images and video size themselves", () => {
    expect(presetFrame("image").aspect).toBeNull();
    expect(presetFrame("video").aspect).toBeNull();
  });

  it("gives unpreviewable files a small card", () => {
    expect(presetFrame("other").maxWidthPx).toBe(520);
    expect(presetFrame("archive").maxWidthPx).toBe(520);
  });
});

describe("measuredFrame", () => {
  it("overrides the preset aspect with the measured one", () => {
    expect(measuredFrame("pdf", 1.6)).toEqual({ maxWidthPx: 900, aspect: 1.6 });
  });

  it("ignores a degenerate aspect and falls back to the preset", () => {
    expect(measuredFrame("pdf", 0)).toEqual(presetFrame("pdf"));
    expect(measuredFrame("pdf", -3)).toEqual(presetFrame("pdf"));
    expect(measuredFrame("pdf", Number.NaN)).toEqual(presetFrame("pdf"));
    expect(measuredFrame("pdf", Number.POSITIVE_INFINITY)).toEqual(
      presetFrame("pdf"),
    );
  });
});

describe("frameStyle", () => {
  it("caps width by viewport, aspect-derived height, and the px cap", () => {
    expect(frameStyle({ maxWidthPx: 1200, aspect: 16 / 9 })).toEqual({
      width: "min(92vw, calc(90vh * 1.778), 1200px)",
      maxHeight: "90vh",
    });
  });

  it("omits the aspect term when there is no aspect", () => {
    expect(frameStyle({ maxWidthPx: 520, aspect: null })).toEqual({
      width: "min(92vw, 520px)",
      maxHeight: "90vh",
    });
  });
});
