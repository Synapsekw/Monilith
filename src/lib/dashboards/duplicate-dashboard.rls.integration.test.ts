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

describe.skipIf(!integrationTargetReady())(
  "RLS + RPC: duplicate_dashboard",
  () => {
    let admin: SupabaseClient<Database>;
    const createdUserIds: string[] = [];

    /** orgA context — userA owns a source dashboard */
    let userAId: string;
    let userAAnon: SupabaseClient<Database>;
    let orgAId: string;
    let dashboardAId: string;

    /** orgB context — userB is NOT a member of orgA */
    let userBAnon: SupabaseClient<Database>;

    beforeAll(async () => {
      admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // ── userA in orgA ───────────────────────────────────────────────────────
      const emailA = `rls-dupdash-a-${randomUUID()}@example.com`;
      const { data: createdA, error: errA } = await admin.auth.admin.createUser(
        {
          email: emailA,
          password: PASSWORD,
          email_confirm: true,
        },
      );
      expect(errA, "createUser(A)").toBeNull();
      userAId = createdA.user!.id;
      createdUserIds.push(userAId);

      userAAnon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInWithRetry(userAAnon, { email: emailA, password: PASSWORD });

      const { data: orgData } = await userAAnon.rpc("create_organization", {
        p_name: "Org A (dup-dash)",
        p_slug: `dupd-a-${randomUUID().slice(0, 8)}`,
      });
      orgAId = (orgData as { id: string }).id;

      const { data: wsData } = await userAAnon
        .from("workspaces")
        .insert({ org_id: orgAId, name: "WS A", created_by: userAId })
        .select("id")
        .single();
      const wsAId = (wsData as { id: string }).id;

      const { data: dashData, error: dashErr } = await userAAnon.rpc(
        "create_dashboard",
        { p_workspace_id: wsAId, p_name: "Source Dashboard" },
      );
      expect(dashErr, "create_dashboard(A)").toBeNull();
      dashboardAId = (dashData as { id: string }).id;

      // Seed one widget on the source dashboard (no source board → null).
      const { error: widgetErr } = await userAAnon.rpc(
        "create_dashboard_widget",
        {
          p_dashboard_id: dashboardAId,
          p_kind: "number",
          p_source_board_id: null as unknown as string,
          p_title: "Widget A",
        },
      );
      expect(widgetErr, "create_dashboard_widget(A)").toBeNull();

      // ── userB in a separate org (NOT a member of orgA) ──────────────────────
      const emailB = `rls-dupdash-b-${randomUUID()}@example.com`;
      const { data: createdB, error: errB } = await admin.auth.admin.createUser(
        {
          email: emailB,
          password: PASSWORD,
          email_confirm: true,
        },
      );
      expect(errB, "createUser(B)").toBeNull();
      createdUserIds.push(createdB.user!.id);

      userBAnon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInWithRetry(userBAnon, { email: emailB, password: PASSWORD });

      await userBAnon.rpc("create_organization", {
        p_name: "Org B (dup-dash)",
        p_slug: `dupd-b-${randomUUID().slice(0, 8)}`,
      });
    }, 90_000);

    afterAll(async () => {
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("duplicates the dashboard and its widgets", async () => {
      const { data: dup, error } = await userAAnon.rpc("duplicate_dashboard", {
        p_dashboard_id: dashboardAId,
      });
      expect(error).toBeNull();
      expect(dup).toBeTruthy();
      expect(dup!.id).not.toBe(dashboardAId);
      expect(dup!.name).toBe("Source Dashboard (copy)");

      const widgets = await admin
        .from("dashboard_widgets")
        .select("id")
        .eq("dashboard_id", dup!.id);
      expect(widgets.data!.length).toBe(1);
    });

    it("denies duplication to a non-member", async () => {
      const { error } = await userBAnon.rpc("duplicate_dashboard", {
        p_dashboard_id: dashboardAId,
      });
      expect(error).not.toBeNull();
    });
  },
);
