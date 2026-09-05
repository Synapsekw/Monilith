/**
 * A mention target is a PERSON or one of the author's own AGENTS.
 *
 * The two carry different text: a person's mention writes their DISPLAY NAME
 * (which may contain spaces and is matched back out by `renderBody`), while an
 * agent's writes its HANDLE — which is what makes an agent mention typeable.
 * `activeMentionQuery` terminates a token at the first whitespace, so a
 * multi-word name can only ever be CLICKED; a handle can be typed straight
 * through, which is the whole point of Spec 3's addressing half.
 */
export type UserMentionTarget = {
  kind: "user";
  userId: string;
  fullName: string | null;
};
export type AgentMentionTarget = {
  kind: "agent";
  agentId: string;
  handle: string;
  name: string;
};
export type MentionTarget = UserMentionTarget | AgentMentionTarget;

/** The text a mention writes into the body — and the token `renderBody`
 *  accents back out of it. Includes the leading `@`. */
export function mentionLabel(target: MentionTarget): string {
  return target.kind === "agent"
    ? `@${target.handle}`
    : `@${target.fullName ?? "Someone"}`;
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
 *  tagged id (`{ kind: "user", userId }` / `{ kind: "agent", agentId }`). */
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
