export type MentionTarget = { userId: string; fullName: string | null };

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

/** Replace the active @query (from its `start` to the caret) with `@FullName `
 *  and return the new text + caret. The caller records `target.userId`. */
export function applyMention(
  text: string,
  caret: number,
  target: MentionTarget,
): { text: string; caret: number } {
  const active = activeMentionQuery(text, caret);
  const start = active ? active.start : caret;
  const label = `@${target.fullName ?? "Someone"} `;
  const next = text.slice(0, start) + label + text.slice(caret);
  return { text: next, caret: start + label.length };
}
