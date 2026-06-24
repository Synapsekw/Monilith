import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  WidgetConfigForm,
  type BoardOption,
  type WidgetDraft,
} from "@/components/dashboards/WidgetConfigForm";

const boards: BoardOption[] = [
  {
    id: "b1",
    name: "Board 1",
    numbersColumns: [{ id: "n1", name: "Points" }],
    statusColumns: [{ id: "s1", name: "Status" }],
    dateColumns: [{ id: "d1", name: "Due" }],
    peopleColumns: [{ id: "p1", name: "Owner" }],
    dropdownColumns: [{ id: "dd1", name: "Priority" }],
    allColumns: [],
  },
];

function draft(): WidgetDraft {
  return {
    kind: "chart",
    sourceBoardId: "b1",
    title: "",
    config: {
      chartType: "bar",
      primary: { kind: "status", columnId: "s1" },
      measure: { agg: "count" },
    },
  };
}

describe("WidgetConfigForm", () => {
  it("emits a chartType change when the user picks line", () => {
    const onChange = vi.fn();
    render(
      <WidgetConfigForm boards={boards} value={draft()} onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText("Chart type"), {
      target: { value: "line" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ chartType: "line" }),
      }),
    );
  });

  it("auto-selects the first number column when switching the measure to Sum", () => {
    const onChange = vi.fn();
    render(
      <WidgetConfigForm boards={boards} value={draft()} onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText("Measure"), {
      target: { value: "sum" },
    });
    // Without this, the chart is saved with no valueColumnId and the server
    // rejects it ("Sum and average need a numbers column."). The form must
    // never produce an unsavable measure.
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          measure: { agg: "sum", valueColumnId: "n1" },
        }),
      }),
    );
  });

  it("offers only Count when the board has no number columns", () => {
    const noNumbers: BoardOption[] = [{ ...boards[0], numbersColumns: [] }];
    render(
      <WidgetConfigForm
        boards={noNumbers}
        value={draft()}
        onChange={vi.fn()}
      />,
    );
    const measure = screen.getByLabelText("Measure") as HTMLSelectElement;
    expect(Array.from(measure.options).map((o) => o.value)).toEqual(["count"]);
  });
});
