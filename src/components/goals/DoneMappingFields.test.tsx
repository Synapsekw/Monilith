import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  DoneMappingFields,
  defaultDoneOptionIds,
} from "@/components/goals/DoneMappingFields";
import type { StatusColumn } from "@/lib/portfolios/queries";

const columns: StatusColumn[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Status",
    options: [
      {
        id: "aaaaaaaa-0000-0000-0000-000000000001",
        label: "Working",
        color: "#3b82f6",
      },
      {
        id: "aaaaaaaa-0000-0000-0000-000000000002",
        label: "Done",
        color: "#22c55e",
      },
    ],
  },
];

describe("defaultDoneOptionIds", () => {
  it("guesses done options by label", () => {
    expect(defaultDoneOptionIds(columns[0])).toEqual([
      "aaaaaaaa-0000-0000-0000-000000000002",
    ]);
  });
  it("returns [] for undefined", () => {
    expect(defaultDoneOptionIds(undefined)).toEqual([]);
  });
});

describe("DoneMappingFields", () => {
  it("renders an option checkbox per status option, checked from doneOptionIds", () => {
    render(
      <DoneMappingFields
        idPrefix="t1"
        columns={columns}
        doneColumnId={columns[0].id}
        doneOptionIds={["aaaaaaaa-0000-0000-0000-000000000002"]}
        onColumnChange={() => {}}
        onToggleOption={() => {}}
      />,
    );
    expect(
      screen.getByRole("checkbox", { name: /working/i }),
    ).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /done/i })).toBeChecked();
  });

  it("calls onToggleOption with the option id when a checkbox is clicked", async () => {
    const onToggleOption = vi.fn();
    render(
      <DoneMappingFields
        idPrefix="t2"
        columns={columns}
        doneColumnId={columns[0].id}
        doneOptionIds={[]}
        onColumnChange={() => {}}
        onToggleOption={onToggleOption}
      />,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /done/i }));
    expect(onToggleOption).toHaveBeenCalledWith(
      "aaaaaaaa-0000-0000-0000-000000000002",
    );
  });

  it("calls onColumnChange(null) when 'No mapping' is selected", async () => {
    const onColumnChange = vi.fn();
    render(
      <DoneMappingFields
        idPrefix="t3"
        columns={columns}
        doneColumnId={columns[0].id}
        doneOptionIds={[]}
        onColumnChange={onColumnChange}
        onToggleOption={() => {}}
      />,
    );
    await userEvent.selectOptions(
      screen.getByLabelText(/completion status/i),
      "",
    );
    expect(onColumnChange).toHaveBeenCalledWith(null);
  });

  it("shows loading and no-columns states", () => {
    const { rerender } = render(
      <DoneMappingFields
        idPrefix="t4"
        columns={[]}
        loading
        doneColumnId={null}
        doneOptionIds={[]}
        onColumnChange={() => {}}
        onToggleOption={() => {}}
      />,
    );
    expect(screen.getByText(/loading status columns/i)).toBeInTheDocument();
    rerender(
      <DoneMappingFields
        idPrefix="t4"
        columns={[]}
        doneColumnId={null}
        doneOptionIds={[]}
        onColumnChange={() => {}}
        onToggleOption={() => {}}
      />,
    );
    expect(screen.getByText(/no status columns/i)).toBeInTheDocument();
  });
});
