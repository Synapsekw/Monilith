"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import type { ColumnOption } from "@/lib/validations/boards";
import { isHttpUrl } from "@/lib/validations/boards";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { addDaysISO, diffDaysISO } from "@/lib/boards/calendar";
import { isoToLocalDate, localDateToISO } from "@/lib/boards/iso-date";
import { cn } from "@/lib/utils";
import { pillTextColor } from "@/lib/boards/contrast";
import {
  ClearOptionButton,
  StatusOptionList,
  parsePercentInput,
} from "./status-options";
import { currencyOf, roundToCurrency } from "@/lib/boards/currency";

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

export function PercentEditor({
  value,
  onCommit,
  onCancel,
  onClear,
}: EditorProps<{ percent: number }>) {
  const [raw, setRaw] = useState(value ? String(value.percent) : "");
  function commit() {
    const parsed = parsePercentInput(raw);
    // Emptying a previously-set cell clears it (deletes the row).
    if (parsed.kind === "clear") return (onClear ?? onCancel)();
    if (parsed.kind === "invalid") return onCancel();
    onCommit({ percent: parsed.percent });
  }
  const onKey = useCommitKeys(commit, onCancel);
  return (
    <Input
      type="number"
      min={0}
      max={100}
      autoFocus
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onKeyDown={onKey}
      onBlur={commit}
      className="h-8 tabular-nums"
    />
  );
}

export function CurrencyEditor({
  value,
  settings,
  onCommit,
  onCancel,
  onClear,
}: EditorProps<{ amount: number }>) {
  const code = currencyOf(settings);
  const [raw, setRaw] = useState(value ? String(value.amount) : "");
  function commit() {
    const trimmed = raw.trim();
    // Emptying a previously-set cell clears it (deletes the row).
    if (trimmed === "") return (onClear ?? onCancel)();
    const n = Number(trimmed);
    if (Number.isNaN(n)) return onCancel();
    // Normalize to the currency's minor units (USD→2dp, JPY→0, KWD→3).
    onCommit({ amount: roundToCurrency(n, code) });
  }
  const onKey = useCommitKeys(commit, onCancel);
  return (
    <div className="flex h-8 items-center gap-1.5">
      <span className="text-muted-foreground shrink-0 text-xs">{code}</span>
      <Input
        type="number"
        autoFocus
        aria-label="Amount"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
        className="h-8 tabular-nums"
      />
    </div>
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
      <StatusOptionList
        options={options}
        selected={selected}
        onSelect={(optionId) => onCommit({ optionId })}
        onClear={() => (onClear ?? onCancel)()}
      />
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
              "focus-visible:ring-ring inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium transition-opacity focus-visible:ring-2 focus-visible:outline-none",
              isSelected ? "opacity-100" : "opacity-60 hover:opacity-90",
            )}
            style={{ backgroundColor: o.color, color: pillTextColor(o.color) }}
          >
            {o.label}
          </button>
        );
      })}
      <ClearOptionButton onClear={() => (onClear ?? onCancel)()} />
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
      <ClearOptionButton onClear={() => (onClear ?? onCancel)()} />
    </PopoverSurface>
  );
}

export function DateEditor({
  value,
  onCommit,
  onCancel,
  onClear,
}: EditorProps<{ date: string; end?: string }>) {
  const selected = value?.date ? isoToLocalDate(value.date) : undefined;
  function commit(picked: Date) {
    const date = localDateToISO(picked);
    // Preserve an existing range end by shifting it the same number of days, so
    // editing a multi-day item's start doesn't silently collapse its Gantt /
    // Calendar span. Single-day values stay date-only (no synthesised end).
    if (value?.date && value.end && value.end > value.date) {
      const span = diffDaysISO(value.date, value.end);
      onCommit({ date, end: addDaysISO(date, span) });
    } else {
      onCommit({ date });
    }
  }
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
        aria-label="Pick a date"
        align="start"
        sideOffset={4}
        className="w-auto p-2"
      >
        <Calendar
          mode="single"
          autoFocus
          defaultMonth={selected}
          selected={selected}
          onSelect={(picked) => {
            if (picked) commit(picked);
          }}
        />
        <div className="mt-1 flex justify-end border-t pt-1">
          <ClearOptionButton onClear={() => (onClear ?? onCancel)()} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function CheckboxEditor({
  value,
  onCommit,
}: EditorProps<{ checked: boolean }>) {
  const checked = value?.checked ?? false;
  return (
    <div className="flex h-8 items-center px-1">
      {/* The native checkbox stays visually `size-4`; on a coarse pointer the
          surrounding label is a ≥44px tap target so a finger can toggle it. */}
      <label className="grid cursor-pointer place-items-center pointer-coarse:size-11">
        <input
          type="checkbox"
          aria-label="Toggle"
          checked={checked}
          autoFocus
          onChange={() => onCommit({ checked: !checked })}
          className="size-4"
        />
      </label>
    </div>
  );
}

export function RatingEditor({
  value,
  onCommit,
  onClear,
  onCancel,
}: EditorProps<{ rating: number }>) {
  const current = value?.rating ?? 0;
  return (
    <PopoverSurface label="Set rating" onCancel={onCancel}>
      <div className="flex items-center gap-1 p-1 pointer-coarse:gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            aria-label={`${i} stars`}
            onClick={() =>
              i === current ? (onClear ?? onCancel)() : onCommit({ rating: i })
            }
            className="grid place-items-center pointer-coarse:size-11"
          >
            <Star
              className={`size-5 ${i <= current ? "fill-current text-amber-400" : "text-muted-foreground/40"}`}
            />
          </button>
        ))}
      </div>
    </PopoverSurface>
  );
}

export function LinkEditor({
  value,
  onCommit,
  onCancel,
}: EditorProps<{ url: string; text?: string }>) {
  const [url, setUrl] = useState(value?.url ?? "");
  const [text, setText] = useState(value?.text ?? "");
  const [err, setErr] = useState<string | null>(null);
  const commit = () => {
    if (!isHttpUrl(url)) {
      setErr("Enter a valid http or https URL");
      return;
    }
    onCommit({ url, ...(text ? { text } : {}) });
  };
  return (
    <PopoverSurface label="Edit link" onCancel={onCancel}>
      <div className="flex w-56 flex-col gap-1 p-1">
        <Input
          autoFocus
          aria-label="URL"
          placeholder="https://…"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setErr(null);
          }}
          className="h-8"
        />
        <Input
          aria-label="Label"
          placeholder="Label (optional)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-8"
        />
        {err && <span className="text-destructive text-xs">{err}</span>}
        <button type="button" className="self-end text-xs" onClick={commit}>
          Save
        </button>
      </div>
    </PopoverSurface>
  );
}

function TextLikeEditor({
  label,
  initial,
  validate,
  build,
  onCommit,
  onCancel,
}: {
  label: string;
  initial: string;
  validate: (s: string) => string | null;
  build: (s: string) => unknown;
  onCommit: (v: unknown) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const commit = () => {
    const e = validate(s);
    if (e) {
      setErr(e);
      return;
    }
    onCommit(build(s));
  };
  const onKey = useCommitKeys(commit, onCancel);
  return (
    <div className="flex flex-col gap-1">
      <Input
        autoFocus
        aria-label={label}
        value={s}
        onChange={(e) => {
          setS(e.target.value);
          setErr(null);
        }}
        onKeyDown={onKey}
        className="h-8"
      />
      {err && <span className="text-destructive text-xs">{err}</span>}
      <button type="button" className="self-end text-xs" onClick={commit}>
        Save
      </button>
    </div>
  );
}

export function EmailEditor({
  value,
  onCommit,
  onCancel,
}: EditorProps<{ email: string }>) {
  return (
    <TextLikeEditor
      label="Email"
      initial={value?.email ?? ""}
      onCommit={onCommit as (v: unknown) => void}
      onCancel={onCancel}
      validate={(s) =>
        /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? null : "Enter a valid email"
      }
      build={(s) => ({ email: s })}
    />
  );
}

export function PhoneEditor({
  value,
  onCommit,
  onCancel,
}: EditorProps<{ phone: string }>) {
  return (
    <TextLikeEditor
      label="Phone"
      initial={value?.phone ?? ""}
      onCommit={onCommit as (v: unknown) => void}
      onCancel={onCancel}
      validate={(s) => (s.trim().length ? null : "Enter a phone number")}
      build={(s) => ({ phone: s.trim() })}
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
    case "checkbox":
      return (
        <CheckboxEditor
          value={value as { checked: boolean } | null}
          settings={settings}
          onCommit={onCommit}
          onCancel={onCancel}
          onClear={onClear}
        />
      );
    case "rating":
      return (
        <RatingEditor
          value={value as { rating: number } | null}
          settings={settings}
          onCommit={onCommit}
          onCancel={onCancel}
          onClear={onClear}
        />
      );
    case "percent":
      return (
        <PercentEditor
          value={value as { percent: number } | null}
          settings={settings}
          onCommit={onCommit}
          onCancel={onCancel}
          onClear={onClear}
        />
      );
    case "currency":
      return (
        <CurrencyEditor
          value={value as { amount: number } | null}
          settings={settings}
          onCommit={onCommit}
          onCancel={onCancel}
          onClear={onClear}
        />
      );
    case "link":
      return (
        <LinkEditor
          value={value as { url: string; text?: string } | null}
          settings={settings}
          onCommit={onCommit}
          onCancel={onCancel}
          onClear={onClear}
        />
      );
    case "email":
      return (
        <EmailEditor
          value={value as { email: string } | null}
          settings={settings}
          onCommit={onCommit}
          onCancel={onCancel}
          onClear={onClear}
        />
      );
    case "phone":
      return (
        <PhoneEditor
          value={value as { phone: string } | null}
          settings={settings}
          onCommit={onCommit}
          onCancel={onCancel}
          onClear={onClear}
        />
      );
    // Files cells have no inline editor — upload/preview is handled directly in
    // BoardTable's EditableCell via FilesCell + the lightbox.
    case "files":
      return null;
    // Mirror cells are read-only reflections of a linked item's value — they are
    // never edited in place (the source data is owned by the linked board).
    case "mirror":
      return null;
    default:
      return null;
  }
}
