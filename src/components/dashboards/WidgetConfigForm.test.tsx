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
    percentColumns: [{ id: "pc1", name: "% Complete" }],
    allColumns: [
      {
        id: "s1",
        name: "Status",
        kind: "status",
        options: [
          { id: "opt-done", label: "Done", color: "#00c875" },
          { id: "opt-wip", label: "In Progress", color: "#0073ea" },
          { id: "opt-complete", label: "Complete", color: "#037f4c" },
        ],
      },
    ],
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

  it("offers the completion kind and defaults to status mode", () => {
    render(
      <WidgetConfigForm
        boards={boards}
        value={{
          kind: "completion",
          sourceBoardId: "b1",
          title: "",
          config: { mode: "status", doneOptionIds: [] },
        }}
        onChange={vi.fn()}
      />,
    );
    // The kind select offers Completion.
    const kindSelect = screen.getByLabelText("Widget type", {
      selector: "select",
    }) as HTMLSelectElement;
    expect(Array.from(kindSelect.options).map((o) => o.value)).toContain(
      "completion",
    );
    const mode = screen.getByLabelText(
      "Completion source",
    ) as HTMLSelectElement;
    expect(mode.value).toBe("status");
    expect(screen.getByLabelText("Status column")).toBeInTheDocument();
  });

  it("percent mode shows the percent-column select and empty-board hint", () => {
    const { rerender } = render(
      <WidgetConfigForm
        boards={boards}
        value={{
          kind: "completion",
          sourceBoardId: "b1",
          title: "",
          config: { mode: "percent", doneOptionIds: [] },
        }}
        onChange={vi.fn()}
      />,
    );
    const percentSelect = screen.getByLabelText(
      "Percent column",
    ) as HTMLSelectElement;
    expect(Array.from(percentSelect.options).map((o) => o.value)).toContain(
      "pc1",
    );

    // No percent columns → helper text.
    const noPercent: BoardOption[] = [{ ...boards[0], percentColumns: [] }];
    rerender(
      <WidgetConfigForm
        boards={noPercent}
        value={{
          kind: "completion",
          sourceBoardId: "b1",
          title: "",
          config: { mode: "percent", doneOptionIds: [] },
        }}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Add a Percent column to this board/i),
    ).toBeInTheDocument();
  });

  it("picking a status column pre-checks done-like options", () => {
    const onChange = vi.fn();
    render(
      <WidgetConfigForm
        boards={boards}
        value={{
          kind: "completion",
          sourceBoardId: "b1",
          title: "",
          config: { mode: "status", doneOptionIds: [] },
        }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Status column"), {
      target: { value: "s1" },
    });
    // "Done" and "Complete" match /done|complete|finished/i; "In Progress"
    // does not — the preset is editable via the checkboxes afterwards.
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          statusColumnId: "s1",
          doneOptionIds: ["opt-done", "opt-complete"],
        }),
      }),
    );
  });

  it("renders editable done-option checkboxes once a status column is picked", () => {
    render(
      <WidgetConfigForm
        boards={boards}
        value={{
          kind: "completion",
          sourceBoardId: "b1",
          title: "",
          config: {
            mode: "status",
            statusColumnId: "s1",
            doneOptionIds: ["opt-done"],
          },
        }}
        onChange={vi.fn()}
      />,
    );
    const done = screen.getByLabelText(/Done/) as HTMLInputElement;
    const wip = screen.getByLabelText(/In Progress/) as HTMLInputElement;
    expect(done.checked).toBe(true);
    expect(wip.checked).toBe(false);
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

describe("WidgetConfigForm health kind", () => {
  it("offers the health kind with fixed-rule helper text", () => {
    render(
      <WidgetConfigForm
        boards={boards}
        value={{
          kind: "health",
          sourceBoardId: "b1",
          title: "",
          config: {},
        }}
        onChange={vi.fn()}
      />,
    );
    const kindSelect = screen.getByLabelText("Widget type", {
      selector: "select",
    }) as HTMLSelectElement;
    expect(Array.from(kindSelect.options).map((o) => o.value)).toContain(
      "health",
    );
    // Fixed rule → helper text only, no column selects beyond the shared ones.
    expect(screen.getByText(/no extra configuration/i)).toBeInTheDocument();
    expect(screen.getByText(/overdue/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Status column")).not.toBeInTheDocument();
  });
});
