import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChartBlockOptionsEditor } from "@/components/reports/ChartBlockOptions";
import type { ChartBlockOptions } from "@/lib/reports/config";
import type { Column } from "@/lib/boards/queries";

const options: ChartBlockOptions = {
  variant: "donut",
  source: "status",
  columnId: null,
  title: "",
  maxCategories: 6,
};

const columns = [
  { id: "c1", name: "Status", kind: "status", position: 0, settings: null },
  { id: "c2", name: "Owner", kind: "people", position: 1, settings: null },
  { id: "c3", name: "Notes", kind: "text", position: 2, settings: null },
  { id: "c4", name: "Budget", kind: "currency", position: 3, settings: null },
] as unknown as Column[];

describe("ChartBlockOptionsEditor", () => {
  it("offers only chartable columns as the source", () => {
    render(
      <ChartBlockOptionsEditor
        options={options}
        columns={columns}
        onChange={vi.fn()}
      />,
    );
    const select = screen.getByLabelText("Chart source") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["status", "board_group", "c1", "c2"]);
    expect(values).not.toContain("c3");
    expect(values).not.toContain("c4");
  });

  it("emits source=column with the picked columnId", () => {
    const onChange = vi.fn();
    render(
      <ChartBlockOptionsEditor
        options={options}
        columns={columns}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Chart source"), {
      target: { value: "c2" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...options,
      source: "column",
      columnId: "c2",
    });
  });

  it("clears columnId when switching back to the late-bound status source", () => {
    const onChange = vi.fn();
    render(
      <ChartBlockOptionsEditor
        options={{ ...options, source: "column", columnId: "c2" }}
        columns={columns}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Chart source"), {
      target: { value: "status" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...options,
      source: "status",
      columnId: null,
    });
  });

  it("emits the chosen variant", () => {
    const onChange = vi.fn();
    render(
      <ChartBlockOptionsEditor
        options={options}
        columns={columns}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Chart style"), {
      target: { value: "bars" },
    });
    expect(onChange).toHaveBeenCalledWith({ ...options, variant: "bars" });
  });

  it("emits maxCategories as a number within 3..6", () => {
    const onChange = vi.fn();
    render(
      <ChartBlockOptionsEditor
        options={options}
        columns={columns}
        onChange={onChange}
      />,
    );
    const select = screen.getByLabelText("Max categories") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "3",
      "4",
      "5",
      "6",
    ]);
    fireEvent.change(select, { target: { value: "4" } });
    expect(onChange).toHaveBeenCalledWith({ ...options, maxCategories: 4 });
  });

  it("emits a title override", () => {
    const onChange = vi.fn();
    render(
      <ChartBlockOptionsEditor
        options={options}
        columns={columns}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Chart title"), {
      target: { value: "Where work sits" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...options,
      title: "Where work sits",
    });
  });
});
