"use client";

import { MoreVertical, Trash2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NumberWidget } from "@/components/dashboards/widgets/NumberWidget";
import { useDashboardMutations } from "@/lib/dashboards/use-dashboard-mutations";
import type { CacheWidget } from "@/lib/dashboards/cache";

export function DashboardWidget({
  widget,
  dashboardId,
  editing,
}: {
  widget: CacheWidget;
  dashboardId: string;
  editing: boolean;
}) {
  const { removeWidget } = useDashboardMutations(dashboardId);

  return (
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
        ) : (
          <div className="text-muted-foreground text-sm">
            {widget.kind} widget — coming soon
          </div>
        )}
      </div>
    </div>
  );
}
