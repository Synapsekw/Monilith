import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ChartLegend,
  type ChartLegendEntry,
} from "@/components/dashboards/widgets/ChartLegend";

const entries: ChartLegendEntry[] = [
  { key: "a", label: "Backlog", color: "#9ca3af", value: 14 },
  { key: "b", label: "In Progress", color: "#3b82f6", value: 9 },
  { key: "c", label: "Done", color: "#22c55e", value: 1200 },
];

/** jsdom lays nothing out, so the scroll box is injected. */
function stubScrollBox(scrollHeight: number, clientHeight: number) {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(
    scrollHeight,
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(
    clientHeight,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChartLegend side placement", () => {
  /**
   * The side legend is a column flexbox that scrolls. Centring its items on
   * the main axis (`justify-center`) puts the overflow on BOTH ends, and the
   * half above the scroll origin can never be scrolled to — the first entries
   * were simply cut off. The list is centred by `self-center` on the list box
   * itself instead, and its content always starts at the top of that box.
   */
  it("starts its column at the top of the scroller instead of centring the overflow", () => {
    render(<ChartLegend entries={entries} placement="auto" />);
    const classes = screen
      .getByRole("list", { name: "Legend" })
      .className.split(/\s+/);
    expect(classes).toContain("@md:flex-col");
    expect(classes).toContain("overflow-y-auto");
    expect(classes).toContain("@md:justify-start");
    expect(classes).not.toContain("@md:justify-center");
    // Still vertically centred beside the chart while it fits.
    expect(classes).toContain("@md:self-center");
    expect(classes).toContain("@md:max-h-full");
  });

  it("leaves the bottom placement a centred wrapping row", () => {
    render(<ChartLegend entries={entries} placement="bottom" />);
    const classes = screen
      .getByRole("list", { name: "Legend" })
      .className.split(/\s+/);
    expect(classes).toContain("justify-center");
    expect(classes).toContain("content-start");
    expect(classes.filter((c) => c.startsWith("@md:"))).toEqual([]);
  });
});

describe("ChartLegend keyboard reach", () => {
  it.each(["auto", "bottom"] as const)(
    "is a labelled, focusable scroll region when its entries overflow (%s)",
    (placement) => {
      stubScrollBox(240, 96);
      render(<ChartLegend entries={entries} placement={placement} />);
      const list = screen.getByRole("list", { name: "Legend" });
      expect(list).toHaveAttribute("tabindex", "0");
      expect(list).toHaveClass(
        "focus-visible:ring-2",
        "focus-visible:ring-ring",
        "focus-visible:outline-none",
      );
      list.focus();
      expect(list).toHaveFocus();
    },
  );

  it("adds no tab stop when every entry fits", () => {
    stubScrollBox(96, 96);
    render(<ChartLegend entries={entries} placement="auto" />);
    expect(screen.getByRole("list", { name: "Legend" })).not.toHaveAttribute(
      "tabindex",
    );
  });
});

describe("ChartLegend values", () => {
  it("renders the value when an entry carries one", () => {
    render(<ChartLegend entries={entries} />);
    expect(
      screen.getAllByTestId("chart-legend-value").map((n) => n.textContent),
    ).toEqual(["14", "9", "1,200"]);
  });

  it("renders name and colour key only when an entry has no value", () => {
    render(
      <ChartLegend
        entries={entries.map((e) => ({
          key: e.key,
          label: e.label,
          color: e.color,
        }))}
      />,
    );
    expect(screen.queryAllByTestId("chart-legend-value")).toHaveLength(0);
    expect(
      screen.getAllByTestId("chart-legend-name").map((n) => n.textContent),
    ).toEqual(["Backlog", "In Progress", "Done"]);
    expect(screen.getAllByTestId("chart-legend-key")).toHaveLength(3);
  });
});
