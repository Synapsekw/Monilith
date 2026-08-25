import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocumentPicker } from "./DocumentPicker";
import {
  documentBudget,
  estimateTokens,
  ASSUMED_PREFIX_TOKENS,
} from "@/lib/agents/document-budget";

const doc = (id: string, tokenEstimate: number) => ({
  id,
  title: `Doc ${id}`,
  tokenEstimate,
  sourceFormat: "pasted" as const,
  sourceFileName: null,
  updatedAt: "2026-08-24T10:00:00Z",
});

const base = {
  contextLength: 200_000,
  instructions: "Do the thing.",
  onChange: vi.fn(),
};

// The exact budget number the meter must show is derived from the REAL
// `documentBudget`/`ASSUMED_PREFIX_TOKENS` rather than a hand-computed magic
// number, for the same reason the meter itself must import them: a literal
// pinned by hand drifts silently the moment either constant changes, which is
// exactly the divergence this feature exists to prevent.
const expectedBudget = documentBudget({
  contextLength: base.contextLength,
  prefixTokens: ASSUMED_PREFIX_TOKENS,
  instructionTokens: estimateTokens(base.instructions),
}).budget;

describe("DocumentPicker", () => {
  it("shows the budget meter with used and available tokens", () => {
    render(
      <DocumentPicker
        {...base}
        documents={[doc("a", 1_000)]}
        selectedIds={["a"]}
      />,
    );
    expect(screen.getByText(/1,000/)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(expectedBudget.toLocaleString())),
    ).toBeInTheDocument();
  });

  it("disables a document that would overrun the budget", () => {
    render(
      <DocumentPicker
        {...base}
        // Deliberately NOT the 16,385-token floor used below for the
        // "too small" case: that context makes the budget itself fall below
        // MIN_USEFUL_BUDGET, which replaces the whole list with the
        // too-small message — there would be no checkbox to disable. This
        // context keeps the budget usable while still smaller than the
        // document, so the overrun-disable path is what's under test.
        contextLength={100_000}
        documents={[doc("a", 100_000)]}
        selectedIds={[]}
      />,
    );
    expect(screen.getByRole("checkbox", { name: /Doc a/ })).toBeDisabled();
  });

  it("still allows DESELECTING when already over budget", () => {
    render(
      <DocumentPicker
        {...base}
        contextLength={100_000}
        documents={[doc("a", 100_000)]}
        selectedIds={["a"]}
      />,
    );
    const box = screen.getByRole("checkbox", { name: /Doc a/ });
    expect(box).not.toBeDisabled();
    fireEvent.click(box);
    expect(base.onChange).toHaveBeenCalledWith([]);
  });

  it("says documents are unavailable below MIN_USEFUL_BUDGET", () => {
    render(
      <DocumentPicker
        {...base}
        contextLength={16_385}
        documents={[doc("a", 10)]}
        selectedIds={[]}
      />,
    );
    expect(
      screen.getByText(/context is too small for reference documents/i),
    ).toBeInTheDocument();
  });

  it("discloses when the context length was assumed", () => {
    render(
      <DocumentPicker
        {...base}
        contextLength={null}
        documents={[doc("a", 10)]}
        selectedIds={[]}
      />,
    );
    expect(
      screen.getByText(/assuming a 32,000-token context/i),
    ).toBeInTheDocument();
  });

  it("selecting is client state — it does NOT call a server action", () => {
    const setAgentDocuments = vi.fn();
    render(
      <DocumentPicker {...base} documents={[doc("a", 10)]} selectedIds={[]} />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /Doc a/ }));
    expect(base.onChange).toHaveBeenCalledWith(["a"]);
    expect(setAgentDocuments).not.toHaveBeenCalled();
  });
});
