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

  it("commits a null option id when cleared", async () => {
    const onCommit = vi.fn();
    render(
      <StatusEditor
        value={{ optionId: "o1" }}
        settings={statusSettings}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onCommit).toHaveBeenCalledWith({ optionId: null });
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
});
