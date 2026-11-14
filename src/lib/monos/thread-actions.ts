"use server";

import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { createClient } from "@/lib/supabase/server";
import {
  getMessages,
  toThreadMessages,
  type ThreadMessage,
} from "@/lib/ai/ask/conversations";
import { fail, type ActionResult } from "@/lib/actions/result";
import { getMyMono } from "./queries";

/**
 * The My Mono tab's one read, on its first open: the latest thread with the
 * caller's Mono (`ai_conversations_mono_updated_idx`) and its turns (bounded
 * by getMessages). Never on first paint.
 */
export async function loadMyMonoThread(): Promise<
  ActionResult<{ conversationId: string | null; messages: ThreadMessage[] }>
> {
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) return fail("No organization.");
  try {
    const supabase = await createClient();
    const mono = await getMyMono(supabase, org.id);
    if (!mono)
      return { ok: true, data: { conversationId: null, messages: [] } };
    const { data, error } = await supabase
      .from("ai_conversations")
      .select("id")
      .eq("user_id", user.id)
      .eq("mono_id", mono.userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return fail("Couldn't load your chat.");
    if (!data)
      return { ok: true, data: { conversationId: null, messages: [] } };
    return {
      ok: true,
      data: {
        conversationId: data.id,
        messages: toThreadMessages(await getMessages(data.id)),
      },
    };
  } catch {
    return fail("Couldn't load your chat.");
  }
}
