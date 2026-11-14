"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import { Skeleton } from "@/components/ui/skeleton";
import { AskChat } from "@/components/ai/ask/AskChat";
import type { UIMessage } from "@/components/ai/ask/MessageList";
import { MonoAvatar } from "@/components/mono/MonoAvatar";
import { AgentChip } from "@/components/mono/MonoChip";
import { MonoNameColorForm } from "@/components/mono/MonoNameColorForm";
import {
  addMyMonoToBoard,
  createMyMono,
  removeMyMonoFromBoard,
} from "@/lib/monos/actions";
import { loadMyMonoThread } from "@/lib/monos/thread-actions";
import { brainLine, monoAccessibleLabel } from "@/lib/monos/labels";
import type { MyMono } from "@/lib/monos/types";
import {
  boardMembershipKey,
  monoThreadOf,
  useMyMonoStore,
} from "@/stores/my-mono";
import { railMood } from "./rail-mood";

/**
 * The right rail's My Mono tab (Personal Monos spec §9, Plan 2A).
 *
 * Budget: renders from props (the page's one `get_my_mono` read). The first
 * open of an awake Mono issues ONE Server Action for its latest thread; the
 * thread lives in `useMyMonoStore`, so switching tabs and back is free. The
 * "on this board" toggle is one Server Action and no refresh.
 */
export function MonoTab({
  boardId,
  initialMono,
  initialOnBoard,
  ownerName,
}: {
  boardId: string;
  initialMono: MyMono | null;
  initialOnBoard: boolean;
  ownerName: string | null;
}) {
  const router = useRouter();
  const [created, setCreated] = useState<MyMono | null>(null);
  const mono = created ?? initialMono;
  const [busy, setBusy] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [boardPending, startBoard] = useTransition();
  const threads = useMyMonoStore((s) => s.threads);
  const setThread = useMyMonoStore((s) => s.setThread);
  const newChat = useMyMonoStore((s) => s.newChat);
  const membership = useMyMonoStore((s) => s.membership);
  const setMembership = useMyMonoStore((s) => s.setMembership);
  const thread = mono ? monoThreadOf(threads, mono.userId) : null;
  const awake = mono !== null && mono.brain !== "none";
  const monoId = mono?.userId ?? null;
  const memberKey = monoId ? boardMembershipKey(monoId, boardId) : null;
  const onBoard =
    (memberKey !== null ? membership[memberKey] : undefined) ?? initialOnBoard;

  const loadThread = useCallback(
    async (id: string) => {
      setThread(id, { status: "loading" });
      try {
        const res = await loadMyMonoThread();
        if (res.ok)
          setThread(id, {
            status: "ready",
            conversationId: res.data.conversationId,
            messages: res.data.messages,
          });
        else setThread(id, { status: "error" });
      } catch {
        setThread(id, { status: "error" });
      }
    },
    [setThread],
  );

  useEffect(() => {
    if (!monoId || !awake || thread?.status !== "idle") return;
    void loadThread(monoId);
  }, [monoId, awake, thread?.status, loadThread]);

  const syncMessages = useCallback(
    (messages: UIMessage[]) => {
      if (monoId) setThread(monoId, { messages });
    },
    [monoId, setThread],
  );

  // Bubbles keep a static idle face so old turns never look busy; only the
  // thinking indicator shows the live mood. Hence no dependency on `busy`.
  const monoName = mono?.name;
  const monoColor = mono?.color;
  const speaker = useMemo(
    () =>
      monoName !== undefined && monoColor !== undefined
        ? {
            name: monoName,
            tint: monoColor,
            mark: (
              <MonoAvatar color={monoColor} mood="idle" size={22} label="" />
            ),
            thinkingMark: (
              <MonoAvatar
                color={monoColor}
                mood="thinking"
                size={22}
                label=""
              />
            ),
          }
        : undefined,
    [monoName, monoColor],
  );

  if (!mono) {
    return (
      <div
        data-scroll-container
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3.5 py-4"
      >
        <div className="flex flex-col gap-1">
          <Kicker size="xs">My Mono</Kicker>
          <h2 className="text-sm font-extrabold">Meet your Mono</h2>
          <p className="text-muted-foreground text-sm">
            Your own agent. Only you can chat with it, assign it or @mention it.
          </p>
        </div>
        <MonoNameColorForm
          submitLabel="Create my Mono"
          onSubmit={async (value) => {
            const res = await createMyMono(value);
            if (!res.ok) return res.error;
            setCreated(res.data);
            // Server data changed: the board's member payload gains the Mono
            // (updateTag already ran). One refresh, not a navigation.
            router.refresh();
            return null;
          }}
        />
      </div>
    );
  }

  const toggleBoard = () =>
    startBoard(async () => {
      setBoardError(null);
      const res = onBoard
        ? await removeMyMonoFromBoard({ boardId })
        : await addMyMonoToBoard({ boardId });
      if (res.ok)
        setMembership(boardMembershipKey(mono.userId, boardId), !onBoard);
      else setBoardError(res.error);
    });

  const mood = railMood({
    brain: mono.brain,
    busy,
    justCreated: created !== null,
  });
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 px-3.5 pt-3 pb-2">
        <MonoAvatar
          color={mono.color}
          mood={mood}
          size={56}
          label={monoAccessibleLabel(mono.name, ownerName)}
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <h2
              className="truncate text-sm font-extrabold"
              style={{
                color: `color-mix(in oklab, ${mono.color} 65%, var(--foreground))`,
              }}
            >
              {mono.name}
            </h2>
            <AgentChip />
          </div>
          <p className="text-muted-foreground text-xs">
            {brainLine(mono.brain, mono.keyProvider)}
          </p>
          <p className="text-muted-foreground text-xs">
            Only you can chat with, assign or @mention it.
          </p>
        </div>
      </div>

      <div className="mx-3.5 flex items-center gap-2 border-y py-1.5 text-xs">
        <span className="text-muted-foreground min-w-0 flex-1 truncate">
          {onBoard ? "On this board" : "Not on this board"}
        </span>
        <Button
          variant="ghost"
          size="xs"
          disabled={boardPending}
          onClick={toggleBoard}
        >
          {onBoard ? "Remove from this board" : "Add to this board"}
        </Button>
      </div>
      {boardError ? (
        <p role="alert" className="text-destructive px-3.5 pt-1.5 text-xs">
          {boardError}
        </p>
      ) : null}

      {!awake ? (
        // `chrome-reset`: an opaque card inside the dock's chrome scope.
        <div className="chrome-reset bg-surface mx-3.5 my-3 flex flex-col gap-2 rounded-lg border p-3">
          <p className="text-sm font-semibold">{mono.name} is asleep</p>
          <p className="text-muted-foreground text-xs">
            Give it a brain to wake it up: add an Anthropic or OpenAI API key.
            It runs on your key, and only while you chat with it.
          </p>
          <Button asChild size="sm" className="self-start">
            <Link href="/settings/ai">Add an API key</Link>
          </Button>
        </div>
      ) : thread?.status === "error" ? (
        <div className="flex items-center gap-2 px-3.5 py-2">
          <p className="text-destructive min-w-0 flex-1 text-xs">
            Couldn&apos;t load your chat.
          </p>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void loadThread(mono.userId)}
          >
            Try again
          </Button>
        </div>
      ) : thread?.status !== "ready" ? (
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading your chat"
          className="flex flex-col gap-2 px-3.5 py-3"
        >
          <Skeleton variant="chrome" className="h-4 w-2/3" />
          <Skeleton variant="chrome" className="h-4 w-1/2" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 pt-1.5 pr-2 pl-3.5">
            <Kicker size="xs" className="min-w-0 flex-1 truncate">
              Chat
            </Kicker>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="New chat with your Mono"
              className="text-muted-foreground hover:text-foreground"
              disabled={busy || thread.conversationId === null}
              onClick={() => newChat(mono.userId)}
            >
              <Plus className="size-4" />
            </Button>
          </div>
          <AskChat
            key={`${mono.userId}:${thread.chatKey}`}
            conversationId={thread.conversationId}
            initialMessages={thread.messages}
            monoId={mono.userId}
            surface="atmosphere"
            onStarted={(id) => setThread(mono.userId, { conversationId: id })}
            onTurnStart={() => setBusy(true)}
            // Supplying `onTurnComplete` is what stops AskChat's default
            // router.refresh() after every turn (gotcha-09).
            onTurnComplete={() => setBusy(false)}
            // Settles on every path: a failed turn must not leave the Mono
            // "thinking" for good.
            onTurnEnd={() => setBusy(false)}
            onMessagesChange={syncMessages}
            speaker={speaker}
          />
        </div>
      )}
    </div>
  );
}
