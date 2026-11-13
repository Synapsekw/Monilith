/** A mention target is a person. Plan 2 adds the owner's own Mono. */
export type UserMentionTarget = {
  kind: "user";
  userId: string;
  fullName: string | null;
};
export type MentionTarget = UserMentionTarget;

/** The text a mention writes into the body, including the leading `@`. */
export function mentionLabel(target: MentionTarget): string {
  return `@${target.fullName ?? "Someone"}`;
}

/** The `@query` immediately preceding the caret, or null. A space closes the
 *  token; the `@` must start the string or follow whitespace. */
export function activeMentionQuery(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upto[at - 1]!)) return null;
  const query = upto.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { query, start: at };
}

/** Replace the active @query (from its `start` to the caret) with the target's
 *  `@label ` and return the new text + caret. The caller records the target's
 *  tagged id (`{ kind: "user", userId }`). */
export function applyMention(
  text: string,
  caret: number,
  target: MentionTarget,
): { text: string; caret: number } {
  const active = activeMentionQuery(text, caret);
  const start = active ? active.start : caret;
  const label = `${mentionLabel(target)} `;
  const next = text.slice(0, start) + label + text.slice(caret);
  return { text: next, caret: start + label.length };
}
