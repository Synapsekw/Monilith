import { Info } from "lucide-react";
import { boardCapMessages, type BoardTruncation } from "@/lib/boards/caps";

/**
 * The quiet line under the board header that says a read stopped at a limit,
 * so a board with values missing never just looks emptier than it is.
 *
 * Mounted by `BoardHeader` (every view renders one), fed from the board cache
 * the view already holds, so it follows a resync and costs no read of its own.
 * Not dismissible: the values stay missing for as long as it shows.
 * Renders nothing when no limit was hit.
 */
export function BoardCapNotice({
  truncation,
}: {
  truncation: BoardTruncation | null | undefined;
}) {
  const messages = boardCapMessages(truncation);
  if (messages.length === 0) return null;
  return (
    <div
      role="status"
      data-testid="board-cap-notice"
      className="text-muted-foreground flex items-start gap-2 border-b px-6 py-1.5 text-xs"
    >
      <Info className="mt-px size-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-0.5">
        {messages.map((message) => (
          <p key={message}>{message}</p>
        ))}
      </div>
    </div>
  );
}
