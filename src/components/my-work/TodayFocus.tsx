"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  Globe,
} from "lucide-react";
import { toast } from "sonner";
import { AskAiMark } from "@/components/brand/ask-ai-mark";
import { fireDoneBurst } from "@/components/ui/done-burst";
import { Kicker } from "@/components/ui/kicker";
import { LazyCalendar, preloadCalendar } from "@/components/ui/lazy-calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { STATUS_SOFT_TEXT } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import { addDaysISO } from "@/lib/boards/calendar";
import { isoToLocalDate, localDateToISO } from "@/lib/boards/iso-date";
import { markFocusItemDone, setFocusItemDueDate } from "@/lib/focus/actions";
import type { FocusItem, FocusResult } from "@/lib/focus/queries";
import { FOCUS_TIERS, focusTotal, type FocusTier } from "@/lib/focus/reason";
import { formatDue } from "@/lib/my-work/format";
import { armAskStart, startPromptFor } from "@/lib/ai/ask/start-prompts";

/** Rows shown at first. The database already limited the list. */
const COLLAPSED_ROWS = 7;
/** Rows each "Show more" adds, from rows already loaded with the page. */
const MORE_STEP = 10;

/**
 * Tier tones. "Due today" is the one group that carries the brand accent: it
 * is what this block is for. The others reuse the sanctioned status palette by
 * meaning (overdue = red, blocking = orange, at risk = yellow, info = blue,
 * neutral = gray). `bar` is the rail and dot fill; `text` is the AA-safe label
 * colour. Static strings so Tailwind sees them.
 */
const TIERS: Record<
  FocusTier,
  { label: string; plural: string; bar: string; text: string }
> = {
  0: {
    label: "Due today",
    plural: "due today",
    bar: "bg-primary",
    text: "text-primary",
  },
  1: {
    label: "Overdue",
    plural: "overdue",
    bar: "bg-status-red",
    text: STATUS_SOFT_TEXT.red,
  },
  2: {
    label: "Blocking",
    plural: "blocking",
    bar: "bg-status-orange",
    text: STATUS_SOFT_TEXT.orange,
  },
  3: {
    label: "Due soon",
    plural: "due soon",
    bar: "bg-status-yellow",
    text: STATUS_SOFT_TEXT.yellow,
  },
  4: {
    label: "Waiting on reply",
    plural: "awaiting reply",
    bar: "bg-status-blue",
    text: STATUS_SOFT_TEXT.blue,
  },
  5: {
    label: "Stalled",
    plural: "stalled",
    bar: "bg-status-gray",
    text: STATUS_SOFT_TEXT.gray,
  },
};

const EMPTY_TOTALS: FocusResult["totals"] = {
  0: 0,
  1: 0,
  2: 0,
  3: 0,
  4: 0,
  5: 0,
};

/** The link's one-shot proof of intent; see `armAskStart`. */
function armAsk() {
  const text = startPromptFor("today");
  if (text) armAskStart(text);
}

/** `2026-11-14` → `Sat · Nov 14`, in UTC so the stored day never drifts. */
function formatToday(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t);
  const weekday = d.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
  return `${weekday} · ${formatDue(iso)}`;
}

/** A row as shown: the server's row, plus whether a write is in flight. */
type ShownItem = FocusItem & { pending?: boolean };
type Shown = { items: ShownItem[]; totals: FocusResult["totals"] };

type RowAction =
  | { type: "done"; itemId: string }
  | { type: "due"; itemId: string; dueDate: string };

/**
 * What the list shows while a write is in flight. Done: the row leaves and its
 * group's count drops. Due date: the row keeps its place with the new date,
 * dimmed, because only the database can say which group it now belongs to (or
 * that it left the list). The server's answer replaces this either way.
 */
export function applyRowAction(state: Shown, action: RowAction): Shown {
  if (action.type === "done") {
    const gone = state.items.find((i) => i.itemId === action.itemId);
    if (!gone) return state;
    const n = state.totals[gone.tier];
    return {
      items: state.items.filter((i) => i.itemId !== action.itemId),
      totals: {
        ...state.totals,
        [gone.tier]: n === null ? null : Math.max(0, n - 1),
      },
    };
  }
  return {
    ...state,
    items: state.items.map((i) =>
      i.itemId === action.itemId
        ? { ...i, dueDate: action.dueDate, pending: true }
        : i,
    ),
  };
}

function DoneButton({
  item,
  onDone,
}: {
  item: ShownItem;
  onDone: (el: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Mark done: ${item.itemName}`}
      title="Mark done"
      disabled={item.pending}
      onClick={(e) => onDone(e.currentTarget)}
      className="group/done focus-visible:ring-ring -m-1 grid size-7 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 disabled:pointer-events-none pointer-coarse:-m-3 pointer-coarse:size-11"
    >
      <span className="border-border-bright group-hover/done:border-status-green group-hover/done:bg-status-green/15 ease-keystone grid size-[1.125rem] place-items-center rounded-full border transition-[border-color,background-color,transform] duration-200 group-active/done:scale-90">
        <Check
          aria-hidden="true"
          strokeWidth={3}
          className={cn(
            "size-2.5 opacity-0 transition-opacity duration-200 group-hover/done:opacity-100 group-focus-visible/done:opacity-100",
            STATUS_SOFT_TEXT.green,
          )}
        />
      </span>
    </button>
  );
}

function DueControl({
  item,
  today,
  overdue,
  onPick,
}: {
  item: ShownItem;
  today: string;
  overdue: boolean;
  onPick: (dueDate: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pick = (iso: string) => {
    setOpen(false);
    if (iso !== item.dueDate) onPick(iso);
  };
  const selected = item.dueDate ? isoToLocalDate(item.dueDate) : undefined;
  const quick: { label: string; iso: string }[] = [
    { label: "Today", iso: today },
    { label: "Tomorrow", iso: addDaysISO(today, 1) },
    { label: "In a week", iso: addDaysISO(today, 7) },
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            item.dueDate
              ? `Change due date for ${item.itemName}, now ${formatDue(item.dueDate)}`
              : `Set a due date for ${item.itemName}`
          }
          disabled={item.pending}
          onPointerEnter={preloadCalendar}
          onFocus={preloadCalendar}
          className={cn(
            "hover:bg-state-hover hover:border-border-hover focus-visible:ring-ring inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm border border-transparent px-1.5 text-xs tabular-nums transition-colors outline-none focus-visible:ring-2 disabled:pointer-events-none pointer-coarse:h-11 pointer-coarse:px-2.5",
            overdue ? "text-destructive" : "text-muted-foreground",
          )}
        >
          <CalendarDays aria-hidden="true" className="size-3.5 opacity-70" />
          {item.dueDate ? formatDue(item.dueDate) : "Set date"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        aria-label="Change due date"
        align="end"
        className="w-auto p-2"
      >
        <div className="mb-1 flex gap-1 border-b pb-2">
          {quick.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => pick(q.iso)}
              className="bg-surface-muted hover:border-border-hover focus-visible:ring-ring flex-1 rounded-sm border px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 pointer-coarse:py-2.5"
            >
              {q.label}
            </button>
          ))}
        </div>
        <LazyCalendar
          mode="single"
          autoFocus
          defaultMonth={selected}
          selected={selected}
          onSelect={(picked) => {
            if (picked) pick(localDateToISO(picked));
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function Row({
  item,
  today,
  onDone,
  onDue,
}: {
  item: ShownItem;
  today: string;
  onDone: (item: ShownItem, el: HTMLElement) => void;
  onDue: (item: ShownItem, dueDate: string) => void;
}) {
  const tier = TIERS[item.tier];
  const overdue = item.dueDate !== null && item.dueDate < today;
  const href = `/boards/${item.boardId}?item=${item.itemId}`;
  const canDone = item.canEdit && item.canMarkDone;
  const canDue = item.canEdit && item.canSetDue;
  return (
    <li
      aria-busy={item.pending || undefined}
      className={cn(
        "group hover:bg-state-hover focus-within:bg-state-hover ease-keystone relative grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-x-3 py-2 pr-2.5 pl-3.5 transition-[background-color,opacity] sm:grid-cols-[1.25rem_minmax(0,1fr)_auto] sm:pl-4.5",
        item.pending && "opacity-60",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "ease-keystone absolute top-2 bottom-2 left-0 w-[3px] rounded-r-[3px] opacity-90 transition-[top,bottom] duration-300 group-focus-within:top-0 group-focus-within:bottom-0 group-hover:top-0 group-hover:bottom-0",
          tier.bar,
        )}
      />
      {canDone ? (
        <DoneButton item={item} onDone={(el) => onDone(item, el)} />
      ) : (
        // No control for a board the member can only view: a quiet marker
        // keeps the column, so names stay aligned.
        <span
          aria-hidden="true"
          className="bg-border-bright mx-auto size-1.5 rounded-full"
        />
      )}
      <Link
        href={href}
        className="focus-visible:ring-ring min-w-0 rounded-sm py-0.5 outline-none focus-visible:ring-2"
      >
        <p className="truncate text-sm font-medium">{item.itemName}</p>
        <p className="text-muted-foreground truncate text-xs">
          {item.boardName}
          {item.groupName ? ` · ${item.groupName}` : ""}
        </p>
        <p className="text-muted-foreground mt-0.5 truncate text-[0.78rem] leading-snug">
          {item.reason}
        </p>
      </Link>
      <div className="col-start-2 mt-1 flex items-center gap-1.5 sm:col-start-3 sm:mt-0">
        {item.status ? (
          <span className="bg-surface-muted text-muted-foreground max-w-40 shrink-0 truncate rounded-sm px-2.5 py-0.5 text-xs font-medium">
            {item.status}
          </span>
        ) : null}
        {canDue ? (
          <DueControl
            item={item}
            today={today}
            overdue={overdue}
            onPick={(iso) => onDue(item, iso)}
          />
        ) : item.dueDate ? (
          <span
            className={cn(
              "shrink-0 px-1.5 text-xs tabular-nums",
              overdue ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {formatDue(item.dueDate)}
          </span>
        ) : null}
        <Link
          href={href}
          aria-label={`Open ${item.itemName} on its board`}
          title="Open on its board"
          className="text-muted-foreground hover:text-foreground hover:bg-state-hover focus-visible:ring-ring grid size-7 shrink-0 place-items-center rounded-sm transition-colors outline-none focus-visible:ring-2 pointer-coarse:size-11"
        >
          <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
    </li>
  );
}

/**
 * The "Today" block on My Work: what to do first. One card, grouped by reason
 * in the order the database ranked them: due today, then overdue (most recent
 * first), then blocking, due soon, waiting on reply, stalled. Each group shows
 * how many items it holds in total, not just how many are on screen.
 *
 * Data: the rows arrive with the page (ranked, tiered and limited in the SQL
 * function, never re-sorted here). "Show more" reveals rows already in memory:
 * no fetch, no navigation. It is bounded by what was loaded (at most 50); past
 * that the block says how many there are and points at the full list below.
 *
 * Actions (only on boards the member can edit): mark done and change the due
 * date. Each is one Server Action round trip. The row reacts at once
 * (`useOptimistic`), and the action revalidates this page, so the response
 * carries the database's fresh list and the optimistic state gives way to it.
 * A failure puts the row back and says why. "Ask about my day" is a plain link
 * into /ask, which starts the thread there.
 */
export function TodayFocus({
  focus,
  canAsk,
  nextDue,
}: {
  focus: FocusResult | null;
  canAsk: boolean;
  /** Earliest dated item from the ordinary list, for the empty state. */
  nextDue: { name: string; dueDate: string } | null;
}) {
  const [shownRows, setShownRows] = useState(COLLAPSED_ROWS);
  const [, startTransition] = useTransition();
  const [shown, applyOptimistic] = useOptimistic<Shown, RowAction>(
    { items: focus?.items ?? [], totals: focus?.totals ?? EMPTY_TOTALS },
    applyRowAction,
  );

  if (focus === null) {
    return (
      <section aria-labelledby="today-focus-h" className="px-6 pt-6">
        <div className="mx-auto max-w-3xl">
          <h2 id="today-focus-h" className="sr-only">
            Today
          </h2>
          <p className="text-muted-foreground px-1 text-sm">
            Today could not be loaded.
          </p>
        </div>
      </section>
    );
  }

  const onDone = (item: ShownItem, el: HTMLElement) => {
    fireDoneBurst(el);
    startTransition(async () => {
      applyOptimistic({ type: "done", itemId: item.itemId });
      const res = await markFocusItemDone({ itemId: item.itemId });
      if (!res.ok)
        toast.error(`"${item.itemName}" was not marked done. ${res.error}`);
    });
  };
  const onDue = (item: ShownItem, dueDate: string) => {
    startTransition(async () => {
      applyOptimistic({ type: "due", itemId: item.itemId, dueDate });
      const res = await setFocusItemDueDate({ itemId: item.itemId, dueDate });
      if (!res.ok)
        toast.error(
          `The due date of "${item.itemName}" was not changed. ${res.error}`,
        );
    });
  };

  const { items, totals } = shown;
  const visible = items.slice(0, shownRows);
  const hidden = items.length - visible.length;
  // A null total is unknown (the list was cut off before that tier): leave it
  // out rather than show a false 0.
  const tiers = FOCUS_TIERS.filter((t) => (totals[t] ?? 0) > 0);
  const total = focusTotal(totals);
  const beyondLoaded = total !== null ? Math.max(0, total - items.length) : 0;

  // Rows arrive in tier order, so each tier is one consecutive run.
  const groups: { tier: FocusTier; rows: ShownItem[] }[] = [];
  for (const item of visible) {
    const last = groups.at(-1);
    if (last && last.tier === item.tier) last.rows.push(item);
    else groups.push({ tier: item.tier, rows: [item] });
  }

  return (
    <section aria-labelledby="today-focus-h" className="px-6 pt-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-1">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2.5">
              <h2
                id="today-focus-h"
                className="text-base font-semibold tracking-tight"
              >
                Today
              </h2>
              <Kicker>{formatToday(focus.today)}</Kicker>
            </div>
            {tiers.length > 0 ? (
              <ul
                aria-label="Today by reason"
                className="text-muted-foreground mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-xs"
              >
                {tiers.map((t) => (
                  <li key={t} className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className={cn("size-1.5 rounded-full", TIERS[t].bar)}
                    />
                    <span>
                      <b className="text-foreground font-semibold tabular-nums">
                        {totals[t]}
                      </b>{" "}
                      {TIERS[t].plural}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {canAsk ? (
            <Link
              href="/ask?start=today"
              onClick={armAsk}
              className="bg-surface hover:border-border-hover hover:bg-state-hover focus-visible:ring-ring ease-keystone group inline-flex h-8 items-center gap-2 rounded-[10px] border px-3 text-[0.8125rem] font-medium whitespace-nowrap transition-[border-color,background-color,transform] outline-none focus-visible:ring-2 active:scale-[0.97]"
            >
              <AskAiMark className="text-primary ease-keystone size-4 transition-transform duration-500 group-hover:scale-110 group-hover:rotate-[18deg]" />
              Ask about my day
            </Link>
          ) : null}
        </div>

        {focus.timezoneAssumed ? (
          <p className="text-muted-foreground mx-1 mb-3 flex items-center gap-2 text-xs">
            <Globe className="size-3.5 shrink-0" aria-hidden="true" />
            <span>
              Dates use UTC. Set your timezone in{" "}
              <Link
                href="/settings/preferences"
                className="text-primary underline underline-offset-2"
              >
                Preferences
              </Link>
              .
            </span>
          </p>
        ) : null}

        {items.length === 0 ? (
          <div className="bg-surface flex items-center gap-3 rounded-lg border px-4 py-3.5">
            <span className="bg-status-green/15 dark:text-status-green flex size-7 shrink-0 items-center justify-center rounded-full text-[color:color-mix(in_oklab,var(--status-green)_65%,black)]">
              <Check className="size-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Nothing urgent</h3>
              {nextDue ? (
                <p className="text-muted-foreground truncate text-xs">
                  {`Next due: ${nextDue.name} · ${formatDue(nextDue.dueDate)}`}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="bg-surface hover:border-border-hover overflow-hidden rounded-lg border transition-colors">
            <div id="today-focus-items">
              {groups.map((g) => {
                const groupTotal = totals[g.tier];
                const headingId = `today-focus-tier-${g.tier}`;
                return (
                  <section
                    key={g.tier}
                    aria-labelledby={headingId}
                    className="border-t first:border-t-0"
                  >
                    <div className="bg-surface-sunken flex items-center justify-between gap-3 border-b py-1.5 pr-3.5 pl-3.5 sm:pl-4.5">
                      <h3 id={headingId} className="contents">
                        <Kicker size="xs" className={TIERS[g.tier].text}>
                          {TIERS[g.tier].label}
                        </Kicker>
                      </h3>
                      <span className="text-muted-foreground text-2xs font-mono tabular-nums">
                        {groupTotal !== null && groupTotal > g.rows.length
                          ? `${g.rows.length} of ${groupTotal}`
                          : g.rows.length}
                      </span>
                    </div>
                    <ul className="divide-y">
                      {g.rows.map((item) => (
                        <Row
                          key={item.itemId}
                          item={item}
                          today={focus.today}
                          onDone={onDone}
                          onDue={onDue}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
            {hidden > 0 || shownRows > COLLAPSED_ROWS || beyondLoaded > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t px-3.5 py-1 sm:px-4.5">
                <p className="text-muted-foreground py-1.5 text-xs tabular-nums">
                  {`Showing ${visible.length} of ${total ?? items.length}`}
                  {hidden === 0 && beyondLoaded > 0
                    ? ". The rest is in the list below."
                    : ""}
                </p>
                <div className="flex items-center gap-1">
                  {shownRows > COLLAPSED_ROWS ? (
                    <button
                      type="button"
                      onClick={() => setShownRows(COLLAPSED_ROWS)}
                      className="text-muted-foreground hover:text-foreground hover:bg-state-hover focus-visible:ring-ring h-7 rounded-sm px-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 pointer-coarse:h-11"
                    >
                      Show fewer
                    </button>
                  ) : null}
                  {hidden > 0 ? (
                    <button
                      type="button"
                      aria-controls="today-focus-items"
                      onClick={() => setShownRows((n) => n + MORE_STEP)}
                      className="text-foreground hover:bg-state-hover focus-visible:ring-ring inline-flex h-7 items-center gap-1 rounded-sm px-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 pointer-coarse:h-11"
                    >
                      {`Show ${Math.min(MORE_STEP, hidden)} more`}
                      <ChevronDown aria-hidden="true" className="size-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
