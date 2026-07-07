import { randomUUID } from "node:crypto";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

loadIntegrationEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";
const BUCKET = "avatars";

type U = { id: string; anon: SupabaseClient<Database> };

describe.skipIf(!integrationTargetReady())("RLS: avatars storage", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];
  const uploadedPaths: string[] = [];

  let userA: U;
  let userB: U;

  async function provision(): Promise<U> {
    const email = `rls-avatar-${randomUUID()}@example.com`;
    const { data: created } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    const id = created.user!.id;
    createdUserIds.push(id);

    const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await signInWithRetry(anon, { email, password: PASSWORD });
    return { id, anon };
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    userA = await provision();
    userB = await provision();
  }, 60_000);

  afterAll(async () => {
    // Best-effort object cleanup, then delete the provisioned users.
    if (uploadedPaths.length)
      await admin.storage
        .from(BUCKET)
        .remove(uploadedPaths)
        .catch(() => {});
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  });

  it("owner can upload under their own {uid}/ prefix", async () => {
    const path = `${userA.id}/${randomUUID()}.webp`;
    const { error } = await userA.anon.storage
      .from(BUCKET)
      .upload(path, new Blob(["x"], { type: "image/webp" }));
    expect(error).toBeNull();
    if (!error) uploadedPaths.push(path);
  });

  it("a user CANNOT upload under another user's prefix (RLS denies)", async () => {
    // userB writing into userA's prefix.
    const path = `${userA.id}/${randomUUID()}.webp`;
    const { error } = await userB.anon.storage
      .from(BUCKET)
      .upload(path, new Blob(["x"], { type: "image/webp" }));
    expect(error).not.toBeNull();
  });

  it("public read works via the public URL (no auth)", async () => {
    const path = `${userA.id}/${randomUUID()}.webp`;
    const { error: upErr } = await userA.anon.storage
      .from(BUCKET)
      .upload(path, new Blob(["x"], { type: "image/webp" }));
    expect(upErr).toBeNull();
    if (!upErr) uploadedPaths.push(path);

    const { data } = userA.anon.storage.from(BUCKET).getPublicUrl(path);
    const res = await fetch(data.publicUrl);
    expect(res.ok).toBe(true);
  });
});
