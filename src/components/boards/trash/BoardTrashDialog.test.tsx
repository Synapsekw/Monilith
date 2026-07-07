import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BoardTrashDialog } from "./BoardTrashDialog";

const BOARD = "11111111-1111-1111-1111-111111111111";

function makeGroup() {
  return {
    id: "g1",
    board_id: BOARD,
    name: "Archived Group",
    org_id: "o1",
    color: "gray",
    position: 1,
    archived_at: "2026-07-06T10:00:00Z",
    archived_by: "u1",
    created_at: "2026-07-01T00:00:00Z",
  };
}

function makeItem() {
  return {
    id: "i1",
    board_id: BOARD,
    group_id: "g2",
    parent_id: null,
    name: "Archived Item",
    org_id: "o1",
    position: 1,
    archived_at: "2026-07-06T11:00:00Z",
    archived_by: "u1",
    created_at: "2026-07-01T00:00:00Z",
  };
}

const loadBoardTrash = vi.fn(async (..._a: unknown[]) => ({
  groups: [makeGroup()],
  items: [makeItem()],
}));
const restoreGroup = vi.fn(async (..._a: unknown[]) => ({
  ok: true,
  data: undefined,
}));
const restoreItem = vi.fn(async (..._a: unknown[]) => ({
  ok: true,
  data: undefined,
}));
const purgeGroup = vi.fn(async (..._a: unknown[]) => ({
  ok: true,
  data: undefined,
}));
const purgeItem = vi.fn(async (..._a: unknown[]) => ({
  ok: true,
  data: undefined,
}));

vi.mock("@/lib/boards/actions", () => ({
  loadBoardTrash: (...a: unknown[]) => loadBoardTrash(...a),
  restoreGroup: (...a: unknown[]) => restoreGroup(...a),
  restoreItem: (...a: unknown[]) => restoreItem(...a),
  purgeGroup: (...a: unknown[]) => purgeGroup(...a),
  purgeItem: (...a: unknown[]) => purgeItem(...a),
}));

const showMutationError = vi.fn();
vi.mock("@/lib/ui/mutation-toast", () => ({
  showMutationError: (...a: unknown[]) => showMutationError(...a),
}));

function renderOpen() {
  return render(
    <BoardTrashDialog boardId={BOARD} open onOpenChange={() => {}} />,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("BoardTrashDialog", () => {
  it("loads and renders archived groups and items", async () => {
    renderOpen();
    expect(loadBoardTrash).toHaveBeenCalledWith(BOARD);
    expect(await screen.findByText("Archived Group")).toBeInTheDocument();
    expect(screen.getByText("Archived Item")).toBeInTheDocument();
  });

  it("restores a group via its Restore button", async () => {
    renderOpen();
    const restore = await screen.findByRole("button", {
      name: /restore group Archived Group/i,
    });
    await userEvent.click(restore);
    await waitFor(() =>
      expect(restoreGroup).toHaveBeenCalledWith({ groupId: "g1" }),
    );
  });

  it("restores an item via its Restore button", async () => {
    renderOpen();
    const restore = await screen.findByRole("button", {
      name: /restore item Archived Item/i,
    });
    await userEvent.click(restore);
    await waitFor(() =>
      expect(restoreItem).toHaveBeenCalledWith({ itemId: "i1" }),
    );
  });

  it("permanently deletes a group after confirming", async () => {
    renderOpen();
    const del = await screen.findByRole("button", {
      name: /delete group Archived Group permanently/i,
    });
    await userEvent.click(del);
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: /delete permanently/i }),
    );
    await waitFor(() =>
      expect(purgeGroup).toHaveBeenCalledWith({ groupId: "g1" }),
    );
  });

  it("permanently deletes an item after confirming", async () => {
    renderOpen();
    const del = await screen.findByRole("button", {
      name: /delete item Archived Item permanently/i,
    });
    await userEvent.click(del);
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: /delete permanently/i }),
    );
    await waitFor(() =>
      expect(purgeItem).toHaveBeenCalledWith({ itemId: "i1" }),
    );
  });
});
