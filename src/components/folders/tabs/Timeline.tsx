"use client";

import dynamic from "next/dynamic";

/**
 * Folder Timeline tab. The Gantt canvas (dnd-kit, react-virtual, the bar and
 * link machinery) is code-split behind this wrapper so it never ships in the
 * command center's first paint — the guard in no-gantt-in-first-paint.test.ts
 * keeps it that way. Its data loads only once the tab mounts.
 */
export const TimelineTab = dynamic(
  () =>
    import("@/components/folders/tabs/TimelineInner").then(
      (m) => m.TimelineInner,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="bg-surface-muted h-64 w-full animate-pulse rounded-lg" />
    ),
  },
);
