"use server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { runAi } from "@/lib/ai/gateway";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { MODEL } from "@/lib/ai/providers/anthropic";
import {
  buildTranscript,
  summarizeThread as summarizeThreadWithAi,
} from "@/lib/ai/summarize/summarize";
import { ProviderNotCapableError } from "@/lib/ai/errors";
import { mapAiError } from "@/lib/ai/action-guard";
import { createClient } from "@/lib/supabase/server";
import { getBoardPayload } from "@/lib/boards/queries";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import { fail, type ActionResult } from "@/lib/actions/result";

// Same caps as useItemCollab's item_updates/item_activities reads — bounded,
// indexed (item_id, created_at desc) reads, never unbounded.
const UPDATES_LIMIT = 30;
const ACTIVITY_LIMIT = 50;

const inputSchema = z.object({ itemId: z.string().uuid() });

/**
 * "Catch me up": summarize an item's update/activity thread via Anthropic.
 * Read-only — no writes, no cache invalidation. Entitlement-gated before any
 * token spend; the transcript is built and checked for emptiness BEFORE
 * entering runAi so a thread with nothing in it never spends a token.
 * Requires an Anthropic key — this is a plain-text completion, not tied to
 * tool support, but summarize.ts's client is Anthropic-shaped only.
 */
export async function summarizeThread(input: {
  itemId: string;
}): Promise<ActionResult<{ summary: string }>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid item.");
  const { itemId } = parsed.data;

  try {
    const user = await requireUser();
    const org = await resolveActiveOrg();
    if (!org) return fail("No organization.");

    await requireAiEntitlement(org.id, "thread_summary");

    const supabase = await createClient();

    const { data: item, error: itemErr } = await supabase
      .from("items")
      .select("id, board_id")
      .eq("id", itemId)
      .maybeSingle();
    if (itemErr) throw itemErr;
    if (!item) return fail("Item not found.");

    const payload = await getBoardPayload(item.board_id);
    if (!payload) return fail("Item not found.");
    const members = await listOrgMembersCached(payload.board.org_id);

    const [updatesRes, activitiesRes] = await Promise.all([
      supabase
        .from("item_updates")
        .select("*")
        .eq("item_id", itemId)
        .order("created_at", { ascending: false })
        .limit(UPDATES_LIMIT),
      supabase
        .from("item_activities")
        .select("*")
        .eq("item_id", itemId)
        .order("created_at", { ascending: false })
        .limit(ACTIVITY_LIMIT),
    ]);
    if (updatesRes.error) throw updatesRes.error;
    if (activitiesRes.error) throw activitiesRes.error;

    const updates = updatesRes.data ?? [];
    const activities = activitiesRes.data ?? [];

    // Check emptiness BEFORE any spend — build the transcript here, not just
    // inside summarizeThreadWithAi (which rebuilds it, deterministically, once
    // inside runAi's metered call).
    const transcript = buildTranscript({
      updates,
      activities,
      columns: payload.columns,
      members,
    });
    if (!transcript) return fail("Nothing to summarize yet.");

    const summary = await runAi(
      { orgId: org.id, userId: user.id, feature: "thread_summary" },
      async ({ adapter, apiKey }) => {
        if (adapter.id !== "anthropic")
          throw new ProviderNotCapableError("thread_summary");
        const r = await summarizeThreadWithAi({
          apiKey,
          updates,
          activities,
          columns: payload.columns,
          members,
        });
        return { result: r.summary, usage: r.usage, model: MODEL };
      },
    );

    return { ok: true, data: { summary } };
  } catch (e) {
    return fail(
      mapAiError(e, {
        fallback: "Couldn't summarize this thread. Please try again.",
        notConfigured:
          "Add an AI provider key in Settings to use AI summaries.",
        providerNotCapable: "Thread summaries need an Anthropic key.",
      }),
    );
  }
}
