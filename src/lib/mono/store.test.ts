import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encryptedStore, type RawMonoRecord, type RawMonoStore } from "./store";

function rawFixture(now: () => number) {
  const data = new Map<string, RawMonoRecord>();
  const raw: RawMonoStore = {
    async read(namespace, key) {
      return data.get(namespace + key) ?? null;
    },
    async compareSwap(namespace, key, ciphertext, expiresAt, version) {
      const old = data.get(namespace + key),
        live = old && old.expires_at > now() ? old : null;
      if (version ? live?.version !== version : !!live) return null;
      const next = randomUUID();
      data.set(namespace + key, {
        ciphertext,
        version: next,
        expires_at: expiresAt,
      });
      return next;
    },
  };
  return { raw, data };
}
const secret = "test-only-session-secret-32-characters-long";
const origin = "https://preview.vercel.app";

describe("encrypted durable Mono records", () => {
  it("encrypts records with atomic revision checks and no plaintext keys", async () => {
    const now = () => 1000,
      f = rawFixture(now),
      store = encryptedStore(f.raw, secret, origin, now);
    const v = await store.write("sessions/private-id", {
      kind: "rate",
      count: 1,
      expiresAt: 2000,
    });
    expect(v).toBeTruthy();
    expect((await store.read("sessions/private-id"))?.value).toMatchObject({
      count: 1,
    });
    expect(JSON.stringify([...f.data.entries()])).not.toMatch(
      /sessions|private-id|count/,
    );
    expect(
      await store.write("sessions/private-id", {
        kind: "rate",
        count: 2,
        expiresAt: 2000,
      }),
    ).toBeNull();
    expect(
      await store.write(
        "sessions/private-id",
        { kind: "rate", count: 2, expiresAt: 2000 },
        randomUUID(),
      ),
    ).toBeNull();
    expect(
      await store.write(
        "sessions/private-id",
        { kind: "rate", count: 2, expiresAt: 2000 },
        v,
      ),
    ).toBeTruthy();
  });
  it("isolates preview/prod origins and invalidates sessions safely on key rotation", async () => {
    const now = () => 1000,
      f = rawFixture(now),
      store = encryptedStore(f.raw, secret, origin, now);
    await store.write("sessions/a", {
      kind: "rate",
      count: 1,
      expiresAt: 2000,
    });
    expect(
      await encryptedStore(
        f.raw,
        secret,
        "https://www.monolith.works",
        now,
      ).read("sessions/a"),
    ).toBeNull();
    const rotated = encryptedStore(f.raw, secret + "new", origin, now);
    expect(await rotated.read("sessions/a")).toBeNull();
    expect(
      await rotated.write("sessions/a", {
        kind: "rate",
        count: 2,
        expiresAt: 2000,
      }),
    ).toBeTruthy();
  });
  it("never returns expired records and allows expired key replacement", async () => {
    let current = 1000;
    const f = rawFixture(() => current),
      store = encryptedStore(f.raw, secret, origin, () => current);
    await store.write("a", { kind: "rate", count: 1, expiresAt: 2000 });
    current = 2000;
    expect(await store.read("a")).toBeNull();
    expect(
      await store.write("a", { kind: "rate", count: 2, expiresAt: 3000 }),
    ).toBeTruthy();
  });
  it("rejects tampered ciphertext and forged expiry instead of losing uncertain delivery", async () => {
    const now = () => 1000,
      f = rawFixture(now),
      store = encryptedStore(f.raw, secret, origin, now);
    await store.write("a", { kind: "rate", count: 1, expiresAt: 2000 });
    const entry = [...f.data.values()][0],
      original = entry.ciphertext;
    const bytes = Buffer.from(original, "base64");
    bytes[30] ^= 1;
    entry.ciphertext = bytes.toString("base64");
    await expect(store.read("a")).rejects.toThrow();
    entry.ciphertext = original;
    entry.expires_at = 3000;
    await expect(store.read("a")).rejects.toThrow();
  });
  it("binds ciphertext to the record address", async () => {
    const now = () => 1000,
      f = rawFixture(now),
      store = encryptedStore(f.raw, secret, origin, now);
    await store.write("a", { kind: "rate", count: 1, expiresAt: 2000 });
    await store.write("b", { kind: "rate", count: 2, expiresAt: 2000 });
    const entries = [...f.data.values()];
    entries[1].ciphertext = entries[0].ciphertext;
    await expect(store.read("b")).rejects.toThrow();
  });
});
