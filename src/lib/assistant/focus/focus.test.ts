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

describe("board focus bounds", () => {
  const ITEMS_HEADER = "ITEMS (most recently updated first";

  function huge(): BoardPayload {
    const p = payload(40);
    (p as unknown as { columns: unknown[] }).columns = Array.from(
      { length: 60 },
      (_, c) => ({
        id: `c-${c}`,
        name: `Column ${c}`,
        kind: "status",
        settings: {
          options: Array.from({ length: 12 }, (_, o) => ({
            id: `o-${c}-${o}`,
            label: `Option label ${"long".repeat(10)} ${o}`,
            color: "gray",
          })),
        },
      }),
    );
    return p;
  }
  const manyMembers = Array.from({ length: 100 }, (_, i) => ({
    userId: `u-${i}`,
    fullName: `Member ${i}`,
  })) as never;

  it("keeps the ITEMS header and whole lines when the head is huge", () => {
    const text = buildBoardFocus({ payload: huge(), members: manyMembers });
    expect(text.length).toBeLessThanOrEqual(FOCUS_MAX_CHARS);
    expect(text).toContain(ITEMS_HEADER);
    const lines = text.split("\n");
    expect(lines.some((l) => l.startsWith("- i-"))).toBe(true);
    const last = lines[lines.length - 1];
    expect(
      /^- i-\d+ \| Item \d+ \| group g-1 \| no values$/.test(last) ||
        /^… \d+ more items not shown; call list_items$/.test(last),
    ).toBe(true);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(300);
  });

  it("marks capped groups, columns and members with the omitted count", () => {
    const p = payload(1);
    (p as unknown as { groups: unknown[] }).groups = Array.from(
      { length: 35 },
      (_, i) => ({ id: `g-${i}`, name: `Group ${i}` }),
    );
    (p as unknown as { columns: unknown[] }).columns = Array.from(
      { length: 33 },
      (_, i) => ({
        id: `c-${i}`,
        name: `Col ${i}`,
        kind: "text",
        settings: null,
      }),
    );
    const text = buildBoardFocus({ payload: p, members: manyMembers });
    const more = text.split("\n").filter((l) => /^… \d+ more$/.test(l));
    expect(more).toEqual(["… 5 more", "… 3 more", "… 60 more"]);
  });

  it("ends a budget-cut roster with the exact omitted count", () => {
    const big = payload(50);
    for (const it of big.items) (it as { name: string }).name = "x".repeat(500);
    const text = buildBoardFocus({ payload: big, members });
    const shown = text.split("\n").filter((l) => l.startsWith("- i-")).length;
    expect(shown).toBeLessThan(50);
    const lines = text.split("\n");
    expect(lines[lines.length - 1]).toBe(
      `… ${50 - shown} more items not shown; call list_items`,
    );
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
