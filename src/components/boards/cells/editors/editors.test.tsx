import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  CheckboxEditor,
  DateEditor,
  DropdownEditor,
  LinkEditor,
  NumbersEditor,
  PeopleEditor,
  RatingEditor,
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

  it("routes the trailing Clear button through onClear", async () => {
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
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
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

  it("routes the trailing Clear button through onClear", async () => {
    const onCommit = vi.fn();
    const onClear = vi.fn();
    render(
      <PeopleEditor
        value={{ userIds: ["u1"] }}
        settings={{}}
        members={[
          { userId: "u1", fullName: "Ada", email: "a@x.io", avatarUrl: null },
        ]}
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

describe("DateEditor", () => {
  it("opens the calendar immediately on edit", () => {
    render(
      <DateEditor
        value={{ date: "2026-06-10" }}
        settings={{}}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("grid")).toBeInTheDocument();
  });

  it("commits the picked day as a local ISO date (no off-by-one)", async () => {
    const onCommit = vi.fn();
    render(
      <DateEditor
        value={{ date: "2026-06-10" }}
        settings={{}}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByText("15"));
    // Exact equality also proves no `end` is synthesised for a single day.
    expect(onCommit).toHaveBeenCalledWith({ date: "2026-06-15" });
  });

  it("preserves an existing range end by shifting it the same span", async () => {
    const onCommit = vi.fn();
    render(
      <DateEditor
        value={{ date: "2026-06-10", end: "2026-06-13" }}
        settings={{}}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByText("15"));
    // 3-day span (10→13) shifts forward with the new start (15→18).
    expect(onCommit).toHaveBeenCalledWith({
      date: "2026-06-15",
      end: "2026-06-18",
    });
  });

  it("clears the cell via the Clear affordance", async () => {
    const onCommit = vi.fn();
    const onClear = vi.fn();
    render(
      <DateEditor
        value={{ date: "2026-06-10" }}
        settings={{}}
        onCommit={onCommit}
        onCancel={vi.fn()}
        onClear={onClear}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onClear).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("cancels on Escape without committing", async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <DateEditor
        value={{ date: "2026-06-10" }}
        settings={{}}
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("CheckboxEditor", () => {
  it("commits the toggled checked state", async () => {
    const onCommit = vi.fn();
    render(
      <CheckboxEditor
        value={{ checked: false }}
        settings={{}}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /toggle/i }));
    expect(onCommit).toHaveBeenCalledWith({ checked: true });
  });
});

describe("RatingEditor", () => {
  it("commits the chosen star count", async () => {
    const onCommit = vi.fn();
    render(
      <RatingEditor
        value={{ rating: 0 }}
        settings={{}}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /4 stars/i }));
    expect(onCommit).toHaveBeenCalledWith({ rating: 4 });
  });

  it("clears via onClear when the current rating is reclicked", async () => {
    const onCommit = vi.fn();
    const onClear = vi.fn();
    render(
      <RatingEditor
        value={{ rating: 3 }}
        settings={{}}
        onCommit={onCommit}
        onCancel={vi.fn()}
        onClear={onClear}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /3 stars/i }));
    expect(onClear).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("LinkEditor", () => {
  it("rejects an invalid URL and shows an error without committing", async () => {
    const onCommit = vi.fn();
    render(
      <LinkEditor
        value={null}
        settings={{}}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText(/url/i), "nope");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(/http or https/i)).toBeInTheDocument();
  });

  it("rejects a javascript: scheme (XSS guard) without committing", async () => {
    const onCommit = vi.fn();
    render(
      <LinkEditor
        value={null}
        settings={{}}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText(/url/i), "javascript:alert(1)");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(/http or https/i)).toBeInTheDocument();
  });
});
