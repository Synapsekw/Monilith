"use client";

import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import { timeAgo } from "@/lib/boards/automation-runs";

/**
 * The week in one paragraph.
 *
 * Deliberately not a heading + body: a heading over a single paragraph is
 * chrome pretending to be structure. The mono kicker names the WINDOW (which is
 * the one thing a reader has to know to trust the sentence), and the timestamp
 * beside it says how old the answer is. Refresh appears only once the brief is
 * old enough for that to be a real question.
 */
export function BriefBlock({
  brief,
  generatedAt,
  nowMs,
  stale,
  onRefresh,
  running,
}: {
  brief: string;
  generatedAt: string;
  nowMs: number;
  stale: boolean;
  onRefresh: () => void;
  running: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Kicker size="xs">Last 7 days</Kicker>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground text-3xs font-mono">
            {timeAgo(generatedAt, nowMs)}
          </span>
          {stale && (
            <Button
              variant="ghost"
              size="xs"
              onClick={onRefresh}
              disabled={running}
            >
              Refresh
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm leading-relaxed">{brief}</p>
    </div>
  );
}
