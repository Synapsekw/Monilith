import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BoardTable } from "./BoardTable";

// The tanstack virtualizer reads the scroll container's offset size to compute
// in-viewport rows; jsdom returns 0. Stub a real viewport so the group's item
// rows mount (mirrors BoardTable.test.tsx).
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return 600;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return 1200;
    },
  });
});

// dnd-kit passthrough: this suite drives the board's drag routing directly by
// invoking the captured onDragEnd, so we replace DndContext with a passthrough
// that stashes each context's onDragEnd keyed by its `id` prop. Everything else
// (DragOverlay, useDroppable, collision helpers) stays real.
const dndOnDragEnd: Record<string, ((e: unknown) => void) | undefined> = {};
vi.mock("@dnd-kit/core", async () => {
  const actual =
    await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  return {
    ...actual,
    DndContext: ({
      id,
      children,
      onDragEnd,
    }: {
      id?: string;
      children?: ReactNode;
      onDragEnd?: (e: unknown) => void;
    }) => {
      if (id) dndOnDragEnd[id] = onDragEnd;
      return children;
    },
  };
});

// Board mutations run through these server actions; stub them so jsdom doesn't
// load server-only code and so we can assert which one a drop routed to.
const moveItem = vi.fn();
const reorderItem = vi.fn();
const reorderGroup = vi.fn();
vi.mock("@/lib/boards/actions", () => ({
  createGroup: vi.fn(),
  updateGroupColor: vi.fn(),
  deleteGroup: vi.fn(),
  addSubitem: vi.fn(),
  deleteItem: vi.fn(),
  moveItem: (...a: unknown[]) => moveItem(...a),
  reorderItem: (...a: unknown[]) => reorderItem(...a),
  reorderGroup: (...a: unknown[]) => reorderGroup(...a),
  updateColumnSettings: vi.fn(),
}));

vi.mock("@/lib/boards/dependency-actions", () => ({
  createDependency: vi.fn(),
  deleteDependency: vi.fn(),
}));

vi.mock("@/lib/collaboration/actions", () => ({
  createAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  getAttachmentDownloadUrl: vi.fn(),
  getAttachmentPreviewUrls: vi
    .fn()
    .mockResolvedValue({ ok: true, data: { urls: {} } }),
}));

vi.mock("./BoardHeader", () => ({
  BoardHeader: () => <div data-testid="board-header" />,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

function twoGroupPayload() {
  return {
    board: { id: "b1", org_id: "o1", name: "Board", name_column_width: null },
    groups: [
      {
        id: "g1",
        board_id: "b1",
        org_id: "o1",
        name: "Group 1",
        color: "#0073ea",
        position: 0,
      },
      {
        id: "g2",
        board_id: "b1",
        org_id: "o1",
        name: "Group 2",
        color: "#00c875",
        position: 1,
      },
    ],
    columns: [],
    items: [
      {
        id: "i1",
        board_id: "b1",
        org_id: "o1",
        group_id: "g1",
        parent_id: null,
        name: "Item 1",
        position: 0,
      },
      {
        id: "i2",
        board_id: "b1",
        org_id: "o1",
        group_id: "g2",
        parent_id: null,
        name: "Item 2",
        position: 10,
      },
      {
        id: "i3",
        board_id: "b1",
        org_id: "o1",
        group_id: "g2",
        parent_id: null,
        name: "Item 3",
        position: 20,
      },
    ],
    cellValues: [],
    dependencies: [],
    views: [],
  } as never;
}

function renderTwoGroups() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardTable payload={twoGroupPayload()} selectedViewId="v1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  moveItem.mockReset();
  reorderItem.mockReset();
  reorderGroup.mockReset();
  for (const k of Object.keys(dndOnDragEnd)) delete dndOnDragEnd[k];
});

describe("BoardTable cross-group item DnD", () => {
  it("cross-group item drop calls moveItem with the target group + numeric position", async () => {
    moveItem.mockResolvedValue({ ok: true, data: {} });
    renderTwoGroups();

    const onDragEnd = dndOnDragEnd["board-dnd"];
    expect(onDragEnd).toBeTypeOf("function");
    onDragEnd!({
      active: {
        id: "i1",
        data: { current: { type: "item", groupId: "g1" } },
        rect: { current: { translated: { top: 12 } } },
      },
      over: {
        id: "i2",
        data: { current: { type: "item", groupId: "g2" } },
        rect: { top: 0, height: 40 },
      },
    });

    await waitFor(() =>
      expect(moveItem).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: "i1",
          groupId: "g2",
          position: expect.any(Number),
        }),
      ),
    );
    expect(reorderItem).not.toHaveBeenCalled();
  });

  it("same-group item drop calls reorderItem, not moveItem", async () => {
    reorderItem.mockResolvedValue({ ok: true, data: {} });
    renderTwoGroups();

    const onDragEnd = dndOnDragEnd["board-dnd"]!;
    onDragEnd({
      active: {
        id: "i2",
        data: { current: { type: "item", groupId: "g2" } },
        rect: { current: { translated: { top: 30 } } },
      },
      over: {
        id: "i3",
        data: { current: { type: "item", groupId: "g2" } },
        rect: { top: 0, height: 40 },
      },
    });

    await waitFor(() => expect(reorderItem).toHaveBeenCalled());
    expect(moveItem).not.toHaveBeenCalled();
  });

  it("dropping an item on a group container appends (moveItem with no position)", async () => {
    moveItem.mockResolvedValue({ ok: true, data: {} });
    renderTwoGroups();

    const onDragEnd = dndOnDragEnd["board-dnd"]!;
    onDragEnd({
      active: {
        id: "i1",
        data: { current: { type: "item", groupId: "g1" } },
        rect: { current: { translated: { top: 12 } } },
      },
      over: {
        id: "group-drop-g2",
        data: { current: { type: "group-container", groupId: "g2" } },
        rect: { top: 0, height: 400 },
      },
    });

    await waitFor(() =>
      expect(moveItem).toHaveBeenCalledWith(
        expect.objectContaining({ itemId: "i1", groupId: "g2" }),
      ),
    );
    // Container drop = append: no explicit position sent.
    expect(moveItem.mock.calls[0][0].position).toBeUndefined();
  });

  it("group-header drop calls reorderGroup, not any item move", async () => {
    reorderGroup.mockResolvedValue({ ok: true, data: {} });
    renderTwoGroups();

    const onDragEnd = dndOnDragEnd["board-dnd"]!;
    onDragEnd({
      active: { id: "g1", data: { current: { type: "group" } } },
      over: { id: "g2", data: { current: { type: "group" } } },
    });

    await waitFor(() => expect(reorderGroup).toHaveBeenCalled());
    expect(moveItem).not.toHaveBeenCalled();
    expect(reorderItem).not.toHaveBeenCalled();
  });
});
