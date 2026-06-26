// scripts/sync-prod/sync-storage.ts
/**
 * Copy storage blobs dev → prod for /sync-prod. Reads .env.prod.local + .env.local.
 * Creates missing prod buckets, copies every dev object (upsert), deletes prod-only
 * objects (full mirror). `--dry-run` prints the plan and touches nothing.
 *
 * Run: pnpm sync:storage            (executes)
 *      pnpm sync:storage -- --dry-run
 */
import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadStorageEndpoints } from "../../src/lib/sync-prod/config";
import {
  planStorageSync,
  type BucketRef,
  type StorageObjectRef,
} from "../../src/lib/sync-prod/storage-plan";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env.prod.local", override: true });

const DRY_RUN = process.argv.includes("--dry-run");

async function listBuckets(client: SupabaseClient): Promise<BucketRef[]> {
  const { data, error } = await client.storage.listBuckets();
  if (error) throw error;
  return data.map((b) => ({ id: b.id, public: b.public }));
}

async function listObjects(
  client: SupabaseClient,
  buckets: BucketRef[],
): Promise<StorageObjectRef[]> {
  const out: StorageObjectRef[] = [];
  for (const bucket of buckets) {
    // Recurse folders; Supabase list is per-prefix, 100/page by default.
    const walk = async (prefix: string) => {
      let offset = 0;
      for (;;) {
        const { data, error } = await client.storage
          .from(bucket.id)
          .list(prefix, { limit: 100, offset });
        if (error) throw error;
        if (!data.length) break;
        for (const entry of data) {
          const path = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.id === null)
            await walk(path); // folder
          else out.push({ bucket: bucket.id, name: path });
        }
        if (data.length < 100) break;
        offset += data.length;
      }
    };
    await walk("");
  }
  return out;
}

async function main() {
  const { dev, prod } = loadStorageEndpoints(process.env);
  const devClient = createClient(dev.url, dev.serviceKey, {
    auth: { persistSession: false },
  });
  const prodClient = createClient(prod.url, prod.serviceKey, {
    auth: { persistSession: false },
  });

  const [devBuckets, prodBuckets] = await Promise.all([
    listBuckets(devClient),
    listBuckets(prodClient),
  ]);
  const [devObjects, prodObjects] = await Promise.all([
    listObjects(devClient, devBuckets),
    listObjects(prodClient, prodBuckets),
  ]);

  const plan = planStorageSync(
    devBuckets,
    prodBuckets,
    devObjects,
    prodObjects,
  );
  console.log(
    `Plan: create ${plan.bucketsToCreate.length} bucket(s), copy ${plan.objectsToCopy.length} object(s), delete ${plan.objectsToDelete.length} prod-only object(s).`,
  );
  if (DRY_RUN) {
    console.log("--dry-run: no changes made.");
    return;
  }

  for (const b of plan.bucketsToCreate) {
    // Mirrors only the public/private flag. allowedMimeTypes and fileSizeLimit are NOT copied
    // (and prod-only buckets are not deleted, only their objects) — acceptable for current buckets;
    // revisit if a bucket relies on server-side MIME/size restrictions.
    const { error } = await prodClient.storage.createBucket(b.id, {
      public: b.public,
    });
    if (error) throw error;
    console.log(`created bucket ${b.id}`);
  }
  for (const o of plan.objectsToCopy) {
    const { data, error } = await devClient.storage
      .from(o.bucket)
      .download(o.name);
    if (error)
      throw new Error(`download ${o.bucket}/${o.name}: ${error.message}`);
    // Upload the Blob directly so its MIME type is preserved — a Buffer would
    // make prod re-serve every object as application/octet-stream, breaking
    // inline image/PDF previews. This is the "full-fidelity" requirement.
    const up = await prodClient.storage.from(o.bucket).upload(o.name, data, {
      upsert: true,
      contentType: data.type || "application/octet-stream",
    });
    if (up.error)
      throw new Error(`upload ${o.bucket}/${o.name}: ${up.error.message}`);
  }
  console.log(`copied ${plan.objectsToCopy.length} object(s)`);
  for (const o of plan.objectsToDelete) {
    const { error } = await prodClient.storage.from(o.bucket).remove([o.name]);
    if (error)
      throw new Error(`delete ${o.bucket}/${o.name}: ${error.message}`);
  }
  console.log(
    `deleted ${plan.objectsToDelete.length} prod-only object(s). Done.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
