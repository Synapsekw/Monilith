import { describe, it, expect, vi, beforeEach } from "vitest";

const requireUser = vi.fn();
const resolveActiveOrg = vi.fn();
const listMemoryForAgent = vi.fn();
const countMemoryForAgent = vi.fn();
const upsertOwnerNote = vi.fn();
const deleteMemoryRow = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
// resolveActiveOrg(), NOT getActiveOrgId(): the latter degrades a missing org
// to "" and would insert `org_id: ""` rather than surfacing a clear failure —
// the same choice `document-actions.ts` documents.
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: () => resolveActiveOrg(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePath(p),
}));
vi.mock("./memory-db", () => ({
  listMemoryForAgent: (...a: unknown[]) => listMemoryForAgent(...a),
  countMemoryForAgent: (...a: unknown[]) => countMemoryForAgent(...a),
  upsertOwnerNote: (...a: unknown[]) => upsertOwnerNote(...a),
  deleteMemoryRow: (...a: unknown[]) => deleteMemoryRow(...a),
}));

import {
  listAgentMemory,
  saveOwnerNote,
  deleteMemoryNote,
} from "./memory-actions";
import { INSTRUCTIONS_SENTINEL } from "./document-inject";

const UUID = "3f6a1c2e-0000-4000-8000-000000000001";
const NOTE_ID = "3f6a1c2e-0000-4000-8000-0000000000aa";

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u1" });
  resolveActiveOrg.mockResolvedValue({
    id: "o1",
    name: "Org",
    timezone: "UTC",
  });
  listMemoryForAgent.mockResolvedValue([]);
  countMemoryForAgent.mockResolvedValue(0);
  upsertOwnerNote.mockResolvedValue(undefined);
  deleteMemoryRow.mockResolvedValue(undefined);
});

describe("saveOwnerNote validation", () => {
  it("rejects a multi-line note before it reaches the database", async () => {
    const res = await saveOwnerNote({
      userAgentId: UUID,
      key: "notes",
      value: "one\ntwo",
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/single line/i);
    expect(upsertOwnerNote).not.toHaveBeenCalled();
  });

  it("rejects a note containing the instructions sentinel", async () => {
    const res = await saveOwnerNote({
      userAgentId: UUID,
      key: "notes",
      value: `x ${INSTRUCTIONS_SENTINEL} y`,
    });
    expect(res.ok).toBe(false);
    expect(upsertOwnerNote).not.toHaveBeenCalled();
  });

  it("rejects a key that is not a slug", async () => {
    const res = await saveOwnerNote({
      userAgentId: UUID,
      key: "Not A Slug",
      value: "x",
    });
    expect(res.ok).toBe(false);
    expect(upsertOwnerNote).not.toHaveBeenCalled();
  });

  it("rejects an over-long value", async () => {
    const res = await saveOwnerNote({
      userAgentId: UUID,
      key: "long",
      value: "x".repeat(501),
    });
    expect(res.ok).toBe(false);
    expect(upsertOwnerNote).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid agent id", async () => {
    const res = await saveOwnerNote({
      userAgentId: "not-a-uuid",
      key: "k",
      value: "v",
    });
    expect(res.ok).toBe(false);
    expect(upsertOwnerNote).not.toHaveBeenCalled();
  });
});

describe("saveOwnerNote cap", () => {
  it("refuses a NEW note at the 50-note cap and names the limit", async () => {
    countMemoryForAgent.mockResolvedValue(50);
    listMemoryForAgent.mockResolvedValue([]);
    const res = await saveOwnerNote({
      userAgentId: UUID,
      key: "new-one",
      value: "x",
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/50/);
    expect(upsertOwnerNote).not.toHaveBeenCalled();
  });

  it("allows EDITING an existing note at the cap", async () => {
    // A cap that locked the owner out of correcting the very notes that filled
    // it would be the worst version of this feature.
    countMemoryForAgent.mockResolvedValue(50);
    listMemoryForAgent.mockResolvedValue([
      {
        id: "n1",
        key: "existing",
        value: "old",
        origin: "owner",
        tokenEstimate: 1,
        lastRunId: null,
        updatedAt: "2026-08-01T00:00:00Z",
      },
    ]);
    const res = await saveOwnerNote({
      userAgentId: UUID,
      key: "existing",
      value: "new",
    });
    expect(res.ok).toBe(true);
    expect(upsertOwnerNote).toHaveBeenCalled();
  });
});

describe("saveOwnerNote success path", () => {
  it("stamps the resolved org and owner, and revalidates the settings route", async () => {
    const res = await saveOwnerNote({
      userAgentId: UUID,
      key: "frozen-board",
      value: "frozen",
    });
    expect(res.ok).toBe(true);
    expect(upsertOwnerNote.mock.calls[0]![1]).toMatchObject({
      userAgentId: UUID,
      orgId: "o1",
      ownerId: "u1",
      key: "frozen-board",
      value: "frozen",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/settings/agents");
  });

  it("fails with a clear message when there is no active org", async () => {
    resolveActiveOrg.mockResolvedValue(null);
    const res = await saveOwnerNote({
      userAgentId: UUID,
      key: "k",
      value: "v",
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/organization/i);
    expect(upsertOwnerNote).not.toHaveBeenCalled();
  });

  it("does not revalidate when the write throws", async () => {
    upsertOwnerNote.mockRejectedValue(new Error("db down"));
    const res = await saveOwnerNote({
      userAgentId: UUID,
      key: "k",
      value: "v",
    });
    expect(res.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("listAgentMemory", () => {
  it("returns the agent's notes", async () => {
    listMemoryForAgent.mockResolvedValue([
      {
        id: "n1",
        key: "k",
        value: "v",
        origin: "agent",
        tokenEstimate: 1,
        lastRunId: "r1",
        updatedAt: "2026-08-01T00:00:00Z",
      },
    ]);
    const res = await listAgentMemory(UUID);
    expect(res.ok).toBe(true);
    expect(res.ok === true && res.data.notes).toHaveLength(1);
  });

  it("degrades to a failure result rather than throwing", async () => {
    listMemoryForAgent.mockRejectedValue(new Error("nope"));
    const res = await listAgentMemory(UUID);
    expect(res.ok).toBe(false);
  });
});

describe("deleteMemoryNote", () => {
  it("deletes and revalidates", async () => {
    const res = await deleteMemoryNote(NOTE_ID);
    expect(res.ok).toBe(true);
    expect(deleteMemoryRow.mock.calls[0]![1]).toBe(NOTE_ID);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/agents");
  });

  it("rejects a non-uuid id without touching the database", async () => {
    const res = await deleteMemoryNote("nope");
    expect(res.ok).toBe(false);
    expect(deleteMemoryRow).not.toHaveBeenCalled();
  });
});
