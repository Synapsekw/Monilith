"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/actions/result";
import { MEMORY_MAX_NOTES } from "@/lib/agents/document-budget";
import {
  ownerNoteSchema,
  deleteNoteSchema,
} from "@/lib/validations/agent-memory";
import {
  listMemoryForAgent,
  countMemoryForAgent,
  upsertOwnerNote,
  deleteMemoryRow,
  type AgentMemoryNote,
} from "./memory-db";

// NOTE (gotcha-92): this module is "use server". It may export ONLY async
// functions. No `export type { … }` and no `export { type … }` — those are
// export CLAUSES and break at runtime even though `pnpm build` exits 0.
// `src/test/use-server-exports.test.ts` scans this file automatically.

const AGENTS_ROUTE = "/settings/agents";
const NO_ORG = "No organization.";

/**
 * The panel's ON-DEMAND read, deliberately not part of first paint.
 *
 * The settings page loads only the per-agent AGGREGATE (count + token total),
 * which is all the budget meter needs. Fetching every note for every agent to
 * render a number would ship up to 20 x 25 KB of prose nobody looked at. This
 * is the same posture `AgentRunHistory` already uses — an explicit disclosure
 * of ONE agent's data on an explicit click, not a view toggle (working
 * agreement #5).
 *
 * RLS on `agent_memory` is what scopes this read; no ownership check is
 * duplicated here, exactly as `document-actions.ts` never re-checks `owner_id`.
 */
export async function listAgentMemory(
  userAgentId: string,
): Promise<ActionResult<{ notes: AgentMemoryNote[] }>> {
  try {
    const supabase = await createClient();
    return {
      ok: true,
      data: { notes: await listMemoryForAgent(supabase, userAgentId) },
    };
  } catch {
    return fail("Couldn't load this agent's memory.");
  }
}

/**
 * The owner's write. Always lands as `origin: 'owner'` (stamped in
 * `upsertOwnerNote`, never taken from the caller), which is what makes the
 * note un-clobberable by the agent: `agent_remember` refuses a key an owner
 * note holds.
 */
export async function saveOwnerNote(input: {
  userAgentId: string;
  key: string;
  value: string;
}): Promise<ActionResult> {
  const parsed = ownerNoteSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid note.");

  try {
    const user = await requireUser();
    // resolveActiveOrg(), not getActiveOrgId() — the same choice
    // `document-actions.ts` documents: it fails with a clear "No
    // organization." instead of inserting `org_id: ""`.
    const org = await resolveActiveOrg();
    if (!org) return fail(NO_ORG);
    const supabase = await createClient();

    // The cap applies to NEW notes only. Editing an existing note at 50/50
    // must stay possible — a cap that locks the owner out of correcting the
    // very notes that filled it would be the worst version of this feature.
    const existing = await listMemoryForAgent(
      supabase,
      parsed.data.userAgentId,
    );
    const isEdit = existing.some((n) => n.key === parsed.data.key);
    if (!isEdit) {
      const count = await countMemoryForAgent(
        supabase,
        parsed.data.userAgentId,
      );
      if (count >= MEMORY_MAX_NOTES)
        return fail(
          `This agent already has ${MEMORY_MAX_NOTES} notes, the maximum. ` +
            "Delete one to add another.",
        );
    }

    await upsertOwnerNote(supabase, {
      userAgentId: parsed.data.userAgentId,
      orgId: org.id,
      ownerId: user.id,
      key: parsed.data.key,
      value: parsed.data.value,
    });
    revalidatePath(AGENTS_ROUTE);
    return { ok: true, data: undefined };
  } catch {
    return fail("Couldn't save that note.");
  }
}

/**
 * Deletion is the UI's job, deliberately: revoking `memory.write` does NOT
 * erase anything, because what an agent learned is the owner's data now.
 */
export async function deleteMemoryNote(id: string): Promise<ActionResult> {
  const parsed = deleteNoteSchema.safeParse({ id });
  if (!parsed.success) return fail("Invalid note.");
  try {
    const supabase = await createClient();
    await deleteMemoryRow(supabase, parsed.data.id);
    revalidatePath(AGENTS_ROUTE);
    return { ok: true, data: undefined };
  } catch {
    return fail("Couldn't delete that note.");
  }
}
