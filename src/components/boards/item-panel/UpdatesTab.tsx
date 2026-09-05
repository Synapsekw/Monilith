"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RevealOnHover } from "@/components/ui/reveal-on-hover";
import { MentionTextarea } from "@/components/boards/item-panel/MentionTextarea";
import { DateTime } from "@/components/datetime/date-time";
import { ThreadSummary } from "@/components/ai/summarize/ThreadSummary";
import {
  mentionLabel,
  type AgentMentionTarget,
  type MentionTarget,
} from "@/lib/collaboration/mentions";
import type { UpdatesCache } from "@/lib/collaboration/cache";
import type { Member } from "@/lib/collaboration/activity";
import type { MentionTargetInput } from "@/lib/validations/collaboration-actions";

/**
 * Display-only accenting of mention tokens inside a persisted update body —
 * `@Full Name` for a person, `@handle` for an agent. Purely cosmetic: scans the
 * plain-text string for a known label after an `@`, and returns the original
 * text split into plain-string fragments interleaved with accented `<span>`s
 * for each match. Never mutates, reformats, or reparses the underlying text —
 * mention linking/notifications are driven by the separate tagged `mentions`
 * array, not by this render.
 */
function renderBody(text: string, names: string[]): ReactNode[] {
  // Longest label first so "@John Doe" is matched before a shorter "@John".
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

/** Stable empty default — a fresh `[]` literal would bust the targets memo on
 *  every render. */
const NO_AGENTS: readonly AgentMentionTarget[] = [];

/**
 * The agent marker `postAgentReply` writes into an agent-authored update's
 * `body`.
 *
 * Read for ATTRIBUTION only. An agent's reply is authored by the platform bot,
 * which is not an org member, so without this the author line falls through to
 * the "Someone" default — and "Someone" is exactly the ambiguity an agent
 * comment must not have. Absent (and the badge simply not rendered) on every
 * human comment and on every comment written before this shipped.
 */
function agentAuthor(
  body: unknown,
): { name: string; handle: string } | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const marker = (body as { agent?: unknown }).agent;
  if (typeof marker !== "object" || marker === null) return undefined;
  const { name, handle } = marker as { name?: unknown; handle?: unknown };
  if (typeof name !== "string" || typeof handle !== "string") return undefined;
  return { name, handle };
}

export function UpdatesTab({
  itemId,
  cache,
  isError = false,
  members,
  agents = NO_AGENTS,
  onAdd,
  onDelete,
}: {
  itemId: string;
  cache: UpdatesCache | undefined;
  isError?: boolean;
  members: readonly Member[];
  /** The author's own agents, addressable by `@handle`. Already loaded by the
   *  page — mention filtering is pure client state, so typing costs nothing. */
  agents?: readonly AgentMentionTarget[];
  onAdd: (text: string, mentions: MentionTargetInput[]) => void;
  onDelete: (updateId: string) => void;
}) {
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<MentionTargetInput[]>([]);
  const [open, setOpen] = useState(false);
  const threadIsEmpty = !cache || cache.updates.length === 0;

  const targets = useMemo<MentionTarget[]>(
    () => [...members.map((m) => ({ kind: "user" as const, ...m })), ...agents],
    [members, agents],
  );

  function reset() {
    setText("");
    setMentions([]);
    setOpen(false);
  }

  /** The full target behind a recorded (id-only) mention, if it is still known. */
  function resolve(m: MentionTargetInput): MentionTarget | undefined {
    return targets.find((t) =>
      m.kind === "agent"
        ? t.kind === "agent" && t.agentId === m.agentId
        : t.kind === "user" && t.userId === m.userId,
    );
  }

  function submit() {
    const t = text.trim();
    if (!t) return;
    // Drop targets whose label was edited back out before sending, so we don't
    // notify someone — or wake an agent — the final text no longer mentions.
    const present = mentions.filter((m) => {
      const target = resolve(m);
      return !!target && t.includes(mentionLabel(target));
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
            mentions={mentions}
            targets={targets}
            onChange={(t, next) => {
              setText(t);
              setMentions(next);
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

      <ThreadSummary itemId={itemId} disabled={threadIsEmpty} />

      {isError ? (
        <EmptyState variant="inline">
          Couldn&apos;t load updates. Reopen the item to try again.
        </EmptyState>
      ) : threadIsEmpty ? (
        <EmptyState variant="inline">No updates yet for this item.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {cache.updates.map((u) => {
            const bot = agentAuthor(u.body);
            return (
              <li
                key={u.id}
                className="group bg-surface-muted card-lift border-border hover:border-border-bright rounded-lg border p-3.5 text-sm"
              >
                <div className="text-muted-foreground mb-1 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2">
                    <span className="text-foreground font-extrabold">
                      {bot?.name ??
                        members.find((m) => m.userId === u.author_id)
                          ?.fullName ??
                        "Someone"}
                    </span>
                    {bot && (
                      <span className="text-kicker text-3xs border-border rounded border px-1 font-mono tracking-wide uppercase">
                        Agent
                      </span>
                    )}
                    <span className="text-kicker text-3xs font-mono tracking-wide uppercase">
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
                    targets.map((t) => mentionLabel(t).slice(1)),
                  )}
                </p>
                {u.edited_at && (
                  <span className="text-muted-foreground text-xs">
                    (edited)
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
