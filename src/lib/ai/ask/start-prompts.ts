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

/**
 * One-shot proof that THIS tab's member clicked the link (sessionStorage,
 * per tab). The URL key alone must never send: a link on another site, a
 * shared URL, or browser Back to a page entry that still carries `?start`
 * would otherwise spend a paid assistant turn. The link arms the token on
 * click; AskChat consumes it (read, then remove) before sending. Every storage
 * access is guarded: where storage is unavailable nothing auto-sends.
 */
const TOKEN_KEY = "monolith:ask-start";
const TOKEN_TTL_MS = 60_000;

export function armAskStart(text: string): void {
  try {
    window.sessionStorage.setItem(
      TOKEN_KEY,
      JSON.stringify({ text, at: Date.now() }),
    );
  } catch {
    // Private mode or blocked storage: the chat just opens empty.
  }
}

/** True once per arming, only for the same message and within the TTL. */
export function consumeAskStart(text: string): boolean {
  try {
    const raw = window.sessionStorage.getItem(TOKEN_KEY);
    if (raw === null) return false;
    window.sessionStorage.removeItem(TOKEN_KEY);
    const token: unknown = JSON.parse(raw);
    if (typeof token !== "object" || token === null) return false;
    const { text: armed, at } = token as { text?: unknown; at?: unknown };
    return (
      armed === text &&
      typeof at === "number" &&
      Date.now() - at <= TOKEN_TTL_MS
    );
  } catch {
    return false;
  }
}
