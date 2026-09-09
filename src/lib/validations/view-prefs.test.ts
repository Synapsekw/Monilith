import { describe, expect, it } from "vitest";
import {
  EMPTY_BOARD_VIEW_PREFS,
  MAX_FILTER_QUERY_CHARS,
  MAX_PREF_IDS,
  boardViewPrefsStateSchema,
  parseBoardViewPrefs,
} from "./view-prefs";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("boardViewPrefsStateSchema", () => {
  it("accepts a full, well-formed state", () => {
    const parsed = boardViewPrefsStateSchema.safeParse({
      viewId: UUID_A,
      collapsedGroupIds: [UUID_B],
      expandedItemIds: [],
      filterQuery: "q=hello&sort=name:asc",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown key rather than stripping it", () => {
    const parsed = boardViewPrefsStateSchema.safeParse({ nope: 1 });
    expect(parsed.success).toBe(false);
  });

  it("rejects an id list over the cap", () => {
    const tooMany = Array.from({ length: MAX_PREF_IDS + 1 }, () => UUID_A);
    const parsed = boardViewPrefsStateSchema.safeParse({
      collapsedGroupIds: tooMany,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a filter query over the character cap", () => {
    const parsed = boardViewPrefsStateSchema.safeParse({
      filterQuery: "x".repeat(MAX_FILTER_QUERY_CHARS + 1),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-uuid id", () => {
    const parsed = boardViewPrefsStateSchema.safeParse({
      collapsedGroupIds: ["not-a-uuid"],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("parseBoardViewPrefs", () => {
  it("fills every field from a partial state", () => {
    expect(parseBoardViewPrefs({ collapsedGroupIds: [UUID_A] })).toEqual({
      viewId: null,
      collapsedGroupIds: [UUID_A],
      expandedItemIds: [],
      filterQuery: "",
    });
  });

  it("falls back to defaults for malformed stored state", () => {
    expect(parseBoardViewPrefs({ viewId: 42 })).toEqual(EMPTY_BOARD_VIEW_PREFS);
    expect(parseBoardViewPrefs(null)).toEqual(EMPTY_BOARD_VIEW_PREFS);
    expect(parseBoardViewPrefs("garbage")).toEqual(EMPTY_BOARD_VIEW_PREFS);
  });
});
