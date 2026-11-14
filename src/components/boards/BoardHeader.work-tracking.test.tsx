import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import { BoardHeader } from "./BoardHeader";
import {
  BoardPresenceProvider,
  type BoardPresenceContextValue,
} from "@/lib/boards/presence-context";
import { boardKey, useBoardCache } from "@/lib/boards/use-board-cache";
import type { BoardCache } from "@/lib/boards/cache";

const updateBoardWorkSettings = vi.fn();
vi.mock("@/lib/boards/actions/work-settings", () => ({
  updateBoardWorkSettings: (...a: unknown[]) => updateBoardWorkSettings(...a),
}));
// The board-actions barrel (rename, cells, ...) is server code; the real
// useBoardMutations is exercised here, but none of those actions are called.
vi.mock("@/lib/boards/actions");
vi.mock("@/lib/boards/board-payload-action", () => ({
  fetchBoardPayload: vi.fn(),
}));
vi.mock("./ViewSwitcher", () => ({ ViewSwitcher: () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/boards/spreadsheet-actions", () => ({
  previewImport: vi.fn(),
  commitImport: vi.fn(),
}));
vi.mock("@/components/boards/automations/AutomationsDialog", () => ({
  AutomationsDialog: () => null,
}));
vi.mock("@/components/boards/trash/BoardTrashDialog", () => ({
  BoardTrashDialog: () => null,
}));
vi.mock("@/components/boards/ShareBoardDialog", () => ({
  ShareBoardDialog: () => null,
}));
vi.mock("@/lib/boards/sharing-actions", () => ({
  shareBoard: vi.fn(),
  unshareBoard: vi.fn(),
}));

const B = "11111111-1111-4111-8111-111111111111";
const S1 = "33333333-3333-4333-8333-333333333333";
const S2 = "77777777-7777-4777-8777-777777777777";
const D1 = "44444444-4444-4444-8444-444444444444";

const columns = [
  {
    id: S1,
    board_id: B,
    name: "Status",
    kind: "status",
    position: 1,
    settings: {
      options: [
        { id: "o1", label: "Working", color: "#fdab3d" },
        { id: "o2", label: "Done", color: "#00c875" },
      ],
    },
  },
  {
    id: S2,
    board_id: B,
    name: "Stage",
    kind: "status",
    position: 2,
    settings: { options: [{ id: "s1", label: "Shipped", color: "#00c875" }] },
  },
  { id: D1, board_id: B, name: "Due", kind: "date", position: 3, settings: {} },
];

function makeCache(): BoardCache {
  return {
    board: {
      id: B,
      name: "Sprint",
      work_status_column_id: null,
      work_done_option_ids: null,
      work_due_column_id: null,
    },
    groups: [],
    columns,
    items: [],
    cellValues: [],
    dependencies: [],
    attachments: [],
    timeEntries: [],
    relationLinks: [],
    mirrorTargetCells: [],
    mirrorTargetColumns: [],
  } as unknown as BoardCache;
}

const presence: BoardPresenceContextValue = {
  roster: [],
  focusMap: new Map(),
  setFocus: vi.fn(),
  selfUserId: "self",
  selfFocusTargetId: null,
  channelStatus: "SUBSCRIBED",
  flashTargetId: null,
};

/** One "view": reads the shared cache like Table/Kanban do and renders its own header. */
function View({ initial }: { initial: BoardCache }) {
  const { data } = useBoardCache(B, initial);
  return (
    <BoardHeader
      boardId={B}
      boardName={data.board.name}
      board={data.board}
      views={[]}
      selectedViewId="v1"
      columns={data.columns as never}
      access="editor"
    />
  );
}

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const initial = makeCache();
  const wrap = (ui: ReactElement) => (
    <QueryClientProvider client={qc}>
      <BoardPresenceProvider value={presence}>{ui}</BoardPresenceProvider>
    </QueryClientProvider>
  );
  const first = render(wrap(<View initial={initial} />));
  return { qc, initial, wrap, first };
}

async function openDialog() {
  await userEvent.click(
    screen.getByRole("button", { name: "More board actions" }),
  );
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Work tracking" }),
  );
  return screen.findByRole("dialog");
}

async function saveStatusAndDue() {
  await userEvent.selectOptions(screen.getByLabelText("Status column"), S1);
  await userEvent.click(screen.getByRole("checkbox", { name: "Done" }));
  await userEvent.selectOptions(screen.getByLabelText("Due date column"), D1);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  updateBoardWorkSettings.mockResolvedValue({ ok: true, data: undefined });
});

describe("BoardHeader work tracking over the shared board cache", () => {
  it("a header mounted later (view switch) opens with the saved values", async () => {
    const { wrap, initial, first } = setup();
    await openDialog();
    await saveStatusAndDue();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Switching views remounts the header over the same cache; no refetch.
    first.unmount();
    render(wrap(<View initial={initial} />));
    await openDialog();
    expect(screen.getByLabelText("Status column")).toHaveDisplayValue("Status");
    expect(screen.getByRole("checkbox", { name: "Done" })).toBeChecked();
    expect(screen.getByLabelText("Due date column")).toHaveDisplayValue("Due");
  });

  it("reopening in the same instance shows the saved values", async () => {
    setup();
    await openDialog();
    await saveStatusAndDue();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await openDialog();
    expect(screen.getByLabelText("Status column")).toHaveDisplayValue("Status");
    expect(screen.getByRole("checkbox", { name: "Done" })).toBeChecked();
  });

  it("a failed save leaves the cached board row unchanged", async () => {
    updateBoardWorkSettings.mockResolvedValue({ ok: false, error: "nope" });
    const { qc } = setup();
    await openDialog();
    await saveStatusAndDue();
    expect(await screen.findByText("nope")).toBeInTheDocument();
    const board = qc.getQueryData<BoardCache>(boardKey(B))!.board;
    expect(board.work_status_column_id).toBeNull();
    expect(board.work_done_option_ids).toBeNull();
    expect(board.work_due_column_id).toBeNull();
  });

  it("a change made outside this header (collaborator) shows on reopen", async () => {
    const { qc } = setup();
    act(() => {
      qc.setQueryData<BoardCache>(boardKey(B), (prev) => ({
        ...prev!,
        board: {
          ...prev!.board,
          work_status_column_id: S2,
          work_done_option_ids: ["s1"],
        },
      }));
    });
    await openDialog();
    expect(screen.getByLabelText("Status column")).toHaveDisplayValue("Stage");
    expect(screen.getByRole("checkbox", { name: "Shipped" })).toBeChecked();
  });
});
