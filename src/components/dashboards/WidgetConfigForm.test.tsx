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
});
