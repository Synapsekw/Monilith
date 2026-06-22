import { redirect } from "next/navigation";
import { listMyBoards, listSharedBoards } from "@/lib/boards/queries";

/**
 * Index for the `/boards` route. Without this page, navigating to `/boards`
 * (e.g. after deleting the currently-active board in BoardItemMenu) 404s — the
 * route otherwise only has the `[boardId]` dynamic segment. Redirects to the
 * first available board; mirrors the owned-then-shared fallback in `/home`.
 */
export default async function BoardsIndex() {
  const boards = await listMyBoards();
  if (boards.length > 0) redirect(`/boards/${boards[0].id}`);

  const sharedBoards = await listSharedBoards();
  if (sharedBoards.length > 0) redirect(`/boards/${sharedBoards[0].id}`);

  return (
    <div className="text-muted-foreground flex h-full items-center justify-center p-12 text-sm">
      No boards yet. Create one from the sidebar.
    </div>
  );
}
