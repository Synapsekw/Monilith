import type { ChatSpeaker } from "./speaker";

/** Who answers when no speaker is given: the org assistant. */
const PLAIN_ASSISTANT = "Monolith assistant";

/**
 * Thread header: the thread's title on the left, and on the right a chip
 * naming who answers — the speaker (a Mono) when given, otherwise the
 * Monolith assistant.
 *
 * Static by design: it holds no state, never navigates and never triggers a
 * `router.refresh()` (working agreement #5).
 */
export function ThreadHeader({
  title,
  speaker,
}: {
  title: string;
  speaker?: Pick<ChatSpeaker, "name" | "tint">;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
      <h2 className="min-w-0 truncate text-sm font-semibold" title={title}>
        {title}
      </h2>
      <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 px-2 text-sm">
        <span
          aria-hidden="true"
          className="bg-primary size-1.5 shrink-0 rounded-full"
          style={speaker?.tint ? { backgroundColor: speaker.tint } : undefined}
        />
        <span className="max-w-40 truncate">
          {speaker?.name ?? PLAIN_ASSISTANT}
        </span>
      </span>
    </div>
  );
}
