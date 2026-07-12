"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { Group } from "@/lib/boards/queries";
import { cn } from "@/lib/utils";
import { GROUP_COLORS } from "@/lib/boards/group-colors";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

export function GroupMenu({
  group,
  onRename,
  onSetColor,
  onDelete,
}: {
  group: Group;
  onRename: () => void;
  onSetColor: (color: string) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${group.name} group menu`}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring ml-auto grid size-7 shrink-0 place-items-center rounded-md opacity-0 transition-opacity group-hover/grouphdr:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none pointer-coarse:size-11 pointer-coarse:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem>
          <DropdownMenuSeparator />
          <div className="px-2 py-1.5">
            <p className="text-muted-foreground mb-1.5 text-xs">Color</p>
            <div className="grid grid-cols-6 gap-1.5">
              {GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Set color ${c}`}
                  onClick={() => {
                    onSetColor(c);
                    setOpen(false);
                  }}
                  style={{ backgroundColor: c }}
                  className={cn(
                    "focus-visible:ring-ring size-5 rounded-full focus-visible:ring-2 focus-visible:outline-none",
                    group.color.toLowerCase() === c.toLowerCase() &&
                      "ring-foreground ring-offset-background ring-2 ring-offset-1",
                  )}
                />
              ))}
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            onSelect={() => setConfirming(true)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &ldquo;{group.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This moves the group and all of its items to Trash. You can
              restore them from Trash.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={onDelete}
            >
              Move to Trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
