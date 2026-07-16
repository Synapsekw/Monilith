import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { TimeCard } from "./TimeCard";
import { formatHours } from "@/lib/time/hours";
import type { TimeCardData } from "@/lib/time/types";
import { upsertTimeAllocation, deleteTimeAllocation } from "@/lib/time/actions";

// Resolve the actions so commit paths reach reconcile + scheduleRefresh. The
// upsert echoes the written seconds (server writes exactly what we sent), so the
// durable overlay reconciles to the same value it optimistically showed.
vi.mock("@/lib/time/actions", () => ({
  upsertTimeAllocation: vi.fn(async (input: { hours: number }) => ({
    ok: true,
    data: { durationSecs: Math.round(input.hours * 3600) },
  })),
  deleteTimeAllocation: vi.fn(async () => ({ ok: true, data: null })),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

const DAYS = ["2026-06-29", "2026-06-30", "2026-07-01"]; // Mon..Wed

/** Expected footer/total label, mirroring the component's `formatHours(x) || "0"}h`. */
const label = (secs: number) => `${formatHours(secs) || "0"}h`;

function makeData(day1Secs: number): TimeCardData {
  return {
    weekStart: DAYS[0],
    userId: "user-1",
    days: DAYS,
    rows: [
      {
        key: "cat:Design",
        kind: "category",
        itemId: null,
        boardId: null,
        boardName: null,
        category: "Design",
        label: "Design",
        cells: [
          { day: DAYS[0], manualSecs: day1Secs, timerSecs: 0 },
          { day: DAYS[1], manualSecs: 3600, timerSecs: 0 },
          { day: DAYS[2], manualSecs: 0, timerSecs: 0 },
        ],
        totalSecs: day1Secs + 3600,
      },
    ],
  };
}

/** Set the cell input at `index` to `value` and commit it on blur, flushing the
 * awaited action + reconcile via an async act(). */
async function commitCellValue(index: number, value: string) {
  const input = screen.getAllByRole("textbox")[index];
  await act(async () => {
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
  });
}

describe("TimeCard optimistic totals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the seeded row, daily, and week totals", () => {
    // day1 2.5h + day2 1h = 3.5h row & week total.
    render(<TimeCard data={makeData(9000)} categories={[]} />);

    // Row total (3.5h) and week total (3.5h) are the two 3.5h labels.
    expect(screen.getAllByText(label(12600))).toHaveLength(2);
    // Daily totals.
    expect(screen.getByText(label(9000))).toBeInTheDocument(); // day1 2.5h
    expect(screen.getByText(label(3600))).toBeInTheDocument(); // day2 1h
  });

  it("renders the Total header label with the Keystone kicker recipe", () => {
    render(<TimeCard data={makeData(9000)} categories={[]} />);

    const total = screen.getByText("Total");
    expect(total.className).toContain("font-mono");
    expect(total.className).toContain("text-kicker");
  });

  it("updates row Total, daily total, and week total synchronously on commit", () => {
    render(<TimeCard data={makeData(9000)} categories={[]} />);

    const inputs = screen.getAllByRole("textbox");
    const day1 = inputs[0];

    act(() => {
      fireEvent.change(day1, { target: { value: "3" } });
      fireEvent.blur(day1);
    });

    // Overlay is applied synchronously on commit. day1 now 3h (10800), day2 1h
    // → row/week total 4h (14400).
    expect(screen.getAllByText(label(14400))).toHaveLength(2); // row + week = 4h
    expect(screen.getByText(label(10800))).toBeInTheDocument(); // day1 3h
    expect(screen.getByText(label(3600))).toBeInTheDocument(); // day2 unchanged 1h

    // And the action fired with the committed hours (not seconds).
    expect(vi.mocked(upsertTimeAllocation)).toHaveBeenCalledWith(
      expect.objectContaining({
        workDate: DAYS[0],
        category: "Design",
        hours: 3,
      }),
    );
  });

  it("drops totals to zero optimistically when a cell is cleared", () => {
    // Seed day1 = 2.5h so clearing it is observable.
    render(<TimeCard data={makeData(9000)} categories={[]} />);

    const inputs = screen.getAllByRole("textbox");
    const day1 = inputs[0];

    act(() => {
      fireEvent.change(day1, { target: { value: "" } });
      fireEvent.blur(day1);
    });

    // day1 → 0, so row/week total collapse to just day2's 1h (3600).
    expect(screen.getAllByText(label(3600))).toHaveLength(3); // day2 + row + week
    expect(vi.mocked(deleteTimeAllocation)).toHaveBeenCalledWith(
      expect.objectContaining({ workDate: DAYS[0], category: "Design" }),
    );
  });
});

describe("coalesced refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not refresh per cell edit; one refresh ~2s after the last commit", async () => {
    vi.useFakeTimers();
    try {
      render(<TimeCard data={makeData(0)} categories={[]} />);
      await commitCellValue(0, "2");
      await commitCellValue(1, "1.5");
      // Two commits, still no refresh — the debounce keeps rescheduling.
      expect(refresh).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the committed value visible after the transition settles (durable overlay)", async () => {
    render(<TimeCard data={makeData(0)} categories={[]} />);
    await commitCellValue(0, "2");
    // 2h reconciled from the action's durationSecs is still shown (day total).
    expect(screen.getByText(/2h/)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
