"use client";

import { useState } from "react";
import type { ColumnOption } from "@/lib/validations/boards";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Settings = Record<string, unknown> & { options?: ColumnOption[] };

/** Member shape for the People editor — defined locally to avoid the
 * `server-only` import that `OrgMember` from `@/lib/boards/queries` carries. */
export type EditorMember = {
  userId: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
};

type EditorProps<V> = {
  value: V | null;
  settings: Settings;
  onCommit: (value: V) => void;
  onCancel: () => void;
  /** Clear the cell entirely (deletes the row). Falls back to onCancel. */
  onClear?: () => void;
};

/** Shared key handling: Enter commits, Escape cancels. */
function useCommitKeys(commit: () => void, cancel: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };
}

/**
 * A floating popover surface for selector editors (Status/Dropdown/People).
 * Built on Radix Popover so it portals to the body — escaping the board's
 * `overflow-auto` scroll containers — and flips/shifts to stay on screen, so
 * every option is reachable however near the viewport edge the cell sits
 * (Monday-style). Monochrome chrome; color is earned only by the pills inside.
 *
 * `--radix-popover-content-available-height` caps the surface to the space the
 * collision detector measured, and the inner list scrolls beyond that.
 */
function PopoverSurface({
  label,
  onCancel,
  children,
}: {
  label: string;
  /** Fired when the popover is dismissed (Escape or outside click). */
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <Popover
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      {/* Anchors the floating surface to the cell it edits. */}
      <PopoverAnchor className="absolute inset-0" aria-hidden />
      <PopoverContent
        role="listbox"
        aria-label={label}
        align="start"
        sideOffset={4}
        className="flex max-h-[min(20rem,var(--radix-popover-content-available-height))] min-w-[12rem] flex-col gap-0.5 overflow-auto p-1"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function TextEditor({
  value,
  onCommit,
  onCancel,
}: EditorProps<{ text: string }>) {
  const [text, setText] = useState(value?.text ?? "");
  const onKey = useCommitKeys(() => onCommit({ text }), onCancel);
  return (
    <Input
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={onKey}
      onBlur={() => onCommit({ text })}
      className="h-8"
    />
  );
}

export function NumbersEditor({
  value,
  onCommit,
  onCancel,
  onClear,
}: EditorProps<{ n: number }>) {
  const [raw, setRaw] = useState(value ? String(value.n) : "");
  function commit() {
    const trimmed = raw.trim();
    // Emptying a previously-set cell clears it (deletes the row).
    if (trimmed === "") return (onClear ?? onCancel)();
    const n = Number(trimmed);
    if (Number.isNaN(n)) return onCancel();
    onCommit({ n });
  }
  const onKey = useCommitKeys(commit, onCancel);
  return (
    <Input
      type="number"
      autoFocus
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onKeyDown={onKey}
      onBlur={commit}
      className="h-8 tabular-nums"
    />
  );
}

export function StatusEditor({
  value,
  settings,
  onCommit,
  onCancel,
  onClear,
}: EditorProps<{ optionId: string | null }>) {
  const options = settings.options ?? [];
  const selected = value?.optionId ?? null;
  return (
    <PopoverSurface label="Select status" onCancel={onCancel}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="option"
          aria-selected={selected === o.id}
          onClick={() => onCommit({ optionId: o.id })}
          className="focus-visible:ring-ring inline-flex items-center justify-center rounded-md px-2 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none"
          style={{ backgroundColor: o.color }}
        >
          {o.label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => (onClear ?? onCancel)()}
        className="text-muted-foreground hover:bg-accent focus-visible:ring-ring rounded-md px-2 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        Clear
      </button>
    </PopoverSurface>
  );
}

export function DropdownEditor({
  value,
  settings,
  onCommit,
  onCancel,
  onClear,
}: EditorProps<{ optionIds: string[] }>) {
  const options = settings.options ?? [];
  const [selected, setSelected] = useState<string[]>(value?.optionIds ?? []);
  function toggle(id: string) {
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    setSelected(next);
    // An empty selection clears the cell (deletes the row).
    if (next.length === 0) return (onClear ?? onCancel)();
    onCommit({ optionIds: next });
  }
  return (
    <PopoverSurface label="Select options" onCancel={onCancel}>
      {options.map((o) => {
        const isSelected = selected.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            role="option"
            aria-selected={isSelected}
            onClick={() => toggle(o.id)}
            className={cn(
              "focus-visible:ring-ring inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-white transition-opacity focus-visible:ring-2 focus-visible:outline-none",
              isSelected ? "opacity-100" : "opacity-60 hover:opacity-90",
            )}
            style={{ backgroundColor: o.color }}
          >
            {o.label}
          </button>
        );
      })}
    </PopoverSurface>
  );
}

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
  return (
    <PopoverSurface label="Assign people" onCancel={onCancel}>
      {members.length === 0 ? (
        <span className="text-muted-foreground px-2 py-1 text-sm">
          No members
        </span>
      ) : (
        members.map((m) => {
          const isSelected = selected.includes(m.userId);
          const name = m.fullName ?? m.email ?? m.userId;
          return (
            <button
              key={m.userId}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => toggle(m.userId)}
              className={cn(
                "hover:bg-accent focus-visible:ring-ring flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none",
                isSelected && "bg-accent",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  isSelected ? "bg-primary" : "bg-muted-foreground/40",
                )}
              />
              <span className="truncate">{name}</span>
            </button>
          );
        })
      )}
    </PopoverSurface>
  );
}

export function DateEditor({
  value,
  onCommit,
  onCancel,
  onClear,
}: EditorProps<{ date: string; end?: string }>) {
  const [date, setDate] = useState(value?.date ?? "");
  function commit() {
    // Emptying a previously-set date clears it (deletes the row).
    if (date.trim() === "") return (onClear ?? onCancel)();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return onCancel();
    onCommit({ date });
  }
  const onKey = useCommitKeys(commit, onCancel);
  return (
    <Input
      type="date"
      aria-label="Date"
      autoFocus
      value={date}
      onChange={(e) => setDate(e.target.value)}
      onKeyDown={onKey}
      onBlur={commit}
      className="h-8"
    />
  );
}

/** Dispatch a cell to its kind's editor. Clearing maps to onCommit of an empty value. */
export function CellEditor({
  kind,
  value,
  settings,
  members,
  onCommit,
  onCancel,
  onClear,
}: {
  kind: string;
  value: unknown;
  settings: Settings;
  members?: EditorMember[];
  onCommit: (value: unknown) => void;
  onCancel: () => void;
  onClear?: () => void;
}) {
  switch (kind) {
    case "text":
      return (
        <TextEditor
          value={value as { text: string } | null}
          settings={settings}
          onCommit={onCommit}
          onCancel={onCancel}
          onClear={onClear}
        />
      );
    case "numbers":
      return (
        <NumbersEditor
          value={value as { n: number } | null}
          settings={settings}
          onCommit={onCommit}
          onCancel={onCancel}
          onClear={onClear}
        />
      );
    case "status":
      return (
        <StatusEditor
          value={value as { optionId: string | null } | null}
          settings={settings}
          onCommit={onCommit}
          onCancel={onCancel}
          onClear={onClear}
        />
      );
    case "dropdown":
      return (
        <DropdownEditor
          value={value as { optionIds: string[] } | null}
          settings={settings}
          onCommit={onCommit}
          onCancel={onCancel}
          onClear={onClear}
        />
      );
    case "people":
      return (
        <PeopleEditor
          value={value as { userIds: string[] } | null}
          settings={settings}
          members={members}
          onCommit={onCommit}
          onCancel={onCancel}
          onClear={onClear}
        />
      );
    case "date":
      return (
        <DateEditor
          value={value as { date: string; end?: string } | null}
          settings={settings}
          onCommit={onCommit}
          onCancel={onCancel}
          onClear={onClear}
        />
      );
    default:
      return null;
  }
}
