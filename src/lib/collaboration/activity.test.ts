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
  it("resolves a status change to from/to chips", () => {
    const d = resolveActivity(
      row({ action: "cell_changed", old_value: "s1", new_value: "s2" }),
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

  it("falls back to a literal for a number cell", () => {
    const numCol = {
      ...COL,
      id: "col-n",
      kind: "numbers",
      name: "Estimate",
    } as unknown as Tables<"columns">;
    const d = resolveActivity(
      row({ column_id: "col-n", old_value: 3, new_value: 5 }),
      [numCol],
      [],
    );
    expect(d).toMatchObject({
      kind: "cell_changed",
      columnName: "Estimate",
      from: "3",
      to: "5",
    });
  });
});
