"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  BoardTableMock,
  CalendarMock,
  KanbanMock,
  KANBAN_COLUMNS,
  SWITCHER_ROWS,
  TimelineMock,
  WindowFrame,
} from "./landing-mocks";

const VIEWS = [
  { id: "table", label: "Table" },
  { id: "kanban", label: "Kanban" },
  { id: "calendar", label: "Calendar" },
  { id: "timeline", label: "Timeline" },
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

/**
 * Client-side board view switcher for the landing page. Swaps the shown mock in
 * local component state only — zero network, no router navigation, no refetch.
 * The same seeded "Q3 launch plan" board, four ways.
 */
export function LandingViewSwitcher() {
  const [view, setView] = useState<ViewId>("table");
  const active = VIEWS.find((v) => v.id === view)!;

  return (
    <div>
      <div
        role="tablist"
        aria-label="Board view"
        className="bg-surface-muted border-border mx-auto mb-8 flex w-max gap-1.5 rounded-full border p-1.5"
      >
        {VIEWS.map((v) => {
          const isActive = v.id === view;
          return (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setView(v.id)}
              className={cn(
                "ease-keystone rounded-full px-5 py-2 text-sm font-semibold transition-all duration-200",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v.label}
            </button>
          );
        })}
      </div>

      <WindowFrame
        title={`Product · Q3 launch plan · ${active.label}`}
        chip="● live"
      >
        <div role="tabpanel">
          {view === "table" && <BoardTableMock rows={SWITCHER_ROWS} />}
          {view === "kanban" && <KanbanMock columns={KANBAN_COLUMNS} />}
          {view === "calendar" && <CalendarMock />}
          {view === "timeline" && <TimelineMock />}
        </div>
      </WindowFrame>
    </div>
  );
}
