import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  parseVersionsFromFilenames,
  findDuplicateVersions,
  classifyLedger,
  parseEnvFile,
  normalizePgBin,
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

describe("normalizePgBin", () => {
  it("converts the MSYS drive form to a Windows path on win32", () => {
    assert.equal(
      normalizePgBin("/c/Program Files/PostgreSQL/17/bin", "win32"),
      "C:\\Program Files\\PostgreSQL\\17\\bin",
    );
  });

  it("uppercases the drive letter and handles a bare drive root", () => {
    assert.equal(normalizePgBin("/d/pg/bin", "win32"), "D:\\pg\\bin");
    assert.equal(normalizePgBin("/c", "win32"), "C:");
  });

  it("leaves a value already in Windows form untouched", () => {
    assert.equal(
      normalizePgBin("C:\\Program Files\\PostgreSQL\\17\\bin", "win32"),
      "C:\\Program Files\\PostgreSQL\\17\\bin",
    );
  });

  it("rewrites separators on a Windows-drive path written with slashes", () => {
    assert.equal(
      normalizePgBin("C:/Program Files/PostgreSQL/17/bin", "win32"),
      "C:\\Program Files\\PostgreSQL\\17\\bin",
    );
  });

  it("never rewrites on non-Windows — a leading /c/ there is a real path", () => {
    assert.equal(
      normalizePgBin("/c/Program Files/PostgreSQL/17/bin", "darwin"),
      "/c/Program Files/PostgreSQL/17/bin",
    );
    assert.equal(
      normalizePgBin("/opt/homebrew/bin", "linux"),
      "/opt/homebrew/bin",
    );
  });

  it("passes empty/undefined through so the caller can skip the PATH prefix", () => {
    assert.equal(normalizePgBin("", "win32"), "");
    assert.equal(normalizePgBin(undefined, "win32"), undefined);
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
