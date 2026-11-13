/** Client-safe wording for Monos. One place, so every surface says the same. */

export function ownerPossessive(ownerName: string | null): string {
  const first = ownerName?.trim().split(/\s+/)[0];
  return first ? `${first}'s Mono` : "A teammate's Mono";
}

export function monoAccessibleLabel(
  name: string,
  ownerName: string | null,
): string {
  return `${name}, ${ownerPossessive(ownerName)}`;
}

/** The brain status line (spec §9). 2A's key brain works only while its
 *  owner chats with it, so the copy promises nothing unattended. */
export function brainLine(
  brain: "none" | "key" | "connected",
  keyProvider: string | null,
): string {
  if (brain === "key")
    return `Runs on your ${keyProvider === "openai" ? "OpenAI" : "Anthropic"} key. Chat with it here.`;
  if (brain === "connected")
    return "Connected to your Claude or ChatGPT subscription";
  return "Asleep";
}
