import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Kicker } from "@/components/ui/kicker";
import { StatusPill } from "@/components/ui/status-pill";
import { STATUS_BG } from "@/components/ui/status-pill";
import type { GalleryRow } from "@/lib/folders/types";

/** One card per folder in the active workspace (spec §4 /dashboards). Server-renderable. */
export function FolderGallery({
  rows,
}: {
  rows: GalleryRow[];
  workspaceId: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState>
        No folders yet. Create one from the Boards section of the sidebar, then
        move boards into it.
      </EmptyState>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((r) => {
        const pct = r.items > 0 ? Math.round((r.done / r.items) * 100) : null;
        return (
          <Link
            key={r.folderId}
            href={`/folders/${r.folderId}`}
            className="bg-surface hover:border-border-hover card-lift flex flex-col gap-3 rounded-lg border p-4"
          >
            <div className="flex items-center gap-2">
              <FolderKanban className="text-muted-foreground size-4" />
              <span className="truncate text-sm font-semibold">{r.name}</span>
            </div>
            {r.boards === 0 ? (
              <p className="text-muted-foreground text-xs">No boards yet</p>
            ) : (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="font-heading text-2xl font-semibold tabular-nums">
                    {pct === null ? "—" : `${pct}%`}
                  </span>
                  <Kicker>
                    {r.boards} {r.boards === 1 ? "board" : "boards"} · {r.items}{" "}
                    items
                  </Kicker>
                </div>
                <div className="bg-surface-muted h-1 w-full overflow-hidden rounded-sm">
                  <div
                    className={STATUS_BG.green}
                    style={{ width: `${pct ?? 0}%`, height: "100%" }}
                  />
                </div>
                <div className="flex gap-2">
                  {r.overdue > 0 ? (
                    <StatusPill color="red" variant="soft">
                      {r.overdue} overdue
                    </StatusPill>
                  ) : null}
                  {r.attention > 0 ? (
                    <StatusPill color="yellow" variant="soft">
                      {r.attention} need attention
                    </StatusPill>
                  ) : null}
                </div>
              </>
            )}
          </Link>
        );
      })}
    </div>
  );
}
