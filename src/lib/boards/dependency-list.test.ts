import { describe, expect, it } from "vitest";
import { buildDependencyList } from "@/lib/boards/dependency-list";

const span = (s: string, e: string) => ({
  start: s,
  end: e,
  isMilestone: s === e,
});
const FB = "11111111-1111-4111-8111-111111111111";

describe("buildDependencyList", () => {
  it("splits local and foreign links into waiting-on and blocking with late flags", () => {
    const res = buildDependencyList({
      itemId: "me",
      dependencies: [
        { id: "d1", predecessor_id: "p-local", successor_id: "me" },
        { id: "d2", predecessor_id: "me", successor_id: "f1" },
      ],
      localItems: [
        { id: "me", name: "Me" },
        { id: "p-local", name: "Design" },
      ],
      localBoard: { id: "b0", name: "Platform" },
      localSpans: new Map([
        ["me", span("2026-11-03", "2026-11-12")],
        ["p-local", span("2026-11-01", "2026-11-05")],
      ]),
      context: {
        boards: [
          {
            id: FB,
            name: "Sites",
            can_edit: false,
            date_columns: [],
            timeline_config: null,
            groups: [],
          },
        ],
        items: [
          {
            id: "f1",
            board_id: FB,
            group_id: FB,
            parent_id: null,
            name: "Install",
            position: 0,
            created_at: "",
            updated_at: "",
            dates: {},
          },
        ],
      },
      contextSpans: new Map([["f1", span("2026-11-20", "2026-11-25")]]),
    });
    expect(res.waitingOn).toEqual([
      {
        dependencyId: "d1",
        itemId: "p-local",
        itemName: "Design",
        boardId: "b0",
        boardName: "Platform",
        endISO: "2026-11-05",
        late: true,
        local: true,
      },
    ]);
    expect(res.blocking).toEqual([
      {
        dependencyId: "d2",
        itemId: "f1",
        itemName: "Install",
        boardId: FB,
        boardName: "Sites",
        endISO: "2026-11-25",
        late: false,
        local: false,
      },
    ]);
  });
});
