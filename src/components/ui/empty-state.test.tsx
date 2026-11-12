import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { EmptyState } from "./empty-state";

test("panel variant renders the dashed-box pattern", () => {
  render(<EmptyState>No widgets yet.</EmptyState>);
  const el = screen.getByText("No widgets yet.");
  for (const c of [
    "rounded-lg",
    "border-dashed",
    "p-12",
    "text-center",
    "text-muted-foreground",
  ]) {
    expect(el.className).toContain(c);
  }
});

test("inline variant renders unboxed with standardized padding", () => {
  render(<EmptyState variant="inline">No files yet.</EmptyState>);
  const el = screen.getByText("No files yet.");
  expect(el.className).toContain("py-8");
  expect(el.className).not.toContain("border-dashed");
});

test("merges a custom className", () => {
  render(
    <EmptyState variant="inline" className="my-2">
      Empty.
    </EmptyState>,
  );
  expect(screen.getByText("Empty.").className).toContain("my-2");
});

describe("mascot / title / actions", () => {
  test("lays out mascot, then title, message and actions in order", () => {
    const { container } = render(
      <EmptyState
        mascot
        title="Your goals will appear here"
        actions={<button type="button">New goal</button>}
      >
        Create a goal to get started.
      </EmptyState>,
    );
    const root = container.firstElementChild!;
    // Still the dashed panel, now a row that stacks and centres when narrow.
    for (const c of [
      "border-dashed",
      "p-12",
      "flex-col",
      "items-center",
      "text-center",
      "sm:flex-row",
      "sm:text-left",
    ]) {
      expect(root.className).toContain(c);
    }
    const [mono, body] = [...root.children];
    expect(mono.tagName.toLowerCase()).toBe("svg");
    expect(mono).toHaveAttribute("aria-hidden", "true");
    expect(mono).toHaveAttribute("data-mood", "idle");

    const title = screen.getByText("Your goals will appear here");
    expect(title.className).toContain("text-foreground");
    expect(title.className).toContain("font-semibold");
    const message = screen.getByText("Create a goal to get started.");
    const action = screen.getByRole("button", { name: "New goal" });
    expect(body.contains(title)).toBe(true);
    const follows = (a: Element, b: Element) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(follows(title, message)).toBeTruthy();
    expect(follows(message, action)).toBeTruthy();
    // The message keeps the muted colour it inherits from the root.
    expect(root.className).toContain("text-muted-foreground");
  });

  test("mascot mood is selectable", () => {
    const { container } = render(<EmptyState mascot="happy">Hi.</EmptyState>);
    expect(container.querySelector("svg")).toHaveAttribute(
      "data-mood",
      "happy",
    );
  });

  test("title and actions work without the mascot", () => {
    const { container } = render(
      <EmptyState title="Nothing here" variant="inline">
        Add something.
      </EmptyState>,
    );
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(container.firstElementChild!.className).toContain("py-8");
  });

  test("mascot={false} keeps the legacy markup", () => {
    expect(
      renderToStaticMarkup(<EmptyState mascot={false}>Empty.</EmptyState>),
    ).toBe(
      '<div class="text-muted-foreground text-center text-sm rounded-lg border border-dashed p-12">Empty.</div>',
    );
  });
});

// Baseline captured BEFORE the mascot/title/actions props existed: a call site
// that passes none of them must keep producing exactly this markup.
describe("legacy markup is byte-identical", () => {
  test("panel", () => {
    expect(renderToStaticMarkup(<EmptyState>No widgets yet.</EmptyState>)).toBe(
      '<div class="text-muted-foreground text-center text-sm rounded-lg border border-dashed p-12">No widgets yet.</div>',
    );
  });

  test("inline with className", () => {
    expect(
      renderToStaticMarkup(
        <EmptyState variant="inline" className="my-2">
          Empty.
        </EmptyState>,
      ),
    ).toBe(
      '<div class="text-muted-foreground text-center text-sm py-8 my-2">Empty.</div>',
    );
  });
});
