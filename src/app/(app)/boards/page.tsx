import Link from "next/link";
import { redirect } from "next/navigation";
import { listMyBoards, listSharedBoards } from "@/lib/boards/queries";
import { getArchivedBoards } from "@/lib/boards/trash-queries";
import { ArchivedBoardsSection } from "@/components/boards/ArchivedBoardsSection";

/**
 * Index for the `/boards` route. Two responsibilities:
 *
 * 1. Fallback landing — the route otherwise only has the `[boardId]` dynamic
 *    segment, so navigating to `/boards` (e.g. after archiving the active board
 *    in BoardItemMenu) would 404. When there is nothing archived to recover, it
 *    redirects to the first available board (owned, then shared), mirroring
 *    `/home` — the fast path, unchanged for the common case.
 * 2. Workspace Trash — when the user has archived boards, it renders them in an
 *    "Archived boards" section (Restore / Delete permanently) instead of
 *    redirecting, so the Trash surface is reachable even while live boards
 *    exist. This is the only behavior change, and it only triggers when there
 *    is something in Trash to show. The archived read is bounded + indexed and
 *    runs in parallel with the list reads (0 added latency on the hot path).
 */
export default async function BoardsIndex() {
  const [boards, sharedBoards, archivedBoards] = await Promise.all([
    listMyBoards(),
    listSharedBoards(),
    getArchivedBoards(),
  ]);

  // Fast path: nothing archived → behave exactly as before (redirect / empty).
  if (archivedBoards.length === 0) {
    if (boards.length > 0) redirect(`/boards/${boards[0].id}`);
    if (sharedBoards.length > 0) redirect(`/boards/${sharedBoards[0].id}`);
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-12 text-sm">
        No boards yet. Create one from the sidebar.
      </div>
    );
  }

  // There is something in Trash — render an index so it's reachable. Live boards
  // (also in the sidebar) are listed as links so the page stays navigable.
  const hasLiveBoards = boards.length > 0 || sharedBoards.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">Boards</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Pick a board from the sidebar, or recover an archived one below.
        </p>
      </div>

      {hasLiveBoards ? (
        <section className="bg-surface rounded-md border">
          <ul>
            {boards.map((board, i) => (
              <li key={board.id} className={i > 0 ? "border-t" : undefined}>
                <Link
                  href={`/boards/${board.id}`}
                  className="hover:bg-state-hover flex items-center rounded-md px-3 py-2 text-sm transition-colors"
                >
                  <span className="min-w-0 flex-1 truncate">{board.name}</span>
                </Link>
              </li>
            ))}
            {sharedBoards.map((board) => (
              <li
                key={board.id}
                className={boards.length > 0 ? "border-t" : undefined}
              >
                <Link
                  href={`/boards/${board.id}`}
                  className="hover:bg-state-hover flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors"
                >
                  <span className="min-w-0 flex-1 truncate">{board.name}</span>
                  <span className="text-muted-foreground text-xs">Shared</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ArchivedBoardsSection boards={archivedBoards} />
    </div>
  );
}
