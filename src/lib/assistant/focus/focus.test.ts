import { describe, it, expect } from "vitest";
import type { BoardPayload } from "@/lib/boards/queries";
import { FOCUS_MAX_CHARS, FOCUS_MAX_ITEMS, renderFocusBlock } from "./types";
import { buildBoardFocus } from "./board";

function payload(itemCount: number): BoardPayload {
  return {
    board: { id: "b-1", name: "Q4 Launch", org_id: "o-1" },
    groups: [{ id: "g-1", name: "This week" }],
    columns: [{ id: "c-1", name: "Status", kind: "status", settings: null }],
    items: Array.from({ length: itemCount }, (_, i) => ({
      id: `i-${i}`,
      name: `Item ${i}`,
      group_id: "g-1",
      parent_id: null,
      updated_at: `2026-11-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
    })),
    cellValues: [],
  } as unknown as BoardPayload;
}

const members = [{ userId: "u-1", fullName: "Ana Petrović" }] as never;

describe("board focus", () => {
  it("names the board, its groups, columns, members and items", () => {
    const text = buildBoardFocus({ payload: payload(3), members });
    expect(text).toContain("Q4 Launch");
    expect(text).toContain("b-1");
    expect(text).toContain("g-1 | This week");
    expect(text).toContain("c-1 | Status | status");
    expect(text).toContain("u-1 | Ana Petrović");
    expect(text).toContain("i-0");
  });

  it("lists at most 50 items and says how to get the rest", () => {
    const text = buildBoardFocus({ payload: payload(120), members });
    const itemLines = text.split("\n").filter((l) => l.startsWith("- i-"));
    expect(itemLines).toHaveLength(FOCUS_MAX_ITEMS);
    expect(text).toContain("120 items");
    expect(text).toContain("list_items");
  });

  it("never exceeds the character budget", () => {
    const big = payload(50);
    for (const it of big.items) (it as { name: string }).name = "x".repeat(500);
    expect(
      buildBoardFocus({ payload: big, members }).length,
    ).toBeLessThanOrEqual(FOCUS_MAX_CHARS);
  });
});

describe("renderFocusBlock", () => {
  it("wraps snapshot text in the FOCUS delimiters", () => {
    const block = renderFocusBlock("hello");
    expect(block).toContain("=== FOCUS");
    expect(block).toContain("hello");
    expect(block).toContain("=== END FOCUS ===");
  });
  it("says so when there is no focus", () => {
    expect(renderFocusBlock(null)).toContain("No page is in focus");
  });
});
