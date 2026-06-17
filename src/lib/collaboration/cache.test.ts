import { describe, it, expect } from "vitest";
import {
  prependUpdate,
  replaceUpdate,
  removeUpdate,
  prependActivity,
  type UpdatesCache,
  type ActivityCache,
} from "@/lib/collaboration/cache";
import type { Tables } from "@/types/database.types";

function upd(id: string): Tables<"item_updates"> {
  return {
    id,
    org_id: "o",
    board_id: "b",
    item_id: "i",
    author_id: "u",
    body: { text: id },
    body_text: id,
    edited_at: null,
    created_at: "2026-06-17T00:00:00Z",
    updated_at: "2026-06-17T00:00:00Z",
  } as Tables<"item_updates">;
}

describe("updates cache", () => {
  it("prepends newest-first and is idempotent on id", () => {
    let c: UpdatesCache = { updates: [upd("a")] };
    c = prependUpdate(c, upd("b"));
    expect(c.updates.map((u) => u.id)).toEqual(["b", "a"]);
    c = prependUpdate(c, upd("b")); // echo
    expect(c.updates.map((u) => u.id)).toEqual(["b", "a"]);
  });
  it("replaces and removes by id", () => {
    let c: UpdatesCache = { updates: [upd("a"), upd("b")] };
    const edited = { ...upd("a"), body_text: "edited" };
    c = replaceUpdate(c, edited);
    expect(c.updates.find((u) => u.id === "a")?.body_text).toBe("edited");
    c = removeUpdate(c, "a");
    expect(c.updates.map((u) => u.id)).toEqual(["b"]);
  });
});

describe("activity cache", () => {
  it("prepends and de-dupes by id", () => {
    const a = { id: "x" } as Tables<"item_activities">;
    let c: ActivityCache = { activities: [] };
    c = prependActivity(c, a);
    c = prependActivity(c, a);
    expect(c.activities).toHaveLength(1);
  });
});
