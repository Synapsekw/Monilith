import { StrictMode, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LongTextEditor } from "./LongTextEditor";
import { TooltipProvider } from "@/components/ui/tooltip";

// The toolbar buttons are wrapped in Tooltip/TooltipTrigger, which throws
// without a TooltipProvider ancestor. In the app this comes from the
// root-level provider (src/components/providers.tsx); tests supply their own,
// same as BoardsNav.test.tsx / DashboardsNav.test.tsx do for their own
// Tooltip usage.
function setup(overrides: Partial<Parameters<typeof LongTextEditor>[0]> = {}) {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const result = render(
    <TooltipProvider>
      <LongTextEditor
        value={{ text: "old" }}
        onCommit={onCommit}
        onCancel={onCancel}
        columnName="Description"
        {...overrides}
      />
    </TooltipProvider>,
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
        <TooltipProvider>
          <LongTextEditor
            value={{ text }}
            onCommit={onCommit}
            onCancel={onCancel}
            columnName="Description"
          />
        </TooltipProvider>
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
        <TooltipProvider>
          <LongTextEditor
            value={{ text: "old" }}
            onCommit={() => setEditing(false)}
            onCancel={() => setEditing(false)}
            columnName="Description"
          />
        </TooltipProvider>
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

// FIX 1: the toolbar icons carried aria-labels only, so sighted users had no
// way to discover what each button did without clicking it. TooltipTrigger's
// onFocus opens the tooltip synchronously (no hover-delay timer to fake), so
// focusing the button is enough to assert the tooltip content renders.
describe("LongTextEditor — toolbar tooltips", () => {
  // Radix's TooltipContent renders the text twice — once in the visible
  // popup, once in a visually-hidden node carrying role="tooltip" for
  // screen readers — so `getByText` matches two nodes. Reading the
  // role="tooltip" node's text is the unambiguous query.
  it("shows the label with its keyboard shortcut in a tooltip", async () => {
    setup();
    fireEvent.focus(screen.getByRole("button", { name: /^bold$/i }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Bold (⌘B)");
  });

  it("shows the italic shortcut in a tooltip", async () => {
    setup();
    fireEvent.focus(screen.getByRole("button", { name: /^italic$/i }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Italic (⌘I)");
  });

  it("shows just the label for actions with no keyboard shortcut", async () => {
    setup();
    fireEvent.focus(screen.getByRole("button", { name: /quote/i }));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Quote");
    expect(tooltip.textContent).not.toMatch(/Quote \(/);
  });

  it("keeps the aria-label as the accessible name — the tooltip does not replace it", async () => {
    setup();
    const button = screen.getByRole("button", { name: /^bold$/i });
    fireEvent.focus(button);
    await screen.findByRole("tooltip");
    // The tooltip text ("Bold (⌘B)") is additive; the button's own
    // accessible name stays the plain "Bold" aria-label.
    expect(button).toHaveAccessibleName("Bold");
  });
});

// FIX 2: role="tab"/aria-selected covered basic mouse/Enter-Space use, but
// the WAI-ARIA APG tabs pattern also needs aria-controls on each tab,
// role="tabpanel"/aria-labelledby on the panel, a roving tabindex, and
// Left/Right arrow-key switching. There is only ever one tabpanel mounted
// (Preview unmounts the textarea, Write unmounts the preview), so both tabs
// share one aria-controls target and the panel's aria-labelledby is what
// actually tracks which tab currently owns it.
describe("LongTextEditor — tabs ARIA pattern", () => {
  it("wires aria-controls (both tabs) and aria-labelledby (the active panel) to each other", () => {
    setup();
    const writeTab = screen.getByRole("tab", { name: /write/i });
    const previewTab = screen.getByRole("tab", { name: /preview/i });
    const panel = screen.getByRole("tabpanel");
    expect(writeTab).toHaveAttribute("aria-controls", panel.id);
    expect(previewTab).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", writeTab.id);
  });

  it("relabels the single tabpanel to the preview tab once switched", async () => {
    setup();
    await userEvent.click(screen.getByRole("tab", { name: /preview/i }));
    const previewTab = screen.getByRole("tab", { name: /preview/i });
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", previewTab.id);
  });

  it("uses a roving tabindex — only the selected tab is in the Tab order", () => {
    setup();
    expect(screen.getByRole("tab", { name: /write/i })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("tab", { name: /preview/i })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("switches tabs with ArrowRight / ArrowLeft, moving focus to Preview", async () => {
    setup();
    const writeTab = screen.getByRole("tab", { name: /write/i });
    const previewTab = screen.getByRole("tab", { name: /preview/i });

    writeTab.focus();
    await userEvent.keyboard("{ArrowRight}");
    // Preview has no competing autoFocus content, so focus lands on the tab
    // itself, per the APG roving-tabindex pattern.
    expect(previewTab).toHaveAttribute("aria-selected", "true");
    expect(previewTab).toHaveFocus();
    expect(previewTab).toHaveAttribute("tabindex", "0");
    expect(writeTab).toHaveAttribute("tabindex", "-1");

    await userEvent.keyboard("{ArrowLeft}");
    // Switching back to Write re-mounts the `autoFocus` textarea (existing,
    // pre-fix behaviour — the same thing happens on a mouse click), which
    // wins the focus race after this handler's own `.focus()` call. The
    // selection/tabindex state is still correct even though DOM focus ends
    // up in the panel rather than on the tab.
    expect(writeTab).toHaveAttribute("aria-selected", "true");
    expect(writeTab).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("textbox")).toHaveFocus();
  });
});
