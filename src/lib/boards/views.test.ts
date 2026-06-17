import { describe, it, expect } from "vitest";
import {
  resolveSelectedView,
  resolveKanbanGroupColumn,
} from "@/lib/boards/views";

const table = { id: "v-table", kind: "table" } as const;
const kanban = { id: "v-kanban", kind: "kanban" } as const;

describe("resolveSelectedView", () => {
  it("returns the requested view when it exists", () => {
    expect(resolveSelectedView([table, kanban] as never, "v-kanban")).toBe(
      ([table, kanban] as never)[1],
    );
  });
  it("falls back to the first table view when the id is unknown", () => {
    expect(resolveSelectedView([kanban, table] as never, "missing")?.id).toBe(
      "v-table",
    );
  });
  it("falls back to the first view when no table view exists", () => {
    expect(resolveSelectedView([kanban] as never, undefined)?.id).toBe(
      "v-kanban",
    );
  });
  it("returns null for an empty list", () => {
    expect(resolveSelectedView([] as never, undefined)).toBeNull();
  });
});

describe("resolveKanbanGroupColumn", () => {
  const cols = [
    { id: "c1", kind: "text" },
    { id: "c2", kind: "status" },
    { id: "c3", kind: "status" },
  ];
  it("returns the configured status column when valid", () => {
    expect(
      resolveKanbanGroupColumn(cols as never, { group_column_id: "c3" })?.id,
    ).toBe("c3");
  });
  it("falls back to the first status column when config points at a non-status column", () => {
    expect(
      resolveKanbanGroupColumn(cols as never, { group_column_id: "c1" })?.id,
    ).toBe("c2");
  });
  it("falls back to the first status column when config is empty", () => {
    expect(resolveKanbanGroupColumn(cols as never, {})?.id).toBe("c2");
  });
  it("returns null when there is no status column", () => {
    expect(
      resolveKanbanGroupColumn([{ id: "c1", kind: "text" }] as never, {}),
    ).toBeNull();
  });
});
