import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { RelationCell } from "./RelationCell";
import type { RelationLink } from "@/lib/boards/relations";

const mk = (id: string, name: string | null, pos: number): RelationLink => ({
  id,
  itemId: "i",
  columnId: "c",
  linkedItemId: `t-${id}`,
  linkedItemName: name,
  position: pos,
});

const base = {
  allowMultiple: true,
  loadCandidates: async () => [],
  onChange: () => {},
};

describe("RelationCell", () => {
  it("renders a chip per linked item up to the cap", () => {
    render(<RelationCell {...base} links={[mk("a", "Acquisition Q3", 0)]} />);
    expect(screen.getByText("Acquisition Q3")).toBeInTheDocument();
  });

  it("collapses overflow into +N more in stored order", () => {
    render(
      <RelationCell
        {...base}
        maxChips={2}
        links={[
          mk("c", "C", 2),
          mk("a", "A", 0),
          mk("b", "B", 1),
          mk("d", "D", 3),
        ]}
      />,
    );
    // sorted by position → A,B shown; C,D collapsed
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("+2 more")).toBeInTheDocument();
    expect(screen.queryByText("C")).not.toBeInTheDocument();
  });

  it("omits chips whose linked name is RLS-filtered (null)", () => {
    render(<RelationCell {...base} links={[mk("a", null, 0)]} />);
    expect(screen.queryByText(/t-a/)).not.toBeInTheDocument();
  });

  it("shows the add affordance when empty and editable", () => {
    render(<RelationCell {...base} links={[]} />);
    expect(
      screen.getByRole("button", { name: "Edit linked items" }),
    ).toBeInTheDocument();
  });

  it("read-only cells render chips but no editor button is disabled-interactive", () => {
    render(<RelationCell {...base} readOnly links={[mk("a", "A", 0)]} />);
    expect(
      screen.getByRole("button", { name: "Edit linked items" }),
    ).toBeDisabled();
  });

  // ── TOUCH Batch-2 (iPad) ──────────────────────────────────────────────
  it("gives the empty-state add chip a ≥44px coarse target", () => {
    render(<RelationCell {...base} links={[]} />);
    const trigger = screen.getByRole("button", { name: "Edit linked items" });
    const addChip = trigger.querySelector(".border-dashed");
    expect(addChip?.className).toContain("pointer-coarse:size-11");
  });
});

describe("RelationCell — debounced search", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function openPicker(loadCandidates: (q: string) => Promise<never[]>) {
    render(
      <RelationCell
        allowMultiple
        onChange={() => {}}
        loadCandidates={loadCandidates}
        links={[]}
      />,
    );
    // Open the popover.
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Edit linked items" }),
      );
    });
    return screen.getByLabelText("Search items to link") as HTMLInputElement;
  }

  it("echoes each keystroke instantly but fetches once after the quiet period", () => {
    const loadCandidates = vi.fn(async () => [] as never[]);
    const input = openPicker(loadCandidates);

    // Initial open fetches with an empty query.
    expect(loadCandidates).toHaveBeenCalledTimes(1);
    expect(loadCandidates).toHaveBeenLastCalledWith("");
    loadCandidates.mockClear();

    // Three fast keystrokes: the input value echoes immediately each time…
    act(() => fireEvent.change(input, { target: { value: "a" } }));
    act(() => fireEvent.change(input, { target: { value: "ac" } }));
    act(() => fireEvent.change(input, { target: { value: "acm" } }));
    expect(input.value).toBe("acm");
    // …but no fetch has fired yet (still inside the debounce window).
    expect(loadCandidates).not.toHaveBeenCalled();

    // After the quiet period, exactly one fetch fires with the latest value.
    act(() => void vi.advanceTimersByTime(200));
    expect(loadCandidates).toHaveBeenCalledTimes(1);
    expect(loadCandidates).toHaveBeenLastCalledWith("acm");
  });

  it("does not fetch a stale query after the popover closes", () => {
    const loadCandidates = vi.fn(async () => [] as never[]);
    const input = openPicker(loadCandidates);
    loadCandidates.mockClear(); // drop the initial open fetch

    act(() => fireEvent.change(input, { target: { value: "abc" } }));
    // Close the popover before the debounce elapses (Escape closes it).
    act(() => fireEvent.keyDown(input, { key: "Escape" }));

    act(() => void vi.advanceTimersByTime(500));
    expect(loadCandidates).not.toHaveBeenCalled();
  });
});
