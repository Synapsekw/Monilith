import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
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
