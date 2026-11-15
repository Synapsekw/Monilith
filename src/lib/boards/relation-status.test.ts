import { describe, it, expect } from "vitest";
import { resolveLinkedStatuses } from "@/lib/boards/relation-status";

const STATUS = {
  id: "c-status",
  position: 1,
  settings: {
    options: [
      { id: "o-done", label: "Completed", color: "#00c875" },
      { id: "o-prog", label: "In Progress", color: "#579bfc" },
    ],
  },
};
const PROGRAMME = {
  id: "c-programme",
  position: 4,
  settings: {
    options: [{ id: "o-drones", label: "Drones", color: "#0086c0" }],
  },
};

describe("resolveLinkedStatuses", () => {
  it("maps each linked item to the label and colour of its status option", () => {
    const out = resolveLinkedStatuses(
      [
        { item_id: "m1", column_id: "c-status", value: { optionId: "o-done" } },
        { item_id: "m2", column_id: "c-status", value: { optionId: "o-prog" } },
      ],
      [STATUS],
    );
    expect(out.get("m1")).toEqual({ label: "Completed", color: "#00c875" });
    expect(out.get("m2")).toEqual({ label: "In Progress", color: "#579bfc" });
  });

  it("uses the left-most status column when the target board has several", () => {
    // Cell order must not decide it: the Programme cell comes first here.
    const out = resolveLinkedStatuses(
      [
        {
          item_id: "m1",
          column_id: "c-programme",
          value: { optionId: "o-drones" },
        },
        { item_id: "m1", column_id: "c-status", value: { optionId: "o-done" } },
      ],
      [PROGRAMME, STATUS],
    );
    expect(out.get("m1")).toEqual({ label: "Completed", color: "#00c875" });
  });

  it("falls through to the next status column when the first one is unset", () => {
    const out = resolveLinkedStatuses(
      [
        { item_id: "m1", column_id: "c-status", value: { optionId: null } },
        {
          item_id: "m1",
          column_id: "c-programme",
          value: { optionId: "o-drones" },
        },
      ],
      [STATUS, PROGRAMME],
    );
    expect(out.get("m1")).toEqual({ label: "Drones", color: "#0086c0" });
  });

  it("leaves out items with no status, an unknown option or an unknown column", () => {
    const out = resolveLinkedStatuses(
      [
        { item_id: "m1", column_id: "c-status", value: null },
        { item_id: "m2", column_id: "c-status", value: { optionId: "gone" } },
        { item_id: "m3", column_id: "c-other", value: { optionId: "o-done" } },
      ],
      [STATUS],
    );
    expect(out.size).toBe(0);
  });

  it("ignores malformed column settings", () => {
    const out = resolveLinkedStatuses(
      [{ item_id: "m1", column_id: "c-bad", value: { optionId: "x" } }],
      [{ id: "c-bad", position: 0, settings: null }],
    );
    expect(out.size).toBe(0);
  });
});
