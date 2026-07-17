"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kicker } from "@/components/ui/kicker";
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
import {
  deleteConversation,
  renameConversation,
} from "@/lib/ai/ask/conversation-actions";
import type { ConversationRow } from "@/lib/ai/ask/conversations";

/** One rail row: a link to the thread, plus a rename/delete menu. Rename swaps
 *  the link for an inline input; delete confirms first. */
function RailRow({
  conversation,
  active,
}: {
  conversation: ConversationRow;
  active: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function commitRename() {
    const next = title.trim();
    setEditing(false);
    if (!next || next === conversation.title) {
      setTitle(conversation.title);
      return;
    }
    startTransition(async () => {
      const res = await renameConversation({
        conversationId: conversation.id,
        title: next,
      });
      if (!res.ok) setTitle(conversation.title);
      else router.refresh();
    });
  }

  function confirmDelete() {
    setConfirmOpen(false);
    startTransition(async () => {
      const res = await deleteConversation({ conversationId: conversation.id });
      if (res.ok) {
        if (active) router.push("/ask");
        router.refresh();
      }
    });
  }

  if (editing) {
    return (
      <li className="px-1">
        <Input
          autoFocus
          value={title}
          disabled={isPending}
          aria-label="Conversation title"
          className="h-8 text-sm"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitRename();
            } else if (e.key === "Escape") {
              setTitle(conversation.title);
              setEditing(false);
            }
          }}
        />
      </li>
    );
  }

  return (
    <li
      className={cn(
        "group/row hover:border-border-hover relative flex items-center rounded-md border border-transparent",
        active && "bg-primary/10 border-primary/25",
      )}
    >
      <Link
        href={`/ask/${conversation.id}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "min-w-0 flex-1 truncate px-3 py-2 text-sm",
          active
            ? "text-foreground"
            : "text-muted-foreground group-hover/row:text-foreground",
        )}
      >
        {conversation.title}
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Conversation actions"
            disabled={isPending}
            className="mr-1 shrink-0 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 pointer-coarse:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil className="size-4" /> Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            onSelect={() => setConfirmOpen(true)}
          >
            <Trash2 className="size-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{conversation.title}&rdquo; and its messages will be
              permanently removed. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive/10 text-destructive hover:bg-destructive/20"
              onClick={confirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

/**
 * The `/ask` conversation rail — replaces the Pulse nav in layout B. "New chat"
 * routes to the empty composer; each row links to its thread (an RSC navigation
 * that legitimately loads *different* server data — allowed under working
 * agreement #5). Rename/delete are Server Actions with a targeted refresh.
 */
export function ConversationRail({
  conversations,
}: {
  conversations: ConversationRow[];
}) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2 py-2">
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={() => router.push("/ask")}
        >
          <Plus className="size-4" /> New chat
        </Button>
      </div>

      <div className="px-3 pt-2 pb-1">
        <Kicker>Recent</Kicker>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {conversations.length === 0 ? (
          <p className="text-muted-foreground px-3 py-2 text-xs">
            No conversations yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {conversations.map((c) => (
              <RailRow
                key={c.id}
                conversation={c}
                active={pathname === `/ask/${c.id}`}
              />
            ))}
          </ul>
        )}
      </nav>
    </div>
  );
}
