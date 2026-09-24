import { describe, expect, it } from "vitest";
import { buildBoardOptions } from "./board-options";

describe("buildBoardOptions", () => {
  it("groups columns per board by kind and keeps boards with no columns", () => {
    const opts = buildBoardOptions(
      [
        { id: "b1", name: "A" },
        { id: "b2", name: "B" },
      ],
      [
        {
          id: "c1",
          name: "Status",
          kind: "status",
          settings: { options: [{ id: "o1", label: "Done", color: "#0f0" }] },
          board_id: "b1",
        },
        {
          id: "c2",
          name: "Amount",
          kind: "numbers",
          settings: {},
          board_id: "b1",
        },
      ],
    );
    expect(opts).toHaveLength(2);
    expect(opts[0].statusColumns).toEqual([{ id: "c1", name: "Status" }]);
    expect(opts[0].numbersColumns).toEqual([{ id: "c2", name: "Amount" }]);
    expect(opts[0].allColumns[0].options).toEqual([
      { id: "o1", label: "Done", color: "#0f0" },
    ]);
    expect(opts[1].allColumns).toEqual([]);
  });
});
