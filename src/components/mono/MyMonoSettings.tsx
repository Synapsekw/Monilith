"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MonoAvatar } from "./MonoAvatar";
import { AgentChip } from "./MonoChip";
import { MonoNameColorForm } from "./MonoNameColorForm";
import {
  createMyMono,
  removeMyMonoFromBoard,
  updateMyMono,
} from "@/lib/monos/actions";
import { brainLine, monoAccessibleLabel } from "@/lib/monos/labels";
import type { MonoBoard, MyMono } from "@/lib/monos/types";

export function MyMonoSettings({
  mono,
  boards: initialBoards,
  ownerName,
}: {
  mono: MyMono | null;
  boards: MonoBoard[];
  ownerName: string | null;
}) {
  const router = useRouter();
  const [boards, setBoards] = useState(initialBoards);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!mono) {
    return (
      <div className="max-w-sm py-4">
        <MonoNameColorForm
          submitLabel="Create my Mono"
          onSubmit={async (value) => {
            const res = await createMyMono(value);
            if (!res.ok) return res.error;
            router.refresh();
            return null;
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="flex items-center gap-3">
        <MonoAvatar
          color={mono.color}
          mood={mono.brain === "none" ? "dozing" : "idle"}
          size={56}
          label={monoAccessibleLabel(mono.name, ownerName)}
        />
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold">{mono.name}</span>
            <AgentChip />
          </div>
          <p className="text-muted-foreground text-sm">
            {brainLine(mono.brain, mono.keyProvider)}
          </p>
          {mono.brain === "none" ? (
            <Link href="/settings/ai" className="text-brand text-sm underline">
              Add an API key to wake it
            </Link>
          ) : null}
        </div>
      </div>

      <div className="max-w-sm">
        <MonoNameColorForm
          initialName={mono.name}
          initialColor={mono.color}
          submitLabel="Save"
          onSubmit={async (value) => {
            const res = await updateMyMono(value);
            if (!res.ok) return res.error;
            router.refresh();
            return null;
          }}
        />
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Boards it is on</h3>
        {boards.length === 0 ? (
          <p className="text-muted-foreground text-sm">Not on any board yet.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {boards.map((b) => (
              <li key={b.boardId} className="flex items-center gap-2 px-3 py-2">
                <Link
                  href={`/boards/${b.boardId}`}
                  className="min-w-0 flex-1 truncate text-sm hover:underline"
                >
                  {b.name}
                </Link>
                <span className="text-muted-foreground text-xs">
                  {b.accessLevel === "editor" ? "Can edit" : "Can view"}
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={pending}
                  aria-label={`Remove ${mono.name} from ${b.name}`}
                  onClick={() =>
                    startTransition(async () => {
                      setError(null);
                      try {
                        const res = await removeMyMonoFromBoard({
                          boardId: b.boardId,
                        });
                        if (res.ok)
                          setBoards((prev) =>
                            prev.filter((x) => x.boardId !== b.boardId),
                          );
                        else setError(res.error);
                      } catch {
                        setError("Something went wrong. Try again.");
                      }
                    })
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
