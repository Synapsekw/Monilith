import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { isSafeTestTarget, loadIntegrationEnv } from "./integration-env";

// Vitest globalSetup file: the exported `teardown` runs ONCE after the whole
// run. Integration suites (`*.integration.test.ts`) provision throwaway
// `@example.com` users + orgs against the LIVE cloud project (no local stack),
// which leaked thousands of rows historically. With the cascade-safe
// cell-activity trigger in place (migration 20260619230000), deleting an org
// cascades cleanly, so we can purge all leaked test data here using
// supabase-js with the service role (the only DB access the test process has —
// no direct Postgres URL / pg driver).
// See vault/decisions/2026-06-19-gotcha-23-activity-trigger-blocks-cascade-delete.md

const EXAMPLE_SUFFIX = "@example.com";

// global-teardown is the cross-run leak-sweeper; per-suite afterAll already
// removes same-run data. Because every worktree's `pnpm test` shares ONE cloud
// dev project, an unscoped suffix purge cascade-deletes a *concurrent* run's
// in-flight org → board → group (the P0002 "group not found" flake). Only sweep
// users old enough that no live run could still own them; true orphans from a
// crashed run age past this and get collected by the next run.
export const PURGE_MIN_AGE_MS = 30 * 60 * 1000; // 30 min

export type PurgeCandidate = {
  id: string;
  email: string | null | undefined;
  created_at: string;
};

export function selectPurgeableUserIds(
  users: PurgeCandidate[],
  nowMs: number,
  minAgeMs: number,
): string[] {
  const ids: string[] = [];
  for (const u of users) {
    if (!u.email?.toLowerCase().endsWith(EXAMPLE_SUFFIX)) continue;
    const createdMs = Date.parse(u.created_at);
    if (Number.isNaN(createdMs)) continue; // unknown age → never purge
    if (nowMs - createdMs >= minAgeMs) ids.push(u.id);
  }
  return ids;
}

const LIST_PER_PAGE = 1000;
const MAX_PAGES = 50;
const BATCH = 100;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function teardown(): Promise<void> {
  // Single source of truth: loads .env.local then .env.test (override) if present.
  loadIntegrationEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // No service-role secret (e.g. CI) → no integration suite ran. Skip silently.
  if (!url || !serviceRoleKey) return;

  // HARD GUARD: the @example.com purge is destructive. Run it ONLY against the
  // explicitly-marked dedicated test project — never DEV/PROD. Without .env.test
  // (or its PULSE_TEST_DB marker) this refuses and returns, leaving DEV intact.
  if (!isSafeTestTarget(url)) {
    console.warn(
      "[global-teardown] target is not a marked test DB (PULSE_TEST_DB) — " +
        "skipping purge to protect DEV/PROD.",
    );
    return;
  }

  const admin: SupabaseClient<Database> = createClient<Database>(
    url,
    serviceRoleKey,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );

  // Collect every test user (id + email + created_at), paginating until a short page.
  const candidates: PurgeCandidate[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: LIST_PER_PAGE,
    });
    if (error) {
      console.warn(
        `[global-teardown] listUsers page ${page} failed: ${error.message}`,
      );
      break;
    }
    const users = data?.users ?? [];
    for (const u of users) {
      candidates.push({ id: u.id, email: u.email, created_at: u.created_at });
    }
    if (users.length < LIST_PER_PAGE) break;
  }

  // Age-gate: only purge users old enough that no concurrent run still owns them.
  const userIds = selectPurgeableUserIds(
    candidates,
    Date.now(),
    PURGE_MIN_AGE_MS,
  );

  if (userIds.length === 0) return;

  const idBatches = chunk(userIds, BATCH);

  // Delete their orgs — the cascade-safe trigger lets this remove all
  // org-scoped rows (boards/groups/items/columns/cell_values/activities).
  for (const batch of idBatches) {
    const { error } = await admin
      .from("organizations")
      .delete()
      .in("created_by", batch);
    if (error)
      console.warn(
        `[global-teardown] org delete batch failed: ${error.message}`,
      );
  }

  // Platform-level audit rows aren't org-scoped, so they don't cascade away.
  for (const batch of idBatches) {
    const byActor = await admin
      .from("admin_audit_log")
      .delete()
      .in("actor_id", batch);
    if (byActor.error)
      console.warn(
        `[global-teardown] audit(actor) delete batch failed: ${byActor.error.message}`,
      );
    const byTarget = await admin
      .from("admin_audit_log")
      .delete()
      .in("target_user_id", batch);
    if (byTarget.error)
      console.warn(
        `[global-teardown] audit(target) delete batch failed: ${byTarget.error.message}`,
      );
  }

  // Finally remove the auth users themselves (best-effort, per id).
  let deletedUsers = 0;
  for (const id of userIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (!error) deletedUsers++;
  }

  console.log(
    `[global-teardown] purged ${deletedUsers} test users / ${userIds.length} candidate org-owners`,
  );
}
