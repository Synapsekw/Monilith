import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkloadGrid } from "./WorkloadGrid";
import type {
  MemberCapacity,
  OrgWorkloadDefaults,
  WorkloadActualRow,
  WorkloadBoard,
  WorkloadMember,
  WorkloadRawRow,
  WorkloadWorkspace,
} from "@/lib/workload/types";

// Mutable search-param string the mocked useSearchParams reads from.
let searchParamsString = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(searchParamsString),
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

const H = 3600;

const members: WorkloadMember[] = [
  { userId: "u1", fullName: "Ann", email: null, avatarUrl: null },
];
const caps: MemberCapacity[] = [
  {
    userId: "u1",
    hoursPerDay: 8,
    workingDays: [1, 2, 3, 4, 5],
    customized: true,
  },
];
const defaults: OrgWorkloadDefaults = {
  hoursPerDay: 8,
  perItemHours: 4,
  workingDays: [1, 2, 3, 4, 5],
};
const boards: WorkloadBoard[] = [
  { id: "b1", name: "Board One", workspaceId: "w1" },
  { id: "b2", name: "Board Two", workspaceId: "w2" },
];
const workspaces: WorkloadWorkspace[] = [
  { id: "w1", name: "Alpha" },
  { id: "w2", name: "Beta" },
];

// One 8h item on each board, both assigned to u1, on a working day in-window.
const rawRows: WorkloadRawRow[] = [
  {
    itemId: "i1",
    boardId: "b1",
    itemName: "On b1",
    userId: "u1",
    startDate: "2026-06-15",
    endDate: "2026-06-15",
    estimateSecs: 8 * H,
  },
  {
    itemId: "i2",
    boardId: "b2",
    itemName: "On b2",
    userId: "u1",
    startDate: "2026-06-15",
    endDate: "2026-06-15",
    estimateSecs: 8 * H,
  },
];

function renderGrid(props?: { actuals?: WorkloadActualRow[] }) {
  return render(
    <WorkloadGrid
      rawRows={rawRows}
      actuals={props?.actuals ?? []}
      members={members}
      capacities={caps}
      defaults={defaults}
      boards={boards}
      workspaces={workspaces}
      today="2026-06-17"
      weeksBack={4}
      weeksFwd={4}
      weekStartsOn={1}
      currentUserId="u1"
      isOrgAdmin={false}
    />,
  );
}

describe("WorkloadGrid filtering (v2)", () => {
  beforeEach(() => {
    searchParamsString = "";
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("with no board filter, a member's total sums effort across all boards", () => {
    renderGrid();
    // 8h on b1 + 8h on b2 = 16h total for Ann
    expect(screen.getByText("16h")).toBeInTheDocument();
  });

  it("with board=b1, only that board's effort is counted (client recompute)", () => {
    searchParamsString = "board=b1";
    renderGrid();
    expect(screen.getByText("8h")).toBeInTheDocument();
    expect(screen.queryByText("16h")).not.toBeInTheDocument();
  });

  it("clicking a board option pushes ?board= via the History API (0 refetch)", async () => {
    const pushSpy = vi.spyOn(window.history, "pushState");
    renderGrid();
    await userEvent.click(
      screen.getByRole("button", { name: /filter by board/i }),
    );
    await userEvent.click(screen.getByRole("option", { name: /board one/i }));
    expect(pushSpy).toHaveBeenCalled();
    const url = new URL(pushSpy.mock.calls.at(-1)![2] as string, "http://x");
    expect(url.searchParams.get("board")).toBe("b1");
  });
});

describe("WorkloadGrid metric overlay (v2)", () => {
  beforeEach(() => {
    searchParamsString = "";
  });

  it("metric=actual surfaces logged actuals in the cells", () => {
    searchParamsString = "metric=actual";
    renderGrid({
      actuals: [
        { userId: "u1", boardId: "b1", day: "2026-06-15", secs: 5 * H },
      ],
    });
    // The actual-metric row total for Ann should reflect 5h logged.
    const cells = screen.getAllByTestId("capacity-cell");
    const hasActual = cells.some(
      (c) => c.getAttribute("data-metric") === "actual",
    );
    expect(hasActual).toBe(true);
    expect(screen.getByText("5h")).toBeInTheDocument();
  });
});
