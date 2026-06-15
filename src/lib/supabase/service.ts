// server-only — bypasses RLS, never import into client components.
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";
import type { Database } from "@/types/database.types";

export function createServiceClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for the service client",
    );
  }

  // No-op cookies: the service client is fully privileged and stateless, so it
  // must not read or write any user session.
  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {},
      },
    },
  );
}
