import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/types/database.types";
import { listBoardsHandler } from "./list-boards";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!integrationTargetReady())(
  "MCP bridged client: RLS still applies (list_boards never crosses orgs)",
  () => {
    let admin: ReturnType<typeof createClient<Database>>;
    let orgAUserId: string;
    let orgBUserId: string;
    // Dynamic import DEFERRED until after loadIntegrationEnv() has overridden
    // process.env, because @/lib/env.ts caches NEXT_PUBLIC_SUPABASE_URL eagerly
    // at module-evaluation time and a static `import ... from
    // "@/lib/mcp/oauth/session-bridge"` would resolve during this file's
    // import-hoisting phase — before loadIntegrationEnv() runs — baking in
    // vitest.setup.ts's placeholder localhost URL instead of the real target.
    // Same fix as session-bridge.integration.test.ts (Task 5); verified by
    // reproducing the ECONNREFUSED failure with a static import against live
    // dev, then confirming this deferred-import form passes.
    let mintBridgeSecret: typeof import("@/lib/mcp/oauth/session-bridge").mintBridgeSecret;
    let getBridgedClient: typeof import("@/lib/mcp/oauth/session-bridge").getBridgedClient;

    beforeAll(async () => {
      ({ mintBridgeSecret, getBridgedClient } =
        await import("@/lib/mcp/oauth/session-bridge"));
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const a = await admin.auth.admin.createUser({
        email: `mcp-org-a-${randomUUID()}@example.com`,
        password: "Test-Password-123!",
        email_confirm: true,
      });
      const b = await admin.auth.admin.createUser({
        email: `mcp-org-b-${randomUUID()}@example.com`,
        password: "Test-Password-123!",
        email_confirm: true,
      });
      orgAUserId = a.data.user!.id;
      orgBUserId = b.data.user!.id;
    }, 60_000);

    afterAll(async () => {
      await admin.auth.admin.deleteUser(orgAUserId);
      await admin.auth.admin.deleteUser(orgBUserId);
    }, 60_000);

    it("a bridged client for user A never returns boards belonging to org-B-only user B", async () => {
      const secretId = await mintBridgeSecret(orgAUserId);
      const { client } = await getBridgedClient(secretId);
      const result = await listBoardsHandler(async () => client);
      const boards = JSON.parse(result.content[0].text as string) as {
        orgId: string;
      }[];
      // orgBUserId has no membership in any org orgAUserId belongs to (both are
      // fresh, org-less test users), so this must be empty — proving the
      // bridged client is RLS-scoped, not merely filtered in application code.
      expect(boards).toEqual([]);
      void orgBUserId;
    }, 30_000);
  },
);
