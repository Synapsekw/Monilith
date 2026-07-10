import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ItemPanel } from "./ItemPanel";
import {
  BoardPresenceProvider,
  type BoardPresenceContextValue,
} from "@/lib/boards/presence-context";
import { usePresenceFocusStore } from "@/lib/boards/presence-focus-store";
import { presenceTarget } from "@/lib/boards/presence-target";
import { itemUpdatesKey } from "@/lib/collaboration/use-item-collab";
import type { ItemUpdate } from "@/lib/collaboration/cache";

afterEach(() => usePresenceFocusStore.getState().reset());

function ctx(
  setFocus: BoardPresenceContextValue["setFocus"],
): BoardPresenceContextValue {
  return {
    roster: [],
    focusMap: new Map(),
    setFocus,
    selfUserId: "self",
    selfFocusTargetId: null,
    channelStatus: "SUBSCRIBED",
    flashTargetId: null,
  };
}

const baseProps = {
  itemName: "Widget",
  orgId: "org1",
  boardId: "board1",
  currentUserId: "self",
  columns: [],
  members: [],
  createdBy: null,
  createdAt: null,
  onClose: () => {},
} as const;

function renderPanel(
  setFocus: BoardPresenceContextValue["setFocus"],
  itemId: string | null,
) {
  // usePresenceFocus reads setFocus from the presence focus store now — seed it.
  usePresenceFocusStore.getState().syncPresence({
    focusMap: new Map(),
    flashTargetId: null,
    selfUserId: "self",
    setFocus,
  });
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <BoardPresenceProvider value={ctx(setFocus)}>
        <ItemPanel {...baseProps} itemId={itemId} />
      </BoardPresenceProvider>
    </QueryClientProvider>,
  );
}

describe("ItemPanel creation metadata", () => {
  it("shows read-only creation metadata in the fields tab", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <BoardPresenceProvider value={ctx(vi.fn())}>
          <ItemPanel
            itemId="item-1"
            itemName="Design review"
            orgId="org-1"
            boardId="board-1"
            currentUserId="u-1"
            columns={[]}
            members={[{ userId: "u-1", fullName: "Danijel Jovanovic" }]}
            createdBy="u-1"
            createdAt="2026-06-25T15:42:00Z"
            onClose={() => {}}
          />
        </BoardPresenceProvider>
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole("tab", { name: /fields/i }));
    // Scope to the fields tab's <dl> — the Keystone header now also renders an
    // OWNER/CREATED meta chip with the same values, so unscoped queries would
    // match twice.
    const fieldsList = screen.getByText("Created by").closest("dl")!;
    expect(within(fieldsList).getByText("Created by")).toBeInTheDocument();
    expect(
      within(fieldsList).getByText("Danijel Jovanovic"),
    ).toBeInTheDocument();
    expect(within(fieldsList).getByText("Created at")).toBeInTheDocument();
    expect(within(fieldsList).getByText(/2026/)).toBeInTheDocument();
  });
});

describe("ItemPanel tab strip (touch)", () => {
  it("carries the coarse-pointer sizing token on each tab and switches tabs on click", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <BoardPresenceProvider value={ctx(vi.fn())}>
          <ItemPanel {...baseProps} itemId="item-1" />
        </BoardPresenceProvider>
      </QueryClientProvider>,
    );
    for (const name of [/^fields$/i, /updates/i, /activity log/i, /files/i]) {
      expect(screen.getByRole("tab", { name })).toHaveClass(
        "pointer-coarse:min-h-11",
      );
    }
    // tab switch is client-side: clicking Files reveals the Files-tab content
    await user.click(screen.getByRole("tab", { name: /files/i }));
    expect(screen.getByText(/No files yet/i)).toBeInTheDocument();
  });
});

describe("ItemPanel tab polish", () => {
  it("tabs expose tab semantics and the branded focus ring", () => {
    renderPanel(vi.fn(), "item-1");
    const tablist = screen.getByRole("tablist");
    expect(tablist).toBeTruthy();
    const updates = screen.getByRole("tab", { name: /updates/i });
    expect(updates.getAttribute("aria-selected")).toBe("true");
    expect(updates.className).toContain("focus-visible:ring");
    expect(updates.className).toContain("transition-colors");
  });

  it("tab body is wrapped in the fade-in wrapper", () => {
    renderPanel(vi.fn(), "item-1");
    expect(document.querySelector(".animate-fadein")).toBeTruthy();
  });
});

describe("ItemPanel presence", () => {
  it("registers a panel focus target while the panel is open", () => {
    const setFocus = vi.fn();
    renderPanel(setFocus, "i1");
    expect(setFocus).toHaveBeenCalledWith({
      viewKind: "panel",
      targetId: presenceTarget.item("i1"),
    });
  });

  it("does not register a focus when there is no open item", () => {
    const setFocus = vi.fn();
    renderPanel(setFocus, null);
    expect(setFocus).not.toHaveBeenCalledWith(
      expect.objectContaining({ viewKind: "panel" }),
    );
  });
});

describe("ItemPanel meta chips (Keystone)", () => {
  it("renders an OWNER meta chip with the creator's name in the header", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <BoardPresenceProvider value={ctx(vi.fn())}>
          <ItemPanel
            {...baseProps}
            itemId="item-1"
            members={[{ userId: "u-1", fullName: "Danijel Jovanovic" }]}
            createdBy="u-1"
            createdAt="2026-06-25T15:42:00Z"
          />
        </BoardPresenceProvider>
      </QueryClientProvider>,
    );
    const ownerLabel = screen.getByText("OWNER");
    expect(ownerLabel.className).toContain("font-mono");
    expect(ownerLabel.className).toContain("text-kicker");
    expect(screen.getByText("Danijel Jovanovic")).toBeInTheDocument();
  });
});

describe("ItemPanel updates tab count (Keystone)", () => {
  it("shows an accent count on the Updates tab when updates exist", () => {
    const qc = new QueryClient();
    const fixture: ItemUpdate[] = [
      {
        id: "upd-1",
        item_id: "item-1",
        board_id: "board1",
        org_id: "org1",
        author_id: "u-1",
        body: {},
        body_text: "First update",
        created_at: "2026-06-25T15:42:00Z",
        updated_at: "2026-06-25T15:42:00Z",
        edited_at: null,
      },
    ];
    qc.setQueryData(itemUpdatesKey("item-1"), { updates: fixture });
    render(
      <QueryClientProvider client={qc}>
        <BoardPresenceProvider value={ctx(vi.fn())}>
          <ItemPanel {...baseProps} itemId="item-1" />
        </BoardPresenceProvider>
      </QueryClientProvider>,
    );
    const updatesTab = screen.getByRole("tab", { name: /updates/i });
    const count = updatesTab.querySelector(".text-primary");
    expect(count).toBeTruthy();
    expect(count).toHaveTextContent("01");
  });
});
