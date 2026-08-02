import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { readOrgAiSettings } from "@/lib/ai/org-settings";
import { countAgentsForOwner, countRunsToday } from "./agents-db";

/**
 * Per-user ceilings on personal agents. Personal agents bill the ORG's managed
 * credit pool, so without a per-user cap one enthusiastic member can starve the
 * whole org. Enforced server-side only — the UI shows the limit, it does not
 * enforce it.
 */
export class AgentCapExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentCapExceededError";
  }
}

export async function assertCanCreateAgent(
  client: SupabaseClient<Database>,
  orgId: string,
  ownerId: string,
): Promise<void> {
  const { maxAgentsPerUser } = await readOrgAiSettings(client, orgId);
  const existing = await countAgentsForOwner(client, orgId, ownerId);
  if (existing >= maxAgentsPerUser) {
    throw new AgentCapExceededError(
      `You can have at most ${maxAgentsPerUser} agents. Delete one to create another.`,
    );
  }
}

export async function assertRunAllowedToday(
  svc: SupabaseClient<Database>,
  orgId: string,
  ownerId: string,
  fireDate: string,
): Promise<void> {
  const { maxAgentRunsPerUserPerDay } = await readOrgAiSettings(svc, orgId);
  const today = await countRunsToday(svc, orgId, ownerId, fireDate);
  if (today >= maxAgentRunsPerUserPerDay) {
    throw new AgentCapExceededError(
      `Daily agent run limit of ${maxAgentRunsPerUserPerDay} reached.`,
    );
  }
}
