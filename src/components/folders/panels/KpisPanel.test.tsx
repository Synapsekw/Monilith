import { cleanup, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { statusToneClasses } from "@/components/ui/status-pill";
import type { BurnRow } from "@/lib/folders/types";
import { computeKpis } from "@/lib/folders/rollup";
import { FIXTURE_TODAY, folderFixture } from "@/lib/folders/fixture";
import { KpisPanel, trendColor } from "./KpisPanel";

const mockTrends = vi.hoisted(() => ({ short: false }));
vi.mock("@/lib/folders/tower", async (orig) => {
  const real = await orig<typeof import("@/lib/folders/tower")>();
  return {
    ...real,
    kpiTrends: (...a: Parameters<typeof real.kpiTrends>) => {
      const out = real.kpiTrends(...a);
      if (!mockTrends.short) return out;
      return Object.fromEntries(
        Object.entries(out).map(([k, t]) => [
          k,
          { ...t, points: t!.points.slice(0, 1) },
        ]),
      );
    },
  };
});

/** Weeks start on Mondays; FIXTURE_TODAY (Tue 2026-09-15) sits in 09-14. */
function burnRows(weeks: [string, number, number, number][]): BurnRow[] {
  return weeks.map(([weekStart, planned, completed, overdueOpen]) => ({
    stageKey: "s",
    weekStart,
    planned,
    completed,
    overdueOpen,
  }));
}
const COVERS_TODAY = burnRows([
  ["2026-08-24", 2, 2, 0],
  ["2026-08-31", 3, 2, 1],
  ["2026-09-07", 3, 3, 2],
  ["2026-09-14", 4, 4, 3],
  ["2026-09-21", 5, 0, 0],
  ["2026-09-28", 1, 0, 0],
]);
const ENDS_BEFORE_TODAY = COVERS_TODAY.slice(0, 3);

function pill(text: string) {
  return screen.getByText(text);
}
function expectTone(el: HTMLElement, color: "green" | "red" | "blue" | "gray") {
  for (const c of statusToneClasses(color, "soft").split(" ").filter(Boolean))
    expect(el).toHaveClass(c);
}

const fx = folderFixture();
const k = computeKpis(fx.rollup!, FIXTURE_TODAY);
const all = [
  "complete",
  "gap",
  "overdue",
  "dueThisWeek",
  "blocked",
  "stale",
] as const;

function renderPanel(patch: Partial<Parameters<typeof KpisPanel>[0]> = {}) {
  render(
    <KpisPanel
      cards={[...all]}
      rows={fx.rollup!}
      todayISO={FIXTURE_TODAY}
      failed={false}
      onRetry={vi.fn()}
      {...patch}
    />,
  );
}

describe("KpisPanel", () => {
  it("draws four sparklines for a normal folder", () => {
    renderPanel({ burn: COVERS_TODAY, stage: null, board: null });
    expect(screen.getAllByRole("img")).toHaveLength(4);
  });

  it("ends every sparkline on the number its card shows", () => {
    renderPanel({ burn: COVERS_TODAY, stage: null, board: null });
    const series = (name: RegExp) =>
      screen
        .getByRole("img", { name })
        .getAttribute("aria-label")!
        .split(": ")[1]!
        .split(", ")
        .map(Number);
    expect(series(/^Complete/).at(-1)).toBe(k.donePct);
    expect(series(/^Gap to plan/).at(-1)).toBe(k.gap);
    expect(series(/^Overdue/).at(-1)).toBe(k.overdue);
    expect(series(/^Due this week/)[0]).toBe(k.dueThisWeek);
  });

  it("states more overdue as a red pill and more complete as a green one", () => {
    // Last week: one fewer overdue than the card, and one item complete. The
    // first week has a real completion, so history starts there (the
    // real-activity rule drops weeks before any activity).
    const burn = burnRows([
      ["2026-08-31", 3, 1, 0],
      ["2026-09-07", 3, 0, k.overdue - 1],
      ["2026-09-14", 4, 4, 0],
      ["2026-09-21", 5, 0, 0],
    ]);
    renderPanel({ burn });
    expectTone(pill("+1 this week"), "red");
    const before = Math.round((1 / k.total) * 100);
    expectTone(pill(`+${k.donePct! - before} pts this week`), "green");
    expectTone(pill("5 next week"), "blue");
  });

  it("states fewer overdue as a green pill and an unchanged gap as flat", () => {
    // Gap last week equal to the card's gap: completed − planned = k.gap.
    const burn = burnRows([
      ["2026-08-31", 0, 0, 0],
      ["2026-09-07", -k.gap!, 0, k.overdue + 1],
      ["2026-09-14", 4, 4, 0],
    ]);
    renderPanel({ burn });
    expectTone(pill("−1 this week"), "green");
    expectTone(pill("flat"), "gray");
  });

  it("hides the overdue trend while folder_burn has no overdue_open", () => {
    const burn = COVERS_TODAY.map(({ overdueOpen: _o, ...r }) => r);
    renderPanel({ burn });
    expect(screen.queryByRole("img", { name: /^Overdue/ })).toBeNull();
    expect(screen.getByRole("img", { name: /^Complete/ })).toBeInTheDocument();
  });

  it("draws no sparklines and no pills when burn is null", () => {
    renderPanel({ burn: null });
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    expect(screen.queryByText(/^[+−]\d+ this week$/)).toBeNull();
    expect(screen.queryByText("flat")).toBeNull();
    expect(screen.queryByText(/next week/)).toBeNull();
  });

  it("keeps the due card without a sparkline when burn stops before today", () => {
    renderPanel({ burn: ENDS_BEFORE_TODAY });
    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(screen.queryByRole("img", { name: /Due this week/ })).toBeNull();
    const labels = screen.getAllByTestId("kpi-label").map((n) => n.textContent);
    expect(labels).toContain("Due this week");
    expect(screen.queryByText(/next week/)).toBeNull();
  });

  it("omits a trend with fewer than two points and falls back to the bar", () => {
    mockTrends.short = true;
    try {
      renderPanel({ burn: COVERS_TODAY });
      expect(screen.queryAllByRole("img")).toHaveLength(0);
      expect(screen.queryByText("+1 this week")).toBeNull();
      expect(screen.queryByText("flat")).toBeNull();
      expect(screen.getAllByRole("progressbar").length).toBeGreaterThan(0);
    } finally {
      mockTrends.short = false;
    }
  });

  it("draws no sparkline while a board filter is set or burn is missing", () => {
    renderPanel({ burn: COVERS_TODAY, stage: null, board: "b1" });
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    expect(screen.queryByText("+1 this week")).toBeNull();
  });

  it("collapses zero cards into chips and keeps their labels findable", () => {
    const rows = fx.rollup!.map((r) => ({ ...r, blocked: 0, stale: 0 }));
    renderPanel({ rows });
    const chips = screen.getAllByTestId("kpi-chip").map((c) => c.textContent);
    expect(chips).toEqual(expect.arrayContaining(["Blocked: 0", "Stale: 0"]));
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    const blocked = screen
      .getAllByTestId("kpi-chip")
      .find((c) => c.textContent?.startsWith("Blocked"))!;
    expect(blocked).toHaveTextContent("Blocked: 0");
    expect(within(blocked).getByText(":", { exact: false })).toHaveClass(
      "sr-only",
    );
    const cardLabels = screen
      .getAllByTestId("kpi-label")
      .map((n) => n.textContent);
    expect(cardLabels).not.toContain("Blocked");
    expect(cardLabels).toContain("Complete");
  });

  it("says so when the folder has no due dates", () => {
    const rows = fx.rollup!.map((r) => ({
      ...r,
      minDue: null,
      maxDue: null,
      plannedByToday: 0,
      overdue: 0,
      dueThisWeek: 0,
      dueThisWeekNotStarted: 0,
      oldestOverdue: null,
    }));
    renderPanel({ rows });
    expect(screen.getByText("No due dates set")).toBeInTheDocument();
    const cardLabels = screen
      .getAllByTestId("kpi-label")
      .map((n) => n.textContent);
    expect(cardLabels).not.toContain("Gap to plan");
    expect(cardLabels).not.toContain("Overdue");
    // "No due dates set" already explains it; no "Gap to plan —" chip.
    const chips = screen.getAllByTestId("kpi-chip").map((c) => c.textContent);
    expect(chips.some((c) => c?.startsWith("Gap to plan"))).toBe(false);
  });

  it("shows the no-due-dates chip only for a folder that has items", () => {
    const undated = fx.rollup!.map((r) => ({
      ...r,
      minDue: null,
      maxDue: null,
    }));
    const empty = undated.map((r) => ({
      ...r,
      total: 0,
      done: 0,
      inProgress: 0,
      overdue: 0,
      notStarted: 0,
      blocked: 0,
      stale: 0,
      unassigned: 0,
      incomplete: 0,
      plannedByToday: 0,
      dueThisWeek: 0,
      dueThisWeekNotStarted: 0,
      oldestOverdue: null,
    }));
    renderPanel({ rows: empty });
    expect(screen.queryByText("No due dates set")).toBeNull();
    cleanup();
    renderPanel({ rows: undated });
    expect(screen.getByText("No due dates set")).toBeInTheDocument();
  });

  it("colours the gap sparkline by the sign of the current gap", () => {
    expect(trendColor("gap", { ...k, gap: -3 })).toBe("red");
    expect(trendColor("gap", { ...k, gap: 4 })).toBe("green");
    expect(trendColor("gap", { ...k, gap: 0 })).toBe("green");
    expect(trendColor("overdue", k)).toBe("red");
    expect(trendColor("complete", k)).toBe("green");
    // Rendered: the fixture is behind plan, so its gap line is red.
    renderPanel({ burn: COVERS_TODAY });
    const gap = screen.getByRole("img", { name: /^Gap to plan/ });
    expect(gap.getAttribute("style")).toContain(
      `--status-${k.gap! < 0 ? "red" : "green"}`,
    );
  });

  it("lays the cards out so any count from 1 to 6 fills the row", () => {
    for (const n of [1, 4, 6]) {
      const { container, unmount } = render(
        <KpisPanel
          cards={[...all].slice(0, n)}
          rows={fx.rollup!}
          todayISO={FIXTURE_TODAY}
          failed={false}
          onRetry={vi.fn()}
        />,
      );
      const grid = container.querySelector("[data-testid='kpi-cards']")!;
      // One row of equal columns at lg+, whatever the count; 2-up on phones.
      // (Real geometry is measured in Chromium, see the browser-fix report.)
      for (const c of [
        "grid-cols-2",
        "sm:grid-cols-3",
        "lg:grid-cols-none",
        "lg:grid-flow-col",
        "lg:auto-cols-fr",
      ])
        expect(grid).toHaveClass(c);
      expect(grid.className).not.toMatch(/auto-fit|(md|xl):grid-cols-\d/);
      unmount();
    }
  });

  it("only considers the cards the layout names", () => {
    const rows = fx.rollup!.map((r) => ({ ...r, stale: 0 }));
    renderPanel({ rows, cards: ["complete", "overdue"] });
    expect(screen.queryByText("Stale")).toBeNull();
  });
});
