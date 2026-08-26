"use client";

import { Fragment, type ReactNode } from "react";
import type { SharedBoardEntry } from "@/lib/boards/queries";
import type { BoardFolder } from "@/lib/boards/folders/types";
import { SharedBoardRow } from "@/components/boards/SharedBoardRow";

/**
 * The "Shared with me" block of unfiled shared boards.
 *
 * It lives in its own component because it renders in BOTH nav trees — the
 * plain one and the lazy drag one — and the heading must not be written twice.
 * Only the ROW differs between them, so the drag tree passes `renderRow` to
 * swap in a draggable variant; everything else is defined once, here.
 */
export function SharedBoardsSection({
  boards,
  folders,
  activeBoardId,
  renderRow,
}: {
  boards: SharedBoardEntry[];
  folders: BoardFolder[];
  activeBoardId?: string;
  renderRow?: (board: SharedBoardEntry) => ReactNode;
}) {
  if (boards.length === 0) return null;

  return (
    <>
      <p className="text-muted-foreground px-3 pt-3 text-xs font-medium">
        Shared with me
      </p>
      {boards.map((board) => (
        <Fragment key={board.id}>
          {renderRow ? (
            renderRow(board)
          ) : (
            <SharedBoardRow
              board={board}
              isActive={board.id === activeBoardId}
              folders={folders}
              currentFolderId={null}
              // `leading` is omitted on purpose: SharedBoardRow's default IS
              // the inert 24px grip placeholder, so swapping in the drag tree
              // (which passes a real grip) doesn't shift the row horizontally.
            />
          )}
        </Fragment>
      ))}
    </>
  );
}
