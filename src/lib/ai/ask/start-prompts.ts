/**
 * Messages a link into /ask may start a thread with (`/ask?start=<key>`).
 * The URL carries only a KEY, never the text: a crafted link must not be able
 * to put its own words into the member's assistant thread. Own-property check
 * so `constructor` / `__proto__` do not resolve.
 */
const START_PROMPTS: Record<string, string> = {
  today: "What should I focus on today?",
};

export function startPromptFor(
  raw: string | string[] | undefined,
): string | undefined {
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || !Object.hasOwn(START_PROMPTS, key)) return undefined;
  return START_PROMPTS[key];
}
