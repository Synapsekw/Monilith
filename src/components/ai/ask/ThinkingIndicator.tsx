import { cn } from "@/lib/utils";
import { AskAiMark } from "@/components/brand/ask-ai-mark";

/** What we say before the server has said anything more specific. */
export const THINKING_FALLBACK_LABEL = "Thinking…";

/** Staggered so the three dots read as one travelling wave rather than a blink.
 *  Arbitrary-property utilities keep the stagger in the markup, next to the dot
 *  it belongs to, instead of in three near-identical keyframes. */
const DOT_DELAYS = [
  "[animation-delay:0ms]",
  "[animation-delay:160ms]",
  "[animation-delay:320ms]",
] as const;

/**
 * The "Ask AI is working" state, from submit until the first token.
 *
 * Ask Pulse runs its read tools with text buffered, so a turn's opening stretch
 * is routinely 25–42 SECONDS with nothing streaming. That used to render a
 * static "…" — indistinguishable from a hung page, which is exactly how users
 * read it (they gave up and resent, abandoning the in-flight turn). So this is
 * deliberately alive: motion the eye catches inside a second, plus a label.
 *
 * The label is the meaning, the motion is only the tell — under
 * `prefers-reduced-motion` the dots stand still and the sentence still says
 * what is happening. `role="status"` announces it without stealing focus.
 *
 * Sits in the assistant gutter (size-7 mark + gap-3) so the real answer bubble
 * replaces it in place, with no layout jump.
 */
export function ThinkingIndicator({
  label,
  className,
}: {
  /** The freshest server status, if one has arrived yet. */
  label?: string | null;
  className?: string;
}) {
  return (
    <div className={cn("animate-fadein flex items-start gap-3", className)}>
      <span className="bg-surface text-brand mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border">
        <AskAiMark className="size-3.5" />
      </span>
      <p
        role="status"
        aria-live="polite"
        className="text-muted-foreground flex min-w-0 flex-1 items-center gap-2 pt-1.5 text-sm"
      >
        <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
          {DOT_DELAYS.map((delay) => (
            <span
              key={delay}
              data-slot="thinking-dot"
              className={cn(
                "bg-muted-foreground size-1.5 rounded-full",
                "animate-thinking-dot motion-reduce:animate-none motion-reduce:opacity-60",
                delay,
              )}
            />
          ))}
        </span>
        <span className="truncate">{label || THINKING_FALLBACK_LABEL}</span>
      </p>
    </div>
  );
}
