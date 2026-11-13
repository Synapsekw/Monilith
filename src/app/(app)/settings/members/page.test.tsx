import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, tableReads } = vi.hoisted(() => ({
  rpc: vi.fn(),
  tableReads: [] as string[],
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "u1" }),
}));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: async () => ({ id: "o1", name: "Acme" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (fn: string, args: unknown) => rpc(fn, args),
    from: (table: string) => {
      tableReads.push(table);
      type Chain = PromiseLike<{ data: unknown[] }> & {
        select: () => Chain;
        eq: () => Chain;
        in: () => Chain;
        order: () => Chain;
        limit: () => Chain;
      };
      const rows =
        table === "org_invitations"
          ? [{ id: "i1", email: "x@y.z", role: "member", status: "pending" }]
          : [{ id: "a1", action: "invite" }];
      const chain: Chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        then: (onFulfilled, onRejected) =>
          Promise.resolve({ data: rows }).then(onFulfilled, onRejected),
      };
      return chain;
    },
  }),
}));
vi.mock("@/components/settings/settings-section", () => ({
  SettingsSection: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/settings/org-admin-console", () => ({
  OrgAdminConsole: () => null,
}));

import MembersSettingsPage from "./page";
import { OrgAdminConsole } from "@/components/settings/org-admin-console";

function consoleProps(node: ReactNode): Record<string, unknown> | null {
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (el.type === OrgAdminConsole) return el.props as Record<string, unknown>;
  return consoleProps(el.props?.children);
}

beforeEach(() => {
  vi.clearAllMocks();
  tableReads.length = 0;
});

describe("MembersSettingsPage", () => {
  it("issues the invitations and audit reads while the members RPC is still pending", async () => {
    let releaseMembers: (v: unknown) => void = () => {};
    rpc.mockReturnValue(
      new Promise((resolve) => {
        releaseMembers = resolve;
      }),
    );

    const pending = MembersSettingsPage();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rpc).toHaveBeenCalledWith("get_org_members", { p_org_id: "o1" });
    // A serial page never touches these until the RPC has answered.
    expect(tableReads).toEqual(["org_invitations", "admin_audit_log"]);

    releaseMembers({ data: [{ user_id: "u1", role: "owner" }], error: null });
    const props = consoleProps(await pending);
    expect(props?.currentUserRole).toBe("owner");
    expect(props?.invites).toHaveLength(1);
    expect(props?.audit).toHaveLength(1);
  });

  it("still 404s a non-admin, rendering none of the rows it read", async () => {
    rpc.mockResolvedValue({
      data: [{ user_id: "u1", role: "member" }],
      error: null,
    });

    await expect(MembersSettingsPage()).rejects.toThrow("NOT_FOUND");
  });

  it("still 404s when the members RPC returns nothing (RLS-refused)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "denied" } });

    await expect(MembersSettingsPage()).rejects.toThrow("NOT_FOUND");
  });
});
