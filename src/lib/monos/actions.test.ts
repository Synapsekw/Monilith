import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const BOARD = "33333333-3333-4333-8333-333333333333";
const OTHER_MONO = "44444444-4444-4444-8444-444444444444";

const createUser = vi.fn();
const deleteUser = vi.fn();
const svcRpc = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    auth: { admin: { createUser, deleteUser } },
    rpc: svcRpc,
  }),
}));
const userRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: userRpc }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: OWNER }),
}));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: async () => ({ id: ORG, name: "Acme", timezone: null }),
}));
const updateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag: (t: string) => updateTag(t) }));
const getMyMono = vi.fn();
vi.mock("./queries", () => ({
  getMyMono: (...a: unknown[]) => getMyMono(...a),
}));

import {
  addMyMonoToBoard,
  createMyMono,
  removeMyMonoFromBoard,
  updateMyMono,
} from "./actions";

const mono = (userId: string) => ({
  userId,
  orgId: ORG,
  ownerId: OWNER,
  name: "Nova",
  color: "#7395ff",
  brain: "none" as const,
  keyProvider: null,
  lastSeenAt: null,
  createdAt: "t",
});

beforeEach(() => {
  vi.clearAllMocks();
  createUser.mockResolvedValue({ data: { user: {} }, error: null });
  deleteUser.mockResolvedValue({ data: {}, error: null });
  userRpc.mockResolvedValue({ data: null, error: null });
});

describe("createMyMono", () => {
  it("rejects bad input before touching anything", async () => {
    const res = await createMyMono({ name: " ", color: "blue" });
    expect(res.ok).toBe(false);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("returns the existing Mono without creating a bot", async () => {
    getMyMono.mockResolvedValueOnce(mono("m-existing"));
    const res = await createMyMono({ name: "Nova", color: "#7395FF" });
    expect(res).toEqual({ ok: true, data: mono("m-existing") });
    expect(createUser).not.toHaveBeenCalled();
  });

  it("creates a confirmed, pre-approved bot, then the Mono, then refreshes the roster", async () => {
    getMyMono.mockResolvedValueOnce(null);
    svcRpc.mockImplementation(
      async (_fn: string, args: { p_mono_id: string }) => ({
        data: args.p_mono_id,
        error: null,
      }),
    );
    getMyMono.mockImplementationOnce(async () =>
      mono(svcRpc.mock.calls[0]![1].p_mono_id),
    );
    const res = await createMyMono({ name: " Nova ", color: "#7395FF" });

    const attrs = createUser.mock.calls[0]![0] as {
      id: string;
      email: string;
      email_confirm: boolean;
      app_metadata: Record<string, unknown>;
    };
    expect(attrs.email).toBe(`mono-${attrs.id}@monolith.internal`);
    expect(attrs.email_confirm).toBe(true);
    expect(attrs.app_metadata).toMatchObject({ pre_approved: true });
    expect(svcRpc).toHaveBeenCalledWith("create_mono", {
      p_org_id: ORG,
      p_owner_id: OWNER,
      p_mono_id: attrs.id,
      p_name: "Nova",
      p_color: "#7395ff",
    });
    expect(updateTag).toHaveBeenCalledWith(`org-members:org:${ORG}`);
    expect(deleteUser).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });

  it("deletes its unused bot when another tab won the race", async () => {
    getMyMono.mockResolvedValueOnce(null);
    svcRpc.mockResolvedValue({ data: OTHER_MONO, error: null });
    getMyMono.mockResolvedValueOnce(mono(OTHER_MONO));
    const res = await createMyMono({ name: "Nova", color: "#7395ff" });
    const createdId = (createUser.mock.calls[0]![0] as { id: string }).id;
    expect(deleteUser).toHaveBeenCalledWith(createdId);
    expect(res).toEqual({ ok: true, data: mono(OTHER_MONO) });
  });

  it("deletes its bot and fails when the RPC refuses", async () => {
    getMyMono.mockResolvedValueOnce(null);
    svcRpc.mockResolvedValue({ data: null, error: { message: "nope" } });
    const res = await createMyMono({ name: "Nova", color: "#7395ff" });
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(false);
  });

  it("deletes its bot when the RPC call throws after the bot was created", async () => {
    getMyMono.mockResolvedValueOnce(null);
    svcRpc.mockRejectedValue(new Error("network down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await createMyMono({ name: "Nova", color: "#7395ff" });
    const createdId = (createUser.mock.calls[0]![0] as { id: string }).id;
    expect(deleteUser).toHaveBeenCalledWith(createdId);
    expect(res.ok).toBe(false);
    errSpy.mockRestore();
  });

  it("keeps the adopted bot when a later read throws", async () => {
    getMyMono.mockResolvedValueOnce(null);
    svcRpc.mockImplementation(
      async (_fn: string, args: { p_mono_id: string }) => ({
        data: args.p_mono_id,
        error: null,
      }),
    );
    getMyMono.mockRejectedValueOnce(new Error("read failed"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await createMyMono({ name: "Nova", color: "#7395ff" });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    errSpy.mockRestore();
  });

  it("logs the bot id when cleanup itself fails, without throwing", async () => {
    getMyMono.mockResolvedValueOnce(null);
    svcRpc.mockResolvedValue({ data: null, error: { message: "nope" } });
    deleteUser.mockResolvedValue({ data: null, error: { message: "gone" } });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await createMyMono({ name: "Nova", color: "#7395ff" });
    const createdId = (createUser.mock.calls[0]![0] as { id: string }).id;
    expect(res.ok).toBe(false);
    expect(errSpy).toHaveBeenCalledWith("[mono] orphan bot cleanup failed", {
      botId: createdId,
      message: "gone",
    });
    errSpy.mockRestore();
  });

  it("logs the bot id when cleanup throws", async () => {
    getMyMono.mockResolvedValueOnce(null);
    svcRpc.mockRejectedValue(new Error("network down"));
    deleteUser.mockRejectedValue(new Error("auth down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await createMyMono({ name: "Nova", color: "#7395ff" });
    const createdId = (createUser.mock.calls[0]![0] as { id: string }).id;
    expect(res.ok).toBe(false);
    expect(errSpy).toHaveBeenCalledWith("[mono] orphan bot cleanup failed", {
      botId: createdId,
      message: "auth down",
    });
    errSpy.mockRestore();
  });
});

describe("updateMyMono", () => {
  it("renames through the owner-scoped RPC and refreshes the roster", async () => {
    getMyMono.mockResolvedValueOnce(mono("m1"));
    const res = await updateMyMono({ name: "Nova Two", color: "#A77BFF" });
    expect(userRpc).toHaveBeenCalledWith("update_my_mono", {
      p_org_id: ORG,
      p_name: "Nova Two",
      p_color: "#a77bff",
    });
    expect(updateTag).toHaveBeenCalledWith(`org-members:org:${ORG}`);
    expect(res.ok).toBe(true);
  });
});

describe("board membership", () => {
  it("adds and removes through the owner-scoped RPCs", async () => {
    expect(await addMyMonoToBoard({ boardId: BOARD })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(userRpc).toHaveBeenCalledWith("add_my_mono_to_board", {
      p_board_id: BOARD,
    });
    await removeMyMonoFromBoard({ boardId: BOARD });
    expect(userRpc).toHaveBeenCalledWith("remove_my_mono_from_board", {
      p_board_id: BOARD,
    });
  });

  it("says why an add was refused", async () => {
    userRpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "42501",
        message: "the Mono's owner cannot open this board",
      },
    });
    const res = await addMyMonoToBoard({ boardId: BOARD });
    expect(res).toEqual({
      ok: false,
      error: "You can only add your Mono to boards you can open.",
    });
  });
});
