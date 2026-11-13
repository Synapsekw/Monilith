"use client";

import dynamic from "next/dynamic";

import type { CalendarProps } from "@/components/ui/calendar";

// One in-flight import shared by the `dynamic` render and `preloadCalendar`.
let pending: Promise<React.ComponentType<CalendarProps>> | undefined;
function loadCalendar() {
  return (pending ??= import("@/components/ui/calendar")
    .then((m) => m.Calendar as React.ComponentType<CalendarProps>)
    .catch((error: unknown) => {
      // Let the next open retry after a failed (e.g. offline) load.
      pending = undefined;
      throw error;
    }));
}

/**
 * Warm the calendar chunk ahead of the first open (e.g. on hover/focus of a
 * date trigger). Safe to call repeatedly; failures are ignored — the real open
 * retries through `LazyCalendar`.
 */
export function preloadCalendar() {
  loadCalendar().catch(() => {});
}

/**
 * Stand-in while the calendar chunk loads. Sized to the default single-month
 * `Calendar` (`p-1`; 7 × `size-9` day columns = 260px wide; 32px caption + 16px
 * gap + 16px weekday row + 6 fixed week rows × 40px = 312px tall) so the
 * popover neither jumps nor re-anchors when the real grid replaces it.
 *
 * It is deliberately tabbable: a Radix popover moves focus to the first
 * tabbable node in its content on open, and without this that would be
 * whatever sits next to the calendar (DateEditor's "Clear" button — one stray
 * Enter away from wiping the cell). Once the chunk lands the placeholder
 * unmounts and `Calendar autoFocus` takes focus into the day grid.
 */
function CalendarFallback() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading calendar"
      tabIndex={0}
      data-slot="calendar-fallback"
      className="bg-muted/40 h-[312px] w-[260px] animate-pulse rounded-md outline-none"
    />
  );
}

/**
 * Drop-in, code-split `Calendar`. Importing THIS module is free of
 * react-day-picker + date-fns: the reference lives inside `import()`, so the
 * chunk is fetched the first time a date popover actually opens rather than in
 * the board table's first-load JS. Use it wherever the calendar only appears
 * inside an opened popover; same pattern as
 * `dashboards/widgets/LazyChartWidget.tsx`.
 */
export const LazyCalendar = dynamic<CalendarProps>(loadCalendar, {
  ssr: false,
  loading: CalendarFallback,
});
