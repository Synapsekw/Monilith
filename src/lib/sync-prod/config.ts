import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  PROD_SUPABASE_URL: z.string().url(),
  PROD_SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export interface StorageEndpoints {
  dev: { url: string; serviceKey: string };
  prod: { url: string; serviceKey: string };
}

export function loadStorageEndpoints(env: NodeJS.ProcessEnv): StorageEndpoints {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(
      `sync-prod: invalid/missing storage env vars: ${missing}. ` +
        `Set them in .env.prod.local (see .env.example).`,
    );
  }
  if (parsed.data.NEXT_PUBLIC_SUPABASE_URL === parsed.data.PROD_SUPABASE_URL) {
    throw new Error(
      "sync-prod: dev and prod Supabase URLs are identical — refusing to sync a project onto itself.",
    );
  }
  return {
    dev: {
      url: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
      serviceKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
    },
    prod: {
      url: parsed.data.PROD_SUPABASE_URL,
      serviceKey: parsed.data.PROD_SUPABASE_SERVICE_ROLE_KEY,
    },
  };
}
