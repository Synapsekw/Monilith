"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { Kicker } from "@/components/ui/kicker";
import { MemberAvatar } from "../member-avatar";
import { PopoverSurface } from "./popover-surface";
import { ClearOptionButton } from "./status-options";
import type { EditorMember, EditorProps } from "./types";

/**
 * The assignee picker. Opens onto WHO IS ON THE ITEM — the assigned members as
 * removable chips — and offers the rest of the directory below it, so the first
 * thing the popover answers is "who is tagged here?" rather than "who exists?".
 * Selection is local state seeded at mount; each toggle commits the whole id
 * list and the popover stays open (people columns are multi-assignee).
 */
export function PeopleEditor({
  value,
  onCommit,
  onCancel,
  onClear,
  members = [],
}: EditorProps<{ userIds: string[] }> & { members?: EditorMember[] }) {
  const [selected, setSelected] = useState<string[]>(value?.userIds ?? []);
  function toggle(id: string) {
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    setSelected(next);
    // No assignees clears the cell (deletes the row).
    if (next.length === 0) return (onClear ?? onCancel)();
    onCommit({ userIds: next });
  }
  const memberName = (m: EditorMember) => m.fullName ?? m.email ?? m.userId;
  // The two groups are disjoint — an assigned member is not repeated below —
  // and the assigned strip keeps the order the ids are stored in, so it reads
  // the same as the cell it edits.
  const assigned = selected
    .map((id) => members.find((m) => m.userId === id))
    .filter((m): m is EditorMember => Boolean(m));
  const unassigned = members.filter((m) => !selected.includes(m.userId));
  return (
    <PopoverSurface label="Assign people" onCancel={onCancel}>
      {members.length === 0 ? (
        <span className="text-muted-foreground px-2 py-1 text-sm">
          No members
        </span>
      ) : (
        <>
          <div
            role="group"
            aria-label="Assigned"
            className="flex flex-col gap-1 pb-1"
          >
            <Kicker size="xs" className="px-2 pt-1">
              Assigned {assigned.length > 0 ? assigned.length : null}
            </Kicker>
            {assigned.length === 0 ? (
              <span className="text-muted-foreground px-2 pb-1 text-xs">
                Nobody assigned yet — pick someone below.
              </span>
            ) : (
              <div className="flex flex-wrap gap-1 px-1">
                {assigned.map((m) => (
                  <button
                    key={m.userId}
                    type="button"
                    role="option"
                    aria-selected
                    aria-label={`Unassign ${memberName(m)}`}
                    onClick={() => toggle(m.userId)}
                    className="bg-surface hover:border-border-hover focus-visible:ring-ring flex max-w-full items-center gap-1.5 rounded-sm border py-0.5 pr-1.5 pl-0.5 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11"
                  >
                    <MemberAvatar
                      userId={m.userId}
                      name={memberName(m)}
                      avatarUrl={m.avatarUrl}
                    />
                    <span className="truncate">{memberName(m)}</span>
                    <X aria-hidden className="text-muted-foreground size-3" />
                  </button>
                ))}
              </div>
            )}
          </div>
          {unassigned.length > 0 ? (
            <div
              role="group"
              aria-label="Everyone else"
              className="flex flex-col gap-0.5 border-t pt-1"
            >
              <Kicker size="xs" className="px-2 pb-0.5">
                Everyone else
              </Kicker>
              {unassigned.map((m) => (
                <button
                  key={m.userId}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => toggle(m.userId)}
                  className="hover:bg-state-hover focus-visible:ring-ring flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11"
                >
                  <MemberAvatar
                    userId={m.userId}
                    name={memberName(m)}
                    avatarUrl={m.avatarUrl}
                  />
                  <span className="truncate">{memberName(m)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
      <ClearOptionButton onClear={() => (onClear ?? onCancel)()} />
    </PopoverSurface>
  );
}
