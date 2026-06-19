"use client";

import { useState } from "react";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NumberWidget } from "@/components/dashboards/widgets/NumberWidget";
import { ChartWidget } from "@/components/dashboards/widgets/ChartWidget";
import { BatteryWidget } from "@/components/dashboards/widgets/BatteryWidget";
import { ListWidget } from "@/components/dashboards/widgets/ListWidget";
import { EditListWidgetDialog } from "@/components/dashboards/EditListWidgetDialog";
import { Input } from "@/components/ui/input";
import { useDashboardMutations } from "@/lib/dashboards/use-dashboard-mutations";
import type { CacheWidget } from "@/lib/dashboards/cache";
import type { BoardOption } from "@/components/dashboards/AddWidgetDialog";

export function DashboardWidget({
  widget,
  dashboardId,
  editing,
  boards,
}: {
  widget: CacheWidget;
  dashboardId: string;
  editing: boolean;
  boards: BoardOption[];
}) {
  const { removeWidget, editWidget } = useDashboardMutations(dashboardId);
  const [editOpen, setEditOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(widget.title ?? "");

  function openRename() {
    setTitleDraft(widget.title ?? "");
    setRenaming(true);
  }

  function commitRename() {
    const trimmed = titleDraft.trim();
    setRenaming(false);
    if (!trimmed || trimmed === (widget.title ?? "")) return;
    editWidget.mutate({ widgetId: widget.id, title: trimmed });
  }

  return (
    <>
      <div className="bg-card flex h-full flex-col rounded-lg border">
        <div className="flex items-center justify-between border-b px-3 py-2">
          {editing && renaming ? (
            <Input
              autoFocus
              value={titleDraft}
              disabled={editWidget.isPending}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitRename}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setRenaming(false);
                }
              }}
              aria-label="Widget title"
              className="h-7 max-w-[12rem] text-sm font-medium"
            />
          ) : editing ? (
            <button
              type="button"
              onClick={openRename}
              onMouseDown={(e) => e.stopPropagation()}
              className="hover:text-muted-foreground focus-visible:ring-ring truncate rounded-sm text-left text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              {widget.title || "Untitled"}
            </button>
          ) : (
            <span className="truncate text-sm font-medium">
              {widget.title || "Untitled"}
            </span>
          )}
          {editing ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                className="text-muted-foreground hover:text-foreground"
                aria-label="Widget menu"
                // keep the drag handler from hijacking the click
                onMouseDown={(e) => e.stopPropagation()}
              >
                <MoreVertical className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {widget.kind === "list" ? (
                  <>
                    <DropdownMenuItem onClick={() => setEditOpen(true)}>
                      <Pencil className="mr-2 size-4" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                ) : null}
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => removeWidget.mutate({ widgetId: widget.id })}
                >
                  <Trash2 className="mr-2 size-4" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 p-3">
          {widget.kind === "number" ? (
            <NumberWidget widget={widget} />
          ) : widget.kind === "chart" ? (
            <ChartWidget widget={widget} />
          ) : widget.kind === "battery" ? (
            <BatteryWidget widget={widget} />
          ) : widget.kind === "list" ? (
            <ListWidget widget={widget} />
          ) : (
            <div className="text-muted-foreground text-sm">
              {widget.kind} widget — coming soon
            </div>
          )}
        </div>
      </div>
      {widget.kind === "list" ? (
        <EditListWidgetDialog
          widget={widget}
          board={boards.find((b) => b.id === widget.source_board_id)}
          dashboardId={dashboardId}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      ) : null}
    </>
  );
}
