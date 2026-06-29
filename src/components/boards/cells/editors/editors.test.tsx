import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  CheckboxEditor,
  DateEditor,
  DropdownEditor,
  LinkEditor,
  NumbersEditor,
  PeopleEditor,
  PercentEditor,
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

describe("PercentEditor", () => {
  it("commits a parsed percent on Enter", async () => {
    const onCommit = vi.fn();
    render(
      <PercentEditor
        value={null}
        settings={{}}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByRole("spinbutton"), "75{Enter}");
    expect(onCommit).toHaveBeenCalledWith({ percent: 75 });
  });

  it("clamps values above 100 and below 0", () => {
    // Drive the number input with fireEvent.change so the whole string is set
    // at once — jsdom sanitizes negatives away when typed key-by-key.
    const onCommit = vi.fn();
    render(
      <PercentEditor
        value={null}
        settings={{}}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByRole("spinbutton");

    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenLastCalledWith({ percent: 100 });

    fireEvent.change(input, { target: { value: "-5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenLastCalledWith({ percent: 0 });
  });

  it("clears the cell when emptied", async () => {
    const onClear = vi.fn();
    render(
      <PercentEditor
        value={{ percent: 40 }}
        settings={{}}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onClear={onClear}
      />,
    );
    const input = screen.getByRole("spinbutton");
    await userEvent.clear(input);
    await userEvent.type(input, "{Enter}");
    expect(onClear).toHaveBeenCalled();
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

// ── TOUCH Batch-2 (iPad) ──────────────────────────────────────────────────
// Class-presence assertions: the `(pointer: coarse)` media query only resolves
// in a real browser, so we assert the coarse-pointer sizing variant is present.
describe("inline cell editors — coarse-pointer tap targets", () => {
  it("StatusEditor option pills get a ≥44px min-height on coarse", () => {
    render(
      <StatusEditor
        value={{ optionId: null }}
        settings={statusSettings}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("option", { name: /done/i }).className).toContain(
      "pointer-coarse:min-h-11",
    );
  });

  it("StatusEditor Clear button gets a ≥44px height on coarse", () => {
    render(
      <StatusEditor
        value={{ optionId: "o1" }}
        settings={statusSettings}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /clear/i }).className).toContain(
      "pointer-coarse:h-11",
    );
  });

  it("CheckboxEditor wraps the native input in a ≥44px coarse tap target", () => {
    render(
      <CheckboxEditor
        value={{ checked: false }}
        settings={{}}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByRole("checkbox", { name: /toggle/i });
    expect(input.className).toContain("size-4"); // input stays visually small
    expect(input.closest("label")?.className).toContain(
      "pointer-coarse:size-11",
    );
  });

  it("RatingEditor stars get a ≥44px coarse tap target with comfortable spacing", () => {
    render(
      <RatingEditor
        value={{ rating: 0 }}
        settings={{}}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const star = screen.getByRole("button", { name: /4 stars/i });
    expect(star.className).toContain("pointer-coarse:size-11");
    expect(star.parentElement?.className).toContain("pointer-coarse:gap-2");
  });
});
