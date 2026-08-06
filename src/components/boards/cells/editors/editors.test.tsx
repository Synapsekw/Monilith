import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  CellEditor,
  CheckboxEditor,
  DateEditor,
  DropdownEditor,
  LinkEditor,
  NumbersEditor,
  PeopleEditor,
  PercentEditor,
  RatingEditor,
  StatusEditor,
} from "./index";
import { TooltipProvider } from "@/components/ui/tooltip";

const statusSettings = {
  options: [
    { id: "o1", label: "Done", color: "#00c875" },
    { id: "o2", label: "Stuck", color: "#e2445c" },
  ],
};

describe("CellEditor routes text cells to the long-text panel", () => {
  it("renders the panel with tabs and a toolbar, not a single-line input", () => {
    render(
      <TooltipProvider>
        <CellEditor
          kind="text"
          value={{ text: "old" }}
          settings={{}}
          onCommit={vi.fn()}
          onCancel={vi.fn()}
          columnName="Notes"
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole("tab", { name: /write/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^bold$/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox").tagName).toBe("TEXTAREA");
  });

  it("commits the edited text through onCommit", async () => {
    const onCommit = vi.fn();
    render(
      <TooltipProvider>
        <CellEditor
          kind="text"
          value={{ text: "old" }}
          settings={{}}
          onCommit={onCommit}
          onCancel={vi.fn()}
          columnName="Notes"
        />
      </TooltipProvider>,
    );
    const ta = screen.getByRole("textbox");
    await userEvent.click(ta);
    await userEvent.type(ta, "er{Escape}");
    expect(onCommit).toHaveBeenCalledWith({ text: "older" });
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

describe("PriorityEditor", () => {
  it("commits critical", async () => {
    const onCommit = vi.fn();
    render(
      <CellEditor
        kind="priority"
        value={null}
        settings={{}}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("option", { name: /critical/i }));
    expect(onCommit).toHaveBeenCalledWith({ level: "critical" });
  });
  it("commits normal", async () => {
    const onCommit = vi.fn();
    render(
      <CellEditor
        kind="priority"
        value={{ level: "critical" }}
        settings={{}}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("option", { name: /normal/i }));
    expect(onCommit).toHaveBeenCalledWith({ level: "normal" });
  });
  it("clears via the clear affordance", async () => {
    const onClear = vi.fn();
    render(
      <CellEditor
        kind="priority"
        value={{ level: "normal" }}
        settings={{}}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        onClear={onClear}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onClear).toHaveBeenCalled();
  });
  it("marks the stored level as selected", () => {
    render(
      <CellEditor
        kind="priority"
        value={{ level: "critical" }}
        settings={{}}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("option", { name: /critical/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("option", { name: /normal/i })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
  it("explains the auto state when 2+ items depend on the item", () => {
    render(
      <CellEditor
        kind="priority"
        value={{ level: "normal" }}
        settings={{}}
        dependents={4}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/auto-critical: 4 items depend on this item/i),
    ).toBeInTheDocument();
  });
  it("shows no auto explanation below the threshold", () => {
    render(
      <CellEditor
        kind="priority"
        value={{ level: "normal" }}
        settings={{}}
        dependents={1}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByText(/auto-critical/i)).not.toBeInTheDocument();
  });
});
