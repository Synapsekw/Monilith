import { describe, expect, it } from "vitest";
import { signInOrThrow } from "@/test/integration-auth";

// Minimal structural stub of the GoTrue surface signInWithRetry touches.
function stubClient(result: {
  error: { message: string; status?: number } | null;
}) {
  return {
    auth: { signInWithPassword: async () => result },
  } as unknown as Parameters<typeof signInOrThrow>[0];
}

describe("signInOrThrow", () => {
  it("throws a labelled error when sign-in still fails", async () => {
    const client = stubClient({ error: { message: "bad creds", status: 400 } });
    await expect(
      signInOrThrow(client, { email: "a@example.com", password: "x" }, "userA"),
    ).rejects.toThrow("sign-in failed for userA: bad creds");
  });

  it("falls back to the email when no label is given", async () => {
    const client = stubClient({ error: { message: "boom", status: 400 } });
    await expect(
      signInOrThrow(client, { email: "a@example.com", password: "x" }),
    ).rejects.toThrow("sign-in failed for a@example.com: boom");
  });

  it("resolves with no value on success", async () => {
    const client = stubClient({ error: null });
    await expect(
      signInOrThrow(client, { email: "a@example.com", password: "x" }, "userA"),
    ).resolves.toBeUndefined();
  });
});
