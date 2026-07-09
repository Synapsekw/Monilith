"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  GanttChartSquare,
  Kanban,
  LayoutGrid,
  MoreHorizontal,
  Plus,
  Table,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  createBoardView,
  deleteBoardView,
  updateBoardView,
} from "@/lib/boards/view-actions";
import type { BoardView } from "@/lib/boards/queries";

type ViewTabData = Pick<BoardView, "id" | "kind" | "name">;

const KIND_ICON: Record<string, typeof Table> = {
  table: Table,
  kanban: Kanban,
  calendar: CalendarDays,
  timeline: GanttChartSquare,
};

function KindIcon({ kind }: { kind: string }) {
  const Icon = KIND_ICON[kind] ?? LayoutGrid;
  return <Icon aria-hidden className="size-3.5" />;
}

export function ViewSwitcher({
  boardId,
  views,
  selectedViewId,
}: {
  boardId: string;
  views: ViewTabData[];
  selectedViewId: string;
}) {
  const router = useRouter();
  const [adding, startAdding] = React.useTransition();

  function handleAddView(kind: "kanban" | "calendar" | "timeline") {
    startAdding(async () => {
      const res = await createBoardView({ boardId, kind });
      if (res.ok) router.push(`/boards/${boardId}?view=${res.data.viewId}`);
    });
  }

  return (
    <div
      role="tablist"
      aria-label="Board views"
      className="flex items-center gap-1"
    >
      {views.map((view) => (
        <ViewTab
          key={view.id}
          boardId={boardId}
          view={view}
          selected={view.id === selectedViewId}
          canDelete={views.length > 1}
          firstOtherViewId={views.find((v) => v.id !== view.id)?.id}
        />
      ))}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Add view"
            disabled={adding}
          >
            <Plus aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-36">
          <DropdownMenuItem onSelect={() => handleAddView("kanban")}>
            <Kanban aria-hidden className="size-3.5" />
            Kanban
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => handleAddView("calendar")}>
            <CalendarDays aria-hidden className="size-3.5" />
            Calendar
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => handleAddView("timeline")}>
            <GanttChartSquare aria-hidden className="size-3.5" />
            Timeline
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ViewTab({
  boardId,
  view,
  selected,
  canDelete,
  firstOtherViewId,
}: {
  boardId: string;
  view: ViewTabData;
  selected: boolean;
  canDelete: boolean;
  firstOtherViewId: string | undefined;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = React.useState(false);
  const [draft, setDraft] = React.useState(view.name);
  const [pending, startTransition] = React.useTransition();

  // Switching views is in-page state over already-loaded data: update the URL
  // with the History API (Next syncs it into useSearchParams) so BoardViews
  // re-renders the chosen view WITHOUT re-running the server component. A
  // <Link>/router.push here would refetch the whole board + shell every switch.
  function selectView() {
    if (selected) return;
    window.history.pushState(null, "", `/boards/${boardId}?view=${view.id}`);
  }

  function startRenaming() {
    setDraft(view.name);
    setRenaming(true);
  }

  function commitRename() {
    const name = draft.trim();
    setRenaming(false);
    if (!name || name === view.name) return;
    startTransition(async () => {
      const res = await updateBoardView({ viewId: view.id, name });
      if (res.ok) router.refresh();
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteBoardView({ viewId: view.id });
      if (!res.ok) return;
      // Only navigate away when deleting the currently selected view; deleting a
      // non-selected tab drops it in place and keeps the user where they are.
      if (selected && firstOtherViewId) {
        router.push(`/boards/${boardId}?view=${firstOtherViewId}`);
      } else {
        router.refresh();
      }
    });
  }

  if (renaming) {
    return (
      <Input
        aria-label="View name"
        autoFocus
        value={draft}
        disabled={pending}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitRename();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setRenaming(false);
          }
        }}
        className="h-7 w-32"
      />
    );
  }

  return (
    <div
      className={cn(
        "group/tab ease-keystone flex items-center rounded-full border transition-colors",
        selected
          ? "bg-surface-muted border-border-bright"
          : "hover:border-border border-transparent",
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        onClick={selectView}
        className={cn(
          "focus-visible:ring-ring ease-keystone flex h-7 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
          selected
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground",
          pending && "opacity-60",
        )}
      >
        <KindIcon kind={view.kind} />
        <span className="truncate">{view.name}</span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`View options for ${view.name}`}
            disabled={pending}
            className={cn(
              "mr-0.5 size-6",
              selected && "text-foreground hover:bg-foreground/10",
            )}
          >
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-32">
          <DropdownMenuItem onSelect={startRenaming}>Rename</DropdownMenuItem>
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={handleDelete}>
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
