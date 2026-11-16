import "server-only";
import { requireUser } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";

export type McpConnection = {
  id: string;
  clientName: string;
  createdAt: string;
  /** Last time the app refreshed its access or called a tool (5-minute grain). */
  lastUsedAt: string;
  /** When the connection lapses if the app is not used again before then. */
  expiresAt: string;
};

export async function listMyConnections(): Promise<McpConnection[]> {
  const user = await requireUser();
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("oauth_tokens")
    .select(
      "id, created_at, last_used_at, refresh_token_expires_at, oauth_clients(client_name)",
    )
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  return (data ?? []).map((row) => ({
    id: row.id,
    clientName: row.oauth_clients?.client_name ?? "Unknown app",
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.refresh_token_expires_at,
  }));
}
