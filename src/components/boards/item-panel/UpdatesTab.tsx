"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RevealOnHover } from "@/components/ui/reveal-on-hover";
import { MentionTextarea } from "@/components/boards/item-panel/MentionTextarea";
import { DateTime } from "@/components/datetime/date-time";
import type { UpdatesCache } from "@/lib/collaboration/cache";
import type { Member } from "@/lib/collaboration/activity";

/**
 * Display-only accenting of `@Full Name` mention tokens inside a persisted
 * update body. Purely cosmetic: scans the plain-text string for occurrences
 * of a known member's full name after an `@`, and returns the original text
 * split into plain-string fragments interleaved with accented `<span>`s for
 * each match. Never mutates, reformats, or reparses the underlying text —
 * mention linking/notifications are driven by the separate `mentionIds`
 * array, not by this render.
 */
function renderBody(text: string, names: string[]): ReactNode[] {
  // Longest name first so "@John Doe" is matched before a shorter "@John".
  const candidates = Array.from(new Set(names.filter(Boolean))).sort(
    (a, b) => b.length - a.length,
  );
  if (candidates.length === 0) return [text];

  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  while (cursor < text.length) {
    if (text[cursor] === "@") {
      const name = candidates.find((candidate) => {
        if (!text.startsWith(candidate, cursor + 1)) return false;
        // Require a word boundary after the match so a member named "John"
        // doesn't get carved out of "@Johnny".
        const nextChar = text[cursor + 1 + candidate.length];
        return nextChar === undefined || !/[\p{L}\p{N}]/u.test(nextChar);
      });
      if (name) {
        nodes.push(
          <span key={key++} className="text-primary">
            {`@${name}`}
          </span>,
        );
        cursor += name.length + 1;
        continue;
      }
    }
    // Accumulate plain text up to (but not including) the next '@'.
    const nextAt = text.indexOf("@", cursor + 1);
    const end = nextAt === -1 ? text.length : nextAt;
    nodes.push(text.slice(cursor, end));
    cursor = end;
  }

  return nodes;
}

export function UpdatesTab({
  cache,
  isError = false,
  members,
  onAdd,
  onDelete,
}: {
  cache: UpdatesCache | undefined;
  isError?: boolean;
  members: readonly Member[];
  onAdd: (text: string, mentionIds: string[]) => void;
  onDelete: (updateId: string) => void;
}) {
  const [text, setText] = useState("");
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  function reset() {
    setText("");
    setMentionIds([]);
    setOpen(false);
  }

  function submit() {
    const t = text.trim();
    if (!t) return;
    // Drop ids whose `@Name` was edited back out before sending, so we don't
    // notify someone the final text no longer mentions.
    const present = mentionIds.filter((id) => {
      const m = members.find((x) => x.userId === id);
      return !!m?.fullName && t.includes(`@${m.fullName}`);
    });
    onAdd(t, present);
    reset();
  }

  return (
    <div className="flex flex-col gap-4">
      {!open ? (
        <Button
          variant="outline"
          className="text-muted-foreground w-full justify-start font-normal"
          onClick={() => setOpen(true)}
        >
          Write an update
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <MentionTextarea
            value={text}
            mentionIds={mentionIds}
            members={members}
            onChange={(t, ids) => {
              setText(t);
              setMentionIds(ids);
            }}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={submit}>
              Update
            </Button>
            <Button size="sm" variant="ghost" onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isError ? (
        <EmptyState variant="inline">
          Couldn&apos;t load updates. Reopen the item to try again.
        </EmptyState>
      ) : !cache || cache.updates.length === 0 ? (
        <EmptyState variant="inline">No updates yet for this item.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {cache.updates.map((u) => (
            <li
              key={u.id}
              className="group bg-surface-muted card-lift border-border hover:border-border-bright rounded-lg border p-3.5 text-sm"
            >
              <div className="text-muted-foreground mb-1 flex items-center justify-between text-xs">
                <span className="flex items-center gap-2">
                  <span className="text-foreground font-extrabold">
                    {members.find((m) => m.userId === u.author_id)?.fullName ??
                      "Someone"}
                  </span>
                  <span className="text-kicker font-mono text-[9.5px] tracking-wide uppercase">
                    <DateTime value={u.created_at} />
                  </span>
                </span>
                <RevealOnHover>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(u.id)}
                    aria-label="Delete update"
                  >
                    Delete
                  </Button>
                </RevealOnHover>
              </div>
              <p className="whitespace-pre-wrap">
                {renderBody(
                  u.body_text,
                  members.flatMap((m) => (m.fullName ? [m.fullName] : [])),
                )}
              </p>
              {u.edited_at && (
                <span className="text-muted-foreground text-xs">(edited)</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
