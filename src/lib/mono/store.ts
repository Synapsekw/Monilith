import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import { recordSchema } from "./schemas";

export type MonoRecord = z.infer<typeof recordSchema>;
export type StoredEntry<T = MonoRecord> = { value: T; version: string };
export interface MonoStore {
  read(key: string): Promise<StoredEntry | null>;
  write(
    key: string,
    value: MonoRecord,
    version?: string | null,
  ): Promise<string | null>;
}
const rawRecordSchema = z.object({
  ciphertext: z.string().min(40).max(524288),
  version: z.uuid(),
  expires_at: z.number().int().positive().safe(),
});
export type RawMonoRecord = z.infer<typeof rawRecordSchema>;
export interface RawMonoStore {
  read(namespace: string, key: string): Promise<RawMonoRecord | null>;
  compareSwap(
    namespace: string,
    key: string,
    ciphertext: string,
    expiresAt: number,
    version: string | null,
  ): Promise<string | null>;
}

/** AES-GCM protects tokens, messages and contacts; keyed addresses hide IDs/IPs.
 * Origin + secret namespaces separate deployments and make rotation invalidate
 * old sessions cleanly, without trying to decrypt ciphertext with the new key.
 */
export function encryptedStore(
  raw: RawMonoStore,
  secret: string,
  origin: string,
  now = Date.now,
): MonoStore {
  if (secret.length < 32) throw new Error("Invalid Mono secret");
  const key = createHash("sha256").update(secret).digest();
  const hash = (value: string) =>
    createHmac("sha256", secret).update(value).digest("hex");
  const namespace = hash(`mono:v1:origin:${origin}`);
  const address = (name: string) => hash(`mono:v1:key:${origin}:${name}`);
  return {
    async read(name) {
      const recordKey = address(name),
        found = await raw.read(namespace, recordKey);
      if (!found) return null;
      const entry = rawRecordSchema.parse(found);
      if (entry.expires_at <= now()) return null;
      const bytes = Buffer.from(entry.ciphertext, "base64");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        bytes.subarray(0, 12),
      );
      decipher.setAAD(Buffer.from(`${namespace}:${recordKey}`));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const plaintext = Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString();
      const value = recordSchema.parse(JSON.parse(plaintext));
      if (value.expiresAt !== entry.expires_at)
        throw new Error("Invalid Mono expiry");
      return value.expiresAt > now() ? { value, version: entry.version } : null;
    },
    async write(name, input, version = null) {
      const value = recordSchema.parse(input);
      if (value.expiresAt <= now() || value.expiresAt > now() + 259200000)
        throw new Error("Invalid Mono expiry");
      const recordKey = address(name),
        iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(`${namespace}:${recordKey}`));
      const bytes = Buffer.concat([
        cipher.update(JSON.stringify(value)),
        cipher.final(),
      ]);
      const ciphertext = Buffer.concat([
        iv,
        cipher.getAuthTag(),
        bytes,
      ]).toString("base64");
      if (ciphertext.length > 524288) throw new Error("Mono record too large");
      return raw.compareSwap(
        namespace,
        recordKey,
        ciphertext,
        value.expiresAt,
        version,
      );
    },
  };
}
