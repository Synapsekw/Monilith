"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import { Skeleton } from "@/components/ui/skeleton";
import { BriefBlock } from "./BriefBlock";
import { SuggestionCard } from "./SuggestionCard";
import { useIntelligenceRun } from "./use-intelligence-run";

/** The shape of the answer, not a spinner: three brief lines and two cards. */
function Reading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Reading the board"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    </div>
  );
}

/**
 * The dock's second section: what happened on this board, and what to do next.
 *
 * Fetching budget (working agreement #5): opening this tab issues NO read. The
 * page hands the latest run to the store (Task 8) and the tab renders it.
 * `runOnMount` is the one exception — either the tab opened with nothing
 * cached, or the user pressed "Catch me up" on the strip — and it is guarded so
 * that a re-render can never repeat a request that was already answered.
 */
export function IntelligenceTab({
  boardId,
  canApply,
  runOnMount,
  onRanOnMount,
}: {
  boardId: string;
  canApply: boolean;
  runOnMount: boolean;
  onRanOnMount: () => void;
}) {
  const {
    run,
    running,
    error,
    staleByAge,
    nowMs,
    pending,
    visible,
    catchMeUp,
    refresh,
    dismiss,
    apply,
  } = useIntelligenceRun(boardId, { canApply });

  /**
   * One read per ASKING, however many times React re-renders the asking.
   *
   * Edge-triggered rather than mount-once: the parent lowers `runOnMount` as
   * soon as the read is KICKED OFF, so releasing the guard there is what lets a
   * SECOND "Catch me up" read the board again — a mount-once ref would answer
   * the first request and silently swallow every one after it.
   *
   * `onRanOnMount` fires BEFORE the await, not in `.finally`: this panel
   * unmounts whenever the reader switches to Chat or closes the dock, taking
   * `kicked` with it, so a request still in flight would be re-kicked on the
   * next mount — a second metered model call for one ask. Lowering the parent's
   * flag at kick time is the only half of the guard that survives the unmount.
   */
  const kicked = useRef(false);
  useEffect(() => {
    if (!runOnMount) {
      kicked.current = false;
      return;
    }
    if (kicked.current) return;
    kicked.current = true;
    onRanOnMount();
    void catchMeUp();
  }, [runOnMount, catchMeUp, onRanOnMount]);

  return (
    <div
      id="dock-panel-intelligence"
      role="tabpanel"
      aria-labelledby="dock-tab-intelligence"
      // A page-region scroller, so it reserves the scrollbar gutter — without
      // it the whole panel shifts sideways the moment a third suggestion
      // arrives (src/app/scroll-containers.test.ts).
      data-scroll-container
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3"
    >
      {error && (
        <div className="flex items-center gap-2">
          <p className="text-destructive min-w-0 flex-1 text-xs">{error}</p>
          {/* A retry belongs here only when the READ is what failed. With a
              brief on screen the failure came from a card's own button, and
              re-running the whole model is not what "Try again" would mean. */}
          {!run && (
            <Button variant="ghost" size="xs" onClick={() => void catchMeUp()}>
              Try again
            </Button>
          )}
        </div>
      )}

      {/* The skeleton stands in for a brief that does not exist yet. Once one
          does, a REFRESH leaves it on screen — replacing a readable answer with
          five grey bars costs the reader the thing they came for, and the
          disabled Refresh already says a new one is on its way. */}
      {run ? null : running ? (
        <Reading />
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="text-muted-foreground text-sm">
            Nothing yet — a brief of the last 7 days and what to do next.
          </p>
          <Button size="sm" onClick={() => void catchMeUp()}>
            Catch me up
          </Button>
        </div>
      )}

      {run && (
        <>
          <BriefBlock
            brief={run.payload.brief}
            generatedAt={run.generatedAt}
            nowMs={nowMs}
            stale={staleByAge}
            onRefresh={() => void refresh()}
            running={running}
          />

          {visible.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Kicker size="xs">{`Suggested · ${visible.length}`}</Kicker>
              <ul className="flex flex-col gap-2">
                {visible.map((s) => (
                  <SuggestionCard
                    key={s.id}
                    suggestion={s}
                    canApply={canApply}
                    pending={pending}
                    onApply={(i) => void apply(s.id, i)}
                    onDismiss={() => void dismiss(s.id)}
                  />
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Nothing needs attention right now.
            </p>
          )}

          <p className="text-muted-foreground text-3xs mt-auto font-mono">
            {`${canApply ? "Read-only until you apply" : "Read-only"} · ${
              run.model ?? "model"
            } · ${run.tokensIn + run.tokensOut} tokens`}
          </p>
        </>
      )}
    </div>
  );
}
