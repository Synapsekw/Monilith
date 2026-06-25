import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
const getUserOrgs = vi.fn();
const removeAttachmentObjects = vi.fn<(paths: string[]) => Promise<void>>(
  async () => {},
);

vi.mock("@/lib/auth/session", () => ({
  getUser: () => getUser(),
  getUserOrgs: () => getUserOrgs(),
}));
vi.mock("@/lib/collaboration/attachment-cleanup", () => ({
  removeAttachmentObjects: (paths: string[]) => removeAttachmentObjects(paths),
}));
const updateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: (tag: string) => updateTag(tag),
}));

let currentClient: unknown;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentClient,
}));

import {
  createWorkspace,
  renameWorkspace,
  deleteWorkspace,
} from "@/lib/workspaces/actions";

const WS_ID = "11111111-1111-4111-8111-111111111111";

/** Builds a Supabase client mock covering exactly the chains the actions use. */
function makeClient(
  opts: {
    workspaceCount?: number;
    boards?: { id: string }[];
    attachments?: { storage_path: string }[];
  } = {},
) {
  const { workspaceCount = 2, boards = [], attachments = [] } = opts;
  const insert = vi.fn(async () => ({ error: null }));
  const updateEq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const deleteEq = vi.fn(async () => ({ error: null }));
  const del = vi.fn(() => ({ eq: deleteEq }));

  const from = vi.fn((table: string) => {
    if (table === "workspaces") {
      return {
        insert,
        update,
        delete: del,
        // count query: .select("id", { count, head }) is awaited directly
        select: vi.fn(async () => ({ count: workspaceCount, error: null })),
      };
    }
    if (table === "boards") {
      return {
        select: vi.fn(() => ({ eq: vi.fn(async () => ({ data: boards })) })),
      };
    }
    if (table === "attachments") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(async () => ({ data: attachments })),
        })),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });

  return { client: { from }, insert, update, updateEq, del, deleteEq };
}

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ id: "user-1" });
  getUserOrgs.mockReset().mockResolvedValue([{ id: "org-1", name: "Acme" }]);
  removeAttachmentObjects.mockClear();
  updateTag.mockReset();
});

describe("createWorkspace", () => {
  it("rejects an invalid name without touching the DB", async () => {
    const m = makeClient();
    currentClient = m.client;
    const res = await createWorkspace({ name: "   " });
    expect(res.ok).toBe(false);
    expect(m.insert).not.toHaveBeenCalled();
  });

  it("derives org_id + created_by server-side (ignores client input)", async () => {
    const m = makeClient();
    currentClient = m.client;
    const res = await createWorkspace({ name: "Marketing" });
    expect(res.ok).toBe(true);
    expect(m.insert).toHaveBeenCalledWith({
      org_id: "org-1",
      name: "Marketing",
      created_by: "user-1",
    });
    expect(updateTag).toHaveBeenCalledWith("workspaces:org:org-1");
  });
});

describe("renameWorkspace", () => {
  it("updates the workspace name", async () => {
    const m = makeClient();
    currentClient = m.client;
    const res = await renameWorkspace({
      workspaceId: WS_ID,
      name: "Renamed",
    });
    expect(res.ok).toBe(true);
    expect(m.update).toHaveBeenCalledWith({ name: "Renamed" });
    expect(m.updateEq).toHaveBeenCalledWith("id", WS_ID);
    expect(updateTag).toHaveBeenCalledWith("workspaces:org:org-1");
  });
});

describe("deleteWorkspace", () => {
  it("blocks deleting the only workspace", async () => {
    const m = makeClient({ workspaceCount: 1 });
    currentClient = m.client;
    const res = await deleteWorkspace({ workspaceId: WS_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/only workspace/i);
    expect(m.del).not.toHaveBeenCalled();
  });

  it("deletes and cleans up attachment storage objects", async () => {
    const m = makeClient({
      workspaceCount: 3,
      boards: [{ id: "b1" }],
      attachments: [{ storage_path: "p/1" }, { storage_path: "p/2" }],
    });
    currentClient = m.client;
    const res = await deleteWorkspace({ workspaceId: WS_ID });
    expect(res.ok).toBe(true);
    expect(m.deleteEq).toHaveBeenCalledWith("id", WS_ID);
    expect(removeAttachmentObjects).toHaveBeenCalledWith(["p/1", "p/2"]);
    expect(updateTag).toHaveBeenCalledWith("workspaces:org:org-1");
  });
});
