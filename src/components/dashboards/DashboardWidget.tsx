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
  const { removeWidget } = useDashboardMutations(dashboardId);
  const [editOpen, setEditOpen] = useState(false);

  return (
    <>
      <div className="bg-card flex h-full flex-col rounded-lg border">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="truncate text-sm font-medium">
            {widget.title || "Untitled"}
          </span>
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
                  <DropdownMenuItem onClick={() => setEditOpen(true)}>
                    <Pencil className="mr-2 size-4" /> Edit
                  </DropdownMenuItem>
                ) : null}
                {widget.kind === "list" ? <DropdownMenuSeparator /> : null}
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
