import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

// Load real dev credentials. `override: true` is required because
// vitest.setup.ts seeds placeholder NEXT_PUBLIC_* values before this file's
// top-level code runs; without override dotenv would keep the placeholders.
config({ path: ".env.local", override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PW = "Test-Password-123!";

type TestUser = {
  id: string;
  email: string;
  anon: SupabaseClient<Database>;
};

// Skips cleanly in CI (no service-role secret); runs locally against the dev
// project — mirroring the admin RLS suite's guard pattern exactly.
describe.skipIf(!SERVICE_ROLE_KEY)("profiles RLS — timezone field", () => {
  let admin: SupabaseClient<Database>;

  const createdUserIds: string[] = [];

  let userA: TestUser;
  let userB: TestUser;

  async function createUser(label: string): Promise<TestUser> {
    const email = `tz-rls-${label}-${randomUUID()}@example.com`;
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password: PW,
        email_confirm: true,
      });
    expect(createErr, `createUser(${label})`).toBeNull();
    const id = created.user!.id;
    createdUserIds.push(id);

    const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInErr } = await signInWithRetry(anon, {
      email,
      password: PW,
    });
    expect(signInErr, `signIn(${label})`).toBeNull();

    return { id, email, anon };
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    userA = await createUser("userA");
    userB = await createUser("userB");
  }, 120_000);

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  }, 60_000);

  it("user can update their OWN profile timezone and the value persists", async () => {
    const { error: updateErr } = await userA.anon
      .from("profiles")
      .update({ timezone: "Europe/Belgrade" })
      .eq("id", userA.id);

    expect(updateErr, "own profile update should succeed").toBeNull();

    // Verify via the service-role client (bypasses RLS) that the value persisted.
    const { data, error: selectErr } = await admin
      .from("profiles")
      .select("timezone")
      .eq("id", userA.id)
      .single();

    expect(selectErr, "service-role select after own update").toBeNull();
    expect((data as { timezone: string | null }).timezone).toBe(
      "Europe/Belgrade",
    );
  });

  it("user CANNOT change another user's timezone (RLS default-deny)", async () => {
    // Attempt to write userB's timezone from userA's authenticated client.
    const { data: updateData, error: updateErr } = await userA.anon
      .from("profiles")
      .update({ timezone: "Asia/Tokyo" })
      .eq("id", userB.id)
      .select();

    // RLS hides the row from the writer — no explicit error, but 0 rows affected.
    void updateErr; // may be null (RLS silently filters) — that's expected
    expect(
      (updateData ?? []).length,
      "cross-user update must affect 0 rows (RLS hides the row)",
    ).toBe(0);

    // Verify via service-role client that userB's timezone was NOT changed.
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("timezone")
      .eq("id", userB.id)
      .single();

    expect(
      profileErr,
      "service-role verify after cross-user update",
    ).toBeNull();
    expect(
      (profile as { timezone: string | null }).timezone,
      "userB's timezone must not be Asia/Tokyo",
    ).not.toBe("Asia/Tokyo");
  });
});
