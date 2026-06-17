import { it, expect } from "vitest";
import { buildKanbanColumns, NO_STATUS_ID } from "@/lib/boards/kanban";

const groupCol = {
  id: "status",
  kind: "status",
  settings: {
    options: [
      { id: "o1", label: "Working", color: "#fdab3d" },
      { id: "o2", label: "Done", color: "#00c875" },
    ],
  },
} as never;

const items = [
  { id: "i1", name: "A", position: 0 },
  { id: "i2", name: "B", position: 1 },
  { id: "i3", name: "C", position: 2 },
] as never;

const cellValues = [
  { item_id: "i1", column_id: "status", value: { optionId: "o2" } },
  { item_id: "i2", column_id: "status", value: { optionId: "o1" } },
  // i3 has no status cell → No status
] as never;

it("produces a No-status column first, then one column per option in order", () => {
  const cols = buildKanbanColumns({ items, cellValues }, groupCol);
  expect(cols.map((c) => c.id)).toEqual([NO_STATUS_ID, "o1", "o2"]);
  expect(cols[0].label).toBe("No status");
  expect(cols[1]).toMatchObject({ label: "Working", color: "#fdab3d" });
});

it("buckets cards by their status option and keeps position order", () => {
  const cols = buildKanbanColumns({ items, cellValues }, groupCol);
  expect(
    cols.find((c) => c.id === NO_STATUS_ID)!.cards.map((i) => i.id),
  ).toEqual(["i3"]);
  expect(cols.find((c) => c.id === "o1")!.cards.map((i) => i.id)).toEqual([
    "i2",
  ]);
  expect(cols.find((c) => c.id === "o2")!.cards.map((i) => i.id)).toEqual([
    "i1",
  ]);
});

it("treats a cell whose optionId no longer matches any option as No status", () => {
  const stale = [
    { item_id: "i1", column_id: "status", value: { optionId: "gone" } },
  ] as never;
  const cols = buildKanbanColumns(
    { items: [items[0]] as never, cellValues: stale },
    groupCol,
  );
  expect(
    cols.find((c) => c.id === NO_STATUS_ID)!.cards.map((i) => i.id),
  ).toEqual(["i1"]);
});
