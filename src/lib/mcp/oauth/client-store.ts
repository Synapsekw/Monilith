import "server-only";
import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import type { Tables } from "@/types/database.types";
import type { RegisterClientInput } from "@/lib/validations/mcp-oauth";

export async function registerOauthClient(
  input: RegisterClientInput,
): Promise<Tables<"oauth_clients">> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("oauth_clients")
    .insert({
      client_id: randomUUID(),
      client_name: input.client_name,
      redirect_uris: input.redirect_uris,
    })
    .select("*")
    .single();
  if (error || !data)
    throw new Error(error?.message ?? "Client registration failed.");
  return data;
}

export async function getOauthClient(
  clientId: string,
): Promise<Tables<"oauth_clients"> | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("oauth_clients")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();
  return data;
}
