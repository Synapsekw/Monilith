import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";
import type { Database } from "@/types/database.types";

loadIntegrationEnv();

/**
 * Regression test for a latent bug that shipped and was never noticed.
 *
 * `platformDeleteUser` (src/lib/platform/actions.ts) writes an `admin_audit_log`
 * row with `target_user_id = <the user being deleted>` and THEN calls
 * `svc.auth.admin.deleteUser`. That FK was `ON DELETE NO ACTION`, so the action's
 * own audit write blocked its own delete: the admin "Delete permanently" button
 * returned `fail("Could not delete the user.")` every single time, for every user.
 *
 * Verified against DEV in a rolled-back transaction before the fix:
 *   PROBE(target_user_id): BLOCKED by [admin_audit_log_target_user_id_fkey]
 *     :: update or delete on table "users" violates foreign key constraint
 *
 * There was no existing coverage of the delete path — `platform.integration.test.ts`
 * covers the gate and the search RPCs only — which is exactly why it shipped.
 */
describe.skipIf(!integrationTargetReady())(
  "platform hard-delete after the FK fix",
  () => {
    const admin = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const createdUserIds: string[] = [];

    afterAll(async () => {
      for (const id of createdUserIds) {
        await admin.auth.admin.deleteUser(id).catch(() => {});
      }
    });

    it("an audit row naming the user no longer blocks their deletion", async () => {
      const email = `plat-del-${randomUUID()}@example.com`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: "Test-Password-123!",
        email_confirm: true,
      });
      expect(error, "createUser").toBeNull();
      const id = data.user!.id;
      createdUserIds.push(id);

      // Exactly the shape platformDeleteUser writes: actor is the acting admin,
      // target is the user about to be deleted. `actor_kind` is CHECK-constrained
      // to 'org' | 'platform'.
      const { error: auditErr } = await admin.from("admin_audit_log").insert({
        org_id: null,
        actor_id: id,
        actor_kind: "platform",
        action: "platform.user_deleted",
        target_user_id: id,
        target_email: email,
        metadata: {},
      });
      expect(auditErr, "audit insert").toBeNull();

      // THE assertion. Before the migration this failed with a 23503 on
      // admin_audit_log_target_user_id_fkey.
      const { error: delErr } = await admin.auth.admin.deleteUser(id);
      expect(delErr, "deleteUser with an audit row pointing at it").toBeNull();

      // The audit fact survives the person: both user pointers are nulled by the
      // new SET NULL FKs, and the email is retained (spec §7, decision D1).
      const { data: rows } = await admin
        .from("admin_audit_log")
        .select("actor_id, target_user_id, target_email")
        .eq("target_email", email);
      expect(rows).toHaveLength(1);
      expect(rows![0].actor_id).toBeNull();
      expect(rows![0].target_user_id).toBeNull();
      expect(rows![0].target_email).toBe(email);
    });
  },
);
