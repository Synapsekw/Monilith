import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoalDetailDrawer } from "@/components/goals/GoalDetailDrawer";
import type { GoalNode, RowOwner } from "@/lib/goals/types";
import type { GoalLink } from "@/lib/goals/queries";

const setGoalLinks = vi.fn().mockResolvedValue({ ok: true, data: null });
const getStatusColumnsForBoard = vi.fn();
const updateGoal = vi.fn().mockResolvedValue({ ok: true, data: null });

vi.mock("@/lib/goals/actions", () => ({
  setGoalLinks: (...a: unknown[]) => setGoalLinks(...a),
  getStatusColumnsForBoard: (...a: unknown[]) => getStatusColumnsForBoard(...a),
  updateGoal: (...a: unknown[]) => updateGoal(...a),
  deleteGoal: vi.fn().mockResolvedValue({ ok: true, data: null }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams("goal=g1"),
}));

// NewGoalDialog pulls in extra deps; stub it for this drawer test.
vi.mock("@/components/goals/NewGoalDialog", () => ({
  NewGoalDialog: () => null,
}));

const BOARD_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const COL_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const OPT_WORKING = "dddddddd-0000-0000-0000-000000000001";
const OPT_DONE = "dddddddd-0000-0000-0000-000000000002";

const goal: GoalNode = {
  id: "g1",
  parentGoalId: null,
  name: "Ship v1",
  description: null,
  ownerId: "u1",
  workspaceId: null,
  progressMode: "auto_boards",
  status: "on_track",
  startValue: null,
  currentValue: null,
  targetValue: null,
  unit: null,
  percent: null,
  startDate: null,
  dueDate: null,
  position: 0,
  children: [],
  progress: 0.5,
  autoHealth: "on_track",
  owner: null,
};

const members: RowOwner[] = [
  { userId: "u1", fullName: "Dani", email: "d@x.io", avatarUrl: null },
];
const boards = [{ id: BOARD_ID, name: "Engineering" }];
const links: Record<string, GoalLink[]> = {
  g1: [{ boardId: BOARD_ID, doneColumnId: COL_ID, doneOptionIds: [OPT_DONE] }],
};

beforeEach(() => {
  setGoalLinks.mockClear();
  updateGoal.mockClear().mockResolvedValue({ ok: true, data: null });
  getStatusColumnsForBoard.mockClear();
  getStatusColumnsForBoard.mockResolvedValue({
    ok: true,
    data: {
      columns: [
        {
          id: COL_ID,
          name: "Status",
          options: [
            { id: OPT_WORKING, label: "Working", color: "#3b82f6" },
            { id: OPT_DONE, label: "Done", color: "#22c55e" },
          ],
        },
      ],
    },
  });
});
afterEach(() => vi.clearAllMocks());

function renderDrawer() {
  return render(
    <GoalDetailDrawer
      tree={[goal]}
      members={members}
      boards={boards}
      links={links}
    />,
  );
}

describe("GoalDetailDrawer done-mapping", () => {
  it("lists the linked board and expands to show the persisted mapping", async () => {
    renderDrawer();
    expect(screen.getByText("Engineering")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", {
        name: /edit done mapping for engineering/i,
      }),
    );
    await waitFor(() =>
      expect(getStatusColumnsForBoard).toHaveBeenCalledWith(BOARD_ID),
    );
    expect(
      await screen.findByRole("checkbox", { name: /done/i }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /working/i }),
    ).not.toBeChecked();
  });

  it("toggling an option persists the full links array via setGoalLinks", async () => {
    renderDrawer();
    await userEvent.click(
      screen.getByRole("button", {
        name: /edit done mapping for engineering/i,
      }),
    );
    await userEvent.click(
      await screen.findByRole("checkbox", { name: /working/i }),
    );
    await waitFor(() => expect(setGoalLinks).toHaveBeenCalled());
    expect(setGoalLinks).toHaveBeenCalledWith({
      goalId: "g1",
      links: [
        {
          boardId: BOARD_ID,
          doneColumnId: COL_ID,
          doneOptionIds: [OPT_DONE, OPT_WORKING],
        },
      ],
    });
  });

  it("reverts the edited field and shows an error when updateGoal fails", async () => {
    updateGoal.mockResolvedValueOnce({ ok: false, error: "Save failed" });
    renderDrawer();
    const nameInput = screen.getByDisplayValue("Ship v1");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Ship v2");
    // Blur to fire the onBlur → patch().
    await userEvent.tab();
    await waitFor(() => expect(updateGoal).toHaveBeenCalled());
    // Name reverts to the server truth and the failure is surfaced.
    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
    expect(screen.getByDisplayValue("Ship v1")).toBeInTheDocument();
  });

  it("does not refetch columns when re-expanding the same board", async () => {
    renderDrawer();
    const toggle = screen.getByRole("button", {
      name: /edit done mapping for engineering/i,
    });
    await userEvent.click(toggle); // expand
    await waitFor(() =>
      expect(getStatusColumnsForBoard).toHaveBeenCalledTimes(1),
    );
    await userEvent.click(toggle); // collapse
    await userEvent.click(toggle); // expand again
    expect(getStatusColumnsForBoard).toHaveBeenCalledTimes(1);
  });
});
