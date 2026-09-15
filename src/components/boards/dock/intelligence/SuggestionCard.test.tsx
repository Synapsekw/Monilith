import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Suggestion } from "@/lib/ai/board-intelligence/runs";
import { SuggestionCard } from "./SuggestionCard";

const reassignSuggestion: Suggestion = {
  id: "s1",
  kind: "overloaded",
  title: "Sam is carrying six open items",
  evidence: "6 items",
  body: "Move one to someone with room.",
  evidenceRows: [],
  actions: [
    {
      type: "reassign",
      itemIds: ["i1"],
      columnId: "people-1",
      toUserId: "user-1",
      label: "Give to Alex",
    },
  ],
};

const base = {
  pending: false,
  onApply: vi.fn(),
  onDismiss: vi.fn(),
};

describe("SuggestionCard — Always do this", () => {
  it("offers Always do this when a handler is given", async () => {
    const onAlways = vi.fn();
    render(
      <SuggestionCard
        {...base}
        suggestion={reassignSuggestion}
        canApply
        onAlwaysDoThis={onAlways}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /always do this/i }),
    );
    expect(onAlways).toHaveBeenCalledTimes(1);
  });

  it("renders no Always do this when the handler is absent", () => {
    render(
      <SuggestionCard {...base} suggestion={reassignSuggestion} canApply />,
    );
    expect(
      screen.queryByRole("button", { name: /always do this/i }),
    ).not.toBeInTheDocument();
  });

  it("renders no Always do this for a viewer", () => {
    render(
      <SuggestionCard
        {...base}
        suggestion={reassignSuggestion}
        canApply={false}
        onAlwaysDoThis={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /always do this/i }),
    ).not.toBeInTheDocument();
  });
});
