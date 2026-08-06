import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LongTextEditor } from "./LongTextEditor";

function setup(overrides: Partial<Parameters<typeof LongTextEditor>[0]> = {}) {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(
    <LongTextEditor
      value={{ text: "old" }}
      settings={{}}
      onCommit={onCommit}
      onCancel={onCancel}
      columnName="Description"
      {...overrides}
    />,
  );
  return { onCommit, onCancel };
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
  it("caps the textarea at 20000 characters", () => {
    setup();
    expect(screen.getByRole("textbox")).toHaveAttribute("maxLength", "20000");
  });

  it("hides the counter well below the cap", () => {
    setup();
    expect(screen.queryByText(/\/ 20,000/)).not.toBeInTheDocument();
  });

  it("shows the counter as the cap approaches", () => {
    setup({ value: { text: "x".repeat(19_500) } });
    expect(screen.getByText(/19,500 \/ 20,000/)).toBeInTheDocument();
  });
});
