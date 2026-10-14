import "server-only";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { encryptedStore, type RawMonoStore } from "./store";

/** Canonical privileged client; these RPCs are denied to all browser roles. */
export function createSupabaseMonoStore(secret: string, origin: string) {
  const client = createServiceClient();
  const raw: RawMonoStore = {
    async read(namespace, key) {
      const { data, error } = await typedRpc(client, "mono_record_read", {
        p_namespace: namespace,
        p_key: key,
      });
      if (error) throw new Error("Mono storage unavailable");
      return data?.[0] ?? null;
    },
    async compareSwap(namespace, key, ciphertext, expiresAt, version) {
      const { data, error } = await typedRpc(
        client,
        "mono_record_compare_swap",
        {
          p_namespace: namespace,
          p_key: key,
          p_ciphertext: ciphertext,
          p_expires_at: expiresAt,
          p_expected_version: version,
        },
      );
      if (error) throw new Error("Mono storage unavailable");
      return z.uuid().nullable().parse(data);
    },
  };
  return encryptedStore(raw, secret, origin);
}
