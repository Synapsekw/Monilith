// server-only — bypasses RLS, never import into client components.
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";
import { getServerEnv } from "@/lib/env.server";
import type { Database } from "@/types/database.types";

export function createServiceClient() {
  // Validated at boot by instrumentation.ts; getServerEnv() throws an
  // aggregated, var-naming error if this process somehow skipped that.
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();

  // No-op cookies: the service client is fully privileged and stateless, so it
  // must not read or write any user session.
  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
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
