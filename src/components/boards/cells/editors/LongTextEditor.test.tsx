import { StrictMode, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LongTextEditor } from "./LongTextEditor";

function setup(overrides: Partial<Parameters<typeof LongTextEditor>[0]> = {}) {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const result = render(
    <LongTextEditor
      value={{ text: "old" }}
      settings={{}}
      onCommit={onCommit}
      onCancel={onCancel}
      columnName="Description"
      {...overrides}
    />,
  );
  return { onCommit, onCancel, unmount: result.unmount };
}

describe("LongTextEditor — panel", () => {
  it("seeds the textarea with the current value", () => {
    setup();
    expect(screen.getByRole("textbox")).toHaveValue("old");
  });

  it("shows the column name", () => {
    setup();
    expect(screen.getByText("Description")).toBeInTheDocument();
  });

  it("opens on the Write tab", () => {
    setup();
    expect(screen.getByRole("tab", { name: /write/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

// React StrictMode double-invokes effects on mount (setup → cleanup → setup),
// and the App Router runs in StrictMode in dev whenever next.config.ts leaves
// `reactStrictMode` unset — which it does. The unmount-commit effect therefore
// fires its cleanup once immediately after mount, before the user can type.
// If that cleanup calls back into the parent, `EditableCell` clears its editing
// state and the panel closes the instant it opens: clicking a text cell appears
// to do nothing at all. These tests pin the panel against that.
describe("LongTextEditor — StrictMode (the dev default)", () => {
  function strictSetup(text = "old") {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const result = render(
      <StrictMode>
        <LongTextEditor
          value={{ text }}
          settings={{}}
          onCommit={onCommit}
          onCancel={onCancel}
          columnName="Description"
        />
      </StrictMode>,
    );
    return { onCommit, onCancel, unmount: result.unmount };
  }

  it("stays open on mount and calls neither callback", () => {
    const { onCommit, onCancel } = strictSetup();
    expect(screen.getByRole("textbox")).toHaveValue("old");
    expect(onCancel).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("still commits a real edit on unmount", () => {
    const { onCommit, onCancel, unmount } = strictSetup();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "a real paragraph" },
    });
    unmount();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ text: "a real paragraph" });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("does not write when unmounted with the value untouched", () => {
    const { onCommit, unmount } = strictSetup();
    unmount();
    expect(onCommit).not.toHaveBeenCalled();
  });

  // The reported bug, end to end: EditableCell holds `editing` state, renders
  // this panel while it is set, and clears it from BOTH callbacks. Any callback
  // fired during StrictMode's post-mount cleanup therefore unmounts the panel
  // immediately — the user clicks a text cell and nothing appears to happen.
  // This harness reproduces exactly that wiring.
  it("survives a click when the parent clears editing state on either callback", async () => {
    function Harness() {
      const [editing, setEditing] = useState(false);
      if (!editing)
        return (
          <button type="button" onClick={() => setEditing(true)}>
            open cell
          </button>
        );
      return (
        <LongTextEditor
          value={{ text: "old" }}
          settings={{}}
          onCommit={() => setEditing(false)}
          onCancel={() => setEditing(false)}
          columnName="Description"
        />
      );
    }
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    await userEvent.click(screen.getByRole("button", { name: /open cell/i }));
    expect(screen.getByRole("textbox")).toHaveValue("old");
    expect(screen.getByRole("tab", { name: /write/i })).toBeInTheDocument();
  });
});

describe("LongTextEditor — save semantics", () => {
  it("inserts a newline on Enter without committing", async () => {
    const { onCommit } = setup({ value: { text: "" } });
    const ta = screen.getByRole("textbox");
    await userEvent.click(ta);
    await userEvent.type(ta, "one{Enter}two");
    expect(ta).toHaveValue("one\ntwo");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits and does not cancel on Escape", async () => {
    const { onCommit, onCancel } = setup();
    const ta = screen.getByRole("textbox");
    await userEvent.click(ta);
    await userEvent.type(ta, "er{Escape}");
    expect(onCommit).toHaveBeenCalledWith({ text: "older" });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("commits on Cmd/Ctrl+Enter", async () => {
    const { onCommit } = setup();
    const ta = screen.getByRole("textbox");
    await userEvent.click(ta);
    await userEvent.type(ta, "er");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(onCommit).toHaveBeenCalledWith({ text: "older" });
  });

  it("commits when the close button is pressed", async () => {
    const { onCommit } = setup();
    await userEvent.click(screen.getByRole("textbox"));
    await userEvent.type(screen.getByRole("textbox"), "er");
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onCommit).toHaveBeenCalledWith({ text: "older" });
  });

  it("cancels instead of committing when the text is unchanged", async () => {
    const { onCommit, onCancel } = setup();
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  // FIX 1 regression: GroupSection virtualizes rows (overscan: 6), so
  // scrolling can unmount this panel without any of the explicit dismiss
  // paths above ever firing. Losing an in-progress edit to that is silent
  // data loss — the panel must commit on unmount too.
  it("commits the pending edit when the panel unmounts without an explicit dismissal", async () => {
    const { onCommit, unmount } = setup();
    const ta = screen.getByRole("textbox");
    await userEvent.click(ta);
    await userEvent.type(ta, "er");
    unmount();
    expect(onCommit).toHaveBeenCalledWith({ text: "older" });
  });

  it("commits on an outside click (pointerdown outside the panel)", async () => {
    const { onCommit } = setup();
    const ta = screen.getByRole("textbox");
    await userEvent.click(ta);
    await userEvent.type(ta, "er");
    fireEvent.pointerDown(document.body);
    expect(onCommit).toHaveBeenCalledWith({ text: "older" });
  });

  it("does not double-commit when Escape is followed by unmount", async () => {
    const { onCommit, unmount } = setup();
    const ta = screen.getByRole("textbox");
    await userEvent.click(ta);
    await userEvent.type(ta, "er{Escape}");
    unmount();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ text: "older" });
  });

  // An untouched unmount must call NOTHING. This is not merely an
  // optimisation: StrictMode runs the unmount cleanup once right after mount,
  // so any callback here closes the panel the instant it opens. The cost is
  // that the parent's editing state survives an untouched unmount and the
  // panel reopens when the row scrolls back — harmless, since no data is
  // involved and the user never dismissed it.
  it("calls nothing when unmounted with the value untouched", () => {
    const { onCommit, onCancel, unmount } = setup();
    unmount();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  // A cell that arrived over the cap through the spreadsheet-import bypass
  // (see textValueSchema's comment) cannot be committed on an implicit
  // unmount — the value would exceed the schema bound and there is no panel
  // left to show the blocking message. The edit is lost; nothing is written.
  it("never commits an over-cap unmount", async () => {
    const { onCommit, unmount } = setup({
      value: { text: "x".repeat(20_005) },
    });
    await userEvent.type(screen.getByRole("textbox"), "x");
    unmount();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("LongTextEditor — toolbar", () => {
  it("wraps the selection in bold marks", async () => {
    setup({ value: { text: "hello world" } });
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    ta.setSelectionRange(6, 11);
    await userEvent.click(screen.getByRole("button", { name: /^bold$/i }));
    expect(ta).toHaveValue("hello **world**");
  });

  it("unwraps an already-bold selection on a second press", async () => {
    setup({ value: { text: "hello **world**" } });
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    ta.setSelectionRange(8, 13);
    await userEvent.click(screen.getByRole("button", { name: /^bold$/i }));
    expect(ta).toHaveValue("hello world");
  });

  it("prefixes selected lines with bullets", async () => {
    setup({ value: { text: "a\nb" } });
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    ta.setSelectionRange(0, 3);
    await userEvent.click(screen.getByRole("button", { name: /bullet list/i }));
    expect(ta).toHaveValue("- a\n- b");
  });

  it("applies bold via the keyboard shortcut", async () => {
    setup({ value: { text: "ab" } });
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    ta.setSelectionRange(0, 2);
    await userEvent.keyboard("{Control>}b{/Control}");
    expect(ta).toHaveValue("**ab**");
  });

  it("exposes all nine formatting actions", () => {
    setup();
    for (const name of [
      /^bold$/i,
      /^italic$/i,
      /strikethrough/i,
      /heading/i,
      /bullet list/i,
      /numbered list/i,
      /^link$/i,
      /inline code/i,
      /quote/i,
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });
});

describe("LongTextEditor — preview", () => {
  it("renders formatted output on the Preview tab", async () => {
    setup({ value: { text: "**bold**" } });
    await userEvent.click(screen.getByRole("tab", { name: /preview/i }));
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });

  it("hides the textarea while previewing and restores it on Write", async () => {
    setup();
    await userEvent.click(screen.getByRole("tab", { name: /preview/i }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /write/i }));
    expect(screen.getByRole("textbox")).toHaveValue("old");
  });
});

describe("LongTextEditor — cap", () => {
  it("does not truncate the textarea at 20000 characters", () => {
    // FIX 4: a paste that lands over the cap must not be silently cut down
    // to exactly 20,000 — the user needs to see (and can edit down) the
    // full pasted text, so no `maxLength` on the textarea.
    setup();
    expect(screen.getByRole("textbox")).not.toHaveAttribute("maxLength");
  });

  it("hides the counter well below the cap", () => {
    setup();
    expect(screen.queryByText(/\/ 20,000/)).not.toBeInTheDocument();
  });

  it("shows the counter as the cap approaches", () => {
    setup({ value: { text: "x".repeat(19_500) } });
    expect(screen.getByText(/19,500 \/ 20,000/)).toBeInTheDocument();
  });

  it("blocks the commit and keeps the panel open when over the cap", async () => {
    const { onCommit } = setup({ value: { text: "x".repeat(20_001) } });
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onCommit).not.toHaveBeenCalled();
    // The panel is still open — the textarea (and the user's text) is
    // still on screen, not discarded.
    expect(screen.getByRole("textbox")).toHaveValue("x".repeat(20_001));
    expect(
      screen.getByText(/1 characters over the 20,000 limit/i),
    ).toBeInTheDocument();
  });

  it("names the overage in the blocking message", () => {
    setup({ value: { text: "x".repeat(22_480) } });
    expect(
      screen.getByText(/2,480 characters over the 20,000 limit/i),
    ).toBeInTheDocument();
  });

  it("allows the commit once edited back under the cap", async () => {
    const { onCommit } = setup({ value: { text: "x".repeat(20_005) } });
    const ta = screen.getByRole("textbox");
    // Trim 10 chars off — back under the cap.
    await userEvent.click(ta);
    fireEvent.change(ta, { target: { value: "x".repeat(19_995) } });
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onCommit).toHaveBeenCalledWith({ text: "x".repeat(19_995) });
  });
});

describe("LongTextEditor — toolbar disabled on Preview", () => {
  it("disables toolbar actions while on the Preview tab", async () => {
    setup({ value: { text: "hello" } });
    await userEvent.click(screen.getByRole("tab", { name: /preview/i }));
    expect(screen.getByRole("button", { name: /^bold$/i })).toBeDisabled();
  });

  it("keeps toolbar actions enabled on the Write tab", () => {
    setup();
    expect(screen.getByRole("button", { name: /^bold$/i })).toBeEnabled();
  });
});
