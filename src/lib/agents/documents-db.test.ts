import { describe, it, expect } from "vitest";
import {
  listDocumentsForOwner,
  listDocumentsForAgent,
  insertDocument,
  updateDocumentRow,
  replaceAgentDocuments,
} from "./documents-db";
// Local to this file — there is no shared fake-client helper in this repo.
// Records: calls.select[], calls.order[], calls.limit[], calls.insert[], calls.update[]
import { makeFakeClient } from "./documents-db.fake";

describe("listDocumentsForOwner", () => {
  it("NEVER selects body", async () => {
    const { client, calls } = makeFakeClient({ data: [] });
    await listDocumentsForOwner(client, "owner-1");
    expect(calls.select[0]).not.toContain("body");
  });

  it("orders by updated_at desc and is bounded", async () => {
    const { client, calls } = makeFakeClient({ data: [] });
    await listDocumentsForOwner(client, "owner-1");
    expect(calls.order).toContainEqual(["updated_at", { ascending: false }]);
    expect(calls.limit[0]).toBeGreaterThan(0);
  });

  it("asks for an exact count on the SAME request, not a second one", async () => {
    const { client, calls } = makeFakeClient({ data: [], count: 0 });
    await listDocumentsForOwner(client, "owner-1");
    expect(calls.selectOptions[0]).toEqual({ count: "exact" });
    // One `.from()` chain — the total must never cost an extra round trip.
    expect(calls.select).toHaveLength(1);
  });

  it("reports the TOTAL, not the page length, so the cap is visible", async () => {
    // The bug this closes: a 137-document library rendered "100 documents"
    // forever and the 101st was unreachable with no hint it existed.
    const page = Array.from({ length: 3 }, (_, i) => ({
      id: `d${i}`,
      title: `T${i}`,
      token_estimate: 1,
      source_format: "pasted",
      source_file_name: null,
      updated_at: "2026-08-24T10:00:00Z",
    }));
    const { client } = makeFakeClient({ data: page, count: 137 });
    const res = await listDocumentsForOwner(client, "owner-1");
    expect(res.rows).toHaveLength(3);
    expect(res.total).toBe(137);
  });

  it("falls back to the page length when the count header is absent", async () => {
    const { client } = makeFakeClient({ data: [] });
    expect((await listDocumentsForOwner(client, "owner-1")).total).toBe(0);
  });
});

describe("replaceAgentDocuments", () => {
  it("goes through the ATOMIC rpc, never a delete-then-insert pair", async () => {
    // Two PostgREST calls are two transactions: a failed insert would leave
    // the agent with zero attachments instead of its prior set. The whole
    // point of `replace_agent_documents` is that the pair cannot be split.
    const { client, calls } = makeFakeClient({ data: null });
    await replaceAgentDocuments(client, "agent-1", ["doc-a", "doc-b"]);
    expect(calls.rpc).toEqual([
      [
        "replace_agent_documents",
        { p_user_agent_id: "agent-1", p_document_ids: ["doc-a", "doc-b"] },
      ],
    ]);
    expect(calls.delete).toEqual([]);
    expect(calls.insert).toEqual([]);
  });

  it("sends an empty array for a full detach — still one atomic call", async () => {
    const { client, calls } = makeFakeClient({ data: null });
    await replaceAgentDocuments(client, "agent-1", []);
    expect(calls.rpc).toEqual([
      [
        "replace_agent_documents",
        { p_user_agent_id: "agent-1", p_document_ids: [] },
      ],
    ]);
  });

  it("throws with the postgres message when the rpc fails", async () => {
    const { client } = makeFakeClient({
      data: null,
      error: { message: "violates foreign key constraint" },
    });
    await expect(
      replaceAgentDocuments(client, "agent-1", ["doc-a"]),
    ).rejects.toThrow(/violates foreign key constraint/);
  });
});

describe("insertDocument", () => {
  it("computes token_estimate from the body, ignoring any client value", async () => {
    const { client, calls } = makeFakeClient({ data: { id: "d1" } });
    await insertDocument(client, {
      orgId: "o1",
      ownerId: "u1",
      title: "T",
      body: "abcd", // 4 chars -> 1 token
      sourceFormat: "pasted",
      sourceFileName: null,
    });
    expect(calls.insert[0]).toMatchObject({ token_estimate: 1 });
  });
});

describe("updateDocumentRow", () => {
  it("RECOMPUTES token_estimate on every write", async () => {
    const { client, calls } = makeFakeClient({ data: { id: "d1" } });
    await updateDocumentRow(client, "d1", {
      title: "T",
      body: "abcdefgh", // 8 chars -> 2 tokens
    });
    expect(calls.update[0]).toMatchObject({ token_estimate: 2 });
  });

  it("bumps updated_at", async () => {
    const { client, calls } = makeFakeClient({ data: { id: "d1" } });
    await updateDocumentRow(client, "d1", { title: "T", body: "x" });
    expect(calls.update[0]).toHaveProperty("updated_at");
  });
});

describe("listDocumentsForAgent", () => {
  it("orders by position then created_at so injection order is deterministic", async () => {
    const { client, calls } = makeFakeClient({ data: [] });
    await listDocumentsForAgent(client, "agent-1");
    expect(calls.order).toContainEqual(["position", { ascending: true }]);
  });

  it("DOES select body — the run loop needs the text", async () => {
    const { client, calls } = makeFakeClient({ data: [] });
    await listDocumentsForAgent(client, "agent-1");
    expect(calls.select.join(" ")).toContain("body");
  });
});
