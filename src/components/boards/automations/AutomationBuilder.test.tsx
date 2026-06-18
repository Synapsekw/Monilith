import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AutomationBuilder } from "./AutomationBuilder";
import type { CacheColumn } from "@/lib/boards/cache";
import {
  recipeItemCreatedSetOption,
  recipePersonAssignedNotify,
} from "@/components/boards/automations/recipes";

function col(over: Partial<CacheColumn>): CacheColumn {
  return {
    id: "c",
    board_id: "b1",
    org_id: "o1",
    name: "Col",
    kind: "text",
    position: 0,
    width: null,
    settings: {},
    created_at: "",
    updated_at: "",
    ...over,
  } as CacheColumn;
}

const statusCol = col({
  id: "c-status",
  name: "Status",
  kind: "status",
  settings: {
    options: [
      { id: "opt-done", label: "Done", color: "green" },
      { id: "opt-stuck", label: "Stuck", color: "red" },
    ],
  } as unknown as CacheColumn["settings"],
});

const peopleCol = col({ id: "c-people", name: "Owner", kind: "people" });

const columns = [statusCol, peopleCol];
const members = [
  { userId: "u1", fullName: "Ada Lovelace", email: "ada@x.com" },
];

describe("AutomationBuilder", () => {
  it("emits a status_changed trigger + notify owner action", async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(
      <AutomationBuilder
        columns={columns}
        members={members}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    // Trigger column defaults to the first status column; pick "Done".
    await userEvent.selectOptions(
      screen.getByLabelText("Trigger value"),
      "opt-done",
    );

    // Add a notify action (defaults to "owner" + first people column).
    await userEvent.click(screen.getByRole("button", { name: /notify/i }));

    // The owner people-column select should default to the only people column.
    expect(
      (screen.getByLabelText("Owner people column") as HTMLSelectElement).value,
    ).toBe("c-people");

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    await userEvent.click(save);

    expect(onSubmit).toHaveBeenCalledWith({
      trigger: {
        type: "status_changed",
        columnId: "c-status",
        toOptionId: "opt-done",
      },
      actions: [
        {
          type: "notify",
          recipient: { kind: "owner", peopleColumnId: "c-people" },
        },
      ],
    });
  });

  it("disables Save until an action is present", async () => {
    render(
      <AutomationBuilder
        columns={columns}
        members={members}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows an empty-state when no status/dropdown column exists", () => {
    const onCancel = vi.fn();
    render(
      <AutomationBuilder
        columns={[peopleCol]}
        members={members}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    );
    expect(
      screen.getByText(/Add a Status or Dropdown column/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});

describe("5b-1 recipes", () => {
  it("recipeItemCreatedSetOption builds an item_created → set_option draft", () => {
    const d = recipeItemCreatedSetOption("col-1", "opt-1");
    expect(d.trigger).toEqual({ type: "item_created" });
    expect(d.actions).toEqual([
      { type: "set_option", columnId: "col-1", optionId: "opt-1" },
    ]);
  });

  it("recipePersonAssignedNotify builds a person_assigned → notify-owner draft", () => {
    const d = recipePersonAssignedNotify("people-1");
    expect(d.trigger).toEqual({
      type: "person_assigned",
      columnId: "people-1",
    });
    expect(d.actions).toEqual([
      {
        type: "notify",
        recipient: { kind: "owner", peopleColumnId: "people-1" },
      },
    ]);
  });
});
