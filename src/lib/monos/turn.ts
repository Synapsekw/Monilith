import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { forgetMonoSession } from "@/lib/mono/session";
import { getMyMono } from "./queries";
import type { MonoKeyProvider, MyMono } from "./types";

type Client = SupabaseClient<Database>;

export type MonoTurn = { mono: MyMono; provider: MonoKeyProvider };

/** The caller's own Mono when it is `monoId`, else null (and its cached token
 *  is dropped: Plan 2A D3). */
export async function loadOwnedMono(
  supabase: Client,
  ownerId: string,
  orgId: string,
  monoId: string,
): Promise<MyMono | null> {
  const mono = await getMyMono(supabase, orgId);
  if (!mono || mono.userId !== monoId || mono.ownerId !== ownerId) {
    forgetMonoSession(monoId);
    return null;
  }
  return mono;
}

export const MONO_ASLEEP_ERROR =
  "Your Mono is asleep. Add an Anthropic or OpenAI key in Settings → AI to wake it.";

/** Cheap checks before a Mono turn streams. Minting the Mono's session
 *  happens later, inside the turn, after the opening status (gotcha-62). */
export async function resolveMonoTurn(
  supabase: Client,
  ownerId: string,
  orgId: string,
  monoId: string,
): Promise<
  { ok: true; turn: MonoTurn } | { ok: false; status: 403 | 409; error: string }
> {
  const mono = await loadOwnedMono(supabase, ownerId, orgId, monoId);
  if (!mono) return { ok: false, status: 403, error: "Not your Mono." };
  if (mono.brain === "none" || !mono.keyProvider)
    return { ok: false, status: 409, error: MONO_ASLEEP_ERROR };
  return { ok: true, turn: { mono, provider: mono.keyProvider } };
}

/** Appended to the system prompt on a Mono turn. Names are JSON-quoted. */
export function monoSystemLines(
  mono: Pick<MyMono, "name" | "userId">,
  ownerName: string | null,
): string {
  const owner = ownerName ? JSON.stringify(ownerName) : "your owner";
  return [
    `You are ${JSON.stringify(mono.name)}, the personal agent (a "Mono") of ${owner}.`,
    `You act in Monolith as your own user (user id ${mono.userId}): you can see only boards you have been added to, and anything you change is recorded as done by you.`,
    `Only ${owner} talks to you here. Every change you line up waits for ${owner} to confirm it.`,
    `You never assign or @mention another Mono.`,
  ].join("\n");
}
