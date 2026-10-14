import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill, type StatusColor } from "@/components/ui/status-pill";
import type { AttentionReason, AttentionRow } from "@/lib/folders/types";
import { Failed, Panel } from "./Panel";

const REASON_COLOR: Record<AttentionReason, StatusColor> = {
  overdue: "red",
  blocked: "red",
  unassigned: "yellow",
  stale: "gray",
};

export function AttentionPanel({
  kicker,
  title = "Needs attention",
  attention,
  caption,
  onRetry,
}: {
  kicker: string;
  title?: string;
  attention: AttentionRow[] | null;
  caption: string | null;
  onRetry: () => void;
}) {
  return (
    <Panel kicker={kicker} title={title}>
      {caption ? (
        <p
          data-testid="attention-caption"
          className="text-muted-foreground text-xs"
        >
          {caption}
        </p>
      ) : null}
      {attention === null ? (
        <Failed onRetry={onRetry} />
      ) : attention.length === 0 ? (
        <EmptyState variant="inline">Nothing needs attention.</EmptyState>
      ) : (
        <ul className="divide-y">
          {attention.map((a) => (
            <li key={a.itemId} className="flex items-center gap-3 py-2 text-xs">
              <StatusPill
                color={REASON_COLOR[a.reason]}
                variant="soft"
                className="w-24 justify-center"
              >
                {a.reason}
              </StatusPill>
              <Link
                href={`/boards/${a.boardId}?item=${a.itemId}`}
                className="hover:text-foreground min-w-0 flex-1 truncate font-medium"
              >
                {a.itemName}
              </Link>
              <span className="text-muted-foreground truncate">
                {a.boardName}
                {a.groupName ? ` · ${a.groupName.trim()}` : ""}
              </span>
              <span className="text-muted-foreground font-mono tabular-nums">
                {a.reason} · {a.ageDays}d
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
