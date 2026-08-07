import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/types/database.types";
import { createAttachmentUploadHandler } from "./create-attachment-upload";
import { attachFileHandler } from "./attach-file";
import type { GetClient } from "./shared";
import { runTeardownSteps } from "@/test/teardown-steps";

// RUNS ONLY against a dedicated test project. `integrationTargetReady()`
// requires PULSE_TEST_DB=1 *and* a URL that is neither DEV nor PROD
// (src/test/integration-env.ts deny-lists both refs), so with only `.env.local`
// this suite SKIPS — including with PULSE_TEST_DB=1 forced on the command line.
// That is deliberate: it provisions users, orgs and real storage objects, and
// DEV holds live user-facing data. Provision a throwaway project + `.env.test`
// to execute it.
loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Builds one org with a board, its default group, and a single item, using the
 * caller's own bridged (RLS-scoped) client — never the service role, so the
 * fixture itself proves the user is genuinely a member of what it creates.
 */
async function seedOrg(
  client: SupabaseClient<Database>,
  userId: string,
  label: string,
): Promise<{ orgId: string; boardId: string; itemId: string }> {
  const { data: org, error: orgErr } = await client.rpc("create_organization", {
    p_name: `MCP Attach ${label}`,
    p_slug: `mcp-attach-${label}-${randomUUID().slice(0, 8)}`,
  });
  if (orgErr || !org)
    throw new Error(`create_organization failed: ${orgErr?.message}`);
  const orgId = (org as { id: string }).id;

  const { data: ws, error: wsErr } = await client
    .from("workspaces")
    .insert({ org_id: orgId, name: "WS", created_by: userId })
    .select("id")
    .single();
  if (wsErr || !ws) throw new Error(`workspace insert failed: ${wsErr}`);

  const { data: board, error: boardErr } = await client.rpc("create_board", {
    p_workspace_id: (ws as { id: string }).id,
    p_name: `Board ${label}`,
  });
  if (boardErr || !board)
    throw new Error(`create_board failed: ${boardErr?.message}`);
  const boardId = (board as { id: string }).id;

  const { data: group, error: groupErr } = await client
    .from("groups")
    .select("id")
    .eq("board_id", boardId)
    .limit(1)
    .single();
  if (groupErr || !group) throw new Error(`group read failed: ${groupErr}`);

  const { data: item, error: itemErr } = await client
    .from("items")
    .insert({
      org_id: orgId,
      board_id: boardId,
      group_id: (group as { id: string }).id,
      name: `Item ${label}`,
      position: 1,
    })
    .select("id")
    .single();
  if (itemErr || !item) throw new Error(`item insert failed: ${itemErr}`);

  return { orgId, boardId, itemId: (item as { id: string }).id };
}

describe.skipIf(!integrationTargetReady())(
  "MCP attachment tools: RLS keeps them inside the caller's org",
  () => {
    let admin: ReturnType<typeof createClient<Database>>;
    let orgAUserId: string;
    let orgBUserId: string;
    let orgAId: string;
    let orgAItemId: string;
    let orgBId: string;
    let orgBBoardId: string;
    let orgBItemId: string;
    /** Org A's bridged client, wrapped as a GetClient — the subject under test. */
    let orgAGetClient: GetClient;
    /** storagePaths created by the passing test, removed in afterAll. */
    const createdPaths: string[] = [];

    // Dynamic import DEFERRED until after loadIntegrationEnv() has overridden
    // process.env, because @/lib/env.ts caches NEXT_PUBLIC_SUPABASE_URL eagerly
    // at module-evaluation time and a static import of the session bridge would
    // resolve during this file's import-hoisting phase — baking in
    // vitest.setup.ts's placeholder localhost URL instead of the real target.
    // Same reasoning as cross-org-access.rls.integration.test.ts.
    let mintBridgeSecret: typeof import("@/lib/mcp/oauth/session-bridge").mintBridgeSecret;
    let getBridgedClient: typeof import("@/lib/mcp/oauth/session-bridge").getBridgedClient;

    beforeAll(async () => {
      ({ mintBridgeSecret, getBridgedClient } =
        await import("@/lib/mcp/oauth/session-bridge"));
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const a = await admin.auth.admin.createUser({
        email: `mcp-attach-a-${randomUUID()}@example.com`,
        password: "Test-Password-123!",
        email_confirm: true,
      });
      const b = await admin.auth.admin.createUser({
        email: `mcp-attach-b-${randomUUID()}@example.com`,
        password: "Test-Password-123!",
        email_confirm: true,
      });
      orgAUserId = a.data.user!.id;
      orgBUserId = b.data.user!.id;

      const secretA = await mintBridgeSecret(orgAUserId);
      const { client: clientA } = await getBridgedClient(secretA);
      const secretB = await mintBridgeSecret(orgBUserId);
      const { client: clientB } = await getBridgedClient(secretB);

      const orgA = await seedOrg(clientA, orgAUserId, "a");
      orgAId = orgA.orgId;
      orgAItemId = orgA.itemId;
      const orgB = await seedOrg(clientB, orgBUserId, "b");
      orgBId = orgB.orgId;
      orgBBoardId = orgB.boardId;
      orgBItemId = orgB.itemId;

      orgAGetClient = async () => clientA;
    }, 90_000);

    afterAll(async () => {
      // Storage objects are removed FIRST: deleting the org cascades the
      // `attachments` ROWS, but nothing removes the bucket OBJECTS they point
      // at, so skipping this leaks real files into the target project forever.
      await runTeardownSteps([
        {
          label: `remove ${createdPaths.length} storage object(s)`,
          run: async () => {
            if (createdPaths.length === 0) return { error: null };
            const { error } = await admin.storage
              .from("attachments")
              .remove(createdPaths);
            return { error };
          },
        },
        {
          label: `delete organization ${orgAId}`,
          run: async () => {
            const { error } = await admin
              .from("organizations")
              .delete()
              .eq("id", orgAId);
            return { error };
          },
        },
        {
          label: `delete organization ${orgBId}`,
          run: async () => {
            const { error } = await admin
              .from("organizations")
              .delete()
              .eq("id", orgBId);
            return { error };
          },
        },
        {
          label: `delete user ${orgAUserId}`,
          run: async () => {
            const { error } = await admin.auth.admin.deleteUser(orgAUserId);
            return { error };
          },
        },
        {
          label: `delete user ${orgBUserId}`,
          run: async () => {
            const { error } = await admin.auth.admin.deleteUser(orgBUserId);
            return { error };
          },
        },
      ]);
    }, 90_000);

    it("cannot mint an upload ticket for another org's item", async () => {
      const result = await createAttachmentUploadHandler(orgAGetClient, {
        itemId: orgBItemId,
        fileName: "steal.csv",
      });
      // RLS hides the item entirely from org A, so scope resolution fails.
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Item not found.");
    }, 30_000);

    it("cannot register an attachment onto another org's item", async () => {
      const result = await attachFileHandler(
        orgAGetClient,
        {
          itemId: orgBItemId,
          fileName: "steal.csv",
          contentBase64: Buffer.from("x", "utf8").toString("base64"),
        },
        orgAUserId,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Item not found.");
    }, 30_000);

    it("cannot register a path pointing at another org's storage prefix", async () => {
      const result = await attachFileHandler(
        orgAGetClient,
        {
          itemId: orgAItemId,
          fileName: "steal.csv",
          storagePath: `${orgBId}/${orgBBoardId}/${orgBItemId}/abc-steal.csv`,
        },
        orgAUserId,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe(
        "Storage path does not match this item.",
      );
    }, 30_000);

    // The control: without it, all three negatives would still pass if the
    // handlers were broken and always errored.
    it("attaches successfully within the caller's own org", async () => {
      const result = await attachFileHandler(
        orgAGetClient,
        {
          itemId: orgAItemId,
          fileName: "own.txt",
          mimeType: "text/plain",
          contentBase64: Buffer.from("mine", "utf8").toString("base64"),
        },
        orgAUserId,
      );
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text as string) as {
        sizeBytes: number;
        storagePath: string;
      };
      expect(parsed.sizeBytes).toBe(4);
      createdPaths.push(parsed.storagePath);
    }, 30_000);
  },
);
