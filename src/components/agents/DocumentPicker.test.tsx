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
  // REQUIRED, like the prop itself. Every existing case here budgets an agent
  // with no memory, which is the pre-2c number to the token — `documentBudget`
  // pins that compatibility guarantee, and this fixture is what keeps these
  // assertions measuring the document half in isolation.
  memoryTokens: 0,
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
    // One `textContent` assertion, in order, rather than two independent
    // `getByText` substring searches — those could not have caught "used"
    // and "available" being swapped in the rendering, since both are just
    // numbers and either one alone would still satisfy an isolated regex.
    expect(screen.getByTestId("document-budget-meter")).toHaveTextContent(
      `${(1_000).toLocaleString()} used · ${expectedBudget.toLocaleString()} tokens available`,
    );
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

  it("says how many are hidden when the library is capped at a page", () => {
    // `documents` here is ONE page (as `AgentEditor`/`AgentsSection` thread
    // it), while `total` is what the owner actually has — the same split
    // `DocumentLibrary` already surfaces as "Showing 1 of 137 documents".
    // Without this, a document past the cap is invisible in the picker with
    // no indication it exists or why it can't be attached.
    render(
      <DocumentPicker
        {...base}
        documents={[doc("a", 1_000)]}
        total={137}
        selectedIds={[]}
      />,
    );
    expect(screen.getByText(/showing 1 of 137 documents/i)).toBeInTheDocument();
  });

  it("shows no capped-library notice when the page holds everything", () => {
    // Default `total` (== documents.length) is the "no cap in effect" case —
    // every existing caller that never mentions `total` must keep seeing
    // nothing extra, not a spurious "showing 1 of 1".
    render(
      <DocumentPicker
        {...base}
        documents={[doc("a", 1_000)]}
        selectedIds={[]}
      />,
    );
    expect(screen.queryByText(/showing/i)).not.toBeInTheDocument();
  });

  it("subtracts the agent's memory from the document budget it advertises", () => {
    // The meter and the run loop must divide ONE envelope the same way. If
    // `memoryTokens` never reaches `documentBudget`, this meter promises
    // document room the run has already spent on memory — the precise drift
    // `ASSUMED_PREFIX_TOKENS` exists to prevent, reappearing through a new
    // input. Comparing two renders (rather than pinning a literal) keeps this
    // honest across any future change to the split itself.
    const props = { ...base, documents: [doc("a", 1_000)], selectedIds: ["a"] };
    const { rerender } = render(<DocumentPicker {...props} memoryTokens={0} />);
    const without = screen.getByTestId("document-budget-meter").textContent!;
    rerender(<DocumentPicker {...props} memoryTokens={2_000} />);
    const with2k = screen.getByTestId("document-budget-meter").textContent!;
    expect(with2k).not.toBe(without);
    // And specifically the budget `documentBudget` itself computes for that
    // memory — a meter that merely CHANGED (or grew) would satisfy the
    // inequality above while still being wrong in the direction that matters.
    const budgetWith2k = documentBudget({
      contextLength: base.contextLength,
      prefixTokens: ASSUMED_PREFIX_TOKENS,
      instructionTokens: estimateTokens(base.instructions),
      memoryTokens: 2_000,
    }).budget;
    expect(budgetWith2k).toBeLessThan(expectedBudget);
    expect(with2k).toContain(`${budgetWith2k.toLocaleString()} tokens`);
  });

  it("selecting is CONTROLLED client state — it reports up and fetches nothing", () => {
    // The old version of this test asserted that a locally-declared `vi.fn()`
    // — a mock of nothing, imported by nobody — had not been called, which no
    // change to this component could ever have falsified. What actually needs
    // proving is working agreement #5: toggling a document is 0 server
    // round-trips, and this component holds no selection state of its own.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("no request may leave this component"));
    const { rerender } = render(
      <DocumentPicker {...base} documents={[doc("a", 10)]} selectedIds={[]} />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /Doc a/ }));
    expect(base.onChange).toHaveBeenCalledWith(["a"]);
    // No Server Action, no route handler, no refetch — every Server Action
    // call in a client component goes out over fetch.
    expect(fetchSpy).not.toHaveBeenCalled();
    // Still unchecked: the parent form owns the selection and calls
    // `setAgentDocuments` once, on save, like every other field in it.
    expect(screen.getByRole("checkbox", { name: /Doc a/ })).not.toBeChecked();
    // Only the parent's re-render moves the meter — and it moves without any
    // new data arriving from the server.
    rerender(
      <DocumentPicker
        {...base}
        documents={[doc("a", 10)]}
        selectedIds={["a"]}
      />,
    );
    expect(screen.getByRole("checkbox", { name: /Doc a/ })).toBeChecked();
    expect(screen.getByTestId("document-budget-meter").textContent).toContain(
      "10 used",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
