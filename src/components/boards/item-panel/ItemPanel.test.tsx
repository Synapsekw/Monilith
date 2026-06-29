import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ItemPanel } from "./ItemPanel";
import {
  BoardPresenceProvider,
  type BoardPresenceContextValue,
} from "@/lib/boards/presence-context";
import { presenceTarget } from "@/lib/boards/presence-target";

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
    await user.click(screen.getByRole("button", { name: /fields/i }));
    expect(screen.getByText("Created by")).toBeInTheDocument();
    expect(screen.getByText("Danijel Jovanovic")).toBeInTheDocument();
    expect(screen.getByText("Created at")).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
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
      expect(screen.getByRole("button", { name })).toHaveClass(
        "pointer-coarse:min-h-11",
      );
    }
    // tab switch is client-side: clicking Files reveals the Files-tab content
    await user.click(screen.getByRole("button", { name: /files/i }));
    expect(screen.getByText(/No files yet/i)).toBeInTheDocument();
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
