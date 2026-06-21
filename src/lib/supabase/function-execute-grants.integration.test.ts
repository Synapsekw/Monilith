import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

// Real dev credentials (see rls.integration.test.ts for the override rationale).
config({ path: ".env.local", override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PASSWORD = "Test-Password-123!";

// Guards the SECURITY DEFINER execute lockdown (migration 20260621130000):
//  - anon (logged out) must not be able to call ANY public function via RPC.
//  - authenticated must not be able to call internal `_`-prefixed / trigger
//    functions directly, but MUST keep calling RLS helpers + user RPCs.
describe.skipIf(!SERVICE_ROLE_KEY)("SECURITY DEFINER execute grants", () => {
  let admin: SupabaseClient<Database>;
  let anon: SupabaseClient<Database>;
  let authed: SupabaseClient<Database>;
  let createdUserId: string | null = null;

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // A genuinely logged-out client — never signed in, so it acts as `anon`.
    anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const email = `fn-grants-${randomUUID()}@example.com`;
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
    expect(createErr, "createUser").toBeNull();
    createdUserId = created.user!.id;

    authed = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInErr } = await signInWithRetry(authed, {
      email,
      password: PASSWORD,
    });
    expect(signInErr, "signIn").toBeNull();
  });

  afterAll(async () => {
    if (createdUserId) await admin.auth.admin.deleteUser(createdUserId);
  });

  // Once EXECUTE is revoked for a role, PostgREST drops the function from that
  // role's schema cache, so the call comes back as "could not find function"
  // (PGRST202); a raw permission error surfaces as 42501. Either proves denial;
  // an unrelated logic/FK error (e.g. 23503) does NOT, so we match on code.
  const isDenied = (error: { code?: string | null } | null): boolean =>
    error != null && (error.code === "PGRST202" || error.code === "42501");

  it("denies anon execution of a SECURITY DEFINER function", async () => {
    const { error } = await anon.rpc("is_platform_admin");
    expect(isDenied(error), `anon must be denied; got ${JSON.stringify(error)}`).toBe(true);
  });

  it("denies authenticated execution of an internal `_` function", async () => {
    const { error } = await authed.rpc("_admin_audit", {
      p_org_id: randomUUID(),
      p_actor: randomUUID(),
      p_actor_kind: "user",
      p_action: "test",
      p_target_user: randomUUID(),
      p_target_email: "x@example.com",
      p_metadata: {},
    });
    expect(isDenied(error), `authenticated must be denied; got ${JSON.stringify(error)}`).toBe(true);
  });

  it("still allows authenticated execution of a kept helper/RPC", async () => {
    // is_platform_admin is an RLS-relevant helper the app calls; authenticated
    // must keep EXECUTE. Returns false for a normal user, with no error.
    const { data, error } = await authed.rpc("is_platform_admin");
    expect(error, "authenticated should still execute is_platform_admin").toBeNull();
    expect(data).toBe(false);
  });
});
