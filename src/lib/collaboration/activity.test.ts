import { describe, it, expect } from "vitest";
import {
  resolveActivity,
  type ActivityRow,
} from "@/lib/collaboration/activity";
import type { Tables } from "@/types/database.types";

const COL: Tables<"columns"> = {
  id: "col-status",
  org_id: "o",
  board_id: "b",
  kind: "status",
  name: "Status",
  settings: {
    options: [
      { id: "s1", label: "Working on it", color: "#fdab3d" },
      { id: "s2", label: "Done", color: "#00c875" },
    ],
  },
  position: 0,
  created_at: "",
  updated_at: "",
} as unknown as Tables<"columns">;

function row(partial: Partial<ActivityRow>): ActivityRow {
  return {
    id: "a1",
    org_id: "o",
    board_id: "b",
    item_id: "i1",
    actor_id: "u1",
    action: "cell_changed",
    column_id: "col-status",
    old_value: null,
    new_value: null,
    created_at: "2026-06-17T00:00:00Z",
    ...partial,
  } as ActivityRow;
}

describe("resolveActivity", () => {
  it("resolves a status change to from/to chips (wrapped cell value)", () => {
    const d = resolveActivity(
      row({ old_value: { optionId: "s1" }, new_value: { optionId: "s2" } }),
      [COL],
      [],
    );
    expect(d).toMatchObject({
      kind: "cell_changed",
      columnName: "Status",
      from: { label: "Working on it", color: "#fdab3d" },
      to: { label: "Done", color: "#00c875" },
    });
  });

  it("returns null for an unresolvable / empty status option", () => {
    const d = resolveActivity(
      row({ old_value: null, new_value: { optionId: "gone" } }),
      [COL],
      [],
    );
    expect(d).toMatchObject({ kind: "cell_changed", from: null, to: null });
  });

  it("joins dropdown option labels", () => {
    const dropCol = {
      ...COL,
      id: "col-d",
      kind: "dropdown",
      name: "Tags",
    } as unknown as Tables<"columns">;
    const d = resolveActivity(
      row({ column_id: "col-d", new_value: { optionIds: ["s1", "s2"] } }),
      [dropCol],
      [],
    );
    expect(d).toMatchObject({
      kind: "cell_changed",
      to: "Working on it, Done",
    });
  });

  it("resolves people to member names", () => {
    const pplCol = {
      ...COL,
      id: "col-p",
      kind: "people",
      name: "Owner",
    } as unknown as Tables<"columns">;
    const d = resolveActivity(
      row({ column_id: "col-p", new_value: { userIds: ["u1"] } }),
      [pplCol],
      [{ userId: "u1", fullName: "Ada" }],
    );
    expect(d).toMatchObject({ kind: "cell_changed", to: "Ada" });
  });

  it("resolves a text cell to its text", () => {
    const txtCol = {
      ...COL,
      id: "col-t",
      kind: "text",
      name: "Notes",
    } as unknown as Tables<"columns">;
    const d = resolveActivity(
      row({ column_id: "col-t", new_value: { text: "Hello" } }),
      [txtCol],
      [],
    );
    expect(d).toMatchObject({ kind: "cell_changed", to: "Hello" });
  });

  it("strips Markdown syntax from a text cell change", () => {
    const txtCol = {
      ...COL,
      id: "col-t",
      kind: "text",
      name: "Notes",
    } as unknown as Tables<"columns">;
    const d = resolveActivity(
      row({
        column_id: "col-t",
        new_value: { text: "**bold** and _italic_\n- a bullet" },
      }),
      [txtCol],
      [],
    );
    expect(d).toMatchObject({
      kind: "cell_changed",
      to: "bold and italic a bullet",
    });
  });

  it("truncates a long text cell change with an ellipsis, never the raw value", () => {
    const txtCol = {
      ...COL,
      id: "col-t",
      kind: "text",
      name: "Notes",
    } as unknown as Tables<"columns">;
    const longValue = "word ".repeat(4000).trim(); // ~20,000 chars, board's cap
    const d = resolveActivity(
      row({ column_id: "col-t", new_value: { text: longValue } }),
      [txtCol],
      [],
    );
    expect(d.kind).toBe("cell_changed");
    if (d.kind !== "cell_changed") throw new Error("unreachable");
    expect(typeof d.to).toBe("string");
    const to = d.to as string;
    expect(to.length).toBeLessThan(130);
    expect(to.endsWith("…")).toBe(true);
    expect(to).not.toBe(longValue);
  });

  it("resolves an empty/whitespace-only text cell change to null", () => {
    const txtCol = {
      ...COL,
      id: "col-t",
      kind: "text",
      name: "Notes",
    } as unknown as Tables<"columns">;
    const d = resolveActivity(
      row({ column_id: "col-t", new_value: { text: "   " } }),
      [txtCol],
      [],
    );
    expect(d).toMatchObject({ kind: "cell_changed", to: null });
  });

  it("resolves a number cell to a string, including 0", () => {
    const numCol = {
      ...COL,
      id: "col-n",
      kind: "numbers",
      name: "Estimate",
    } as unknown as Tables<"columns">;
    const d = resolveActivity(
      row({ column_id: "col-n", old_value: { n: 0 }, new_value: { n: 5 } }),
      [numCol],
      [],
    );
    expect(d).toMatchObject({ kind: "cell_changed", from: "0", to: "5" });
  });

  it("resolves a date cell to its date string", () => {
    const dateCol = {
      ...COL,
      id: "col-dt",
      kind: "date",
      name: "Due",
    } as unknown as Tables<"columns">;
    const d = resolveActivity(
      row({ column_id: "col-dt", new_value: { date: "2026-06-20" } }),
      [dateCol],
      [],
    );
    expect(d).toMatchObject({ kind: "cell_changed", to: "2026-06-20" });
  });

  it("renders item_renamed with from/to strings", () => {
    const d = resolveActivity(
      row({
        action: "item_renamed",
        column_id: null,
        old_value: "Old",
        new_value: "New",
      }),
      [COL],
      [],
    );
    expect(d).toMatchObject({ kind: "item_renamed", from: "Old", to: "New" });
  });

  it("renders item_created", () => {
    const d = resolveActivity(
      row({
        action: "item_created",
        column_id: null,
        new_value: { name: "Task" },
      }),
      [COL],
      [],
    );
    expect(d.kind).toBe("item_created");
  });
});
