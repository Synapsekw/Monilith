#!/usr/bin/env node
/**
 * check-migration-ledger.mjs [--env dev|prod] [--show-ddl]
 *
 * Diffs a live Supabase migration ledger (supabase_migrations.schema_migrations)
 * against the committed files in supabase/migrations/, in BOTH directions.
 *
 * The two directions are NOT symmetric (gotcha-57):
 *   - a ledger row with NO committed file is drift, never "pending": `supabase
 *     db push` reads FILES, so that change can never reach PROD — it is lost.
 *   - a committed file that is not applied is the ordinary mid-task state.
 *
 * Suppression: this repo runs many worktrees against ONE shared DEV database, so
 * a sibling session's applied-but-unmerged migration looks identical to drift.
 * A ledger-only version whose file exists in another live git worktree is
 * reported as "pending elsewhere", not drift. (Same sibling-worktree scan idiom
 * as scripts/new-migration.sh — bash and node can't share it, so both sides
 * carry this note.)
 *
 * Also runs the OFFLINE gotcha-43 guard (duplicate version prefixes across
 * committed files), which moved here out of scripts/finish-task.sh so there is
 * one implementation of migration hygiene rather than two.
 *
 * Exit codes (callers set their own policy per code):
 *   0 in sync (warnings may be printed)   1 local failure (duplicate/malformed)
 *   2 ledger drift                        3 could not check (creds/psql/network)
 *   4 usage error
 *
 * Escape hatch: PULSE_SKIP_LEDGER_CHECK=1 prints its own name and exits 0.
 *
 * Written in node rather than bash so the classification logic is unit-testable
 * in the same `pnpm test` gate as everything else (AGENTS.md #4); the only
 * precedent for testing non-src tooling is .claude/hooks/*.test.mjs.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EXIT = { OK: 0, LOCAL: 1, DRIFT: 2, UNAVAILABLE: 3, USAGE: 4 };

const MIGRATION_FILE_RE = /^(\d{14})_[a-z0-9][a-z0-9_-]*\.sql$/;
const VERSION_RE = /^\d{14}$/;

/**
 * Split migration filenames into 14-digit versions and malformed .sql files.
 * Non-.sql entries are ignored outright (README.md, .DS_Store, …).
 * Duplicates are PRESERVED so findDuplicateVersions can see them.
 */
export function parseVersionsFromFilenames(filenames) {
  const versions = [];
  const malformed = [];
  for (const name of filenames) {
    if (!name.endsWith(".sql")) continue;
    const match = MIGRATION_FILE_RE.exec(name);
    if (match) versions.push(match[1]);
    else malformed.push(name);
  }
  return { versions, malformed };
}

/** Versions appearing more than once (gotcha-43), each listed once, sorted. */
export function findDuplicateVersions(versions) {
  const seen = new Set();
  const duplicates = new Set();
  for (const version of versions) {
    if (seen.has(version)) duplicates.add(version);
    seen.add(version);
  }
  return [...duplicates].sort();
}

/**
 * Three-way classification of the ledger against the files.
 *   drift            — in the ledger, no file here, no file in any sibling worktree
 *   pendingElsewhere — in the ledger, no file here, but a sibling worktree has it
 *   pending          — a committed file that is not in the ledger
 */
export function classifyLedger({
  fileVersions,
  ledgerVersions,
  siblingVersions = [],
}) {
  const files = new Set(fileVersions);
  const ledger = new Set(ledgerVersions);
  const siblings = new Set(siblingVersions);
  const drift = [];
  const pendingElsewhere = [];
  for (const version of [...ledger].sort()) {
    if (files.has(version)) continue;
    if (siblings.has(version)) pendingElsewhere.push(version);
    else drift.push(version);
  }
  const pending = [...files].filter((v) => !ledger.has(v)).sort();
  return { drift, pendingElsewhere, pending };
}

/**
 * Minimal .env parser. Splits on the FIRST `=` only — Postgres DSNs carry `=`
 * in query strings and passwords, and a naive split corrupts them.
 */
export function parseEnvFile(contents) {
  const result = {};
  for (const rawLine of contents.split("\n")) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice("export ".length).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")));
    if (quoted) value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}

/**
 * Normalize a PG_BIN directory into the form THIS platform's PATH understands.
 *
 * PG_BIN has two consumers whose native path forms are incompatible: this node
 * script (on Windows, PATH entries are `C:\Program Files\…` joined by `;`) and
 * scripts/sync-prod/*.sh, which run under Git Bash and do `PATH="$PG_BIN:$PATH"`
 * (MSYS `/c/Program Files/…` joined by `:`). Rather than make the user write a
 * dual-form value, the documented value is the plain POSIX/MSYS form and this
 * converts it for node on Windows — one setting satisfies both callers.
 *
 * A value already in Windows form is passed through unchanged, and on non-Windows
 * platforms nothing is rewritten at all (a leading `/c/` there is a real path).
 */
export function normalizePgBin(value, platform = process.platform) {
  if (!value || platform !== "win32") return value;
  const drive = /^\/([A-Za-z])(\/|$)/.exec(value);
  const withDrive = drive
    ? `${drive[1].toUpperCase()}:${value.slice(2)}`
    : value;
  return withDrive.replace(/\//g, "\\");
}

/**
 * Map a result to an exit code. LOCAL wins over everything: it needs no network
 * to reproduce or fix, so it is the most actionable thing to report first.
 */
export function exitCodeFor({
  duplicates = [],
  malformed = [],
  drift = [],
  unavailable = null,
} = {}) {
  if (duplicates.length > 0 || malformed.length > 0) return EXIT.LOCAL;
  if (unavailable) return EXIT.UNAVAILABLE;
  if (drift.length > 0) return EXIT.DRIFT;
  return EXIT.OK;
}

// ---------------------------------------------------------------------------
// I/O + CLI below this line. Everything above is pure and unit-tested.
// ---------------------------------------------------------------------------

function git(args, cwd) {
  return execFileSync("git", args, { encoding: "utf8", cwd }).trim();
}

/** The repo root of the current checkout (worktree or main). */
function currentRoot() {
  return resolve(git(["rev-parse", "--show-toplevel"]));
}

/**
 * The MAIN checkout — the dir whose .git is the common git dir. `.env.prod.local`
 * lives only there: start-task.sh symlinks .env.local into worktrees, not this
 * one, and DEV_SUPABASE_DB_URL exists nowhere else.
 */
function mainCheckout() {
  return dirname(resolve(git(["rev-parse", "--git-common-dir"])));
}

/** Versions of migration files present in OTHER live worktrees, with their dir. */
function siblingWorktreeVersions(root) {
  const byVersion = new Map();
  let listing;
  try {
    listing = git(["worktree", "list", "--porcelain"]);
  } catch {
    return byVersion;
  }
  for (const line of listing.split("\n")) {
    if (!line.startsWith("worktree ")) continue;
    const dir = resolve(line.slice("worktree ".length).trim());
    if (dir === root) continue;
    const migrationsDir = join(dir, "supabase", "migrations");
    if (!existsSync(migrationsDir)) continue;
    for (const version of parseVersionsFromFilenames(readdirSync(migrationsDir))
      .versions) {
      if (!byVersion.has(version)) byVersion.set(version, dir);
    }
  }
  return byVersion;
}

/** Env from the main checkout's .env.prod.local, overlaid by the real process env. */
function loadEnv(main) {
  const path = join(main, ".env.prod.local");
  const fileExists = existsSync(path);
  const fromFile = fileExists ? parseEnvFile(readFileSync(path, "utf8")) : {};
  return { fromFile, fileExists };
}

function psqlEnv(pgBin) {
  const env = {
    ...process.env,
    PGCONNECT_TIMEOUT: "10",
    PGOPTIONS: "-c statement_timeout=15000",
  };
  const bin = normalizePgBin(pgBin);
  if (!bin) return env;
  // `delimiter`, not a literal ":" — Windows splits PATH on ";", so a literal
  // colon fused PG_BIN to the next entry and psql was never found (the PG_BIN
  // escape hatch was inoperable there, and the gate silently exited 3).
  // Windows env keys are case-insensitive but node preserves the OS casing when
  // spreading process.env ("Path"), so assigning a fresh "PATH" key would hand
  // the child TWO path variables; update whichever key is already present.
  const key =
    Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  env[key] = `${bin}${delimiter}${env[key] ?? ""}`;
  return env;
}

/** One round-trip. Throws on any failure; the caller turns that into EXIT.UNAVAILABLE. */
function readLedger(dsn, pgBin) {
  const stdout = execFileSync(
    "psql",
    [
      dsn,
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "select version from supabase_migrations.schema_migrations order by version;",
    ],
    {
      encoding: "utf8",
      env: psqlEnv(pgBin),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function readDdl(dsn, pgBin, version) {
  // `version` is interpolated only after VERSION_RE validation by the caller.
  return execFileSync(
    "psql",
    [
      dsn,
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `select name || E'\\n' || array_to_string(statements, E'\\n') from supabase_migrations.schema_migrations where version = '${version}';`,
    ],
    {
      encoding: "utf8",
      env: psqlEnv(pgBin),
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

function parseArgs(argv) {
  const options = { target: "dev", showDdl: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--show-ddl") options.showDdl = true;
    else if (arg === "--env") {
      const value = argv[i + 1];
      i += 1;
      if (value !== "dev" && value !== "prod") {
        return { error: `--env must be dev or prod (got '${value ?? ""}')` };
      }
      options.target = value;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      return { error: `unknown argument '${arg}'` };
    }
  }
  return options;
}

const USAGE = `usage: node scripts/check-migration-ledger.mjs [--env dev|prod] [--show-ddl]

  Diffs the live Supabase migration ledger against supabase/migrations/.
  exit 0 in sync · 1 duplicate/malformed file · 2 ledger drift (gotcha-57)
       3 could not check (creds/psql/network) · 4 usage error`;

function main(argv) {
  if (process.env.PULSE_SKIP_LEDGER_CHECK === "1") {
    console.log(
      "· migration ledger check skipped by PULSE_SKIP_LEDGER_CHECK=1 — drift was NOT checked",
    );
    return EXIT.OK;
  }

  const options = parseArgs(argv);
  if (options.error) {
    console.error(`error: ${options.error}\n\n${USAGE}`);
    return EXIT.USAGE;
  }
  if (options.help) {
    console.log(USAGE);
    return EXIT.OK;
  }

  const root = currentRoot();
  const mainDir = mainCheckout();
  const migrationsDir = join(root, "supabase", "migrations");
  if (!existsSync(migrationsDir)) {
    console.error(
      `error: ${migrationsDir} not found — run this inside the repo.`,
    );
    return EXIT.USAGE;
  }

  const { versions: fileVersions, malformed } = parseVersionsFromFilenames(
    readdirSync(migrationsDir),
  );
  const duplicates = findDuplicateVersions(fileVersions);

  if (malformed.length > 0) {
    console.error(
      `error: supabase/migrations/ contains ${malformed.length} file(s) that are not <14-digit-version>_<slug>.sql:`,
    );
    for (const name of malformed) console.error(`         ${name}`);
    console.error(
      "       mint migrations with scripts/new-migration.sh <slug> so filename == ledger version.",
    );
  }
  if (duplicates.length > 0) {
    console.error(
      "error: duplicate migration version prefix(es) in supabase/migrations (gotcha-43):",
    );
    for (const version of duplicates) {
      for (const name of readdirSync(migrationsDir)) {
        if (name.startsWith(`${version}_`)) console.error(`         ${name}`);
      }
    }
    console.error(
      "       two files sharing one version corrupt the ledger — re-mint yours with",
    );
    console.error("       scripts/new-migration.sh <slug> (real UTC stamp).");
  }
  if (duplicates.length > 0 || malformed.length > 0) {
    return exitCodeFor({ duplicates, malformed });
  }

  const label = options.target === "prod" ? "PROD" : "DEV";
  const dsnKey =
    options.target === "prod" ? "PROD_SUPABASE_DB_URL" : "DEV_SUPABASE_DB_URL";
  const { fromFile, fileExists } = loadEnv(mainDir);
  const dsn = process.env[dsnKey] || fromFile[dsnKey];
  const pgBin = process.env.PG_BIN || fromFile.PG_BIN;

  let unavailable = null;
  let ledgerVersions = [];
  if (!dsn) {
    unavailable = fileExists
      ? `${dsnKey} is not set in ${join(mainDir, ".env.prod.local")} or the environment`
      : `${join(mainDir, ".env.prod.local")} not found (it is gitignored and not symlinked into worktrees)`;
  } else {
    try {
      ledgerVersions = readLedger(dsn, pgBin);
    } catch (error) {
      const detail =
        error.code === "ENOENT"
          ? "psql not found on PATH (set PG_BIN in .env.prod.local)"
          : (error.stderr || error.message || "unknown error")
              .toString()
              .trim()
              .split("\n")
              .slice(0, 3)
              .join(" | ");
      unavailable = `could not read the ${label} ledger: ${detail}`;
    }
  }

  if (unavailable) {
    console.error(`!! could not check the ${label} migration ledger`);
    console.error(`   reason: ${unavailable}`);
    console.error(
      "   files-vs-ledger drift was NOT checked (gotcha-57). Re-run when possible:  pnpm db:ledger-check",
    );
    return exitCodeFor({ unavailable });
  }

  const siblings = siblingWorktreeVersions(root);
  const { drift, pendingElsewhere, pending } = classifyLedger({
    fileVersions,
    ledgerVersions,
    siblingVersions: [...siblings.keys()],
  });

  for (const version of pendingElsewhere) {
    console.log(
      `· note: ${label} ledger has ${version} with no file here, but ${siblings.get(version)} has it (unmerged parallel work — not drift)`,
    );
  }
  if (pending.length > 0) {
    console.log(
      `· note: ${pending.length} committed migration(s) not yet applied to ${label}: ${pending.join(", ")}`,
    );
  }

  if (drift.length === 0) {
    console.log(
      `✓ migration ledger in sync with supabase/migrations (${fileVersions.length} files, ${ledgerVersions.length} ${label} ledger rows)`,
    );
    return EXIT.OK;
  }

  console.error("");
  console.error(
    `✗ MIGRATION LEDGER DRIFT (gotcha-57) — ${label} has ${drift.length} applied migration(s) with NO committed file:`,
  );
  for (const version of drift) console.error(`      ${version}`);
  console.error("");
  console.error(
    "  This is NOT a pending migration. `supabase db push` reads FILES, so this",
  );
  console.error(
    "  change can never reach PROD — it is lost, and a security-relevant grant or",
  );
  console.error("  revoke can vanish silently (that is exactly gotcha-57).");
  console.error("");
  console.error(
    "  Recover the DDL, then BACKFILL THE FILE AT THE LEDGER'S VERSION —",
  );
  console.error("  do NOT mint a new stamp with new-migration.sh:");
  console.error("");
  if (options.showDdl) {
    for (const version of drift) {
      if (!VERSION_RE.test(version)) {
        console.error(
          `    -- ${version}: not a 14-digit version, inspect by hand`,
        );
        continue;
      }
      console.error(
        `    -- ${version} --------------------------------------------`,
      );
      try {
        console.error(readDdl(dsn, pgBin, version));
      } catch (error) {
        console.error(`    (could not read DDL: ${error.message})`);
      }
      console.error("");
    }
  } else {
    console.error(
      `    node scripts/check-migration-ledger.mjs --env ${options.target} --show-ddl`,
    );
    console.error("");
  }
  console.error(
    "  Then write supabase/migrations/<that-version>_<slug>.sql with those statements",
  );
  console.error(
    "  (prefer idempotent forms: revoke/grant, create or replace) and commit it.",
  );
  console.error("");
  return exitCodeFor({ drift });
}

// Only exit the process when run as a script. The test file IMPORTS this module,
// so an unguarded `process.exit(main(...))` at module scope would kill the vitest
// worker. Same idiom as .claude/hooks/maybe-write-session.mjs:313-321, but
// realpath'd on BOTH sides: node resolves symlinks in the entry point it reports
// through import.meta.url, while process.argv[1] is the literal string the caller
// typed. finish-task.sh invokes us as `node "$WT/scripts/check-migration-ledger.mjs"`
// where $WT comes from `git rev-parse --show-toplevel`, so one symlinked path
// component would make a raw string compare false — and this file's failure mode
// for that is the worst one available: main() never runs, nothing is printed, and
// the process exits 0, silently reporting "no drift" for a security gate.
const isMain = (() => {
  try {
    const self = realpathSync(fileURLToPath(import.meta.url));
    const invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
    return self === invoked;
  } catch {
    return false;
  }
})();

if (isMain) process.exit(main(process.argv.slice(2)));
