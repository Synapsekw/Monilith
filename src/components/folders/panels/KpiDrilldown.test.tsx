import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeKpis } from "@/lib/folders/rollup";
import { FIXTURE_TODAY, folderFixture } from "@/lib/folders/fixture";
import type { KpiItemRow } from "@/lib/folders/types";
import { KPI_KEYS } from "@/lib/validations/folder-layout";

const getFolderKpiItems = vi.fn();
vi.mock("@/lib/folders/actions", () => ({
  getFolderKpiItems: (input: unknown) => getFolderKpiItems(input),
}));
import { KPI_PAGE, itemFact } from "./KpiDrilldown";
import { DRILL, KpisPanel } from "./KpisPanel";

const fx = folderFixture();
const k = computeKpis(fx.rollup!, FIXTURE_TODAY);

const item = (i: number, patch: Partial<KpiItemRow> = {}): KpiItemRow => ({
  itemId: `i${i}`,
  itemName: `Item ${i}`,
  boardId: "b1",
  boardName: "Backend",
  groupId: "g1",
  groupName: " Build ",
  dueOn: "2026-09-01",
  doneOn: null,
  lastTouched: "2026-09-10T08:00:00+00:00",
  isDone: false,
  isOverdue: true,
  ...patch,
});

function renderPanel(props: Partial<Parameters<typeof KpisPanel>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (p: Partial<Parameters<typeof KpisPanel>[0]>) => (
    <QueryClientProvider client={qc}>
      <KpisPanel
        cards={[...KPI_KEYS]}
        rows={fx.rollup!}
        todayISO={FIXTURE_TODAY}
        failed={false}
        onRetry={vi.fn()}
        folderId="f1"
        {...p}
      />
    </QueryClientProvider>
  );
  const view = render(ui(props));
  return { rerender: (p: typeof props) => view.rerender(ui(p)) };
}

const openButton = (name: RegExp) => screen.getByRole("button", { name });

describe("KPI drill-down", () => {
  // Braces on purpose: a function RETURNED from beforeEach is run by vitest
  // as that test's cleanup, which would call the mock with no arguments.
  beforeEach(() => {
    getFolderKpiItems.mockReset();
  });

  it("the fixture has an overdue card to open (the tests below are not vacuous)", () => {
    expect(k.overdue).toBeGreaterThan(0);
    expect(k.done).toBeGreaterThan(0);
  });

  it("reads nothing until a card is clicked", () => {
    renderPanel();
    expect(screen.queryByTestId("kpi-items")).toBeNull();
    expect(getFolderKpiItems).not.toHaveBeenCalled();
  });

  it("names each control by what it shows, with the card's own number", () => {
    renderPanel();
    expect(
      openButton(new RegExp(`^Show the ${k.overdue} overdue items?$`)),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      openButton(new RegExp(`^Show the ${k.done} done items?$`)),
    ).toBeInTheDocument();
  });

  it("Gap to plan is a difference of two counts, so it opens no list", () => {
    renderPanel();
    expect(DRILL.gap).toBeUndefined();
    const gap = screen
      .getAllByTestId("kpi-card")
      .find(
        (c) => within(c).getByTestId("kpi-label").textContent === "Gap to plan",
      )!;
    expect(within(gap).queryByRole("button")).toBeNull();
  });

  it("without a folder id the cards are plain (Customize mode)", () => {
    renderPanel({ folderId: undefined });
    expect(screen.queryAllByTestId("kpi-open")).toHaveLength(0);
  });

  it("opens the items in place: one bounded read in the card's scope, each row naming item and board and linking to it", async () => {
    getFolderKpiItems.mockResolvedValue({
      ok: true,
      data: { rows: [item(1), item(2)], total: k.overdue },
    });
    renderPanel({ stage: "build", board: "b1" });
    fireEvent.click(openButton(/overdue item/));
    await waitFor(() =>
      expect(screen.getAllByTestId("kpi-item")).toHaveLength(2),
    );
    expect(getFolderKpiItems).toHaveBeenCalledTimes(1);
    expect(getFolderKpiItems).toHaveBeenCalledWith({
      folderId: "f1",
      kpi: "overdue",
      boardId: "b1",
      stageKey: "build",
      limit: KPI_PAGE,
      offset: 0,
    });
    const first = screen.getAllByTestId("kpi-item")[0]!;
    expect(within(first).getByRole("link", { name: "Item 1" })).toHaveAttribute(
      "href",
      "/boards/b1?item=i1",
    );
    expect(first).toHaveTextContent("Backend · Build");
    expect(first).toHaveTextContent("due Sep 1 · 14d late");
    // The control now says it closes, and points at the region it opened.
    const btn = openButton(/^Hide the .* overdue item/);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(btn.getAttribute("aria-controls")!)).toBe(
      screen.getByTestId("kpi-items"),
    );
  });

  it("says 'Showing 50 of 70' and pages with Show more, never refetching what it has", async () => {
    const page = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => item(from + i));
    getFolderKpiItems.mockImplementation(async (q: { offset: number }) => ({
      ok: true,
      data: {
        rows: q.offset === 0 ? page(0, 50) : page(q.offset, 20),
        total: 70,
      },
    }));
    renderPanel();
    fireEvent.click(openButton(/overdue item/));
    await waitFor(() =>
      expect(screen.getByTestId("kpi-items-count")).toHaveTextContent(
        "Showing 50 of 70.",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Show 20 more" }));
    await waitFor(() =>
      expect(screen.getByTestId("kpi-items-count")).toHaveTextContent(
        "Showing 70 of 70.",
      ),
    );
    expect(getFolderKpiItems).toHaveBeenCalledTimes(2);
    expect(getFolderKpiItems.mock.calls[1]![0]).toMatchObject({ offset: 50 });
    expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();
  });

  it("states it when the list's total is not the card's number", async () => {
    getFolderKpiItems.mockResolvedValue({
      ok: true,
      data: { rows: [item(1)], total: k.overdue + 3 },
    });
    renderPanel();
    fireEvent.click(openButton(/overdue item/));
    await waitFor(() =>
      expect(screen.getByTestId("kpi-items-count")).toHaveTextContent(
        `The card says ${k.overdue}: the folder changed after this page loaded.`,
      ),
    );
  });

  it("says nothing extra when the total equals the card", async () => {
    getFolderKpiItems.mockResolvedValue({
      ok: true,
      data: { rows: [item(1)], total: k.overdue },
    });
    renderPanel();
    fireEvent.click(openButton(/overdue item/));
    await waitFor(() => screen.getByTestId("kpi-items-count"));
    expect(screen.getByTestId("kpi-items-count").textContent).toBe(
      `Showing 1 of ${k.overdue}.`,
    );
  });

  it("shows the reason and a Retry when the list cannot be read (a database without the function)", async () => {
    getFolderKpiItems.mockResolvedValueOnce({
      ok: false,
      error: "This list is not available yet. Try again later.",
    });
    getFolderKpiItems.mockResolvedValueOnce({
      ok: true,
      data: { rows: [item(1)], total: 1 },
    });
    renderPanel();
    fireEvent.click(openButton(/overdue item/));
    await waitFor(() =>
      expect(
        screen.getByText(/This list is not available yet/),
      ).toBeInTheDocument(),
    );
    // The cards themselves are untouched.
    expect(screen.getAllByTestId("kpi-card").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(screen.getAllByTestId("kpi-item")).toHaveLength(1),
    );
  });

  it("closes from its own button and from the card, and switching cards reads the other list", async () => {
    getFolderKpiItems.mockResolvedValue({
      ok: true,
      data: { rows: [item(1)], total: 1 },
    });
    renderPanel();
    fireEvent.click(openButton(/overdue item/));
    await waitFor(() => screen.getByTestId("kpi-item"));
    fireEvent.click(screen.getByRole("button", { name: "Close the list" }));
    expect(screen.queryByTestId("kpi-items")).toBeNull();

    fireEvent.click(openButton(/done item/));
    await waitFor(() =>
      expect(getFolderKpiItems).toHaveBeenLastCalledWith(
        expect.objectContaining({ kpi: "done" }),
      ),
    );
    expect(
      screen.getByRole("region", { name: "Complete: items" }),
    ).toBeInTheDocument();
    fireEvent.click(openButton(/^Hide the .* done item/));
    expect(screen.queryByTestId("kpi-items")).toBeNull();
  });

  it("a filter change re-reads the open list in the new scope", async () => {
    getFolderKpiItems.mockResolvedValue({
      ok: true,
      data: { rows: [item(1)], total: 1 },
    });
    const { rerender } = renderPanel();
    fireEvent.click(openButton(/overdue item/));
    await waitFor(() => screen.getByTestId("kpi-item"));
    rerender({ board: "b1" });
    await waitFor(() =>
      expect(getFolderKpiItems).toHaveBeenLastCalledWith(
        expect.objectContaining({ boardId: "b1", offset: 0 }),
      ),
    );
  });
});

describe("itemFact", () => {
  it("states the fact that puts the item in the list", () => {
    expect(itemFact("overdue", item(1), "2026-09-15")).toBe(
      "due Sep 1 · 14d late",
    );
    expect(
      itemFact(
        "due_this_week",
        item(1, { dueOn: "2026-09-17", isOverdue: false }),
        "2026-09-15",
      ),
    ).toBe("due Sep 17");
    expect(
      itemFact(
        "done",
        item(1, { doneOn: "2026-09-12", isDone: true }),
        "2026-09-15",
      ),
    ).toBe("done Sep 12");
    expect(itemFact("done", item(1, { isDone: true }), "2026-09-15")).toBe(
      "done",
    );
    expect(itemFact("stale", item(1), "2026-09-30")).toBe("untouched 20d");
    expect(
      itemFact(
        "blocked",
        item(1, { dueOn: null, isOverdue: false }),
        "2026-09-15",
      ),
    ).toBe("no due date");
  });
});
