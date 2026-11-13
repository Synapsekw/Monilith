import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BatchConfirmCard } from "./BatchConfirmCard";

const calls = [
  {
    id: "a",
    tool: "update_item",
    input: { itemId: "item-123", name: "Demo video" },
    summary: "Assign Marko to Demo video",
    destructive: false,
    boardId: null,
  },
  {
    id: "b",
    tool: "update_item",
    input: {
      itemId: "item-456",
      note: "<b>bold</b><img src=x onerror=alert(1)>",
    },
    summary: "Set status of Press kit to Done",
    destructive: false,
    boardId: null,
  },
  {
    id: "c",
    tool: "manage_item",
    input: { action: "archive", itemId: "item-789", long: "x".repeat(300) },
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

  it("says the changes are waiting while idle or running", () => {
    setup();
    expect(screen.getByText("3 changes waiting")).toBeInTheDocument();
  });

  it("drops 'waiting' from the kicker once the card is resolved", () => {
    for (const state of ["done", "error"] as const) {
      const { unmount } = render(
        <BatchConfirmCard
          calls={calls}
          state={state}
          resultNote="Applied."
          onApply={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
      expect(screen.getByText("3 changes")).toBeInTheDocument();
      expect(screen.queryByText(/waiting/)).not.toBeInTheDocument();
      unmount();
    }
  });

  it("marks a destructive row as opt-in, not as irreversible", () => {
    setup();
    const row = screen.getByLabelText(/Archive Old brief/);
    expect(row).not.toBeChecked();
    expect(screen.getByText("(tick to include)")).toBeInTheDocument();
    expect(screen.queryByText(/cannot be undone/)).not.toBeInTheDocument();
  });

  it("shows the result note and no buttons once resolved", () => {
    setup("done", "Applied.");
    expect(screen.getByText("Applied.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Apply/ }),
    ).not.toBeInTheDocument();
  });

  it("shows each row's tool and input values behind a closed Details disclosure", () => {
    setup();
    const details = screen.getAllByText("Details");
    expect(details).toHaveLength(3);
    const first = details[0]!.closest("details")!;
    expect(first.open).toBe(false);
    expect(first).toHaveTextContent("update_item");
    expect(first).toHaveTextContent("itemId");
    expect(first).toHaveTextContent('"item-123"');
    expect(first).toHaveTextContent('"Demo video"');
  });

  it("opens a destructive row's details by default", () => {
    setup();
    const destructive = screen.getAllByText("Details")[2]!.closest("details")!;
    expect(destructive.open).toBe(true);
    expect(destructive).toHaveTextContent("manage_item");
    expect(destructive).toHaveTextContent('"archive"');
  });

  // A native <summary> is in the tab order and the browser toggles it on
  // Enter/Space. jsdom does not synthesise that key activation, so this checks
  // the tab order and the toggle itself.
  it("puts Details in the tab order and toggles it", async () => {
    setup();
    const summary = screen.getAllByText("Details")[0]!;
    const details = summary.closest("details")!;
    await userEvent.tab(); // first checkbox
    await userEvent.tab(); // its Details
    expect(summary).toHaveFocus();
    await userEvent.click(summary);
    expect(details.open).toBe(true);
    await userEvent.click(summary);
    expect(details.open).toBe(false);
  });

  it("renders a value containing markup as text, never as HTML", () => {
    const { container } = render(
      <BatchConfirmCard
        calls={[calls[1]!]}
        state="idle"
        onApply={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container).toHaveTextContent(
      '"<b>bold</b><img src=x onerror=alert(1)>"',
    );
  });

  it("truncates a long value to 200 characters with an ellipsis", () => {
    setup();
    const destructive = screen.getAllByText("Details")[2]!.closest("details")!;
    const value = `"${"x".repeat(300)}"`;
    expect(destructive).toHaveTextContent(`${value.slice(0, 200)}…`);
    expect(destructive).not.toHaveTextContent(value);
  });
});
