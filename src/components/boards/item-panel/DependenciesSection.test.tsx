import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BoardCache } from "@/lib/boards/cache";
import { boardKey } from "@/lib/boards/use-board-cache";
import { toast } from "sonner";
import { DependenciesSection } from "./DependenciesSection";

// The real server actions run (validation, error mapping, editability check);
// only the Supabase client and the search RPC wrapper underneath are faked.
const db = vi.hoisted(() => ({
  createResult: {
    data: { id: "new" } as unknown,
    error: null as null | { code: string; message: string },
  },
  // What `.delete().eq().select("id")` resolves to: the deleted rows. RLS
  // filters a forbidden delete to [] with no error.
  deleteResult: {
    data: [{ id: "dep" }] as { id: string }[] | null,
    error: null as null | { message: string },
  },
  editableBoards: new Set<string>(),
  rpc: vi.fn(),
  deleteEq: vi.fn(),
  deleteSelect: vi.fn(),
  searchItems: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: db.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { board_id: BOARD },
            error: null,
          }),
        }),
      }),
      delete: () => ({ eq: db.deleteEq }),
    }),
  }),
}));

vi.mock("@/lib/search/item-search", () => ({
  searchItems: (q: string) => db.searchItems(q),
}));

vi.mock("@/lib/boards/use-dependency-context", () => ({
  dependencyContextKey: (boardId: string) => ["board-dep-context", boardId],
  useDependencyContext: () => ({
    data: { boards: [], items: [] },
    isPending: false,
  }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const BOARD = "b0b0b0b0-0000-4000-8000-000000000000";
const OTHER_BOARD = "b9b9b9b9-0000-4000-8000-000000000000";
const ME = "11111111-1111-4111-8111-111111111111";
const DESIGN = "22222222-2222-4222-8222-222222222222";
const PERMIT = "99999999-9999-4999-8999-999999999999";
const DEP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const COL = "c-when";

const permit = {
  id: PERMIT,
  name: "Permit",
  boardId: OTHER_BOARD,
  boardName: "Regulatory",
};

function makeCache(): BoardCache {
  return {
    board: { id: BOARD, name: "Platform" },
    groups: [],
    columns: [{ id: COL, name: "When", kind: "date" }],
    items: [
      { id: ME, name: "Me" },
      { id: DESIGN, name: "Design" },
    ],
    cellValues: [
      {
        item_id: ME,
        column_id: COL,
        value: { date: "2026-11-03", end: "2026-11-12" },
        updated_at: "",
      },
      {
        item_id: DESIGN,
        column_id: COL,
        value: { date: "2026-11-01", end: "2026-11-05" },
        updated_at: "",
      },
    ],
    dependencies: [
      {
        id: DEP,
        predecessor_id: DESIGN,
        successor_id: ME,
        board_id: BOARD,
        predecessor_board_id: BOARD,
      },
    ],
    attachments: [],
    timeEntries: [],
    relationLinks: [],
    mirrorTargetCells: [],
    mirrorTargetColumns: [],
  } as unknown as BoardCache;
}

function renderSection(canEdit = true) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  qc.setQueryData(boardKey(BOARD), makeCache());
  const utils = render(
    <QueryClientProvider client={qc}>
      <DependenciesSection
        itemId={ME}
        boardId={BOARD}
        boardName="Platform"
        schedule={null}
        canEdit={canEdit}
      />
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

async function openSearch(direction: "Waiting on" | "Blocking") {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add dependency" }));
  await user.click(screen.getByRole("radio", { name: direction }));
  await user.type(screen.getByRole("searchbox"), "per");
  return user;
}

const editChecks = () =>
  db.rpc.mock.calls.filter(([fn]) => fn === "can_edit_board");

const createCalls = () =>
  db.rpc.mock.calls.filter(([fn]) => fn === "create_item_dependency");

beforeEach(() => {
  vi.clearAllMocks();
  db.createResult = { data: { id: "new" }, error: null };
  db.deleteResult = { data: [{ id: "dep" }], error: null };
  db.editableBoards = new Set([BOARD, OTHER_BOARD]);
  db.searchItems.mockResolvedValue([permit]);
  db.deleteEq.mockImplementation(() => ({ select: db.deleteSelect }));
  db.deleteSelect.mockImplementation(async () => db.deleteResult);
  db.rpc.mockImplementation(
    async (fn: string, args: { p_board_id?: string }) => {
      if (fn === "can_edit_board")
        return {
          data: db.editableBoards.has(args.p_board_id ?? ""),
          error: null,
        };
      if (fn === "create_item_dependency") return db.createResult;
      throw new Error(`unexpected rpc ${fn}`);
    },
  );
});

describe("DependenciesSection", () => {
  it("lists what the item waits on, with board and a late marker", () => {
    renderSection();
    const waiting = screen.getByRole("region", { name: "Waiting on" });
    expect(within(waiting).getByText("Design")).toBeInTheDocument();
    expect(within(waiting).getByText("Platform")).toBeInTheDocument();
    // Design ends Nov 5, Me starts Nov 3 → late.
    expect(within(waiting).getByText("Late")).toBeInTheDocument();
    const blocking = screen.getByRole("region", { name: "Blocking" });
    expect(
      within(blocking).getByText("Nothing waits on this item."),
    ).toBeInTheDocument();
  });

  it("adds a waiting-on link from org-wide search", async () => {
    renderSection();
    const user = await openSearch("Waiting on");
    const hit = await screen.findByRole("button", {
      name: "Permit · Regulatory",
    });
    expect(db.searchItems).toHaveBeenCalledWith("per");
    await user.click(hit);
    await waitFor(() =>
      expect(createCalls()).toEqual([
        ["create_item_dependency", { p_predecessor: PERMIT, p_successor: ME }],
      ]),
    );
  });

  it("adds a blocking link with this item as the predecessor", async () => {
    renderSection();
    const user = await openSearch("Blocking");
    await user.click(
      await screen.findByRole("button", { name: "Permit · Regulatory" }),
    );
    await waitFor(() =>
      expect(createCalls()).toEqual([
        ["create_item_dependency", { p_predecessor: ME, p_successor: PERMIT }],
      ]),
    );
  });

  it("disables blocking targets on boards the viewer can't edit", async () => {
    db.editableBoards = new Set([BOARD]);
    renderSection();
    await openSearch("Blocking");
    const hit = await screen.findByRole("button", {
      name: "Permit · Regulatory (view only)",
    });
    expect(hit).toBeDisabled();
    expect(
      screen.getByText(
        "Only items on boards you can edit can wait on this one.",
      ),
    ).toBeInTheDocument();
    // Waiting on only needs read access on the other board.
    await userEvent
      .setup()
      .click(screen.getByRole("radio", { name: "Waiting on" }));
    expect(
      screen.getByRole("button", { name: "Permit · Regulatory" }),
    ).toBeEnabled();
  });

  it("never checks edit access in Waiting on mode", async () => {
    renderSection();
    await openSearch("Waiting on");
    await screen.findByRole("button", { name: "Permit · Regulatory" });
    expect(editChecks()).toEqual([]);
  });

  it("checks each board once, across keystrokes and direction switches", async () => {
    renderSection();
    const user = await openSearch("Blocking");
    await screen.findByRole("button", { name: "Permit · Regulatory" });
    await waitFor(() => expect(editChecks()).toHaveLength(1));
    await user.type(screen.getByRole("searchbox"), "m");
    await waitFor(() => expect(db.searchItems).toHaveBeenCalledWith("perm"));
    await user.click(screen.getByRole("radio", { name: "Waiting on" }));
    await user.click(screen.getByRole("radio", { name: "Blocking" }));
    expect(editChecks()).toEqual([
      ["can_edit_board", { p_board_id: OTHER_BOARD }],
    ]);
  });

  it("toasts mapped copy for the real cycle error", async () => {
    db.createResult = {
      data: null,
      error: { code: "P0001", message: "this would create a dependency cycle" },
    };
    renderSection();
    const user = await openSearch("Waiting on");
    await user.click(
      await screen.findByRole("button", { name: "Permit · Regulatory" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "That would create a dependency loop.",
      ),
    );
  });

  it("toasts mapped copy for the real edit-access error", async () => {
    db.createResult = {
      data: null,
      error: { code: "42501", message: "no edit access to this board" },
    };
    renderSection();
    const user = await openSearch("Blocking");
    await user.click(
      await screen.findByRole("button", { name: "Permit · Regulatory" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "You can't edit the board that item is on.",
      ),
    );
  });

  it("does not offer the item itself or already-linked items", async () => {
    db.searchItems.mockResolvedValue([
      { id: ME, name: "Me", boardId: BOARD, boardName: "Platform" },
      { id: DESIGN, name: "Design", boardId: BOARD, boardName: "Platform" },
      permit,
    ]);
    renderSection();
    await openSearch("Waiting on");
    await screen.findByRole("button", { name: "Permit · Regulatory" });
    expect(
      screen.queryByRole("button", { name: "Me · Platform" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Design · Platform" }),
    ).not.toBeInTheDocument();
  });

  it("removes a link optimistically", async () => {
    const user = userEvent.setup();
    const { qc } = renderSection();
    await user.click(
      screen.getByRole("button", { name: "Remove link to Design" }),
    );
    expect(qc.getQueryData<BoardCache>(boardKey(BOARD))?.dependencies).toEqual(
      [],
    );
    expect(
      await screen.findByText("Not waiting on anything."),
    ).toBeInTheDocument();
    await waitFor(() => expect(db.deleteEq).toHaveBeenCalledWith("id", DEP));
  });

  it("restores the link and toasts when removing fails", async () => {
    db.deleteResult = { data: null, error: { message: "permission denied" } };
    const user = userEvent.setup();
    const { qc } = renderSection();
    await user.click(
      screen.getByRole("button", { name: "Remove link to Design" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't remove the dependency.",
      ),
    );
    expect(
      qc
        .getQueryData<BoardCache>(boardKey(BOARD))
        ?.dependencies.map((d) => d.id),
    ).toEqual([DEP]);
  });

  it("restores the link and says so when RLS removed nothing", async () => {
    db.deleteResult = { data: [], error: null };
    const user = userEvent.setup();
    const { qc } = renderSection();
    await user.click(
      screen.getByRole("button", { name: "Remove link to Design" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "You can't remove this dependency.",
      ),
    );
    expect(
      qc
        .getQueryData<BoardCache>(boardKey(BOARD))
        ?.dependencies.map((d) => d.id),
    ).toEqual([DEP]);
  });

  it("restores the link when the remove request itself throws", async () => {
    db.deleteSelect.mockRejectedValueOnce(new Error("network"));
    const user = userEvent.setup();
    const { qc } = renderSection();
    await user.click(
      screen.getByRole("button", { name: "Remove link to Design" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't remove the dependency. Check your connection.",
      ),
    );
    expect(
      qc
        .getQueryData<BoardCache>(boardKey(BOARD))
        ?.dependencies.map((d) => d.id),
    ).toEqual([DEP]);
  });

  it("hides editing controls for read-only viewers", () => {
    renderSection(false);
    expect(screen.getByText("Design")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add dependency" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove link to Design" }),
    ).not.toBeInTheDocument();
  });
});
