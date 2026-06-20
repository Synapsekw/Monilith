import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { PendingInvitation } from "./invitations";

type Client = SupabaseClient<Database>;

export async function fetchPendingInvitations(
  supabase: Client,
): Promise<PendingInvitation[]> {
  const { data, error } = await supabase.rpc("my_pending_invitations");
  if (error) return [];
  return (data ?? []) as PendingInvitation[];
}

export async function acceptInvitation(
  supabase: Client,
  inviteId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("accept_invitation", {
    p_invite_id: inviteId,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function declineInvitation(
  supabase: Client,
  inviteId: string,
): Promise<void> {
  const { error } = await supabase.rpc("decline_invitation", {
    p_invite_id: inviteId,
  });
  if (error) throw new Error(error.message);
}
