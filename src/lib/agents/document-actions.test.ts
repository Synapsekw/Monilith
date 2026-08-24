import { describe, it, expect, vi, beforeEach } from "vitest";

const requireUser = vi.fn();
const resolveActiveOrg = vi.fn();
const insertDocument = vi.fn();
const updateDocumentRow = vi.fn();
const deleteDocumentRow = vi.fn();
const replaceAgentDocuments = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
// requireUser() only carries the JWT claims subset (id/email/metadata) — no
// orgId. The active org is resolved the same way src/lib/agents/actions.ts
// (this module's sibling) and src/lib/ai/settings-actions.ts do it, via
// resolveActiveOrg() (src/lib/org/active.ts) — NOT getActiveOrgId(), which
// degrades a missing org to "" instead of surfacing a clear failure.
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: () => resolveActiveOrg(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePath(p),
}));
vi.mock("./documents-db", () => ({
  insertDocument: (...a: unknown[]) => insertDocument(...a),
  updateDocumentRow: (...a: unknown[]) => updateDocumentRow(...a),
  deleteDocumentRow: (...a: unknown[]) => deleteDocumentRow(...a),
  replaceAgentDocuments: (...a: unknown[]) => replaceAgentDocuments(...a),
}));

import {
  createDocument,
  updateDocument,
  deleteDocument,
  setAgentDocuments,
} from "./document-actions";

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u1" });
  resolveActiveOrg.mockResolvedValue({
    id: "o1",
    name: "Org",
    timezone: "UTC",
  });
  insertDocument.mockResolvedValue({ id: "d1" });
});

describe("createDocument", () => {
  it("rejects an empty body without touching the database", async () => {
    const r = await createDocument({
      title: "T",
      body: "",
      sourceFormat: "pasted",
      sourceFileName: null,
    });
    expect(r.ok).toBe(false);
    expect(insertDocument).not.toHaveBeenCalled();
  });

  it("rejects a blank title", async () => {
    const r = await createDocument({
      title: "   ",
      body: "x",
      sourceFormat: "pasted",
      sourceFileName: null,
    });
    expect(r.ok).toBe(false);
  });

  it("scopes the insert to the caller's org and id", async () => {
    await createDocument({
      title: "T",
      body: "x",
      sourceFormat: "pasted",
      sourceFileName: null,
    });
    expect(insertDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: "o1", ownerId: "u1" }),
    );
  });

  it("revalidates the agents settings route", async () => {
    await createDocument({
      title: "T",
      body: "x",
      sourceFormat: "pasted",
      sourceFileName: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/settings/agents");
  });

  it("fails cleanly when the caller has no active org", async () => {
    resolveActiveOrg.mockResolvedValue(null);
    const r = await createDocument({
      title: "T",
      body: "x",
      sourceFormat: "pasted",
      sourceFileName: null,
    });
    expect(r.ok).toBe(false);
    expect(insertDocument).not.toHaveBeenCalled();
  });
});

describe("updateDocument", () => {
  it("rejects a non-uuid id", async () => {
    const r = await updateDocument({ id: "nope", title: "T", body: "x" });
    expect(r.ok).toBe(false);
    expect(updateDocumentRow).not.toHaveBeenCalled();
  });

  it("saves and revalidates on a valid update", async () => {
    const r = await updateDocument({
      id: "44444444-4444-4444-8444-444444444444",
      title: "T",
      body: "x",
    });
    expect(r.ok).toBe(true);
    expect(updateDocumentRow).toHaveBeenCalledWith(
      expect.anything(),
      "44444444-4444-4444-8444-444444444444",
      { title: "T", body: "x" },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/settings/agents");
  });
});

describe("setAgentDocuments", () => {
  it("replaces the whole set in array order", async () => {
    const r = await setAgentDocuments({
      userAgentId: "11111111-1111-4111-8111-111111111111",
      documentIds: [
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
      ],
    });
    expect(r.ok).toBe(true);
    expect(replaceAgentDocuments).toHaveBeenCalledWith(
      expect.anything(),
      "11111111-1111-4111-8111-111111111111",
      [
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
      ],
    );
  });

  it("accepts an empty set (detach everything)", async () => {
    const r = await setAgentDocuments({
      userAgentId: "11111111-1111-4111-8111-111111111111",
      documentIds: [],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a non-uuid agent id", async () => {
    const r = await setAgentDocuments({
      userAgentId: "nope",
      documentIds: [],
    });
    expect(r.ok).toBe(false);
    expect(replaceAgentDocuments).not.toHaveBeenCalled();
  });
});

describe("deleteDocument", () => {
  it("returns a failure rather than throwing when the db errors", async () => {
    deleteDocumentRow.mockRejectedValue(new Error("boom"));
    const r = await deleteDocument("44444444-4444-4444-8444-444444444444");
    expect(r).toEqual({ ok: false, error: expect.any(String) });
  });

  it("deletes and revalidates on success", async () => {
    deleteDocumentRow.mockResolvedValue(undefined);
    const r = await deleteDocument("44444444-4444-4444-8444-444444444444");
    expect(r.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/agents");
  });
});
