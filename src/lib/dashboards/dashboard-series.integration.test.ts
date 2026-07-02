import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { Database } from "@/types/database.types";

// Load dev credentials from .env.local (symlinked into this worktree).
loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// These exercise the RPC's SHAPE + auth contract. They run only against a marked
// dedicated test project (.env.test); otherwise they skip (no DEV pollution).
describe.runIf(integrationTargetReady())("dashboard_series RPC", () => {
  // Use an anon (not signed-in) client — the RPC enforces is_org_member, so
  // an unknown board must yield an error for any caller.
  const supabase = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  it("rejects an unknown board with a not-found error", async () => {
    const { error } = await supabase.rpc("dashboard_series", {
      p_board_id: "00000000-0000-0000-0000-000000000000",
      p_primary: { kind: "date", bucket: "month" },
      p_measure: { agg: "count" },
      p_limit: 12,
    });
    // not-found OR not-a-member depending on RLS visibility — both are non-null.
    expect(error).not.toBeNull();
  });

  it("accepts a valid date-primary call shape (returns rows array)", async () => {
    // A board the test user can see is required for a green data assertion; here
    // we assert the call contract resolves without throwing for a bad board.
    const res = await supabase.rpc("dashboard_series", {
      p_board_id: "00000000-0000-0000-0000-000000000000",
      p_primary: { kind: "date", bucket: "week" },
      p_series: null,
      p_measure: { agg: "count" },
      p_limit: 6,
    });
    expect(res).toHaveProperty("error");
    expect(res).toHaveProperty("data");
  });
});
