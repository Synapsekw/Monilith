import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The runnable half of the spec §3.2 tripwire.
 *
 * `account-deletion-schema.integration.test.ts` asserts the same property against
 * a live catalog, but integration suites SKIP without `.env.test` (the repo's
 * default, so DEV is never polluted) — and a skip is not a pass. This test needs
 * no database: it parses the committed migration that defines
 * `user_delete_reassign_authorship()` and checks its `UPDATE` list against the 13
 * ownership-bearing columns, so a forgotten authorship column fails `pnpm test`
 * on every machine and in CI.
 *
 * The two tests are complementary, not redundant:
 *   - this one  : "does the RPC handle the columns we believe exist?" (no DB)
 *   - the other : "are those still the columns that exist?"           (live DB)
 * Together they cover both directions of drift.
 */

/** `table.column` — must match EXPECTED_REASSIGNED in the integration suite. */
const EXPECTED_REASSIGNED = new Set([
  "attachments.uploaded_by",
  "board_members.granted_by",
  "boards.created_by",
  "dashboards.created_by",
  "goals.created_by",
  "goals.owner_id",
  "item_updates.author_id",
  "items.created_by",
  "member_capacity.created_by",
  "org_invitations.invited_by",
  "organizations.created_by",
  "portfolios.created_by",
  "workspaces.created_by",
]);

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const RPC_NAME = "public.user_delete_reassign_authorship";

/**
 * The newest migration that (re)defines the RPC. Later `create or replace`s win at
 * runtime, so the newest definition is the one that must be correct.
 */
function latestRpcDefinition(): { file: string; body: string } {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const start = sql.indexOf(`create or replace function ${RPC_NAME}(`);
    if (start === -1) continue;
    // The body is dollar-quoted; take everything up to the closing `$$;`.
    const bodyStart = sql.indexOf("$$", start);
    const bodyEnd = sql.indexOf("$$;", bodyStart + 2);
    expect(
      bodyStart !== -1 && bodyEnd !== -1,
      `${file}: could not find the dollar-quoted body of ${RPC_NAME}`,
    ).toBe(true);
    return { file, body: sql.slice(bodyStart + 2, bodyEnd) };
  }
  throw new Error(
    `No migration in ${MIGRATIONS_DIR} defines ${RPC_NAME} — did it get renamed?`,
  );
}

/**
 * Collect `table.column` for every `update public.<table> [alias] set <column> =`
 * in the body. Deliberately structural rather than a per-column regex sweep, so
 * it also catches an UPDATE that targets an unexpected column.
 */
function reassignedColumns(body: string): Set<string> {
  const found = new Set<string>();
  const stripped = body.replace(/--[^\n]*/g, ""); // drop line comments
  const re =
    /\bupdate\s+public\.([a-z_][a-z0-9_]*)(?:\s+[a-z_][a-z0-9_]*)?\s+set\s+([a-z_][a-z0-9_]*)\s*=/gi;
  for (const m of stripped.matchAll(re)) {
    found.add(`${m[1].toLowerCase()}.${m[2].toLowerCase()}`);
  }
  return found;
}

describe("user_delete_reassign_authorship covers every blocking authorship column", () => {
  const { file, body } = latestRpcDefinition();
  const actual = reassignedColumns(body);

  it("parses a non-trivial set of UPDATEs out of the migration", () => {
    // Guards the parser itself: a regex that silently matches nothing would make
    // every assertion below vacuous.
    expect(actual.size, `parsed from ${file}`).toBeGreaterThanOrEqual(
      EXPECTED_REASSIGNED.size,
    );
  });

  for (const column of [...EXPECTED_REASSIGNED].sort()) {
    it(`reassigns ${column}`, () => {
      expect(
        actual.has(column),
        `${file} has no "update public.${column.split(".")[0]} … set ${column.split(".")[1]} =" — ` +
          `deletion will fail on its FK constraint`,
      ).toBe(true);
    });
  }

  it("does not reassign anything unexpected", () => {
    const extra = [...actual].filter((c) => !EXPECTED_REASSIGNED.has(c)).sort();
    expect(
      extra,
      "an UPDATE here that is not a known ownership column — add it to both " +
        "expected lists deliberately, or remove it",
    ).toEqual([]);
  });

  it("hands item_updates.author_id to the platform bot, not to the org owner (decision D2)", () => {
    // D2 is a product decision that is invisible in the column list: both options
    // are an `update public.item_updates set author_id = …`. Pin the principal.
    expect(body).toMatch(/platform_agent_user_id\(\)/);
    expect(body).toMatch(
      /update\s+public\.item_updates\s+t\s+set\s+author_id\s*=\s*v_bot/i,
    );
  });

  it("opens the attribution-freeze escape hatch and closes it again", () => {
    // Without this GUC the items/item_updates UPDATEs are silent no-ops, because
    // two BEFORE UPDATE triggers rewrite attribution back to its old value.
    expect(body).toMatch(
      /set_config\(\s*'pulse\.reassigning_authorship'\s*,\s*'on'\s*,\s*true\s*\)/,
    );
    expect(body).toMatch(
      /set_config\(\s*'pulse\.reassigning_authorship'\s*,\s*''\s*,\s*true\s*\)/,
    );
  });

  it("is gated to the platform admin or the user themselves", () => {
    expect(body).toMatch(/is_platform_admin\(\)/);
    expect(body).toMatch(/p_user_id\s*=\s*\(select auth\.uid\(\)\)/);
    expect(body).toMatch(/raise exception 'not authorized'/);
  });
});
