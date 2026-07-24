import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  },
);
