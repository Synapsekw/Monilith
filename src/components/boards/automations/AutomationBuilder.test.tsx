import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
const dateCol = col({ id: "c-date", name: "Due Date", kind: "date" });

const columns = [statusCol, peopleCol, dateCol];
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

    // Trigger type defaults to "status_changed" (first status column exists).
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
      condition: undefined,
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
    // With only a people column, there are no status columns but the builder
    // still renders (trigger defaults to item_created). The "no status col"
    // hint appears only if user selects status_changed and no status columns exist.
    // The new builder shows a hint inside the trigger section; Save is still present
    // (item_created is valid without a column).
    // Verify we DON'T see the old "Add a Status or Dropdown column to this board" top-level gate.
    expect(
      screen.queryByText(/Add a Status or Dropdown column to this board/i),
    ).toBeNull();
    // The trigger type select should be present
    expect(screen.getByLabelText("Trigger type")).toBeInTheDocument();
  });
});

describe("AutomationBuilder – new trigger types", () => {
  it("builds an item_created → set_option draft", async () => {
    const onSubmit = vi.fn();
    render(
      <AutomationBuilder
        columns={columns}
        members={members}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    // Switch trigger type to "An item is created"
    await userEvent.selectOptions(
      screen.getByLabelText("Trigger type"),
      "item_created",
    );

    // Add a "Set a column" action
    await userEvent.click(
      screen.getByRole("button", { name: /set a column/i }),
    );

    // Pick the status column
    await userEvent.selectOptions(
      screen.getByLabelText("Set column"),
      "c-status",
    );

    // Pick an option
    await userEvent.selectOptions(
      screen.getByLabelText("Set value"),
      "opt-done",
    );

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    await userEvent.click(save);

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: { type: "item_created" },
        actions: [
          { type: "set_option", columnId: "c-status", optionId: "opt-done" },
        ],
      }),
    );
  });

  it("builds a person_assigned trigger from a People column", async () => {
    const onSubmit = vi.fn();
    render(
      <AutomationBuilder
        columns={columns}
        members={members}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    // Switch trigger type to "A person is assigned"
    await userEvent.selectOptions(
      screen.getByLabelText("Trigger type"),
      "person_assigned",
    );

    // People column picker appears; should auto-select the only people column
    expect(
      (screen.getByLabelText("People column") as HTMLSelectElement).value,
    ).toBe("c-people");

    // Add a notify action (defaults to owner)
    await userEvent.click(screen.getByRole("button", { name: /notify/i }));

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    await userEvent.click(save);

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: { type: "person_assigned", columnId: "c-people" },
      }),
    );
  });

  it("attaches an If condition when one is added", async () => {
    const onSubmit = vi.fn();
    render(
      <AutomationBuilder
        columns={columns}
        members={members}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    // status_changed is the default trigger type

    // Reveal the If section
    await userEvent.click(
      screen.getByRole("button", { name: /add condition/i }),
    );

    // FilterBuilder renders an "Add condition" button inside it — click it to add a row
    const addCondBtns = screen.getAllByRole("button", {
      name: /add condition/i,
    });
    // The last one is the FilterBuilder's own "+ Add condition" button
    await userEvent.click(addCondBtns[addCondBtns.length - 1]);

    // A "Filter column" select should appear — pick the status column
    await userEvent.selectOptions(
      screen.getByLabelText("Filter column"),
      "c-status",
    );

    // Operator defaults to "is" for status columns; pick an option value
    await userEvent.selectOptions(
      screen.getByLabelText("Filter value"),
      "opt-done",
    );

    // Add a notify action to make Save valid
    await userEvent.click(screen.getByRole("button", { name: /notify/i }));

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    await userEvent.click(save);

    const arg = onSubmit.mock.calls[0][0];
    expect(arg.condition).toBeDefined();
    expect(arg.condition.conditions).toHaveLength(1);
    expect(arg.condition.conditions[0]).toMatchObject({
      columnId: "c-status",
      operator: "is",
      value: "opt-done",
    });
  });

  it("omits the condition when none added", async () => {
    const onSubmit = vi.fn();
    render(
      <AutomationBuilder
        columns={columns}
        members={members}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    // status_changed default + add a notify action (no If section opened)
    await userEvent.click(screen.getByRole("button", { name: /notify/i }));

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    await userEvent.click(save);

    expect(onSubmit.mock.calls[0][0].condition).toBeUndefined();
  });
});

describe("5b-2 date_reached trigger", () => {
  it("builds a date_reached trigger with direction 'before', count 3 → offsetDays -3", async () => {
    const onSubmit = vi.fn();
    render(
      <AutomationBuilder
        columns={columns}
        members={members}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    // Switch trigger type to "Date reached"
    await userEvent.selectOptions(
      screen.getByLabelText("Trigger type"),
      "date_reached",
    );

    // Date column picker appears; select the date column
    expect(
      (screen.getByLabelText("Date column") as HTMLSelectElement).value,
    ).toBe("c-date");

    // Direction picker — select "before"
    await userEvent.selectOptions(screen.getByLabelText("Direction"), "before");

    // Count input — set to 3 via fireEvent to avoid number-input quirks
    const countInput = screen.getByLabelText("Days count") as HTMLInputElement;
    fireEvent.change(countInput, { target: { value: "3" } });

    // Add a notify action to make Save valid
    await userEvent.click(screen.getByRole("button", { name: /notify/i }));

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    await userEvent.click(save);

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: {
          type: "date_reached",
          columnId: "c-date",
          offsetDays: -3,
        },
      }),
    );
  });

  it("builds a date_reached trigger with direction 'on' → offsetDays 0", async () => {
    const onSubmit = vi.fn();
    render(
      <AutomationBuilder
        columns={columns}
        members={members}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    await userEvent.selectOptions(
      screen.getByLabelText("Trigger type"),
      "date_reached",
    );

    await userEvent.selectOptions(screen.getByLabelText("Direction"), "on");

    // Add notify to make form valid
    await userEvent.click(screen.getByRole("button", { name: /notify/i }));

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: {
          type: "date_reached",
          columnId: "c-date",
          offsetDays: 0,
        },
      }),
    );
  });

  it("builds a date_reached trigger with direction 'after', count 2 → offsetDays 2", async () => {
    const onSubmit = vi.fn();
    render(
      <AutomationBuilder
        columns={columns}
        members={members}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    await userEvent.selectOptions(
      screen.getByLabelText("Trigger type"),
      "date_reached",
    );

    await userEvent.selectOptions(screen.getByLabelText("Direction"), "after");

    const countInput = screen.getByLabelText("Days count") as HTMLInputElement;
    fireEvent.change(countInput, { target: { value: "2" } });

    // Add notify to make form valid
    await userEvent.click(screen.getByRole("button", { name: /notify/i }));

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: {
          type: "date_reached",
          columnId: "c-date",
          offsetDays: 2,
        },
      }),
    );
  });
});

describe("5c-2 webhook action", () => {
  const cols = columns;

  it("hides the webhook action button when canWebhook is false", () => {
    render(
      <AutomationBuilder
        columns={cols}
        members={[]}
        canWebhook={false}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /call a webhook/i }),
    ).toBeNull();
  });

  it("adds a webhook action and validates https before enabling save", async () => {
    const onSubmit = vi.fn();
    render(
      <AutomationBuilder
        columns={cols}
        members={[]}
        canWebhook
        initial={{ trigger: { type: "item_created" }, actions: [] }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /call a webhook/i }),
    );
    // save disabled until a valid https url is entered
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText(/webhook url/i),
      "https://hooks.example.com/abc",
    );
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [
          { type: "call_webhook", url: "https://hooks.example.com/abc" },
        ],
      }),
    );
  });

  it("keeps save disabled for a non-https url", async () => {
    const onSubmit = vi.fn();
    render(
      <AutomationBuilder
        columns={cols}
        members={[]}
        canWebhook
        initial={{ trigger: { type: "item_created" }, actions: [] }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /call a webhook/i }),
    );
    await userEvent.type(
      screen.getByLabelText(/webhook url/i),
      "http://hooks.example.com/abc",
    );
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
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
