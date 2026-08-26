"use client";

import { useEffect, useState } from "react";
import {
  Play,
  Square,
  Plus,
  Clock,
  Pencil,
  Trash2,
  Calendar as CalendarIcon,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFieldStatus } from "@/components/ui/field-status";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import {
  parseDuration,
  formatDuration,
  trackedSeconds,
  type TimeEntryLike,
} from "@/lib/boards/time-format";
import { isoToLocalDate, localDateToISO } from "@/lib/boards/iso-date";
import type { CacheTimeEntry } from "@/lib/boards/cache";

export type TimeTrackingCellProps = {
  entries: readonly CacheTimeEntry[];
  estimateSeconds: number | null;
  currentUserId: string;
  /** Injectable for tests; live interval only starts when this is undefined and a timer is running. */
  nowMs?: number;
  onStart: () => void;
  onStop: (entryId: string) => void;
  onAddManual: (date: string, durationSecs: number) => void;
  onEdit: (entryId: string, date: string, durationSecs: number) => void;
  onDelete: (entryId: string) => void;
  onSetEstimate: (estimateSeconds: number | null) => void;
};

export function TimeTrackingCell(props: TimeTrackingCellProps) {
  const { entries, estimateSeconds, currentUserId, onStart, onStop } = props;

  const running = entries.find(
    (e) => e.ended_at == null && e.user_id === currentUserId,
  );

  // Live tick only while a timer runs and no fixed nowMs is injected (tests).
  // When `props.nowMs` is provided it acts as a pinned clock (tests); when
  // absent the interval drives the display while a timer is active.
  const [tickMs, setTickMs] = useState(() => props.nowMs ?? Date.now());
  useEffect(() => {
    if (props.nowMs != null || !running) return;
    const id = setInterval(() => setTickMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [props.nowMs, running]);

  const nowMs = props.nowMs ?? tickMs;

  const total = trackedSeconds(entries as readonly TimeEntryLike[], nowMs);
  const isEmpty = entries.length === 0 && estimateSeconds == null;

  return (
    <Popover>
      <div className="flex items-center gap-1">
        {/* Collapsed trigger: time display */}
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Open time tracking"
            className={cn(
              "flex items-center gap-1 rounded px-1 py-0.5 text-sm transition-colors",
              "hover:bg-state-hover focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              isEmpty && "text-muted-foreground/40",
              !isEmpty && "text-foreground",
            )}
          >
            {running && (
              <span
                aria-label="Timer running"
                className="bg-primary size-1.5 animate-pulse rounded-full"
              />
            )}
            <span className="tabular-nums">
              {isEmpty ? <Clock className="size-3.5" /> : formatDuration(total)}
            </span>
            {estimateSeconds != null && !isEmpty && (
              <span className="text-muted-foreground">
                {" / "}
                {formatDuration(estimateSeconds)}
              </span>
            )}
          </button>
        </PopoverTrigger>

        {/* Start / Stop quick-action button (always visible, outside popover) */}
        {running ? (
          <button
            type="button"
            aria-label="Stop timer"
            onClick={(e) => {
              e.stopPropagation();
              onStop(running.id);
            }}
            className={cn(
              "text-muted-foreground hover:text-foreground flex items-center justify-center rounded p-0.5 transition-colors pointer-coarse:size-11",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
            )}
          >
            <Square className="size-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Start timer"
            onClick={(e) => {
              e.stopPropagation();
              onStart();
            }}
            className={cn(
              "text-muted-foreground hover:text-foreground flex items-center justify-center rounded p-0.5 transition-colors pointer-coarse:size-11",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
            )}
          >
            <Play className="size-3.5 fill-current" />
          </button>
        )}
      </div>

      <PopoverContent align="start" className="w-80 p-0">
        <TimeTrackingPopover
          {...props}
          nowMs={nowMs}
          running={running}
          total={total}
        />
      </PopoverContent>
    </Popover>
  );
}

// ─── Popover body (split to keep the main component lean) ───────────────────

type PopoverProps = TimeTrackingCellProps & {
  nowMs: number;
  running: CacheTimeEntry | undefined;
  total: number;
};

function TimeTrackingPopover({
  entries,
  estimateSeconds,
  currentUserId,
  nowMs,
  running,
  total,
  onStart,
  onStop,
  onAddManual,
  onEdit,
  onDelete,
  onSetEstimate,
}: PopoverProps) {
  const [estimateInput, setEstimateInput] = useState(
    estimateSeconds != null ? formatDuration(estimateSeconds) : "",
  );
  const [estimateError, setEstimateError] = useState(false);

  const [addDuration, setAddDuration] = useState("");
  const [addDate, setAddDate] = useState(todayIso());
  const [addError, setAddError] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDuration, setEditDuration] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editError, setEditError] = useState(false);
  // Each "Use e.g. 1h 30m" hint is the accessible description of the field it
  // rejects — hand-written `aria-invalid` alone told a screen-reader user the
  // value was wrong but never why.
  const estimateStatus = useFieldStatus(
    estimateError ? "Use e.g. 1h 30m" : null,
  );
  const editStatus = useFieldStatus(editError ? "Use e.g. 1h 30m" : null);
  const addStatus = useFieldStatus(addError ? "Use e.g. 1h 30m or 90m" : null);

  // Chronological sort: running entry always first, then oldest→newest by started_at.
  const sorted = [...entries].sort((a, b) => {
    if (a.ended_at == null) return -1;
    if (b.ended_at == null) return 1;
    return a.started_at.localeCompare(b.started_at);
  });

  function commitEstimate() {
    const s = estimateInput.trim();
    if (!s) {
      onSetEstimate(null);
      setEstimateError(false);
      return;
    }
    const parsed = parseDuration(s);
    if (parsed == null) {
      setEstimateError(true);
      return;
    }
    setEstimateError(false);
    onSetEstimate(parsed);
  }

  function commitAdd() {
    const parsed = parseDuration(addDuration);
    if (parsed == null) {
      setAddError(true);
      return;
    }
    setAddError(false);
    onAddManual(addDate, parsed);
    setAddDuration("");
    setAddDate(todayIso());
  }

  function startEdit(e: CacheTimeEntry) {
    setEditingId(e.id);
    setEditDuration(
      e.duration_secs != null ? formatDuration(e.duration_secs) : "",
    );
    setEditDate(e.started_at.slice(0, 10));
    setEditError(false);
  }

  function commitEdit(id: string) {
    const parsed = parseDuration(editDuration);
    if (parsed == null) {
      setEditError(true);
      return;
    }
    setEditError(false);
    onEdit(id, editDate, parsed);
    setEditingId(null);
  }

  return (
    <div className="flex flex-col">
      {/* Header: total + estimate + start/stop */}
      <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Clock className="text-muted-foreground size-3.5" />
          <span className="text-sm font-medium tabular-nums">
            {formatDuration(total)}
          </span>
          <span className="text-muted-foreground text-xs">tracked</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="flex flex-col">
            <Input
              aria-label="Estimate"
              placeholder="Estimate"
              value={estimateInput}
              onChange={(e) => {
                setEstimateInput(e.target.value);
                setEstimateError(false);
              }}
              onBlur={commitEstimate}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEstimate();
              }}
              className={cn(
                "h-6 w-24 px-1.5 text-xs tabular-nums",
                estimateError && "border-destructive",
              )}
              {...estimateStatus.controlProps}
            />
            {estimateStatus.message && (
              <span
                {...estimateStatus.messageProps}
                className="text-destructive mt-0.5 text-xs"
              >
                {estimateStatus.message}
              </span>
            )}
          </div>
          {running ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => onStop(running.id)}
              className="h-6 px-2 text-xs"
            >
              <Square className="mr-1 size-3 fill-current" />
              Stop
            </Button>
          ) : (
            <Button size="sm" onClick={onStart} className="h-6 px-2 text-xs">
              <Play className="mr-1 size-3 fill-current" />
              Start
            </Button>
          )}
        </div>
      </div>

      {/* Entry list */}
      {sorted.length > 0 && (
        <ul className="divide-border max-h-56 divide-y overflow-y-auto">
          {sorted.map((e) => {
            const isRunning = e.ended_at == null;
            const secs = isRunning
              ? trackedSeconds([e as TimeEntryLike], nowMs)
              : (e.duration_secs ?? 0);
            const isMine = e.user_id === currentUserId;

            if (editingId === e.id) {
              return (
                <li key={e.id} className="flex flex-col gap-1 px-3 py-1.5">
                  <div className="flex items-center gap-1">
                    <Input
                      aria-label="Edit duration"
                      value={editDuration}
                      onChange={(ev) => {
                        setEditDuration(ev.target.value);
                        setEditError(false);
                      }}
                      className={cn(
                        "h-6 w-20 px-1.5 text-xs tabular-nums",
                        editError && "border-destructive",
                      )}
                      {...editStatus.controlProps}
                    />
                    <DatePickerButton
                      ariaLabel="Edit date"
                      value={editDate}
                      onChange={setEditDate}
                    />
                    <Button
                      size="xs"
                      onClick={() => commitEdit(e.id)}
                      className="h-6 px-2 text-xs"
                    >
                      Save
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                      className="h-6 px-1 text-xs"
                    >
                      Cancel
                    </Button>
                  </div>
                  {editStatus.message && (
                    <span
                      {...editStatus.messageProps}
                      className="text-destructive text-xs"
                    >
                      {editStatus.message}
                    </span>
                  )}
                </li>
              );
            }

            return (
              <li
                key={e.id}
                className="group flex items-center gap-2 px-3 py-1.5"
              >
                {isRunning && (
                  <span className="bg-primary size-1.5 animate-pulse rounded-full" />
                )}
                <span className="min-w-[3.5rem] text-xs font-medium tabular-nums">
                  {formatDuration(secs)}
                </span>
                <span className="text-muted-foreground flex-1 truncate text-xs">
                  {e.started_at.slice(0, 10)}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {e.user_id === currentUserId ? "You" : e.user_id.slice(0, 8)}
                </span>
                {isMine && (
                  <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
                    <button
                      type="button"
                      aria-label="Edit entry"
                      onClick={() => startEdit(e)}
                      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring grid place-items-center rounded p-0.5 focus-visible:ring-2 focus-visible:outline-none pointer-coarse:size-11"
                    >
                      <Pencil className="size-3" />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete entry"
                      onClick={() => onDelete(e.id)}
                      className="text-muted-foreground hover:text-destructive focus-visible:ring-ring grid place-items-center rounded p-0.5 focus-visible:ring-2 focus-visible:outline-none pointer-coarse:size-11"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* + Add time row */}
      <div className="border-border border-t px-3 py-2">
        <div className="flex items-center gap-1">
          <Plus className="text-muted-foreground size-3.5 shrink-0" />
          <Input
            aria-label="Duration to add"
            placeholder="e.g. 1h 30m"
            value={addDuration}
            onChange={(e) => {
              setAddDuration(e.target.value);
              setAddError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitAdd();
            }}
            className={cn(
              "h-6 flex-1 px-1.5 text-xs tabular-nums",
              addError && "border-destructive",
            )}
            {...addStatus.controlProps}
          />
          <DatePickerButton
            ariaLabel="Date for manual entry"
            value={addDate}
            onChange={setAddDate}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Add time"
            onClick={commitAdd}
            className="h-6 px-2 text-xs"
          >
            Add
          </Button>
        </div>
        {addStatus.message && (
          <span
            {...addStatus.messageProps}
            className="text-destructive mt-1 block text-xs"
          >
            {addStatus.message}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Date picker (Calendar primitive, replaces native <input type=date>) ─────
// Click-to-open child popover anchored to a compact trigger — the date is one
// field among several in a dense row, so unlike DateEditor (which auto-opens
// because the cell *is* the editor) this opens on click. Renders identical,
// polished DOM in every browser (Safari draws no native calendar glyph).

function DatePickerButton({
  value,
  onChange,
  ariaLabel,
}: {
  /** Current date as `YYYY-MM-DD` (may be empty). */
  value: string;
  onChange: (iso: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? isoToLocalDate(value) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "border-input flex h-6 w-28 items-center gap-1 rounded-md border px-1.5 text-xs pointer-coarse:h-11",
            "hover:bg-state-hover focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          )}
        >
          <CalendarIcon className="text-muted-foreground size-3.5 shrink-0" />
          <span className="tabular-nums">
            {selected
              ? selected.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })
              : "Date"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="w-auto p-2">
        <Calendar
          mode="single"
          autoFocus
          defaultMonth={selected}
          selected={selected}
          onSelect={(picked) => {
            if (picked) {
              onChange(localDateToISO(picked));
              setOpen(false);
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
