import { describe, expect, it } from "vitest";
import { boardCapMessages, NO_TRUNCATION } from "@/lib/boards/caps";

describe("boardCapMessages", () => {
  it("says nothing when no cap was hit, or the payload carries no flag", () => {
    expect(boardCapMessages(NO_TRUNCATION)).toEqual([]);
    expect(boardCapMessages(undefined)).toEqual([]);
    expect(boardCapMessages(null)).toEqual([]);
  });

  it("names the cell cap with its number", () => {
    expect(boardCapMessages({ ...NO_TRUNCATION, cells: true })).toEqual([
      "Showing the first 60,000 cells. Some values are not loaded.",
    ]);
  });

  it("gives one sentence per cap that was hit, in a fixed order", () => {
    expect(
      boardCapMessages({
        cells: true,
        relationLinks: true,
        linkedItemNames: true,
      }),
    ).toEqual([
      "Showing the first 60,000 cells. Some values are not loaded.",
      "Showing the first 2,000 links to other boards. Some links are not loaded.",
      "Showing the first 1,000 linked items. Some links are not shown.",
    ]);
  });
});
