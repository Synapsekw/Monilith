"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Globe } from "lucide-react";
import { AskAiMark } from "@/components/brand/ask-ai-mark";
import { Kicker } from "@/components/ui/kicker";
import { cn } from "@/lib/utils";
import type { FocusItem, FocusResult } from "@/lib/focus/queries";
import type { FocusTier } from "@/lib/focus/reason";
import { formatDue } from "@/lib/my-work/format";

/** Rows shown before "Show all". The database already limited the list. */
const COLLAPSED_ROWS = 7;

/**
 * Tier tones reuse the sanctioned status palette by meaning (overdue = red,
 * blocking = orange, at risk = yellow, info = blue, neutral = gray). `bar` is
 * the rail and dot fill; `text` is the AA-safe label colour (the soft-pill
 * recipe: token darkened 35% in light, the token itself in dark). Static
 * strings so Tailwind sees them.
 */
const TIERS: Record<
  FocusTier,
  { label: string; plural: string; bar: string; text: string }
> = {
  1: {
    label: "Overdue",
    plural: "overdue",
    bar: "bg-status-red",
    text: "text-[color:color-mix(in_oklab,var(--status-red)_65%,black)] dark:text-status-red",
  },
  2: {
    label: "Blocking",
    plural: "blocking",
    bar: "bg-status-orange",
    text: "text-[color:color-mix(in_oklab,var(--status-orange)_65%,black)] dark:text-status-orange",
  },
  3: {
    label: "Due soon",
    plural: "due soon",
    bar: "bg-status-yellow",
    text: "text-[color:color-mix(in_oklab,var(--status-yellow)_65%,black)] dark:text-status-yellow",
  },
  4: {
    label: "Waiting on reply",
    plural: "awaiting reply",
    bar: "bg-status-blue",
    text: "text-[color:color-mix(in_oklab,var(--status-blue)_65%,black)] dark:text-status-blue",
  },
  5: {
    label: "Stalled",
    plural: "stalled",
    bar: "bg-status-gray",
    text: "text-[color:color-mix(in_oklab,var(--status-gray)_65%,black)] dark:text-status-gray",
  },
};

const TIER_ORDER: readonly FocusTier[] = [1, 2, 3, 4, 5];

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

function Row({
  item,
  rank,
  today,
  entering,
}: {
  item: FocusItem;
  rank: number;
  today: string;
  entering: boolean;
}) {
  const tier = TIERS[item.tier];
  const overdue = item.dueDate !== null && item.dueDate < today;
  return (
    <li className={cn(entering && "animate-fadein")}>
      <Link
        href={`/boards/${item.boardId}?item=${item.itemId}`}
        className="group hover:bg-state-hover focus-visible:ring-ring ease-keystone relative grid grid-cols-[1.125rem_minmax(0,1fr)] items-center gap-x-3 py-2.5 pr-3.5 pl-3.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset sm:grid-cols-[1.375rem_minmax(0,1fr)_auto] sm:pl-4.5"
      >
        <span
          aria-hidden="true"
          className={cn(
            "ease-keystone absolute top-2 bottom-2 left-0 w-[3px] rounded-r-[3px] opacity-90 transition-[top,bottom] duration-300 group-hover:top-0 group-hover:bottom-0 group-focus-visible:top-0 group-focus-visible:bottom-0",
            tier.bar,
          )}
        />
        <span
          aria-hidden="true"
          className="text-kicker text-2xs self-start pt-0.5 font-mono tabular-nums"
        >
          {String(rank).padStart(2, "0")}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.itemName}</p>
          <p className="text-muted-foreground truncate text-xs">
            {item.boardName}
            {item.groupName ? ` · ${item.groupName}` : ""}
          </p>
          <p className="mt-0.5 flex items-baseline gap-1.5 text-[0.78rem] leading-snug">
            <Kicker size="xs" className={cn("shrink-0", tier.text)}>
              {tier.label}
            </Kicker>
            <span className="text-muted-foreground">{item.reason}</span>
          </p>
        </div>
        <div className="col-start-2 mt-1.5 flex items-center gap-2.5 sm:col-start-3 sm:mt-0">
          {item.status ? (
            <span className="bg-surface-muted text-muted-foreground max-w-40 shrink-0 truncate rounded-sm px-2.5 py-0.5 text-xs font-medium">
              {item.status}
            </span>
          ) : null}
          {item.dueDate ? (
            <span
              className={cn(
                "shrink-0 text-xs tabular-nums sm:min-w-11 sm:text-right",
                overdue ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {formatDue(item.dueDate)}
            </span>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

/**
 * The "Today" block on My Work: what to focus on first, ranked. Treatment A
 * ("ranked rail"): one card, rows numbered by rank, a tier-coloured rail on
 * each row, the reason in words under the name.
 *
 * The data arrives with the page (server read, ranked, tiered and limited in
 * the database function). The only client state is the "Show all" toggle, which
 * reveals rows already in memory: no fetch, no navigation. "Ask about my day"
 * is a plain link into /ask, which starts the thread there.
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
  const [expanded, setExpanded] = useState(false);

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

  const { items } = focus;
  const canExpand = items.length > COLLAPSED_ROWS;
  const visible = expanded ? items : items.slice(0, COLLAPSED_ROWS);
  const tiers = TIER_ORDER.filter((t) => focus.totals[t] > 0);

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
                        {focus.totals[t]}
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
            <ol
              id="today-focus-items"
              aria-label="Ranked focus items"
              className="divide-y"
            >
              {visible.map((item, i) => (
                <Row
                  key={item.itemId}
                  item={item}
                  rank={i + 1}
                  today={focus.today}
                  entering={i >= COLLAPSED_ROWS}
                />
              ))}
            </ol>
            {canExpand ? (
              <div className="border-t">
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls="today-focus-items"
                  onClick={() => setExpanded((v) => !v)}
                  className="text-muted-foreground hover:text-foreground hover:bg-state-hover focus-visible:ring-ring flex h-9 w-full items-center justify-center gap-1.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset"
                >
                  {expanded ? "Show fewer" : `Show all ${items.length}`}
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      "ease-keystone size-3.5 transition-transform duration-300",
                      expanded && "rotate-180",
                    )}
                  />
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
