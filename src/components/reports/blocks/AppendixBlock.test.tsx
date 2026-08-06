import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppendixBlock } from "@/components/reports/blocks/AppendixBlock";
import type { ReportModel } from "@/lib/reports/shape";
import type { Column, Group, Item } from "@/lib/boards/queries";

const column = { id: "c-text", name: "Notes", kind: "text" } as Column;
const group = { id: "g1", name: "Design", color: "#8ea2eb" } as Group;
const item = { id: "i1", name: "Item A" } as Item;

function modelWith(text: string, fullText: string): ReportModel {
  return {
    columns: [column],
    groups: [
      {
        group,
        rows: [
          {
            item,
            cells: new Map([["c-text", { text, fullText }]]),
            subitems: [],
          },
        ],
      },
    ],
  };
}

describe("AppendixBlock — full-data dump renders complete text, not the preview", () => {
  it("renders fullText (untruncated), not the bounded text preview", () => {
    const preview = "a".repeat(200) + "…";
    const full = "a".repeat(1400); // e.g. well past the 200-char report preview bound
    const html = renderToStaticMarkup(
      <AppendixBlock model={modelWith(preview, full)} />,
    );
    expect(html).toContain(full);
    expect(html).not.toContain(preview);
  });

  it("renders an empty cell when the row has no value for a column", () => {
    const model: ReportModel = {
      columns: [column],
      groups: [{ group, rows: [{ item, cells: new Map(), subitems: [] }] }],
    };
    const html = renderToStaticMarkup(<AppendixBlock model={model} />);
    expect(html).toContain("Item A");
  });
});
