# Migration Ledger Drift Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution context:** the worktree already exists — `.claude/worktrees/migration-ledger-check` on `task/migration-ledger-check`. Build there. Do not create a second worktree; all five tasks touch disjoint files, so one worktree is correct (see Execution DAG).

**Goal:** Detect, automatically, a migration that is applied to a live Supabase ledger but has no committed file in `supabase/migrations/` (gotcha-57), and fail `finish-task.sh` on it before the heavy gates run.

**Architecture:** One zero-dependency Node script, `scripts/check-migration-ledger.mjs`, reads the target ledger with a single `psql` query and diffs it against the committed migration filenames. Ledger-only versions are drift (hard fail, exit 2) unless the file exists in a sibling git worktree (unmerged parallel work — warning only); file-only versions are pending (warning, exit 0). Duplicate version prefixes move here from `finish-task.sh`'s inline gotcha-43 guard and are the offline phase, which runs even with no network. Distinct exit codes (1 local · 2 drift · 3 could-not-check) let `finish-task.sh`, `/sync-prod` and `/promote` apply three different policies to one implementation.

**Tech Stack:** Node ≥20 ESM (`node:child_process`, `node:fs` — no dependencies), `psql` (PostgreSQL 18 via Homebrew, `PG_BIN` fallback), Bash 3.2 (macOS) for the `finish-task.sh` call site, Vitest `unit` project for the pure-function tests.

**Spec:** `docs/superpowers/specs/2026-07-25-migration-ledger-drift-check-design.md`

---

## Before you start

- [ ] **Read the spec.** `docs/superpowers/specs/2026-07-25-migration-ledger-drift-check-design.md` — especially "Semantics", "The false positive that must be suppressed" and "Exit-code contract". The asymmetry between the two directions is the whole point; do not make them symmetric.
- [ ] **Read `vault/decisions/2026-07-25-gotcha-57-dev-applied-migration-with-no-committed-file.md`** for the incident this prevents.
- [ ] **Confirm the local prerequisites** (they were verified while writing this plan, on this machine):

```bash
which psql && psql --version            # expect /opt/homebrew/bin/psql, PostgreSQL 18.x
grep -o '^[A-Z_]*=' /Users/danijeljovanovic/Dev/Monolith/.env.prod.local
# expect: PROD_SUPABASE_URL= PROD_SUPABASE_SERVICE_ROLE_KEY= PROD_SUPABASE_DB_URL= DEV_SUPABASE_DB_URL= PG_BIN=
```

`DEV_SUPABASE_DB_URL` exists **only** in `.env.prod.local`, which is gitignored and **not** symlinked into worktrees (`start-task.sh` symlinks only `.env.local`). Every path in this plan therefore resolves the env file from the **main checkout**, never from `$PWD`.

- [ ] Run `pnpm test` once to confirm a green baseline before changing anything.
- [ ] **Do not** run `scripts/finish-task.sh` until Task 5 is complete.

## File structure

**Created**

| Path                                      | Responsibility                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `scripts/check-migration-ledger.mjs`      | Pure diff/classification functions + a `main()` that does the I/O and printing |
| `scripts/check-migration-ledger.test.mjs` | Vitest unit tests for the five pure functions                                  |

**Modified**

| Path                                              | Change                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| `vitest.config.ts:53-56`                          | Add `scripts/**/*.test.mjs` to the `unit` project's `include`       |
| `package.json:12-27` (`scripts`)                  | Add `db:ledger-check`                                               |
| `scripts/finish-task.sh:114-124`                  | Replace the inline gotcha-43 block with a call + exit-code policy   |
| `.claude/commands/sync-prod.md:49-71`             | Split step 1's stop; add step 1b (files ↔ ledger, DEV **and** PROD) |
| `.claude/commands/promote.md:53-65`               | Add a preflight bullet: DEV ledger drift is a hard stop             |
| `scripts/reconcile-migration-version.sh:54-57`    | Route the no-file case to the new script instead of dead-ending     |
| `scripts/new-migration.sh:99-105`                 | Replace the hand-typed ledger `select` with `pnpm db:ledger-check`  |
| `CONTRIBUTING.md` (migrations section, ~line 124) | Document the check and the two-direction rule                       |
| `AGENTS.md` (migrations invariant bullet)         | One clause pointing at the new script                               |
| `vault/decisions/00-gotcha-index.md`              | Add the gotcha-57 entry (56/57 are both missing; add **57 only**)   |
| `vault/decisions/2026-07-25-gotcha-57-…md`        | Close the "nothing automated compares" consequence + open follow-up |

## Execution DAG

Dependency edges come from the per-task `Interfaces` blocks:

- Task 1 depends on nothing.
- Task 2 depends on Task 1 (script path, exit codes).
- Task 3 depends on Task 1 (exit codes, `--env` flag).
- Task 4 depends on Task 1 (script name, `pnpm db:ledger-check`).
- Task 5 depends on Tasks 2, 3, 4 (it documents the final wired shape).

**Parallel batches**

- **Batch 1:** Task 1
- **Batch 2 (parallel — three concurrent agents):** Task 2, Task 3, Task 4
- **Batch 3:** Task 5

**Critical path:** Task 1 → Task 2 → Task 5 (three sequential units — the wall-clock floor).

Batch 2's three tasks modify strictly disjoint files (`scripts/finish-task.sh` · two `.claude/commands/*.md` · two sibling `scripts/*.sh` + `CONTRIBUTING.md` + `AGENTS.md`), so they run concurrently **in this one worktree** with no clobbering and no per-task worktree. Dispatch them with `superpowers:dispatching-parallel-agents` in a single message.

## Performance & data-fetching budget (working agreement #5)

**No UI, no RSC, no client state — clauses (a), (b) and (c) do not apply.** The tooling equivalents, which are binding:

- **One network round-trip per invocation per ledger:** `select version from supabase_migrations.schema_migrations order by version` — a single scan of a ~111-row table keyed on its text primary key. `--show-ddl` adds exactly one more query, only for versions already found to be drifted.
- **Measured:** 1.19s / 1.27s / 1.41s over three cold `psql` runs against DEV from this machine.
- **Bounded, never hanging:** `PGCONNECT_TIMEOUT=10` and `PGOPTIONS=-c statement_timeout=15000` (libpq-native — `timeout(1)` does not exist on macOS, per `.claude/commands/promote.md`). Worst case is ~10s then exit 3.
- **Fail-fast placement:** the call sits where the gotcha-43 block lives in `finish-task.sh` — after the rebase (so merged siblings' files are present) and **before** `typecheck/lint/test/build`, so a caught drift costs seconds, not a full build.
- **The offline phase never touches the network,** so duplicate-version detection is unaffected by connectivity.

---

### Task 1: The script, its tests, and the wiring

**Interfaces**

- **Consumes:** nothing.
- **Produces:** `scripts/check-migration-ledger.mjs` (exports `parseVersionsFromFilenames`, `findDuplicateVersions`, `classifyLedger`, `parseEnvFile`, `exitCodeFor`, `EXIT`); the CLI contract `node scripts/check-migration-ledger.mjs [--env dev|prod] [--show-ddl]`; exit codes `0/1/2/3/4`; the `pnpm db:ledger-check` alias.

**Files:**

- Create: `scripts/check-migration-ledger.mjs`
- Create: `scripts/check-migration-ledger.test.mjs`
- Modify: `vitest.config.ts:53-56`
- Modify: `package.json` (`scripts` block)

- [ ] **Step 1: Add `scripts/**/\*.test.mjs`to the vitest`unit` project\*\*

In `vitest.config.ts`, replace the `include` block of the `unit` project (currently lines 53-56) and extend its comment:

```ts
          // `.claude/hooks/**` covers the Claude Code hook scripts and
          // `scripts/**` the repo tooling scripts (both plain node .mjs with
          // exported pure functions) so they run in the same `pnpm test` gate
          // as src. Anchored at the repo root on purpose — it does not reach
          // into `.claude/worktrees/*` copies.
          include: [
            "src/**/*.{test,spec}.{ts,tsx}",
            ".claude/hooks/**/*.test.mjs",
            "scripts/**/*.test.mjs",
          ],
```

The `stripShebang` plugin at the top of the same file is keyed on `id.endsWith(".mjs")`, not on path, so a `scripts/` module with a `#!/usr/bin/env node` shebang is already handled — no plugin change needed.

- [ ] **Step 2: Write the failing test file**

Create `scripts/check-migration-ledger.test.mjs`:

```js
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  parseVersionsFromFilenames,
  findDuplicateVersions,
  classifyLedger,
  parseEnvFile,
  exitCodeFor,
  EXIT,
} from "./check-migration-ledger.mjs";

describe("parseVersionsFromFilenames", () => {
  it("extracts the 14-digit version from well-formed migration filenames", () => {
    assert.deepEqual(
      parseVersionsFromFilenames([
        "20260614174043_init.sql",
        "20260724133321_mcp_oauth.sql",
        "20260724134101_mcp-oauth-vault-cleanup-acl.sql",
      ]),
      {
        versions: ["20260614174043", "20260724133321", "20260724134101"],
        malformed: [],
      },
    );
  });

  it("ignores non-.sql entries entirely (never reports them malformed)", () => {
    assert.deepEqual(
      parseVersionsFromFilenames(["README.md", ".DS_Store", "notes.txt"]),
      { versions: [], malformed: [] },
    );
  });

  it("reports .sql files that are not <14-digit>_<slug>.sql as malformed", () => {
    assert.deepEqual(
      parseVersionsFromFilenames([
        "2026061417404_short.sql",
        "20260614174043.sql",
        "20260614174043_Bad_Caps.sql",
        "20260614174043_ok.sql",
      ]),
      {
        versions: ["20260614174043"],
        malformed: [
          "2026061417404_short.sql",
          "20260614174043.sql",
          "20260614174043_Bad_Caps.sql",
        ],
      },
    );
  });

  it("preserves duplicates so findDuplicateVersions can see them", () => {
    assert.deepEqual(
      parseVersionsFromFilenames([
        "20260703120000_a.sql",
        "20260703120000_b.sql",
      ]).versions,
      ["20260703120000", "20260703120000"],
    );
  });
});

describe("findDuplicateVersions", () => {
  it("reproduces the gotcha-43 collision (two files, one version prefix)", () => {
    assert.deepEqual(
      findDuplicateVersions([
        "20260703120000",
        "20260703120000",
        "20260704090000",
      ]),
      ["20260703120000"],
    );
  });

  it("returns each duplicate once, sorted", () => {
    assert.deepEqual(findDuplicateVersions(["b", "a", "b", "a", "a", "c"]), [
      "a",
      "b",
    ]);
  });

  it("returns an empty array for a clean list", () => {
    assert.deepEqual(findDuplicateVersions(["1", "2", "3"]), []);
    assert.deepEqual(findDuplicateVersions([]), []);
  });
});

describe("classifyLedger", () => {
  it("reports nothing when the sets are identical", () => {
    assert.deepEqual(
      classifyLedger({
        fileVersions: ["1", "2"],
        ledgerVersions: ["1", "2"],
        siblingVersions: [],
      }),
      { drift: [], pendingElsewhere: [], pending: [] },
    );
  });

  it("classifies a ledger row with no file anywhere as DRIFT (gotcha-57)", () => {
    assert.deepEqual(
      classifyLedger({
        fileVersions: ["20260724133321"],
        ledgerVersions: ["20260724133321", "20260724134101"],
        siblingVersions: [],
      }),
      { drift: ["20260724134101"], pendingElsewhere: [], pending: [] },
    );
  });

  it("classifies a committed file that was never applied as PENDING, not drift", () => {
    assert.deepEqual(
      classifyLedger({
        fileVersions: ["1", "2"],
        ledgerVersions: ["1"],
        siblingVersions: [],
      }),
      { drift: [], pendingElsewhere: [], pending: ["2"] },
    );
  });

  it("downgrades a ledger-only version to pendingElsewhere when a sibling worktree has the file", () => {
    assert.deepEqual(
      classifyLedger({
        fileVersions: ["1"],
        ledgerVersions: ["1", "2"],
        siblingVersions: ["2"],
      }),
      { drift: [], pendingElsewhere: ["2"], pending: [] },
    );
  });

  it("classifies each version independently in a mixed case", () => {
    assert.deepEqual(
      classifyLedger({
        fileVersions: ["1", "4"],
        ledgerVersions: ["1", "2", "3"],
        siblingVersions: ["2"],
      }),
      { drift: ["3"], pendingElsewhere: ["2"], pending: ["4"] },
    );
  });

  it("treats siblingVersions as optional", () => {
    assert.deepEqual(
      classifyLedger({ fileVersions: [], ledgerVersions: ["9"] }),
      { drift: ["9"], pendingElsewhere: [], pending: [] },
    );
  });
});

describe("parseEnvFile", () => {
  it("parses KEY=value pairs, skipping comments and blank lines", () => {
    assert.deepEqual(parseEnvFile("# a comment\n\nFOO=bar\n  BAZ=qux  \n"), {
      FOO: "bar",
      BAZ: "qux",
    });
  });

  it("strips matching single or double quotes", () => {
    assert.deepEqual(parseEnvFile(`A="one"\nB='two'\nC="un'even\n`), {
      A: "one",
      B: "two",
      C: `"un'even`,
    });
  });

  it("tolerates an `export ` prefix", () => {
    assert.deepEqual(parseEnvFile("export PG_BIN=/opt/homebrew/bin\n"), {
      PG_BIN: "/opt/homebrew/bin",
    });
  });

  it("splits on the FIRST = only, so DSNs with = survive intact", () => {
    const dsn =
      "postgresql://user:p=ss@db.example.com:5432/postgres?sslmode=require";
    assert.deepEqual(parseEnvFile(`DEV_SUPABASE_DB_URL=${dsn}\n`), {
      DEV_SUPABASE_DB_URL: dsn,
    });
  });

  it("ignores lines with no = and lines with an invalid key", () => {
    assert.deepEqual(parseEnvFile("NOEQUALS\n=novalue\n1BAD=x\nOK=y\n"), {
      OK: "y",
    });
  });

  it("keeps an explicitly empty value as an empty string", () => {
    assert.deepEqual(parseEnvFile("EMPTY=\n"), { EMPTY: "" });
  });
});

describe("exitCodeFor", () => {
  it("returns OK for a clean result", () => {
    assert.equal(exitCodeFor({}), EXIT.OK);
    assert.equal(
      exitCodeFor({ duplicates: [], malformed: [], drift: [] }),
      EXIT.OK,
    );
  });

  it("returns LOCAL for duplicate or malformed filenames", () => {
    assert.equal(exitCodeFor({ duplicates: ["1"] }), EXIT.LOCAL);
    assert.equal(exitCodeFor({ malformed: ["bad.sql"] }), EXIT.LOCAL);
  });

  it("returns DRIFT for ledger-only versions", () => {
    assert.equal(exitCodeFor({ drift: ["20260724134101"] }), EXIT.DRIFT);
  });

  it("returns UNAVAILABLE when the ledger could not be read", () => {
    assert.equal(
      exitCodeFor({ unavailable: "psql not found" }),
      EXIT.UNAVAILABLE,
    );
  });

  it("prefers LOCAL over DRIFT and over UNAVAILABLE (it needs no network to fix)", () => {
    assert.equal(exitCodeFor({ duplicates: ["1"], drift: ["2"] }), EXIT.LOCAL);
    assert.equal(
      exitCodeFor({ duplicates: ["1"], unavailable: "offline" }),
      EXIT.LOCAL,
    );
  });

  it("uses distinct numeric codes so callers can set per-site policy", () => {
    assert.deepEqual(
      [EXIT.OK, EXIT.LOCAL, EXIT.DRIFT, EXIT.UNAVAILABLE, EXIT.USAGE],
      [0, 1, 2, 3, 4],
    );
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm test:unit -- scripts/check-migration-ledger.test.mjs
```

Expected: FAIL — `Failed to load .../scripts/check-migration-ledger.mjs` (the module does not exist yet).

- [ ] **Step 4: Write the module**

Create `scripts/check-migration-ledger.mjs`:

```js
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
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
  const fromFile = existsSync(path)
    ? parseEnvFile(readFileSync(path, "utf8"))
    : {};
  return { fromFile, fileExists: existsSync(path) };
}

function psqlEnv(pgBin) {
  const env = {
    ...process.env,
    PGCONNECT_TIMEOUT: "10",
    PGOPTIONS: "-c statement_timeout=15000",
  };
  if (pgBin) env.PATH = `${pgBin}:${env.PATH ?? ""}`;
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
      `   files-vs-ledger drift was NOT checked (gotcha-57). Re-run when possible:  pnpm db:ledger-check`,
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
// worker. Same idiom as .claude/hooks/maybe-write-session.mjs:313-321.
const isMain = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isMain) process.exit(main(process.argv.slice(2)));
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm test:unit -- scripts/check-migration-ledger.test.mjs
```

Expected: PASS — 25 tests across the five `describe` blocks, 0 failed. If instead the vitest worker dies or the run exits early, the `isMain` guard is missing or wrong — the test imports this module, so module-scope `process.exit` would terminate the worker.

- [ ] **Step 6: Add the `package.json` script**

In the `scripts` block of `package.json`, add after `"db:types"`:

```json
    "db:ledger-check": "node scripts/check-migration-ledger.mjs",
```

- [ ] **Step 7: Verify the happy path against the live DEV ledger**

```bash
pnpm db:ledger-check
```

Expected (exact counts will differ as migrations land):

```
✓ migration ledger in sync with supabase/migrations (111 files, 111 DEV ledger rows)
```

Then confirm the exit code and the PROD variant:

```bash
pnpm db:ledger-check > /dev/null; echo "dev rc=$?"     # expect dev rc=0
node scripts/check-migration-ledger.mjs --env prod; echo "prod rc=$?"
```

`--env prod` is expected to print a `not yet applied to PROD` note and still exit 0 — PROD being behind is pending, not drift. Two other acceptable outcomes: exit 3 if PROD's `supabase_migrations.schema_migrations` relation does not exist yet (the never-pushed bootstrap case `/sync-prod` step 1 documents), which surfaces as a `could not read the PROD ledger` reason. If it exits **2**, you have found real PROD drift — stop and report it; do not "fix" the script.

Also confirm the filename regex accepts every committed migration (all 111 matched when this plan was written, so a non-zero result here means a new file broke the convention):

```bash
ls supabase/migrations | grep -vcE '^[0-9]{14}_[a-z0-9][a-z0-9_-]*\.sql$'   # expect 0
```

- [ ] **Step 8: Verify the degradation and usage paths**

```bash
DEV_SUPABASE_DB_URL='postgresql://nobody:nobody@127.0.0.1:1/none' \
  node scripts/check-migration-ledger.mjs --env dev; echo "rc=$?"
```

Expected: `!! could not check the DEV migration ledger` + a reason line, `rc=3`. It must return in well under 15s (libpq refuses a closed port immediately).

```bash
node scripts/check-migration-ledger.mjs --env staging; echo "rc=$?"   # expect rc=4
PULSE_SKIP_LEDGER_CHECK=1 pnpm db:ledger-check; echo "rc=$?"          # expect the skip line, rc=0
```

- [ ] **Step 9: Run the full gates**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all pass. `pnpm lint` runs bare `eslint`; `scripts/**` is not in `globalIgnores`, so this `.mjs` **is** linted (unlike `.claude/hooks/*.mjs`, which `.claude/**` excludes) and this is the first linted `.mjs` in the repo. If the flat config reports `no-undef` on `process`/`console` or otherwise mis-treats the file as browser code, add this block to `eslint.config.mjs` immediately before `globalIgnores(...)` — do **not** widen `globalIgnores`, which would silently exempt future tooling too:

```js
  // Repo tooling scripts are plain Node ESM, not app code.
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly" },
      sourceType: "module",
    },
  },
```

- [ ] **Step 10: Commit**

```bash
git add scripts/check-migration-ledger.mjs scripts/check-migration-ledger.test.mjs vitest.config.ts package.json
git status --short   # confirm ONLY those paths (plus eslint.config.mjs if step 9 needed it)
git commit -m "feat(scripts): add migration ledger drift check (gotcha-57)"
```

---

### Task 2: Wire the check into `finish-task.sh`

**Interfaces**

- **Consumes:** Task 1 — `scripts/check-migration-ledger.mjs`, `--env dev`, exit codes 0/1/2/3/4.
- **Produces:** a blocking DEV drift gate on every merge to `develop`; the gotcha-43 duplicate guard now lives in exactly one place.

**Files:**

- Modify: `scripts/finish-task.sh:114-124` (replace the whole `DUP_VERSIONS` block)

- [ ] **Step 1: Replace the inline duplicate-version block**

`scripts/finish-task.sh` lines 114-124 are currently:

```bash
# gotcha-43: parallel branches mint the same migration version; two files sharing
# a version prefix corrupt the supabase ledger — hard-fail before it can land.
DUP_VERSIONS="$(ls "$WT/supabase/migrations" 2>/dev/null | sed -n 's/^\([0-9]\{14\}\)_.*\.sql$/\1/p' | sort | uniq -d || true)"
if [ -n "$DUP_VERSIONS" ]; then
  echo "error: duplicate migration version prefix(es) in supabase/migrations after rebase:" >&2
  for V in $DUP_VERSIONS; do
    ls "$WT/supabase/migrations" | grep "^${V}_" | sed 's/^/         /' >&2
  done
  echo "       re-mint yours with scripts/new-migration.sh <slug> (real UTC stamp), then re-run." >&2
  exit 1
fi
```

Replace that entire block with:

```bash
# Migration hygiene, one check, two gotchas (scripts/check-migration-ledger.mjs):
#   - gotcha-43 (offline): two committed files sharing one version prefix corrupt
#     the ledger. This guard used to be inlined here; it moved into the script so
#     there is one implementation, and it still runs with no network.
#   - gotcha-57 (needs DEV): a ledger row with NO committed file. `db push` reads
#     files, so such a change can never reach PROD — it is lost, and a revoke/grant
#     on a SECURITY DEFINER function can vanish silently. Run AFTER the rebase so
#     already-merged siblings' files are present, and BEFORE the heavy gates so a
#     hit costs ~1.5s instead of a full build.
# Exit codes: 0 ok · 1 local failure · 2 drift · 3 could-not-check · 4 usage.
# 3 must NEVER block: gating a merge on a network call is how a gate wedges every
# future task. It warns loudly and continues.
echo "→ checking migration hygiene (files ↔ DEV ledger)…"
LEDGER_RC=0
node "$WT/scripts/check-migration-ledger.mjs" --env dev || LEDGER_RC=$?
case "$LEDGER_RC" in
  0) : ;;
  3)
    echo "" >&2
    echo "!! WARNING: could not verify the DEV migration ledger (reason above)." >&2
    echo "   Files-vs-ledger drift was NOT checked (gotcha-57). Re-run manually" >&2
    echo "   when you have connectivity:  pnpm db:ledger-check" >&2
    echo "" >&2
    ;;
  *)
    echo "" >&2
    echo "error: migration hygiene check failed (exit $LEDGER_RC) — see above." >&2
    echo "       not merging. fix it, commit, then re-run finish-task.sh." >&2
    echo "       (last resort, audited: PULSE_SKIP_LEDGER_CHECK=1 scripts/finish-task.sh)" >&2
    exit 1
    ;;
esac
```

`|| LEDGER_RC=$?` is required: the script runs under `set -euo pipefail`, so an unguarded non-zero exit would abort before the `case` could apply per-code policy.

- [ ] **Step 2: Verify the guard still fires on a duplicate version (gotcha-43 regression check)**

Do not run the whole `finish-task.sh` for this — exercise the moved guard directly:

```bash
V=$(ls supabase/migrations | head -1 | cut -c1-14)
touch "supabase/migrations/${V}_duplicate_probe.sql"
pnpm db:ledger-check; echo "rc=$?"
```

Expected: the `duplicate migration version prefix(es) … (gotcha-43)` error listing both filenames, `rc=1`. Clean up and re-verify:

```bash
rm "supabase/migrations/${V}_duplicate_probe.sql"
pnpm db:ledger-check; echo "rc=$?"     # expect ✓ … rc=0
git status --short supabase/migrations # expect empty
```

- [ ] **Step 3: Verify the `finish-task.sh` call site in isolation**

`finish-task.sh` rebases and merges, so do not run it as a test. Confirm the new block is syntactically valid and the policy branches are right:

```bash
bash -n scripts/finish-task.sh && echo "syntax ok"
grep -n "LEDGER_RC" scripts/finish-task.sh
```

Expected: `syntax ok`, and four `LEDGER_RC` lines (init, call, and the `case` reference in the error message).

- [ ] **Step 4: Commit**

```bash
git add scripts/finish-task.sh
git commit -m "feat(scripts): gate finish-task on migration ledger drift (gotcha-57)"
```

---

### Task 3: Command-doc policy — `/sync-prod` and `/promote`

**Interfaces**

- **Consumes:** Task 1 — `pnpm db:ledger-check`, `--env dev|prod`, exit codes.
- **Produces:** the PROD-side policy: `/sync-prod` step 1's stop is split by whether the missing versions have files; `/promote` preflight stops on DEV drift.

**Files:**

- Modify: `.claude/commands/sync-prod.md:63-71` (step 1's stop) and insert a new step 1b after line 71
- Modify: `.claude/commands/promote.md:53-65` (step 1 preflight bullets)

- [ ] **Step 1: Split `/sync-prod` step 1's stop**

In `.claude/commands/sync-prod.md`, replace the block that currently reads:

````markdown
Compute the set of versions present in DEV but absent in PROD.

- **Non-empty set** (including bootstrap where PROD has zero migrations) → **hard stop**: tell the
  user to apply the missing migrations first:
  ```bash
  pnpm exec supabase db push --db-url "$PROD_SUPABASE_DB_URL"
  ```
````

Then retry `/sync-prod`. Do not proceed past this stop.

- **Parity confirmed (sets are equal):** continue.

````

with:

```markdown
Compute the set of versions present in DEV but absent in PROD.

- **Non-empty set, and every version in it has a committed file in `supabase/migrations/`**
  → **hard stop**: tell the user to apply the missing migrations first:
  ```bash
  pnpm exec supabase db push --db-url "$PROD_SUPABASE_DB_URL"
````

Then retry `/sync-prod`. Do not proceed past this stop.

- **Non-empty set, and any version in it has NO committed file** → a **different** hard stop.
  `db push` reads **files**, so it cannot carry that change to PROD — the instruction above would
  appear to succeed while silently dropping it (gotcha-57). Stop and tell the user to backfill the
  file at the ledger's version first (step 1b prints the exact recovery), then retry `/sync-prod`.
  **Never** hand over `db push` for this case.
- **Parity confirmed (sets are equal):** continue.

````

- [ ] **Step 2: Insert step 1b**

Immediately after the block edited in step 1 (i.e. before `### 2. Independent-prod-data guard`), insert:

```markdown
### 1b. Files ↔ ledger drift, both environments (agent, read-only)

Version parity between DEV and PROD answers "is prod behind?" — never "is this change in git at
all?". A ledger row with no committed file is invisible to step 1 and to `db push`. Run the
automated check on **both** ledgers:

```bash
pnpm db:ledger-check                                        # DEV
node scripts/check-migration-ledger.mjs --env prod          # PROD
````

Act on the exit code:

- `0` — in sync (notes about not-yet-applied files are expected and fine). Continue.
- `1` — duplicate or malformed migration filename. **Hard stop**: that must be fixed on `develop`
  before any prod write.
- `2` — **ledger drift.** **Hard stop.** For DEV: recover and backfill the file at the ledger's
  version (`--show-ddl` prints the statements), commit it, then retry `/sync-prod`. For PROD this is
  worse, not better — production is running DDL that exists in no checkout; report the versions and
  stop. Never `db push` past this.
- `3` — could not check. **Stop and ask.** Unlike `finish-task.sh` (where an unverifiable ledger is a
  warning), a prod write must not proceed on an unverified schema. Report the reason (missing
  `.env.prod.local`, missing `psql`, unreachable DB) and let the user decide.

Run this **before** the independent-prod-data guard: it is cheaper and its failure invalidates the
whole sync.

````

- [ ] **Step 3: Add the `/promote` preflight bullet**

In `.claude/commands/promote.md`, in "### 1. Preflight (read-only)", insert this bullet immediately after the `git fetch origin develop main` bullet:

```markdown
- **Migration ledger drift (hard stop).** Run `pnpm db:ledger-check` (DEV). Promotion ships **code**,
  but PROD's schema comes only from **committed files** — so code that depends on DDL applied to DEV
  and never committed works in dev and breaks in production (gotcha-57). Exit `2` (drift) or `1`
  (duplicate/malformed filename) → **stop**, naming the versions; the fix is to backfill the file at
  the ledger's version, not to promote. Exit `3` (could not check) → **note it in the report and
  continue** — `/promote` runs from the main checkout where `.env.prod.local` is present, so a `3`
  here means a genuinely unreachable DB, and blocking a code promotion on it is disproportionate.
````

- [ ] **Step 4: Verify the docs are internally consistent**

```bash
grep -n "db:ledger-check\|check-migration-ledger" .claude/commands/sync-prod.md .claude/commands/promote.md
grep -n "### 1b" .claude/commands/sync-prod.md
```

Expected: `sync-prod.md` mentions the check twice (DEV + PROD invocations) plus the step-1 cross-reference; `promote.md` once; `### 1b. Files ↔ ledger drift` present. Also confirm nothing else in `sync-prod.md` still promises `db push` as the unconditional remedy:

```bash
grep -n "db push" .claude/commands/sync-prod.md
```

Expected: the occurrences inside step 1's first bullet, step 1b, and the "PROD schema behind" edge case — each now qualified. Update the edge-case entry at the bottom of the file if it is not:

```markdown
- **PROD schema behind or bootstrap (zero migrations)** — hard stop at step 1 with the `db push`
  instruction, **unless** a missing version has no committed file, in which case step 1b's backfill
  stop applies instead (`db push` cannot carry it); re-run `/sync-prod` after schema is applied.
```

- [ ] **Step 5: Commit**

```bash
git add .claude/commands/sync-prod.md .claude/commands/promote.md
git commit -m "docs(commands): check files vs migration ledger in sync-prod and promote"
```

---

### Task 4: Point the sibling scripts and reference docs at the new check

**Interfaces**

- **Consumes:** Task 1 — the script name and `pnpm db:ledger-check`.
- **Produces:** no dead ends — `reconcile-migration-version.sh`'s no-file exit routes to the new flow, and `new-migration.sh` teaches the automated check instead of a hand-typed query.

**Files:**

- Modify: `scripts/reconcile-migration-version.sh:54-57`
- Modify: `scripts/new-migration.sh:99-105`
- Modify: `CONTRIBUTING.md` (migrations bullets, ~line 124)
- Modify: `AGENTS.md` (the "Migrations are minted only via…" invariant bullet)

- [ ] **Step 1: Route `reconcile-migration-version.sh`'s dead end**

In `scripts/reconcile-migration-version.sh`, replace this block (lines 54-57):

```bash
if [ ! -f "$MIG_DIR/$FILEBASE" ]; then
  echo "error: supabase/migrations/$FILEBASE does not exist — the committed file is the source of truth." >&2
  exit 1
fi
```

with:

```bash
if [ ! -f "$MIG_DIR/$FILEBASE" ]; then
  echo "error: supabase/migrations/$FILEBASE does not exist — the committed file is the source of truth." >&2
  echo "" >&2
  echo "       If the ledger has a version with NO committed file AT ALL, that is gotcha-57," >&2
  echo "       not gotcha-55 — there is no label to reconcile, the DDL is simply missing from" >&2
  echo "       git. This script cannot help. Instead:" >&2
  echo "         1. node scripts/check-migration-ledger.mjs --env dev --show-ddl" >&2
  echo "         2. write supabase/migrations/<ledger-version>_<slug>.sql with those statements" >&2
  echo "            — backfill AT THE LEDGER'S VERSION; do NOT mint a new stamp." >&2
  echo "         3. pnpm db:ledger-check   # expect ✓ in sync" >&2
  exit 1
fi
```

Also extend the header comment: after the line `# ledgers disagree on a version string for the SAME DDL and \`/sync-prod\`'s`… block, append a paragraph before `# Usage:`:

```bash
# Scope: this repairs a version LABEL drift (gotcha-55) — the file exists, the
# ledger row exists, they disagree. It is NOT the tool for a ledger row with no
# file at all (gotcha-57): use scripts/check-migration-ledger.mjs, which detects
# that case and prints the DDL to backfill.
```

- [ ] **Step 2: Update `new-migration.sh`'s echoed instructions**

In `scripts/new-migration.sh`, replace the echoed step 2 (lines 99-105):

```bash
echo "  2. apply to DEV via the supabase-dev MCP apply_migration with the SAME"
echo "     version+name — name: \"${VERSION}_${SLUG}\" — so the remote ledger row"
echo "     matches this filename (gotcha-55). Then verify:"
echo "       select version, name from supabase_migrations.schema_migrations"
echo "       order by version desc limit 3;"
echo "     if the ledger stamped a different version, repair it with:"
echo "       scripts/reconcile-migration-version.sh <ledger-version> ${VERSION}"
```

with:

```bash
echo "  2. apply to DEV via the supabase-dev MCP apply_migration with the SAME"
echo "     version+name — name: \"${VERSION}_${SLUG}\" — so the remote ledger row"
echo "     matches this filename (gotcha-55). Then verify the whole ledger against"
echo "     the committed files in one command:"
echo "       pnpm db:ledger-check"
echo "     · exit 0 = in sync (a 'not yet applied' note for this file is expected"
echo "       until you apply it)"
echo "     · exit 2 = a ledger row has NO committed file (gotcha-57) — backfill it"
echo "       at the ledger's version; re-run with --show-ddl to get the statements"
echo "     · if the ledger stamped a DIFFERENT version for THIS file, that is"
echo "       gotcha-55 — repair the label with:"
echo "         scripts/reconcile-migration-version.sh <ledger-version> ${VERSION}"
```

- [ ] **Step 3: Document it in `CONTRIBUTING.md`**

In `CONTRIBUTING.md`, immediately after the existing bullet `- After a migration: regenerate \`src/types/database.types.ts\` with \`pnpm db:types\` …`(the bullet ending "…the main source of`any` creep."), add:

```markdown
- **Verify the ledger against the files, in both directions**, with `pnpm db:ledger-check` (DEV;
  `--env prod` for production). The two directions are not equivalent:
  - a **committed file that is not applied** is the ordinary mid-task state — a warning, exit 0;
  - a **ledger row with no committed file** is drift, exit 2, and always a defect. `supabase db push`
    reads files, so that change can never reach production; it is lost. A `revoke`/`grant` on a
    `SECURITY DEFINER` function nearly shipped that way — see
    `vault/decisions/2026-07-25-gotcha-57-dev-applied-migration-with-no-committed-file.md`.

  `finish-task.sh` runs this automatically (blocking on drift, warning if the DB is unreachable), and
  `/sync-prod` + `/promote` run it before any production step. Fix drift by **backfilling the file at
  the ledger's version** — the one sanctioned exception to "never hand-write a version stamp",
  because the stamp is copied from the ledger, not invented. `reconcile-migration-version.sh` is the
  _other_ repair (a version label that drifted while the file exists — gotcha-55).
```

- [ ] **Step 4: Add the `AGENTS.md` clause**

In `AGENTS.md`, in the "Engineering invariants" list, the migrations bullet currently ends:

```markdown
`supabase-dev` MCP with the **same version + name** as the committed file, verify the ledger
(`list_migrations`), and run `scripts/reconcile-migration-version.sh` on any drift.
```

Replace that ending with:

```markdown
`supabase-dev` MCP with the **same version + name** as the committed file, then verify with
**`pnpm db:ledger-check`** (diffs the live ledger against `supabase/migrations/` both ways;
`finish-task.sh` blocks on a ledger row that has no committed file — gotcha-57). A _version label_
that drifted while the file exists is the other repair: `scripts/reconcile-migration-version.sh`.
```

- [ ] **Step 5: Verify**

```bash
bash -n scripts/reconcile-migration-version.sh && bash -n scripts/new-migration.sh && echo "syntax ok"
scripts/reconcile-migration-version.sh 20260101000000 29990101000000 2>&1 | tail -8
```

Expected: `syntax ok`, then the no-file error followed by the three-step gotcha-57 routing (the `2999…` version matches no file by construction, so this exercises exactly that branch).

```bash
grep -n "db:ledger-check" CONTRIBUTING.md AGENTS.md scripts/new-migration.sh
```

Expected: at least one hit in each.

- [ ] **Step 6: Commit**

```bash
git add scripts/reconcile-migration-version.sh scripts/new-migration.sh CONTRIBUTING.md AGENTS.md
git commit -m "docs: route the no-committed-file ledger case to db:ledger-check"
```

---

### Task 5: Vault closeout and full verification

**Interfaces**

- **Consumes:** Tasks 2, 3, 4 — the final wired shape (which call sites enforce what).
- **Produces:** a gotcha-index entry for 57; the ADR's "nothing automated compares" consequence closed; the full gate run + the live drift-injection proof.

**Files:**

- Modify: `vault/decisions/00-gotcha-index.md` ("Shared DB, migrations & Supabase" section)
- Modify: `vault/decisions/2026-07-25-gotcha-57-dev-applied-migration-with-no-committed-file.md` (Consequences)

- [ ] **Step 1: Add the gotcha-57 index entry**

In `vault/decisions/00-gotcha-index.md`, in the "Shared DB, migrations & Supabase" section, add after the `- **55** …` line (keep the section's ascending-number order; do **not** renumber anything, and do not add a 56 entry — that ADR's indexing is a separate concern):

```markdown
- **57** [[2026-07-25-gotcha-57-dev-applied-migration-with-no-committed-file]] — a DEV-applied migration with no committed file is invisible to every gate; `pnpm db:ledger-check` now diffs the ledger against `supabase/migrations/`
```

- [ ] **Step 2: Close out the ADR's consequences**

In `vault/decisions/2026-07-25-gotcha-57-dev-applied-migration-with-no-committed-file.md`, replace the `## Consequences` section's negative + open-follow-up lines:

```markdown
- Negative: still a manual check — nothing automated compares the two lists yet.
- Open follow-up: teach `finish-task.sh` (or a `/sync-prod` pre-check) to diff
  `list_migrations` against `supabase/migrations/` and fail loudly on a DEV version with no file.
  Also worth auditing the other definer functions added around the same date for the same missed ACL.
```

with:

```markdown
- **Automated 2026-07-25** — `scripts/check-migration-ledger.mjs` (`pnpm db:ledger-check`) diffs the
  live ledger against `supabase/migrations/` in both directions. A ledger row with no committed file
  exits 2; a committed-but-unapplied file is a warning at exit 0. `finish-task.sh` **blocks** on
  drift (and warns-but-continues when the DB is unreachable — exit 3 — so the gate can never wedge a
  merge); `/sync-prod` step 1b checks DEV **and** PROD and stops on any non-zero, including
  unavailable; `/promote` preflight stops on DEV drift. The gotcha-43 duplicate-version guard moved
  out of `finish-task.sh` into the same script, so migration hygiene has one implementation.
  Design: `docs/superpowers/specs/2026-07-25-migration-ledger-drift-check-design.md`.
- Known limit: a ledger-only version whose file exists in a **sibling worktree** is reported as
  unmerged parallel work, not drift — necessary to stop the shared-DEV false positive from disabling
  the gate, and safe because that DDL is in git.
- Not automated in CI: `.env.prod.local` is gitignored, so a workflow needs `DEV_SUPABASE_DB_URL` as
  a repository secret. Deliberately deferred.
- Open follow-up: audit the other definer functions added around 2026-07-24 for the same missed ACL.
```

- [ ] **Step 3: Prove the check catches real drift on DEV (the acceptance test)**

This is the developer verification path — it deliberately creates the gotcha-57 condition on the DEV database, proves detection, and cleans up. The probe version `29990101000000` is chosen so it can never collide with a real stamp and always sorts last. `statements` and `name` are nullable, so a two-column insert is enough.

Inject via the `supabase-dev` MCP `execute_sql` (or `psql "$DEV_SUPABASE_DB_URL" -c`):

```sql
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('29990101000000', 'ledger_drift_probe', array['select 1']);
```

Then:

```bash
pnpm db:ledger-check; echo "rc=$?"
```

Expected: `✗ MIGRATION LEDGER DRIFT (gotcha-57) — DEV has 1 applied migration(s) with NO committed file:` listing `29990101000000`, then the backfill instructions, `rc=2`.

Prove `--show-ddl` recovers the DDL:

```bash
node scripts/check-migration-ledger.mjs --env dev --show-ddl 2>&1 | grep -A3 "29990101000000 --"
```

Expected: the probe's `name` and `select 1` printed.

**Clean up — do this before anything else, and confirm it:**

```sql
delete from supabase_migrations.schema_migrations where version = '29990101000000';
```

```bash
pnpm db:ledger-check; echo "rc=$?"     # expect ✓ … rc=0
```

If `rc` is not 0 after the delete, **stop and report** — the DEV ledger is in an unexpected state; do not proceed to the merge.

- [ ] **Step 4: Run all four gates**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four pass. Per `superpowers:verification-before-completion`, paste the real output; do not claim green without it.

- [ ] **Step 5: Commit**

```bash
git add vault/decisions/00-gotcha-index.md vault/decisions/2026-07-25-gotcha-57-dev-applied-migration-with-no-committed-file.md
git status --short   # confirm only vault paths remain unstaged-clean
git commit -m "docs(vault): close gotcha-57's automation follow-up"
```

- [ ] **Step 6: Finish the task**

```bash
scripts/finish-task.sh
```

The run now exercises the new gate on itself: expect `→ checking migration hygiene (files ↔ DEV ledger)…` followed by `✓ migration ledger in sync …` before `→ syncing generated changelog`. If it instead prints the exit-3 warning, note that in the closing report — the merge is still valid, but the drift check did not actually run.

---

## How to test (developer verification path)

**This change is developer tooling — there is no user-facing behavior to test.** The acceptance path is a deliberate drift injection on the DEV database, proven caught, then reverted. Run it from the main checkout after `develop` is pulled.

1. `cd /Users/danijeljovanovic/Dev/Monolith && git pull origin develop`
2. **Baseline.** Run `pnpm db:ledger-check`. Expect `✓ migration ledger in sync with supabase/migrations (N files, N DEV ledger rows)` and exit 0 (`echo $?`).
3. **Inject the gotcha-57 condition on DEV.** Via the `supabase-dev` MCP `execute_sql`:
   `insert into supabase_migrations.schema_migrations (version, name, statements) values ('29990101000000', 'ledger_drift_probe', array['select 1']);`
4. **Prove detection.** Run `pnpm db:ledger-check`. Expect the `✗ MIGRATION LEDGER DRIFT (gotcha-57)` banner naming `29990101000000`, the "`db push` reads FILES … it is lost" explanation, the backfill instruction, and exit code 2.
5. **Prove DDL recovery.** Run `node scripts/check-migration-ledger.mjs --env dev --show-ddl`. Expect `ledger_drift_probe` and `select 1` printed under the version heading — the retrieval gotcha-57 prescribes, without hand-writing SQL.
6. **Prove the merge gate blocks.** From any live task worktree (or a throwaway one via `scripts/start-task.sh drift-probe`), run `scripts/finish-task.sh`. Expect it to stop right after `→ checking migration hygiene (files ↔ DEV ledger)…` with `error: migration hygiene check failed (exit 2)` — **before** typecheck/lint/test/build, so it costs seconds. Nothing is merged.
7. **Clean up (required).** Via `supabase-dev` `execute_sql`:
   `delete from supabase_migrations.schema_migrations where version = '29990101000000';`
   Re-run `pnpm db:ledger-check` and confirm `✓ … in sync`, exit 0. If you created a throwaway worktree in step 6, remove it: `git worktree remove .claude/worktrees/drift-probe && git branch -D task/drift-probe`.
8. **Prove graceful degradation.** Run
   `DEV_SUPABASE_DB_URL='postgresql://nobody:nobody@127.0.0.1:1/none' node scripts/check-migration-ledger.mjs --env dev; echo $?`.
   Expect `!! could not check the DEV migration ledger`, a reason line, and exit 3 — returning immediately, not after a long hang. This is the code `finish-task.sh` treats as a warning, so an unreachable database can never wedge a merge.
9. **Prove the pending direction is only a warning.** Run
   `touch supabase/migrations/29990102000000_pending_probe.sql && pnpm db:ledger-check; echo $?`.
   Expect a `· note: 1 committed migration(s) not yet applied to DEV: 29990102000000` line, `✓ … in sync`, and exit **0** — a file without a ledger row is normal mid-task. Then
   `rm supabase/migrations/29990102000000_pending_probe.sql`.
10. **Prove the moved gotcha-43 guard still fires.** Run
    `V=$(ls supabase/migrations | head -1 | cut -c1-14); touch "supabase/migrations/${V}_dup_probe.sql"; pnpm db:ledger-check; echo $?`.
    Expect the duplicate-prefix error listing both files and exit 1. Then
    `rm "supabase/migrations/${V}_dup_probe.sql"` and confirm `git status --short supabase/migrations` is empty.

Record the same walkthrough in the `/wrapup` session note under a "How to test" heading.
