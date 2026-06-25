import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

// The cached reads call cacheTag/cacheLife, which throw outside a compiled
// `use cache` scope under Vitest. Stub next/cache so the underlying scoped
// service-client read (the actual tenant-boundary logic) executes.
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn() }));

config({ path: ".env.local", override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

/**
 * The headline safety test of Phase 9.3. The cached shell reads use the service
 * client (RLS bypassed) and re-implement the tenant filter by hand, so a bug
 * there is a cross-tenant leak. This provisions two independent tenants and
 * proves each cached read returns only the caller-identity's rows.
 */
describe.skipIf(!SERVICE_ROLE_KEY)("cached reads never cross tenants", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  type Tenant = {
    id: string;
    orgId: string;
    workspaceId: string;
    boardId: string;
    dashboardId: string;
  };
  let a: Tenant;
  let b: Tenant;

  async function provision(label: string): Promise<Tenant> {
    const email = `cache-iso-${label}-${randomUUID()}@example.com`;
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    expect(error, `createUser(${label})`).toBeNull();
    const id = created.user!.id;
    createdUserIds.push(id);

    const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await signInWithRetry(anon, { email, password: PASSWORD });

    const { data: org } = await anon.rpc("create_organization", {
      p_name: `Org ${label}`,
      p_slug: `cache-iso-${label}-${randomUUID().slice(0, 8)}`,
    });
    const orgId = (org as { id: string }).id;

    const { data: ws } = await anon
      .from("workspaces")
      .insert({ org_id: orgId, name: `WS ${label}`, created_by: id })
      .select("id")
      .single();
    const workspaceId = (ws as { id: string }).id;

    const { data: board, error: boardErr } = await anon.rpc("create_board", {
      p_workspace_id: workspaceId,
      p_name: `Board ${label}`,
    });
    expect(boardErr, `create_board(${label})`).toBeNull();
    const boardId = (board as { id: string }).id;

    const { data: dash, error: dashErr } = await anon.rpc("create_dashboard", {
      p_workspace_id: workspaceId,
      p_name: `Dash ${label}`,
    });
    expect(dashErr, `create_dashboard(${label})`).toBeNull();
    const dashboardId = (dash as { id: string }).id;

    return { id, orgId, workspaceId, boardId, dashboardId };
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    a = await provision("a");
    b = await provision("b");
  }, 120_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("user A's cached boards exclude user B's boards (and vice versa)", async () => {
    const { listMyBoardsCached } = await import("@/lib/boards/queries-cached");
    const aBoards = await listMyBoardsCached(a.id);
    const bBoards = await listMyBoardsCached(b.id);

    const aIds = aBoards.map((x) => x.id);
    const bIds = bBoards.map((x) => x.id);
    expect(aIds).toContain(a.boardId);
    expect(aIds).not.toContain(b.boardId);
    expect(bIds).toContain(b.boardId);
    expect(bIds).not.toContain(a.boardId);
  });

  it("org A's cached dashboards exclude org B's", async () => {
    const { listDashboardsCached } =
      await import("@/lib/dashboards/queries-cached");
    const aDash = await listDashboardsCached(a.orgId);
    const bDash = await listDashboardsCached(b.orgId);

    const aIds = aDash.map((d) => d.id);
    expect(aIds).toContain(a.dashboardId);
    expect(aIds).not.toContain(b.dashboardId);
    expect(aDash.every((d) => d.org_id === a.orgId)).toBe(true);
    expect(bDash.every((d) => d.org_id === b.orgId)).toBe(true);
  });

  it("org A's cached workspaces exclude org B's", async () => {
    const { listWorkspacesCached } =
      await import("@/lib/workspaces/queries-cached");
    const aWs = await listWorkspacesCached(a.orgId);
    const bWs = await listWorkspacesCached(b.orgId);

    const aIds = aWs.map((w) => w.id);
    const bIds = bWs.map((w) => w.id);
    expect(aIds).toContain(a.workspaceId);
    expect(aIds).not.toContain(b.workspaceId);
    expect(bIds).toContain(b.workspaceId);
    expect(bIds).not.toContain(a.workspaceId);
  });

  it("cached org-admin guard is true for the owner of org A, false for an outsider", async () => {
    const { isOrgAdminCached } = await import("@/lib/org/guard");
    // The org creator is an owner of their own org.
    expect(await isOrgAdminCached(a.id, a.orgId)).toBe(true);
    // User B is not a member of org A → not an admin there (no cross-tenant leak).
    expect(await isOrgAdminCached(b.id, a.orgId)).toBe(false);
  });
});
