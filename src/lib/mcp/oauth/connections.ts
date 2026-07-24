import "server-only";
import { requireUser } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";

export async function listMyConnections(): Promise<
  { id: string; clientName: string; createdAt: string }[]
> {
  const user = await requireUser();
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("oauth_tokens")
    .select("id, created_at, oauth_clients(client_name)")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  return (data ?? []).map((row) => ({
    id: row.id,
    clientName:
      (row.oauth_clients as { client_name: string } | null)?.client_name ??
      "Unknown app",
    createdAt: row.created_at,
  }));
}
