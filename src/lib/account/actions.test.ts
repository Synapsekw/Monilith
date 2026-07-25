import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories hoist above these declarations, so the spies must come from
// vi.hoisted — a plain `const` is still in its TDZ when a factory runs.
const {
  getUser,
  signOut,
  userRpc,
  svcRpc,
  deleteUser,
  auditInsert,
  notificationInsert,
  storageList,
  storageRemove,
  redirectMock,
} = vi.hoisted(() => ({
  getUser: vi.fn(),
  signOut: vi.fn(),
  userRpc: vi.fn(),
  svcRpc: vi.fn(),
  deleteUser: vi.fn(),
  auditInsert: vi.fn(),
  notificationInsert: vi.fn(),
  storageList: vi.fn(),
  storageRemove: vi.fn(),
  redirectMock: vi.fn(),
}));

// `redirect()` throws in real Next.js; throwing here too proves the action never
// treats the redirect as a returnable value and never runs code after it.
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirectMock(path);
    throw new Error("NEXT_REDIRECT");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser, signOut },
    rpc: userRpc,
  }),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: svcRpc,
    from: (table: string) => ({
      insert: (rows: unknown) =>
        table === "admin_audit_log"
          ? auditInsert(rows)
          : notificationInsert(rows),
    }),
    storage: {
      from: () => ({ list: storageList, remove: storageRemove }),
    },
    auth: { admin: { deleteUser } },
  }),
}));

const { deleteOwnAccount } = await import("./actions");

const USER = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "me@example.com",
};
const ORG = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";

/** Drive the redirect-throwing happy path without letting it fail the test. */
async function runExpectingRedirect() {
  await expect(deleteOwnAccount({ confirmEmail: USER.email })).rejects.toThrow(
    "NEXT_REDIRECT",
  );
}

describe("deleteOwnAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: USER } });
    // Default: no sole-owned orgs, one org whose work goes to OWNER.
    userRpc.mockImplementation((fn: string) =>
      fn === "platform_user_sole_owned_orgs"
        ? Promise.resolve({ data: [], error: null })
        : Promise.resolve({
            data: {
              counts: { boards: 2, items: 9 },
              targets: { [ORG]: OWNER },
            },
            error: null,
          }),
    );
    auditInsert.mockResolvedValue({ error: null });
    notificationInsert.mockResolvedValue({ error: null });
    storageList.mockResolvedValue({ data: [{ name: "a.png" }], error: null });
    storageRemove.mockResolvedValue({ error: null });
    deleteUser.mockResolvedValue({ error: null });
    signOut.mockResolvedValue({ error: null });
  });

  it("rejects an empty confirmation without touching anything", async () => {
    const res = await deleteOwnAccount({ confirmEmail: "   " });
    expect(res).toEqual({
      ok: false,
      error: "Enter your email address to confirm.",
    });
    expect(userRpc).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("refuses a mismatched email even though the client claimed it matched", async () => {
    const res = await deleteOwnAccount({
      confirmEmail: "someone.else@example.com",
    });
    expect(res).toEqual({ ok: false, error: "That's not your email address." });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("matches the email case-insensitively and ignores surrounding space", async () => {
    await expect(
      deleteOwnAccount({ confirmEmail: "  ME@Example.com  " }),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(deleteUser).toHaveBeenCalledWith(USER.id);
  });

  it("refuses, naming the org, when the user is its only owner", async () => {
    userRpc.mockImplementation((fn: string) =>
      fn === "platform_user_sole_owned_orgs"
        ? Promise.resolve({
            data: [{ org_id: ORG, org_name: "Acme" }],
            error: null,
          })
        : Promise.resolve({ data: {}, error: null }),
    );
    const res = await deleteOwnAccount({ confirmEmail: USER.email });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain("Acme");
    // Nothing may be mutated on the refusal path — not even the reassignment.
    expect(userRpc).not.toHaveBeenCalledWith(
      "user_delete_reassign_authorship",
      expect.anything(),
    );
    expect(auditInsert).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it("does not delete the auth user when reassignment fails", async () => {
    userRpc.mockImplementation((fn: string) =>
      fn === "user_delete_reassign_authorship"
        ? Promise.resolve({
            data: null,
            error: { message: "no surviving active owner" },
          })
        : Promise.resolve({ data: [], error: null }),
    );
    const res = await deleteOwnAccount({ confirmEmail: USER.email });
    expect(res.ok).toBe(false);
    expect(deleteUser).not.toHaveBeenCalled();
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it("fails closed when the ownership check itself errors", async () => {
    userRpc.mockImplementation((fn: string) =>
      fn === "platform_user_sole_owned_orgs"
        ? Promise.resolve({ data: null, error: { message: "boom" } })
        : Promise.resolve({ data: {}, error: null }),
    );
    const res = await deleteOwnAccount({ confirmEmail: USER.email });
    expect(res).toEqual({
      ok: false,
      error: "Could not verify org ownership.",
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("reassigns on the user client so the RPC's own auth gate applies", async () => {
    await runExpectingRedirect();
    // Passing the session's own id (never a client-supplied one) is what lets the
    // definer RPC's `p_user_id = auth.uid()` check pass.
    expect(userRpc).toHaveBeenCalledWith("user_delete_reassign_authorship", {
      p_user_id: USER.id,
    });
    expect(svcRpc).not.toHaveBeenCalled();
  });

  it("writes the audit trail BEFORE the delete, one row per org plus a platform row", async () => {
    await runExpectingRedirect();
    expect(auditInsert).toHaveBeenCalledTimes(1);
    const rows = auditInsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);

    const platform = rows.find((r) => r.org_id === null);
    const orgRow = rows.find((r) => r.org_id === ORG);
    expect(platform).toBeDefined();
    expect(orgRow).toBeDefined();
    // actor_kind is constrained to 'org' | 'platform' by a CHECK constraint.
    expect(platform!.actor_kind).toBe("platform");
    expect(orgRow!.actor_kind).toBe("org");
    for (const row of rows) {
      expect(row.action).toBe("account.self_deleted");
      expect(row.actor_id).toBe(USER.id);
      expect(row.target_user_id).toBe(USER.id);
      // Retained in plaintext by decision D1; both pointers become null on delete.
      expect(row.target_email).toBe(USER.email);
    }

    expect(auditInsert.mock.invocationCallOrder[0]).toBeLessThan(
      deleteUser.mock.invocationCallOrder[0],
    );
  });

  it("deletes the orphaned avatar, which no FK would clean up", async () => {
    await runExpectingRedirect();
    expect(storageList).toHaveBeenCalledWith(USER.id);
    expect(storageRemove).toHaveBeenCalledWith([`${USER.id}/a.png`]);
    expect(storageRemove.mock.invocationCallOrder[0]).toBeLessThan(
      deleteUser.mock.invocationCallOrder[0],
    );
  });

  it("still deletes the account when storage cleanup throws", async () => {
    storageList.mockRejectedValue(new Error("storage down"));
    await runExpectingRedirect();
    expect(deleteUser).toHaveBeenCalledWith(USER.id);
  });

  it("notifies each receiving owner after the delete (decision D4)", async () => {
    await runExpectingRedirect();
    expect(notificationInsert).toHaveBeenCalledTimes(1);
    const rows = notificationInsert.mock.calls[0][0] as Array<
      Record<string, unknown>
    >;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      org_id: ORG,
      recipient_id: OWNER,
      actor_id: null, // system-authored; nullable, so this is legal
      kind: "account_deleted",
    });
    expect(notificationInsert.mock.invocationCallOrder[0]).toBeGreaterThan(
      deleteUser.mock.invocationCallOrder[0],
    );
  });

  it("does not notify anyone when no org was affected", async () => {
    userRpc.mockImplementation((fn: string) =>
      fn === "platform_user_sole_owned_orgs"
        ? Promise.resolve({ data: [], error: null })
        : Promise.resolve({ data: { counts: {}, targets: {} }, error: null }),
    );
    await runExpectingRedirect();
    expect(notificationInsert).not.toHaveBeenCalled();
  });

  it("reports a delete failure instead of signing the user out", async () => {
    deleteUser.mockResolvedValue({ error: { message: "nope" } });
    const res = await deleteOwnAccount({ confirmEmail: USER.email });
    expect(res).toEqual({ ok: false, error: "Could not delete your account." });
    expect(signOut).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("tears the session down after the delete and lands on the signed-out page", async () => {
    await runExpectingRedirect();
    expect(signOut.mock.invocationCallOrder[0]).toBeGreaterThan(
      deleteUser.mock.invocationCallOrder[0],
    );
    expect(redirectMock).toHaveBeenCalledWith("/login?deleted=1");
  });

  it("redirects even if signOut rejects for the now-nonexistent user", async () => {
    signOut.mockRejectedValue(new Error("401"));
    await runExpectingRedirect();
    expect(redirectMock).toHaveBeenCalledWith("/login?deleted=1");
  });

  it("refuses when there is no session", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await deleteOwnAccount({ confirmEmail: USER.email });
    expect(res).toEqual({ ok: false, error: "Not authenticated." });
    expect(userRpc).not.toHaveBeenCalled();
  });
});
