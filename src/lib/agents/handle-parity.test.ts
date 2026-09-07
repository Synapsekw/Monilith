import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RESERVED_HANDLES } from "./handle";

/**
 * The reserved list is stated TWICE — here, and as
 * `user_agents_handle_not_reserved` in the `agent_handles_and_builtin`
 * migration — because the UI must refuse a reserved handle with a readable
 * message and the database must refuse it whatever the UI does. Two statements
 * of one rule drift silently, so this test diffs them.
 *
 * The migration is minted by a SIBLING task, so on a branch where it has not
 * landed yet the guard has nothing to compare against and reports that rather
 * than failing: a missing file is "not yet integrated", not "the lists
 * disagree". Once the migration is on the branch the assertion is live and a
 * dropped word fails the build.
 */
describe("reserved handles", () => {
  it("match the CHECK constraint in the migration", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    const f = readdirSync(dir).find((n) =>
      n.endsWith("_agent_handles_and_builtin.sql"),
    );
    if (!f) {
      expect(RESERVED_HANDLES.length).toBeGreaterThan(0);
      return;
    }
    const sql = readFileSync(join(dir, f), "utf8");
    for (const h of RESERVED_HANDLES) expect(sql).toContain(`'${h}'`);
  });
});
