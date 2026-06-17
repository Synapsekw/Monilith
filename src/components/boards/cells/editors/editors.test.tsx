import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DateEditor,
  DropdownEditor,
  NumbersEditor,
  PeopleEditor,
  StatusEditor,
  TextEditor,
} from "./index";

const statusSettings = {
  options: [
    { id: "o1", label: "Done", color: "#00c875" },
    { id: "o2", label: "Stuck", color: "#e2445c" },
  ],
};

describe("TextEditor", () => {
  it("seeds the current value and commits on Enter", async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <TextEditor
        value={{ text: "old" }}
        settings={{}}
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("old");
    await userEvent.clear(input);
    await userEvent.type(input, "new{Enter}");
    expect(onCommit).toHaveBeenCalledWith({ text: "new" });
  });

  it("cancels on Escape without committing", async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <TextEditor
        value={{ text: "old" }}
        settings={{}}
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );
    await userEvent.type(screen.getByRole("textbox"), "x{Escape}");
    expect(onCancel).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("NumbersEditor", () => {
  it("commits a parsed number on Enter", async () => {
    const onCommit = vi.fn();
    render(
      <NumbersEditor
        value={null}
        settings={{}}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByRole("spinbutton"), "42{Enter}");
    expect(onCommit).toHaveBeenCalledWith({ n: 42 });
  });
});

describe("StatusEditor", () => {
  it("commits the chosen option id", async () => {
    const onCommit = vi.fn();
    render(
      <StatusEditor
        value={{ optionId: null }}
        settings={statusSettings}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("option", { name: /done/i }));
    expect(onCommit).toHaveBeenCalledWith({ optionId: "o1" });
  });

  it("renders options in a portal so they escape clipped scroll containers", () => {
    render(
      <div data-testid="clip" style={{ overflow: "hidden" }}>
        <StatusEditor
          value={{ optionId: null }}
          settings={statusSettings}
          onCommit={vi.fn()}
          onCancel={vi.fn()}
        />
      </div>,
    );
    const listbox = screen.getByRole("listbox", { name: /select status/i });
    // The floating surface must NOT be trapped inside the clipping container;
    // it lives in a body-level portal so all options stay visible (Monday-style).
    expect(screen.getByTestId("clip")).not.toContainElement(listbox);
    expect(document.body).toContainElement(listbox);
  });

  it("cancels when the popover is dismissed with Escape", async () => {
    const onCancel = vi.fn();
    render(
      <StatusEditor
        value={{ optionId: null }}
        settings={statusSettings}
        onCommit={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
  });

  it("routes Clear through onClear (deletes the row), not a null upsert", async () => {
    const onCommit = vi.fn();
    const onClear = vi.fn();
    render(
      <StatusEditor
        value={{ optionId: "o1" }}
        settings={statusSettings}
        onCommit={onCommit}
        onCancel={vi.fn()}
        onClear={onClear}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onClear).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("DropdownEditor", () => {
  it("toggles an option and commits the id list", async () => {
    const onCommit = vi.fn();
    render(
      <DropdownEditor
        value={{ optionIds: [] }}
        settings={statusSettings}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("option", { name: /done/i }));
    expect(onCommit).toHaveBeenCalledWith({ optionIds: ["o1"] });
  });

  it("clears via onClear when the last option is deselected", async () => {
    const onCommit = vi.fn();
    const onClear = vi.fn();
    render(
      <DropdownEditor
        value={{ optionIds: ["o1"] }}
        settings={statusSettings}
        onCommit={onCommit}
        onCancel={vi.fn()}
        onClear={onClear}
      />,
    );
    await userEvent.click(screen.getByRole("option", { name: /done/i }));
    expect(onClear).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("PeopleEditor", () => {
  it("toggles a member and commits the user id list", async () => {
    const onCommit = vi.fn();
    render(
      <PeopleEditor
        value={{ userIds: [] }}
        settings={{}}
        members={[
          { userId: "u1", fullName: "Ada", email: "a@x.io", avatarUrl: null },
        ]}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByText("Ada"));
    expect(onCommit).toHaveBeenCalledWith({ userIds: ["u1"] });
  });
});

describe("DateEditor", () => {
  it("commits an ISO date", async () => {
    const onCommit = vi.fn();
    render(
      <DateEditor
        value={null}
        settings={{}}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByLabelText(/date/i);
    await userEvent.type(input, "2026-06-15");
    await userEvent.type(input, "{Enter}");
    expect(onCommit).toHaveBeenCalledWith({ date: "2026-06-15" });
  });

  it("clears via onClear when an existing date is emptied", async () => {
    const onCommit = vi.fn();
    const onClear = vi.fn();
    render(
      <DateEditor
        value={{ date: "2026-06-15" }}
        settings={{}}
        onCommit={onCommit}
        onCancel={vi.fn()}
        onClear={onClear}
      />,
    );
    const input = screen.getByLabelText(/date/i);
    await userEvent.clear(input);
    await userEvent.type(input, "{Enter}");
    expect(onClear).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
