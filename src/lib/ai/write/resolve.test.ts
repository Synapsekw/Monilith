import { describe, expect, it } from "vitest";
import type { BoardPayload } from "@/lib/boards/queries";
import { pickFieldColumns, resolveCreateItem } from "./resolve";

// Minimal board payload shape the resolver reads (mirror getBoardPayload's return).
const payload = {
  board: { id: "b1", name: "Roadmap" },
  groups: [{ id: "g1", name: "Backlog" }],
  columns: [
    { id: "c-due", name: "Due", kind: "date" },
    {
      id: "c-status",
      name: "Status",
      kind: "status",
      settings: { options: [{ id: "o1", label: "In progress" }] },
    },
    { id: "c-owner", name: "Owner", kind: "people" },
  ],
  items: [],
  cellValues: [],
} as unknown as BoardPayload;

const members = [{ userId: "u1", name: "Dana Ruiz" }];

describe("pickFieldColumns", () => {
  it("maps date/status/people kinds to their column ids", () => {
    const { dateColumnId, statusColumnId, peopleColumnId, warnings } =
      pickFieldColumns(payload);
    expect(dateColumnId).toBe("c-due");
    expect(statusColumnId).toBe("c-status");
    expect(peopleColumnId).toBe("c-owner");
    expect(warnings).toEqual([]);
  });

  it("warns and picks a hinted column when >1 date column exists", () => {
    const multi = {
      ...payload,
      columns: [
        { id: "c-created", name: "Created", kind: "date" },
        { id: "c-due", name: "Due date", kind: "date" },
      ],
    } as unknown as BoardPayload;
    const { dateColumnId, warnings } = pickFieldColumns(multi);
    expect(dateColumnId).toBe("c-due");
    expect(warnings.some((w) => w.includes("date columns"))).toBe(true);
  });
});

describe("resolveCreateItem", () => {
  it("builds a summary + resolves owner/status labels", () => {
    const v = resolveCreateItem(payload, members, {
      kind: "create_item",
      boardId: "b1",
      groupId: "g1",
      name: "Ship v2",
      fields: {
        ownerUserIds: ["u1"],
        dueDate: "2026-07-17",
        statusOptionId: "o1",
      },
    });
    expect(v.kind).toBe("ok");
    if (v.kind !== "ok") return;
    expect(v.action.summary).toContain("Ship v2");
    expect(v.action.summary).toContain("Backlog");
    expect(v.action.summary).toContain("Dana Ruiz");
    expect(v.action.summary).toContain("In progress");
    expect(v.action.warnings).toEqual([]);
  });

  it("errors when the group is not on the board", () => {
    const v = resolveCreateItem(payload, members, {
      kind: "create_item",
      boardId: "b1",
      groupId: "nope",
      name: "X",
    });
    expect(v.kind).toBe("error");
  });
});
