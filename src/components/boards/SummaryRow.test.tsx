import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  SummaryRow,
  hasAssignedSummary,
  type SummaryRowProps,
} from "@/components/boards/SummaryRow";
import type { Column } from "@/lib/boards/queries";
import type { BoardCache, CacheCellValue } from "@/lib/boards/cache";

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Two "numbers" columns: colA carries summary_aggregation "sum", colB none.
// Items i1..i3 hold colA values 1, 2, 3 — a group scoped to [i1, i2] sums to 3
// (NOT the board-wide 6), which is exactly what the group variant must show.

function col(
  id: string,
  kind: string,
  settings: Record<string, unknown>,
): Column {
  return {
    id,
    board_id: "b1",
    org_id: "o1",
    kind,
    name: id,
    settings,
    position: 0,
    width: null,
  } as unknown as Column;
}

const colA = col("colA", "numbers", { summary_aggregation: "sum" });
const colB = col("colB", "numbers", {});
const colAED = col("colAED", "currency", {
  currency: "AED",
  summary_aggregation: "sum",
});

const cache = {
  board: { id: "b1", org_id: "o1", name: "Board" },
  groups: [],
  columns: [colA, colB, colAED],
  items: [],
  cellValues: [],
  dependencies: [],
  attachments: [],
  timeEntries: [],
  relationLinks: [],
  mirrorTargetCells: [],
  mirrorTargetColumns: [],
} as unknown as BoardCache;

const cellMap = new Map<string, CacheCellValue["value"]>([
  ["i1:colA", { n: 1 }],
  ["i2:colA", { n: 2 }],
  ["i3:colA", { n: 3 }],
  ["i1:colAED", { amount: 10 }],
  ["i2:colAED", { amount: 20 }],
]);

const template = "200px 180px 180px 180px 180px 44px";

function baseProps(over: Partial<SummaryRowProps> = {}): SummaryRowProps {
  return {
    variant: "group",
    testId: "group-summary-g1",
    label: "Summary",
    columns: [colA, colB],
    itemIds: ["i1", "i2"],
    cellMap,
    cache,
    template,
    nameWidth: 200,
    canEdit: true,
    nowMs: 0,
    onChange: vi.fn(),
    ...over,
  };
}

describe("hasAssignedSummary", () => {
  it("is true only when some column carries summary_aggregation", () => {
    expect(hasAssignedSummary([colA, colB])).toBe(true);
    expect(hasAssignedSummary([colB])).toBe(false);
    expect(hasAssignedSummary([])).toBe(false);
  });
});

describe("SummaryRow", () => {
  it("renders the assigned aggregate over exactly the given itemIds", () => {
    render(<SummaryRow {...baseProps()} />);
    // group-scoped: only i1 + i2 → 3, not the board-wide total (6)
    const row = screen.getByTestId("group-summary-g1");
    expect(row).toHaveTextContent("Sum");
    expect(row).toHaveTextContent("3");
    expect(row).not.toHaveTextContent("6");
  });

  it("group variant paints the group color bar on the frozen name track", () => {
    render(<SummaryRow {...baseProps({ groupColor: "#f00" })} />);
    // name track carries the inset box-shadow like GroupHeaderRow/GroupRollupRow
    const row = screen.getByTestId("group-summary-g1");
    const nameTrack = row.firstElementChild as HTMLElement;
    expect(nameTrack).toHaveTextContent("Summary");
    expect(nameTrack).toHaveStyle({ boxShadow: "inset 3px 0 0 0 #f00" });
  });

  it("board variant is sticky at the bottom and skips the color bar", () => {
    render(
      <SummaryRow
        {...baseProps({ variant: "board", testId: "board-summary-footer" })}
      />,
    );
    const row = screen.getByTestId("board-summary-footer");
    expect(row.className).toContain("sticky");
    const nameTrack = row.firstElementChild as HTMLElement;
    expect(nameTrack.style.boxShadow).toBe("");
  });

  it("editors can pick an aggregation; onChange fires with the column + choice", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SummaryRow {...baseProps({ onChange })} />);
    // colB is unset → its cell shows the editor-only "Summary" affordance
    // ([0] is the frozen name-track label, [1] is colB's affordance).
    await user.click(screen.getAllByText("Summary")[1]);
    await user.click(await screen.findByText("Average"));
    expect(onChange).toHaveBeenCalledWith(colB, "avg");
  });

  it("viewers get read-only cells (no dropdown trigger)", () => {
    render(<SummaryRow {...baseProps({ canEdit: false })} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("sums a currency column with currency formatting", () => {
    render(
      <SummaryRow
        {...baseProps({ columns: [colAED], itemIds: ["i1", "i2"] })}
      />,
    );
    // AED with dirham_sign absent (= ON) renders via CurrencyAmount
    const amount = screen.getByTestId("currency-amount");
    expect(amount).toHaveTextContent("30.00");
  });
});
