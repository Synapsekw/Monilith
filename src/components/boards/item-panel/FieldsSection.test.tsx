import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardCache } from "@/lib/boards/cache";
import { boardKey } from "@/lib/boards/use-board-cache";
import { useEditingCell } from "@/components/boards/table/editing-store";
import { TooltipProvider } from "@/components/ui/tooltip";

// The real board mutations run (optimistic patch, rollback wiring); only the
// Server Actions underneath are faked.
const actions = vi.hoisted(() => ({
  upsertCell: vi.fn(),
  clearCell: vi.fn(),
  fetchBoardPayload: vi.fn(),
}));

vi.mock("@/lib/boards/actions", () => ({
  upsertCell: (...a: unknown[]) => actions.upsertCell(...a),
  clearCell: (...a: unknown[]) => actions.clearCell(...a),
}));
vi.mock("@/lib/boards/board-payload-action", () => ({
  fetchBoardPayload: (...a: unknown[]) => actions.fetchBoardPayload(...a),
}));
vi.mock("@/lib/boards/dependency-actions", () => ({}));
vi.mock("@/lib/boards/relation-actions", () => ({}));
vi.mock("@/lib/boards/relation-candidates", () => ({
  listRelationCandidates: vi.fn(async () => []),
}));
vi.mock("@/lib/boards/time-actions", () => ({}));
vi.mock("@/lib/collaboration/actions", () => ({
  getAttachmentDownloadUrl: vi.fn(),
  getAttachmentPreviewUrls: vi.fn(),
}));

import { FieldsSection } from "./FieldsSection";

const BOARD = "b0b0b0b0-0000-4000-8000-000000000000";
const ITEM = "22222222-2222-4222-8222-222222222222";
const OTHER_ITEM = "33333333-3333-4333-8333-333333333333";
const NOTES = "c0000000-0000-4000-8000-000000000001";
const STATUS = "c0000000-0000-4000-8000-000000000002";
const POINTS = "c0000000-0000-4000-8000-000000000003";

function makeCache(): BoardCache {
  const item = (id: string, name: string) => ({
    id,
    org_id: "o1",
    board_id: BOARD,
    group_id: "g1",
    parent_id: null,
    name,
    position: 1,
    created_by: "u1",
    created_at: "2026-09-09T00:00:00Z",
    updated_at: "2026-09-09T00:00:00Z",
    archived_at: null,
    archived_by: null,
  });
  return {
    board: { id: BOARD, name: "Platform" },
    groups: [],
    columns: [
      { id: NOTES, board_id: BOARD, name: "Notes", kind: "text", settings: {} },
      {
        id: STATUS,
        board_id: BOARD,
        name: "Status",
        kind: "status",
        settings: {
          options: [
            { id: "opt-doing", label: "Working on it", color: "#fdab3d" },
          ],
        },
      },
      {
        id: POINTS,
        board_id: BOARD,
        name: "Points",
        kind: "numbers",
        settings: {},
      },
    ],
    items: [item(ITEM, "Ship it"), item(OTHER_ITEM, "Other row")],
    cellValues: [
      { item_id: ITEM, column_id: NOTES, value: { text: "Hello" } },
      { item_id: ITEM, column_id: STATUS, value: { optionId: "opt-doing" } },
      { item_id: ITEM, column_id: POINTS, value: { n: 5 } },
      { item_id: OTHER_ITEM, column_id: NOTES, value: { text: "Not mine" } },
    ],
    dependencies: [],
    attachments: [],
    timeEntries: [],
    relationLinks: [],
    mirrorTargetCells: [],
    mirrorTargetColumns: [],
  } as unknown as BoardCache;
}

function renderSection({
  canEdit = true,
  seed = true,
}: { canEdit?: boolean; seed?: boolean } = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (seed) qc.setQueryData(boardKey(BOARD), makeCache());
  const view = render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <FieldsSection
          itemId={ITEM}
          boardId={BOARD}
          canEdit={canEdit}
          currentUserId="u1"
          members={[]}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { qc, ...view };
}

beforeEach(() => {
  actions.upsertCell.mockReset();
  actions.upsertCell.mockResolvedValue({ ok: true, data: undefined });
  actions.clearCell.mockReset();
  actions.fetchBoardPayload.mockReset();
  act(() => useEditingCell.getState().setEditing(null));
});

describe("FieldsSection", () => {
  it("lists every board column with this item's own value", () => {
    renderSection();
    const list = screen.getByRole("heading", { name: /fields/i }).parentElement!
      .parentElement!;
    expect(within(list).getByText("Notes")).toBeInTheDocument();
    expect(within(list).getByText("Status")).toBeInTheDocument();
    expect(screen.getByLabelText("Ship it Notes")).toHaveTextContent("Hello");
    expect(screen.getByLabelText("Ship it Status")).toHaveTextContent(
      "Working on it",
    );
    expect(screen.getByLabelText("Ship it Points")).toHaveTextContent("5");
    expect(screen.queryByText("Not mine")).toBeNull();
  });

  it("renders from the loaded board cache and never fetches the board", () => {
    renderSection();
    expect(actions.fetchBoardPayload).not.toHaveBeenCalled();
  });

  it("renders nothing, and still fetches nothing, when no board view has loaded the cache", () => {
    const { container } = renderSection({ seed: false });
    expect(container).toBeEmptyDOMElement();
    expect(actions.fetchBoardPayload).not.toHaveBeenCalled();
  });

  it("edits in place through the table's optimistic cell write", async () => {
    const user = userEvent.setup();
    // Hold the Server Action open: the cache must change before it answers.
    let finish: (v: unknown) => void = () => {};
    actions.upsertCell.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { qc } = renderSection();

    await user.click(screen.getByLabelText("Ship it Points"));
    const input = await screen.findByRole("spinbutton");
    await user.clear(input);
    await user.type(input, "8{Enter}");

    await waitFor(() =>
      expect(actions.upsertCell).toHaveBeenCalledWith({
        itemId: ITEM,
        columnId: POINTS,
        value: { n: 8 },
      }),
    );
    const cell = qc
      .getQueryData<BoardCache>(boardKey(BOARD))!
      .cellValues.find((c) => c.item_id === ITEM && c.column_id === POINTS);
    expect(cell?.value).toEqual({ n: 8 });
    // The editor closed and the field shows the optimistic value.
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getByLabelText("Ship it Points")).toHaveTextContent("8");
    await act(async () => finish({ ok: true, data: undefined }));
  });

  it("keys edit mode to the panel, so the table's copy of the cell stays closed", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(screen.getByLabelText("Ship it Notes"));
    expect(useEditingCell.getState().editing).toEqual({
      itemId: ITEM,
      columnId: NOTES,
      surface: "panel",
    });
  });

  it("clears its own edit mode when it unmounts", async () => {
    const user = userEvent.setup();
    const { unmount } = renderSection();
    await user.click(screen.getByLabelText("Ship it Notes"));
    unmount();
    expect(useEditingCell.getState().editing).toBeNull();
  });

  it("leaves a table cell's edit mode alone when it unmounts", () => {
    const { unmount } = renderSection();
    act(() =>
      useEditingCell.getState().setEditing({ itemId: ITEM, columnId: NOTES }),
    );
    unmount();
    expect(useEditingCell.getState().editing).toEqual({
      itemId: ITEM,
      columnId: NOTES,
    });
  });

  it("is read-only for a viewer: values show, nothing opens an editor or writes", async () => {
    const user = userEvent.setup();
    renderSection({ canEdit: false });
    expect(screen.getByText("View only")).toBeInTheDocument();
    const cell = screen.getByLabelText("Ship it Notes");
    expect(cell).toHaveTextContent("Hello");
    expect(cell).not.toHaveAttribute("role", "button");
    await user.click(cell);
    await user.click(screen.getByLabelText("Ship it Status"));
    expect(useEditingCell.getState().editing).toBeNull();
    await user.click(screen.getByLabelText("Ship it Points"));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(actions.upsertCell).not.toHaveBeenCalled();
  });

  it("says so when the board has no columns", () => {
    const qc = new QueryClient();
    qc.setQueryData(boardKey(BOARD), { ...makeCache(), columns: [] });
    render(
      <QueryClientProvider client={qc}>
        <FieldsSection
          itemId={ITEM}
          boardId={BOARD}
          canEdit
          currentUserId="u1"
          members={[]}
        />
      </QueryClientProvider>,
    );
    expect(
      screen.getByText("This board has no columns yet."),
    ).toBeInTheDocument();
  });
});
