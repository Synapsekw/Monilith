import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardViews } from "@/components/boards/BoardViews";
import { useBoardPresenceContextOptional } from "@/lib/boards/presence-context";
import type { BoardPayload } from "@/lib/boards/queries";
import { EMPTY_BOARD_VIEW_PREFS } from "@/lib/validations/view-prefs";

/**
 * Referential-stability guardrails for BoardViews. It re-renders on every
 * presence sync, so anything it hands down as a fresh object/array/function
 * drags the presence-context consumers and the item panel along with it.
 */
const { panelProps, contextValues, tableRenders } = vi.hoisted(() => ({
  panelProps: [] as { members: unknown; onClose: unknown; itemId: unknown }[],
  contextValues: [] as unknown[],
  tableRenders: { count: 0 },
}));

vi.mock("@/lib/boards/view-prefs-actions", () => ({
  saveBoardViewPrefs: vi.fn(async () => ({ ok: true, data: undefined })),
}));
vi.mock("@/lib/boards/intelligence/visit-actions", () => ({
  touchBoardVisit: vi.fn(async () => ({ ok: true, data: undefined })),
}));

let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/lib/boards/use-board-cache", () => ({
  useBoardCache: vi.fn(() => ({ data: undefined })),
}));
vi.mock("@/lib/boards/use-board-realtime", () => ({
  useBoardRealtime: vi.fn(),
}));
vi.mock("@/components/offline/OfflinePersistence", () => ({
  OfflinePersistence: () => null,
}));

// Like the real hook: a FRESH wrapper object per render around stable fields.
const presenceFields = vi.hoisted(() => ({
  roster: [],
  focusMap: new Map(),
  setFocus: () => {},
  selfUserId: "u1",
  selfFocusTargetId: null,
  channelStatus: "SUBSCRIBED",
}));
vi.mock("@/lib/boards/use-board-presence", () => ({
  useBoardPresence: () => ({ ...presenceFields }),
}));

// Plain (non-memo) probes, so they render whenever BoardViews does.
vi.mock("@/components/boards/BoardTable", () => ({
  BoardTable: function TableProbe() {
    tableRenders.count += 1;
    contextValues.push(useBoardPresenceContextOptional());
    return null;
  },
}));
vi.mock("@/components/boards/item-panel/ItemPanel", () => ({
  ItemPanel: (props: {
    members: unknown;
    onClose: unknown;
    itemId: unknown;
  }) => {
    panelProps.push({
      members: props.members,
      onClose: props.onClose,
      itemId: props.itemId,
    });
    return null;
  },
}));

const payload = {
  board: { id: "b1", name: "Board", org_id: "o1" },
  views: [{ id: "v1", kind: "table", name: "Main Table" }],
  groups: [],
  columns: [],
  items: [{ id: "i1", name: "One", created_by: null, created_at: null }],
  cellValues: [],
  dependencies: [],
} as unknown as BoardPayload;
const members = [
  { userId: "u1", fullName: "Ada", email: "ada@example.com", avatarUrl: null },
] as never;
const grants = [] as never;

function tree() {
  return (
    <BoardViews
      payload={payload}
      members={members}
      initialViewId="v1"
      currentUserId="u1"
      access="owner"
      grants={grants}
      viewPrefs={EMPTY_BOARD_VIEW_PREFS}
      lastSeenAt={null}
    />
  );
}

describe("BoardViews referential stability", () => {
  beforeEach(() => {
    panelProps.length = 0;
    contextValues.length = 0;
    tableRenders.count = 0;
    search = "item=i1";
  });

  it("hands the same presence value, panel members and onClose to a re-render", () => {
    const qc = new QueryClient();
    const view = render(
      <QueryClientProvider client={qc}>{tree()}</QueryClientProvider>,
    );
    view.rerender(
      <QueryClientProvider client={qc}>{tree()}</QueryClientProvider>,
    );

    // BoardViews really rendered again (otherwise this proves nothing)…
    expect(tableRenders.count).toBeGreaterThan(1);
    expect(panelProps.length).toBeGreaterThan(1);
    // …with identical references all the way down.
    expect(new Set(contextValues).size).toBe(1);
    expect(new Set(panelProps.map((p) => p.members)).size).toBe(1);
    expect(new Set(panelProps.map((p) => p.onClose)).size).toBe(1);
    expect(panelProps.at(-1)?.itemId).toBe("i1");
  });
});
