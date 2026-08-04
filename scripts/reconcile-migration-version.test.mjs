import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// gotcha-75: the repair this script prints used to filter on `name`, which
// matched zero rows and still reported success. These tests pin the emitted SQL
// so the repair can never silently do nothing again.
//
// The predicate was wrong because `supabase_migrations.schema_migrations.name`
// has TWO legitimate forms in the live DEV ledger:
//   - `<slug>`             (100 rows — Supabase CLI `db push`)
//   - `<version>_<slug>`   ( 31 rows — MCP `apply_migration`)
// and this script only ever runs against the second kind (an MCP mis-stamp),
// while it derived the first. `version` is the primary key, so it is the only
// predicate the repair needs — and STEP 1 already proves row identity.

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(SCRIPTS_DIR, "reconcile-migration-version.sh");
const MIG_DIR = join(SCRIPTS_DIR, "..", "supabase", "migrations");

// A version with no committed file — the script refuses to relabel one that has.
const ORPHAN_VERSION = "20200101000000";

/** Newest committed migration, so the test never pins a deletable filename. */
function newestMigration() {
  const files = readdirSync(MIG_DIR)
    .filter((f) => /^\d{14}_[a-z0-9_-]+\.sql$/.test(f))
    .sort();
  assert.ok(files.length > 0, "expected committed migrations to exist");
  return files[files.length - 1];
}

function run(applied, fileArg) {
  return execFileSync(SCRIPT, [applied, fileArg], { encoding: "utf8" });
}

describe("reconcile-migration-version.sh — emitted repair SQL", () => {
  it("relabels on version alone, never on name (the zero-row bug)", () => {
    const file = newestMigration();
    const out = run(ORPHAN_VERSION, file);

    const update = out.slice(out.indexOf("UPDATE supabase_migrations"));
    assert.ok(
      update.includes(`SET version = '${file.slice(0, 14)}'`),
      "UPDATE must set the committed file's version",
    );
    assert.ok(
      update.includes(`WHERE version = '${ORPHAN_VERSION}'`),
      "UPDATE must key off the applied version",
    );
    assert.ok(
      !/WHERE[^;]*\bname\s*=/.test(update),
      "UPDATE must NOT filter on name — its form varies by how the migration " +
        "was applied, so the predicate matched zero rows and reported success",
    );
  });

  it("makes a zero-row repair impossible to miss (RETURNING)", () => {
    const file = newestMigration();
    const update = run(ORPHAN_VERSION, file).slice(
      run(ORPHAN_VERSION, file).indexOf("UPDATE supabase_migrations"),
    );
    assert.ok(
      /RETURNING\s+version\s*,\s*name/.test(update),
      "the UPDATE must RETURN the touched row so an empty result is visible " +
        "— a bare UPDATE that matches nothing still exits 0 (gotcha-75)",
    );
  });

  it("tells the operator to verify with db:ledger-check", () => {
    const out = run(ORPHAN_VERSION, newestMigration());
    assert.ok(
      out.includes("pnpm db:ledger-check"),
      "only db:ledger-check caught the silent no-op — the script must say so",
    );
  });

  it("accepts a bare version for the committed file too", () => {
    const file = newestMigration();
    const out = run(ORPHAN_VERSION, file.slice(0, 14));
    assert.ok(out.includes(`supabase/migrations/${file}`));
  });

  it("refuses to relabel a version that a committed file owns", () => {
    const file = newestMigration();
    assert.throws(
      () => run(file.slice(0, 14), file),
      /nothing to reconcile|refusing to relabel/,
    );
  });
});
