import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RollupValueCell } from "./RollupValueCell";
import {
  cellKey,
  type BoardCache,
  type CacheCellValue,
} from "@/lib/boards/cache";
import type { Column, Item } from "@/lib/boards/queries";

function percentCol(): Column {
  return { id: "c1", kind: "percent", settings: null } as unknown as Column;
}
function twoItems(): Item[] {
  return [{ id: "i1" }, { id: "i2" }] as unknown as Item[];
}

describe("RollupValueCell", () => {
  it("renders the averaged accent percent bar over a group's items", () => {
    const cellMap = new Map<string, CacheCellValue["value"]>([
      [cellKey("i1", "c1"), { percent: 40 }],
      [cellKey("i2", "c1"), { percent: 80 }],
    ]);
    const { container } = render(
      <RollupValueCell
        col={percentCol()}
        items={twoItems()}
        cellMap={cellMap}
        cache={{} as BoardCache}
        nowMs={0}
      />,
    );
    const bar = container.querySelector('[role="progressbar"]');
    // average of 40 and 80 is 60 (aria-valuenow carries the value)
    expect(bar?.getAttribute("aria-valuenow")).toBe("60");
    const fill = bar?.firstElementChild as HTMLElement;
    // average 60 sits in the lime band of the value-based red→green ramp
    expect(fill.className).toContain("bg-[var(--progress-lime)]");
  });

  it("renders blank (no bar) when the group has no items", () => {
    const { container } = render(
      <RollupValueCell
        col={percentCol()}
        items={[]}
        cellMap={new Map()}
        cache={{} as BoardCache}
        nowMs={0}
      />,
    );
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });
});
