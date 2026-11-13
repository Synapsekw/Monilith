import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BatchConfirmCard } from "./BatchConfirmCard";

const calls = [
  {
    id: "a",
    tool: "update_item",
    input: {},
    summary: "Assign Marko to Demo video",
    destructive: false,
    boardId: null,
  },
  {
    id: "b",
    tool: "update_item",
    input: {},
    summary: "Set status of Press kit to Done",
    destructive: false,
    boardId: null,
  },
  {
    id: "c",
    tool: "manage_item",
    input: {},
    summary: "Archive Old brief",
    destructive: true,
    boardId: null,
  },
];

function setup(
  state: "idle" | "running" | "done" | "error" = "idle",
  note?: string,
) {
  const onApply = vi.fn();
  const onDismiss = vi.fn();
  render(
    <BatchConfirmCard
      calls={calls}
      state={state}
      resultNote={note}
      onApply={onApply}
      onDismiss={onDismiss}
    />,
  );
  return { onApply, onDismiss };
}

describe("BatchConfirmCard", () => {
  it("lists every change and leaves destructive rows unticked", () => {
    setup();
    expect(screen.getByLabelText("Assign Marko to Demo video")).toBeChecked();
    expect(
      screen.getByLabelText("Set status of Press kit to Done"),
    ).toBeChecked();
    expect(screen.getByLabelText(/Archive Old brief/)).not.toBeChecked();
  });

  it("applies only the ticked rows", async () => {
    const { onApply } = setup();
    await userEvent.click(
      screen.getByLabelText("Set status of Press kit to Done"),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Apply 1 change/ }),
    );
    expect(onApply).toHaveBeenCalledWith(["a"]);
  });

  it("includes a destructive row once the user ticks it", async () => {
    const { onApply } = setup();
    await userEvent.click(screen.getByLabelText(/Archive Old brief/));
    await userEvent.click(
      screen.getByRole("button", { name: /Apply 3 changes/ }),
    );
    expect(onApply).toHaveBeenCalledWith(["a", "b", "c"]);
  });

  it("disables Apply when nothing is ticked", async () => {
    setup();
    await userEvent.click(screen.getByLabelText("Assign Marko to Demo video"));
    await userEvent.click(
      screen.getByLabelText("Set status of Press kit to Done"),
    );
    expect(screen.getByRole("button", { name: /Apply/ })).toBeDisabled();
  });

  it("dismisses", async () => {
    const { onDismiss } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("locks every control while running", () => {
    setup("running");
    expect(screen.getByLabelText("Assign Marko to Demo video")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Applying/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeDisabled();
  });

  it("shows the result note and no buttons once resolved", () => {
    setup("done", "Applied.");
    expect(screen.getByText("Applied.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Apply/ }),
    ).not.toBeInTheDocument();
  });
});
