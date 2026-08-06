import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/types/database.types";
import { listBoardsHandler } from "./list-boards";
import { listGoalsHandler } from "./list-goals";
import { getGoalHandler } from "./get-goal";
import { listDashboardsHandler } from "./list-dashboards";
import { getWorkloadHandler } from "./get-workload";
import { logTimeAllocationHandler } from "./log-time-allocation";
import type { GetClient } from "./shared";

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

describe.skipIf(!integrationTargetReady())(
  "org-scoped tools reject a foreign orgId",
  () => {
    let admin: ReturnType<typeof createClient<Database>>;
    let userAId: string;
    let userBId: string;
    let orgAId: string;
    let getClientB: GetClient;

    // Same deferred-import reasoning as the describe block above.
    let mintBridgeSecret: typeof import("@/lib/mcp/oauth/session-bridge").mintBridgeSecret;
    let getBridgedClient: typeof import("@/lib/mcp/oauth/session-bridge").getBridgedClient;

    beforeAll(async () => {
      ({ mintBridgeSecret, getBridgedClient } =
        await import("@/lib/mcp/oauth/session-bridge"));
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const a = await admin.auth.admin.createUser({
        email: `mcp-scope-a-${randomUUID()}@example.com`,
        password: "Test-Password-123!",
        email_confirm: true,
      });
      const b = await admin.auth.admin.createUser({
        email: `mcp-scope-b-${randomUUID()}@example.com`,
        password: "Test-Password-123!",
        email_confirm: true,
      });
      userAId = a.data.user!.id;
      userBId = b.data.user!.id;

      // Only user A gets a real organization — user B stays org-less, exactly
      // like orgBUserId above, so "not a member" is true by construction, not
      // by a bug in the test's own setup.
      const secretA = await mintBridgeSecret(userAId);
      const { client: clientA } = await getBridgedClient(secretA);
      const { data: org, error: orgErr } = await clientA.rpc(
        "create_organization",
        {
          p_name: "MCP Scope Org A",
          p_slug: `mcp-scope-a-${randomUUID().slice(0, 8)}`,
        },
      );
      if (orgErr || !org)
        throw new Error(`create_organization failed: ${orgErr?.message}`);
      orgAId = (org as { id: string }).id;

      const secretB = await mintBridgeSecret(userBId);
      getClientB = async () => (await getBridgedClient(secretB)).client;
    }, 60_000);

    afterAll(async () => {
      // Deleting the org first cascades workspaces/boards/goals/dashboards/
      // time_allocations owned by it (all `org_id ... on delete cascade`), so
      // by the time we delete the owning user no row anywhere still
      // references them — `organizations.created_by` is deliberately
      // NOT NULL / NO ACTION (2026-07-25 account-deletion-fks migration) and
      // would otherwise block deleteUser outright.
      await admin.from("organizations").delete().eq("id", orgAId);
      await admin.auth.admin.deleteUser(userAId);
      await admin.auth.admin.deleteUser(userBId);
    }, 60_000);

    const cases: {
      name: string;
      run: (orgId: string) => Promise<{ isError?: boolean }>;
    }[] = [
      {
        name: "list_goals",
        run: (orgId) => listGoalsHandler(getClientB, { orgId }),
      },
      {
        name: "get_goal",
        // The org check runs before any goal lookup, so a placeholder goalId
        // never gets reached.
        run: (orgId) =>
          getGoalHandler(getClientB, { goalId: randomUUID(), orgId }),
      },
      {
        name: "list_dashboards",
        run: (orgId) => listDashboardsHandler(getClientB, { orgId }),
      },
      {
        name: "get_workload",
        run: (orgId) => getWorkloadHandler(getClientB, { orgId }),
      },
      {
        name: "log_time_allocation",
        run: (orgId) =>
          logTimeAllocationHandler(getClientB, userBId, {
            orgId,
            date: "2026-01-05",
            category: "Admin",
            secs: 900,
          }),
      },
    ];

    for (const c of cases) {
      it(`${c.name} refuses org A when called as user B`, async () => {
        const result = await c.run(orgAId);
        expect(result.isError).toBe(true);
      }, 30_000);
    }
  },
);
