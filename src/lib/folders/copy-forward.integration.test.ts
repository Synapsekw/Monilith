import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
// The .env parser is the ledger checker's, not a second one: DSNs carry `=` in
// their query string and a naive split corrupts them (AGENTS.md: grep before
// writing a helper).
import { parseEnvFile } from "../../../scripts/check-migration-ledger.mjs";

/**
 * Replays the copy-forward block of the private→shared folder migration
 * against a fixture inside `begin; … rollback;` on DEV through psql — the same
 * transport `scripts/check-migration-ledger.mjs` uses, and the same script the
 * pre-apply dry run ran. Nothing is committed.
 *
 * DELIBERATELY NOT on `src/test/integration-env.ts`: that module's
 * `integrationTargetReady()` gate DENIES DEV outright, because the suites it
 * guards provision and purge rows. This one only ever reads DEV inside a
 * transaction it rolls back, so it targets DEV on purpose — and therefore has
 * to resolve its own opt-in.
 *
 * Opt-in, and it stays skipped by default: `PULSE_TEST_DB=1` must be set AND a
 * `DEV_SUPABASE_DB_URL` must resolve (from the environment, or from the MAIN
 * checkout's `.env.prod.local`, which is the only place that key lives —
 * `start-task.sh` symlinks `.env.local` into worktrees, not that file).
 *
 * Run: PULSE_TEST_DB=1 pnpm vitest run --project integration \
 *        src/lib/folders/copy-forward.integration.test.ts
 */
function resolveDevDsn(): string | undefined {
  if (process.env.DEV_SUPABASE_DB_URL) return process.env.DEV_SUPABASE_DB_URL;
  let mainCheckout: string;
  try {
    mainCheckout = dirname(
      resolve(
        execFileSync("git", ["rev-parse", "--git-common-dir"], {
          encoding: "utf8",
        }).trim(),
      ),
    );
  } catch {
    return undefined;
  }
  const envFile = join(mainCheckout, ".env.prod.local");
  if (!existsSync(envFile)) return undefined;
  // `parseEnvFile` is plain .mjs with no declaration file, so TS widens its
  // return to `{}`; the parser's own contract is string→string.
  const parsed = parseEnvFile(readFileSync(envFile, "utf8")) as Record<
    string,
    string | undefined
  >;
  return parsed.DEV_SUPABASE_DB_URL;
}

const DSN = resolveDevDsn();

describe.skipIf(process.env.PULSE_TEST_DB !== "1" || !DSN)(
  "private → shared folder copy-forward",
  () => {
    it("dedupes by (workspace, trim(lower(name))), votes boards, breaks ties by created_at, backfills dashboards", () => {
      const migDir = join(process.cwd(), "supabase/migrations");
      const file = readdirSync(migDir).find((f) =>
        f.endsWith("_private_folders_copy_forward.sql"),
      );
      expect(file).toBeDefined();
      const sql = readFileSync(join(migDir, file as string), "utf8");
      const block = sql
        .split("-- copy-forward:begin")[1]
        ?.split("-- copy-forward:end")[0];
      expect(block).toBeTruthy();
      const template = readFileSync(
        join(process.cwd(), "scripts/sql/verify-folder-copy-forward.sql"),
        "utf8",
      );
      // A second `:copy_forward` anywhere in the file (a comment mentioning it,
      // say) would swallow the substitution and leave the real placeholder as
      // an unset psql variable — a confusing syntax error rather than a clear
      // failure. Pin it.
      expect(template.split(":copy_forward")).toHaveLength(2);
      const script = template.replace(":copy_forward", block as string);
      const tmp = mkdtempSync(join(tmpdir(), "cf-"));
      const path = join(tmp, "verify.sql");
      writeFileSync(path, script);
      const out = execFileSync(
        "psql",
        [DSN as string, "-v", "ON_ERROR_STOP=1", "-f", path],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      expect(out).toContain("copy-forward verification passed");
    });
  },
);
