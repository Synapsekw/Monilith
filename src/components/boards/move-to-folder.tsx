"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { moveBoardToFolder } from "@/lib/folders/actions";
import { showMutationError } from "@/lib/ui/mutation-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type MoveBoardRequest = {
  boardId: string;
  /** `null` takes the board out of its folder. */
  folderId: string | null;
  /** Shown in the question when the target folder is shared. */
  folderName?: string;
  /** Runs once the board has actually moved. */
  onMoved?: () => void;
};

type MoveBoard = (request: MoveBoardRequest) => void;

type Question = { people: number; truncated: boolean };

/**
 * One attempt. Resolves to the question to ask (the server changed nothing and
 * wants a confirmation), or null when the move is done or failed and was
 * reported. `truncated` means the server capped its member read, so the count
 * is a lower bound.
 */
async function attemptMove(
  request: MoveBoardRequest,
  confirmShared: boolean,
): Promise<Question | null> {
  const res = await moveBoardToFolder(
    confirmShared
      ? { boardId: request.boardId, folderId: request.folderId, confirmShared }
      : { boardId: request.boardId, folderId: request.folderId },
  );
  if (!res.ok) {
    showMutationError("Couldn't move the board.", new Error(res.error));
    return null;
  }
  if (res.data?.needsConfirm)
    return { people: res.data.needsConfirm, truncated: res.data.truncated };
  request.onMoved?.();
  return null;
}

/**
 * With no host mounted there is nowhere to ask, so a move into a shared
 * folder is refused rather than done unasked.
 */
const MoveBoardContext = createContext<MoveBoard>((request) => {
  void attemptMove(request, false).then((question) => {
    if (question)
      showMutationError(
        "Couldn't move the board.",
        new Error("That folder is shared. Move the board from the sidebar."),
      );
  });
});

/** File a board into a folder (or out of one), asking first when that would
 *  give the folder's people access to it. */
export function useMoveBoardToFolder(): MoveBoard {
  return useContext(MoveBoardContext);
}

/**
 * Owns the "move into a shared folder?" question for everything beneath it.
 * Mounted once in `BoardsNav`, above the board list, so neither a closing
 * dropdown nor the swap to the drag-enabled list can unmount the dialog.
 */
export function MoveBoardToFolderHost({ children }: { children: ReactNode }) {
  const [asking, setAsking] = useState<
    ({ request: MoveBoardRequest } & Question) | null
  >(null);

  const move = useCallback<MoveBoard>((request) => {
    void attemptMove(request, false).then((question) => {
      if (question) setAsking({ request, ...question });
    });
  }, []);

  return (
    <MoveBoardContext.Provider value={move}>
      {children}
      <AlertDialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) setAsking(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move into a shared folder?</AlertDialogTitle>
            <AlertDialogDescription>
              {asking
                ? `${asking.truncated ? "At least " : ""}${asking.people} ${asking.people === 1 ? "person" : "people"} in ${asking.request.folderName ?? "this folder"} will have access to this board.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (asking) void attemptMove(asking.request, true);
                setAsking(null);
              }}
            >
              Move board
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MoveBoardContext.Provider>
  );
}
