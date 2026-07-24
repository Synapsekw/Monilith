import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import type { Database } from "@/types/database.types";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!integrationTargetReady())(
  "session-bridge: mint + refresh round-trip",
  () => {
    let admin: ReturnType<typeof createClient<Database>>;
    let userId: string;
    // Dynamic import DEFERRED until after loadIntegrationEnv() has overridden
    // process.env, because @/lib/env.ts caches NEXT_PUBLIC_SUPABASE_URL eagerly
    // at module-evaluation time and a static `import ... from "./session-bridge"`
    // would resolve during this file's import-hoisting phase — before
    // loadIntegrationEnv() runs — baking in vitest.setup.ts's placeholder
    // localhost URL instead of the real target.
    let mintBridgeSecret: typeof import("./session-bridge").mintBridgeSecret;
    let getBridgedClient: typeof import("./session-bridge").getBridgedClient;

    beforeAll(async () => {
      ({ mintBridgeSecret, getBridgedClient } =
        await import("./session-bridge"));
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const email = `mcp-bridge-${randomUUID()}@example.com`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: "Test-Password-123!",
        email_confirm: true,
      });
      expect(error).toBeNull();
      userId = data.user!.id;
    }, 60_000);

    afterAll(async () => {
      await admin.auth.admin.deleteUser(userId);
    }, 60_000);

    it("mints a bridge secret that resolves to a real, RLS-scoped client for that user", async () => {
      const secretId = await mintBridgeSecret(userId);
      expect(secretId).toBeTruthy();

      const { client, newBridgeSecretId } = await getBridgedClient(secretId);
      expect(newBridgeSecretId).toBeTruthy();

      const {
        data: { user },
      } = await client.auth.getUser();
      expect(user?.id).toBe(userId);
    }, 30_000);

    it("does not rotate the Vault secret when the cached access token is still valid", async () => {
      const secretId = await mintBridgeSecret(userId);

      // First call caches a freshly-minted (definitely-valid) access token.
      const first = await getBridgedClient(secretId);
      expect(first.newBridgeSecretId).toBe(secretId);

      // A second call — simulating a concurrent tool call on the same
      // connection — must be a pure Vault read: same secret id back, no
      // refreshSession/rotate round trip, so it can never race a sibling
      // call over a single-use refresh token.
      const second = await getBridgedClient(secretId);
      expect(second.newBridgeSecretId).toBe(secretId);

      const {
        data: { user },
      } = await second.client.auth.getUser();
      expect(user?.id).toBe(userId);
    }, 30_000);

    it("refreshes and rotates the Vault secret once the cached access token is expired", async () => {
      const svc = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const secretId = await mintBridgeSecret(userId);

      // Read back the freshly-minted payload and rewrite it with an
      // already-expired accessExpiresAt, so the next getBridgedClient() call
      // is forced down the refresh+rotate path.
      const { data: rawSecret, error: getErr } = await typedRpc(
        svc,
        "oauth_bridge_get_secret",
        { p_secret_id: secretId },
      );
      expect(getErr).toBeNull();
      const payload = JSON.parse(rawSecret as string) as {
        refreshToken: string;
        accessToken: string;
        accessExpiresAt: number;
      };
      const { data: rotatedSecretId, error: rotateErr } = await typedRpc(
        svc,
        "oauth_bridge_rotate_secret",
        {
          p_old_secret_id: secretId,
          p_secret: JSON.stringify({
            ...payload,
            accessExpiresAt: Date.now() - 1000,
          }),
          p_name: `mcp_bridge:${userId}`,
        },
      );
      expect(rotateErr).toBeNull();

      const { client, newBridgeSecretId } = await getBridgedClient(
        rotatedSecretId as string,
      );
      // A refresh actually happened, so the Vault secret was rotated again —
      // the id returned must differ from the one we forced expiry onto.
      expect(newBridgeSecretId).not.toBe(rotatedSecretId);

      const {
        data: { user },
      } = await client.auth.getUser();
      expect(user?.id).toBe(userId);
    }, 30_000);
  },
);
