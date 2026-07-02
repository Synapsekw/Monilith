import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useEffect, useState, type ComponentType } from "react";
import { BoardViews } from "@/components/boards/BoardViews";
import type { BoardPayload } from "@/lib/boards/queries";

// Drive the active view purely from the URL search params (the client-side
// switch path) — no server refetch is involved.
let viewParam: string | null = null;
vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(viewParam ? `view=${viewParam}` : ""),
}));

// The non-default views are now next/dynamic imports. Resolve the loader in an
// effect and swap the component in (mirrors DashboardWidget.test.tsx): each
// BoardViews loader already maps the module to its named export, so `m` here is
// the component itself. Tests await these via findByTestId.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<unknown>) => {
    return function Lazy(props: Record<string, unknown>) {
      const [Comp, setComp] = useState<ComponentType<
        Record<string, unknown>
      > | null>(null);
      useEffect(() => {
        void loader().then((m) =>
          setComp(() => m as ComponentType<Record<string, unknown>>),
        );
      }, []);
      return Comp ? <Comp {...props} /> : null;
    };
  },
}));

vi.mock("@/lib/boards/use-board-cache", () => ({ useBoardCache: vi.fn() }));
vi.mock("@/lib/boards/use-board-realtime", () => ({
  useBoardRealtime: vi.fn(),
}));
// Presence opens its own realtime channel + reads the Query client; out of scope
// for this routing test, so stub it to an empty roster (same spirit as the
// cache/realtime mocks above).
vi.mock("@/lib/boards/use-board-presence", () => ({
  useBoardPresence: () => ({
    roster: [],
    focusMap: new Map(),
    setFocus: vi.fn(),
    selfUserId: "u1",
    channelStatus: "SUBSCRIBED",
  }),
}));

// Stub the heavy view components so this test isolates the routing decision
// (which view renders) from cache/realtime/render concerns.
vi.mock("@/components/boards/KanbanBoard", () => ({
  KanbanBoard: ({ selectedViewId }: { selectedViewId: string }) => (
    <div data-testid="kanban">kanban:{selectedViewId}</div>
  ),
}));
vi.mock("@/components/boards/BoardTable", () => ({
  BoardTable: ({ selectedViewId }: { selectedViewId: string }) => (
    <div data-testid="table">table:{selectedViewId}</div>
  ),
}));
vi.mock("@/components/boards/CalendarBoard", () => ({
  CalendarBoard: ({ selectedViewId }: { selectedViewId: string }) => (
    <div data-testid="calendar">calendar:{selectedViewId}</div>
  ),
}));
vi.mock("@/components/boards/GanttBoard", () => ({
  GanttBoard: ({ selectedViewId }: { selectedViewId: string }) => (
    <div data-testid="gantt">gantt:{selectedViewId}</div>
  ),
}));
// Stub the detail panel — its data hooks (React Query/Realtime) are out of
// scope for this routing test; here it's closed (no `?item=`) regardless.
vi.mock("@/components/boards/item-panel/ItemPanel", () => ({
  ItemPanel: ({ itemId }: { itemId: string | null }) => (
    <div data-testid="item-panel" data-open={itemId ? "true" : "false"} />
  ),
}));

const payload = {
  board: { id: "b1", name: "Board", org_id: "o1" },
  views: [
    { id: "v1", kind: "table", name: "Main Table" },
    { id: "v2", kind: "kanban", name: "Kanban" },
    { id: "v3", kind: "calendar", name: "Calendar" },
    { id: "v4", kind: "timeline", name: "Timeline" },
  ],
  groups: [],
  columns: [],
  items: [],
  cellValues: [],
  dependencies: [],
} as unknown as BoardPayload;

describe("BoardViews", () => {
  it("renders the table view when the URL selects a table view", () => {
    viewParam = "v1";
    render(
      <BoardViews
        payload={payload}
        members={[]}
        initialViewId="v1"
        currentUserId="u1"
        access="owner"
        grants={[]}
      />,
    );
    expect(screen.getByTestId("table")).toHaveTextContent("table:v1");
    expect(screen.queryByTestId("kanban")).not.toBeInTheDocument();
  });

  it("renders the kanban view when the URL selects a kanban view", async () => {
    viewParam = "v2";
    render(
      <BoardViews
        payload={payload}
        members={[]}
        initialViewId="v1"
        currentUserId="u1"
        access="owner"
        grants={[]}
      />,
    );
    expect(await screen.findByTestId("kanban")).toHaveTextContent("kanban:v2");
    expect(screen.queryByTestId("table")).not.toBeInTheDocument();
  });

  it("falls back to initialViewId when the URL has no view param", async () => {
    viewParam = null;
    render(
      <BoardViews
        payload={payload}
        members={[]}
        initialViewId="v2"
        currentUserId="u1"
        access="owner"
        grants={[]}
      />,
    );
    expect(await screen.findByTestId("kanban")).toHaveTextContent("kanban:v2");
  });

  it("renders the calendar view when the URL selects a calendar view", async () => {
    viewParam = "v3";
    render(
      <BoardViews
        payload={payload}
        members={[]}
        initialViewId="v1"
        currentUserId="u1"
        access="owner"
        grants={[]}
      />,
    );
    expect(await screen.findByTestId("calendar")).toHaveTextContent(
      "calendar:v3",
    );
    expect(screen.queryByTestId("kanban")).not.toBeInTheDocument();
    expect(screen.queryByTestId("table")).not.toBeInTheDocument();
  });

  it("renders the gantt view when the URL selects a timeline view", async () => {
    viewParam = "v4";
    render(
      <BoardViews
        payload={payload}
        members={[]}
        initialViewId="v1"
        currentUserId="u1"
        access="owner"
        grants={[]}
      />,
    );
    expect(await screen.findByTestId("gantt")).toHaveTextContent("gantt:v4");
    expect(screen.queryByTestId("kanban")).not.toBeInTheDocument();
    expect(screen.queryByTestId("table")).not.toBeInTheDocument();
    expect(screen.queryByTestId("calendar")).not.toBeInTheDocument();
  });

  it("lazy-loads the non-default renderers (keeps them out of first paint)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/boards/BoardViews.tsx"),
      "utf8",
    );
    // BoardTable is the default view → stays a static import.
    expect(src).toMatch(/^import\s+\{\s*BoardTable\s*\}\s+from/m);
    // The other three renderers must not be statically imported.
    expect(src).not.toMatch(/^import\s+\{\s*KanbanBoard\s*\}\s+from/m);
    expect(src).not.toMatch(/^import\s+\{\s*CalendarBoard\s*\}\s+from/m);
    expect(src).not.toMatch(/^import\s+\{\s*GanttBoard\s*\}\s+from/m);
    expect(src).toContain("dynamic(");
  });
});
