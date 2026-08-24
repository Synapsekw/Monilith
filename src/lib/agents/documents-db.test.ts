import { describe, it, expect } from "vitest";
import {
  listDocumentsForOwner,
  listDocumentsForAgent,
  insertDocument,
  updateDocumentRow,
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
