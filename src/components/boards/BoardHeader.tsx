"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  Eye,
  FileText,
  MoreHorizontal,
  Trash2,
  Upload,
  UserPlus,
  Zap,
} from "lucide-react";

import { ViewSwitcher } from "@/components/boards/ViewSwitcher";
import { BoardToolbar } from "@/components/boards/BoardToolbar";
import { BoardPresenceBar } from "@/components/boards/presence/BoardPresenceBar";
import { AutomationsDialog } from "@/components/boards/automations/AutomationsDialog";
import { ShareBoardDialog } from "@/components/boards/ShareBoardDialog";
import { BoardTrashDialog } from "@/components/boards/trash/BoardTrashDialog";
import { ExportMenu } from "@/components/boards/ExportMenu";
import { ImportWizard } from "@/components/boards/import/ImportWizard";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { BoardView } from "@/lib/boards/queries";
import type { CacheColumn } from "@/lib/boards/cache";
import type { BoardColumnRef } from "@/lib/boards/spreadsheet/match-columns";
import type { SynthOption } from "@/lib/boards/spreadsheet/types";
import { useBoardMutations } from "@/lib/boards/use-board-mutations";

export type HeaderMember = {
  userId: string;
  fullName: string | null;
  email: string | null;
};

export type HeaderGrant = { userId: string; access: "viewer" | "editor" };

export type HeaderGroup = { id: string; name: string };

export type BoardAccess = "owner" | "editor" | "viewer";

export function BoardHeader({
  boardId,
  boardName,
  views,
  selectedViewId,
  columns = [],
  members = [],
  groups = [],
  access = "owner",
  grants = [],
  currentUserId = "",
  filterable = false,
}: {
  boardId: string;
  boardName: string;
  views: BoardView[];
  selectedViewId: string;
  columns?: CacheColumn[];
  members?: HeaderMember[];
  /** Board groups, threaded into the automations builder (move-to-group action). */
  groups?: HeaderGroup[];
  /** The current user's access to this board. Owners can share; viewers are read-only. */
  access?: BoardAccess;
  /** Existing share grants, seeding the share dialog. Only meaningful for owners. */
  grants?: HeaderGrant[];
  /** Signed-in user id — powers the "My items" people quick-filter in the toolbar. */
  currentUserId?: string;
  /** Show the filter/sort/search toolbar. Only the Table + Kanban views apply it. */
  filterable?: boolean;
}) {
  const { renameBoard } = useBoardMutations(boardId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(boardName);
  const [isPending, startTransition] = useTransition();
  const [automationsOpen, setAutomationsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);

  // The import wizard's existing-board arm matches/targets columns by their
  // real board kind + synthesized options — the same shape the commit
  // Server Action reads off `columns.settings` (see `appendToExistingBoard`
  // in spreadsheet-actions.ts).
  const importBoardColumns: BoardColumnRef[] = useMemo(
    () =>
      columns.map((c) => {
        const settings = c.settings as { options?: SynthOption[] } | null;
        const options =
          (c.kind === "status" || c.kind === "dropdown") &&
          settings &&
          Array.isArray(settings.options)
            ? settings.options
            : [];
        return { id: c.id, name: c.name, kind: c.kind, options };
      }),
    [columns],
  );

  const isOwner = access === "owner";
  const isViewer = access === "viewer";

  function openRename() {
    setName(boardName);
    setEditing(true);
  }

  function commitRename() {
    const trimmed = name.trim();
    setEditing(false);
    if (!trimmed || trimmed === boardName) return;
    // `renameBoard` optimistically patches the shared BoardCache (React Query)
    // with the new name and rolls back on error, and `boardName` here is read
    // from that cache — so the header updates without a `router.refresh()`,
    // which would refetch the whole board (gotcha-09). The transition keeps the
    // input disabled while the mutation is in flight.
    startTransition(() => {
      renameBoard(trimmed);
    });
  }

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-6 py-2">
      {/* Title — compact, editable in place (stable h-7 line box). */}
      <div className="flex min-w-0 items-center gap-2">
        {editing && !isViewer ? (
          <Input
            autoFocus
            value={name}
            disabled={isPending}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
            aria-label="Board name"
            className="h-7 w-56 text-base font-bold"
          />
        ) : isViewer ? (
          <h1 className="flex h-7 items-center truncate text-base font-bold">
            {boardName}
          </h1>
        ) : (
          <button
            type="button"
            onClick={openRename}
            className="hover:text-muted-foreground focus-visible:ring-ring ease-keystone flex h-7 items-center truncate rounded-sm text-left text-base font-bold transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            {boardName}
          </button>
        )}
        {isViewer ? (
          <span className="bg-surface text-muted-foreground inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium">
            <Eye className="size-3.5" />
            View only
          </span>
        ) : null}
      </div>

      {/* Divider + inline view tabs. */}
      <span className="bg-border h-4 w-px shrink-0" aria-hidden />
      <ViewSwitcher
        boardId={boardId}
        views={views}
        selectedViewId={selectedViewId}
      />

      {/* Right control cluster — filter/search toolbar, presence, primary Share,
          and an overflow menu for the low-frequency board actions. */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {/* Filter / sort / search. In-page client state mirrored to the URL
            (History API) — 0 server round-trips; Table + Kanban read the same
            URL state and narrow/order the loaded cache in memory. */}
        {filterable ? (
          <BoardToolbar
            columns={columns}
            members={members}
            currentUserId={currentUserId}
          />
        ) : null}
        <BoardPresenceBar />
        {/* Export is a read — allowed for viewers. Icon-only to stay compact. */}
        <ExportMenu boardId={boardId} iconOnly />
        {/* Reports — a read surface (list + builder). Navigates to a real page,
            so a plain Link (not in-page state) is correct here. */}
        <Button type="button" variant="ghost" size="sm" asChild>
          <Link href={`/boards/${boardId}/reports`}>
            <FileText className="size-3.5" /> Report
          </Link>
        </Button>
        {isOwner ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Share board"
            onClick={() => setShareOpen(true)}
          >
            <UserPlus className="size-3.5" /> Share
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="More board actions"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setAutomationsOpen(true)}>
              <Zap className="size-3.5" /> Automations
            </DropdownMenuItem>
            {/* Import/Trash are board writes — hidden from viewers (the RPCs
                also reject them server-side). */}
            {!isViewer ? (
              <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                <Upload className="size-3.5" /> Import
              </DropdownMenuItem>
            ) : null}
            {!isViewer ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setTrashOpen(true)}>
                  <Trash2 className="size-3.5" /> Trash
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AutomationsDialog
        boardId={boardId}
        columns={columns}
        members={members}
        groups={groups}
        open={automationsOpen}
        onOpenChange={setAutomationsOpen}
      />
      <ImportWizard
        destination={{
          type: "existing",
          boardId,
          boardColumns: importBoardColumns,
          groups,
        }}
        open={importOpen}
        onOpenChange={setImportOpen}
      />
      {isOwner ? (
        <ShareBoardDialog
          boardId={boardId}
          members={members}
          grants={grants}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      ) : null}
      {!isViewer ? (
        <BoardTrashDialog
          boardId={boardId}
          open={trashOpen}
          onOpenChange={setTrashOpen}
        />
      ) : null}
    </header>
  );
}
