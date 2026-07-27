import { describe, it, expect } from "vitest";
import { readMigrationSources } from "./anon-conformance";

/**
 * The platform bot ("Monolith Autopilot") is a seeded auth.users + profiles row
 * created by `20260720120517_board_agents.sql`. Two things about it are
 * load-bearing and pull in opposite directions:
 *
 *  - Its **display name** is user-visible — it is stamped as the author on every
 *    board update the agent posts — so it must track the product name.
 *  - Its **email** is the LOOKUP KEY: `platform_agent_user_id()` resolves the row
 *    with `select id from auth.users where email = 'pulse-autopilot@pulse.internal'`.
 *    Renaming it would orphan the identity (the helper returns null, the confined
 *    applier authors as nobody), so the product rename must NOT touch it.
 *
 * These assertions read the migration corpus so the invariant is enforced by the
 * source of truth for the schema, not by a comment.
 */
const BOT_EMAIL = "pulse-autopilot@pulse.internal";

describe("platform agent identity", () => {
  const sources = readMigrationSources();

  it("renames the seeded bot's display name to Monolith Autopilot", () => {
    const sql = sources.join("\n");
    expect(sql).toContain("full_name = 'Monolith Autopilot'");
  });

  it("never changes the email that platform_agent_user_id() looks up", () => {
    const found = new Set(
      sources.flatMap((sql) => sql.match(/[\w.+-]+@pulse\.internal/g) ?? []),
    );
    expect([...found]).toEqual([BOT_EMAIL]);
  });
});
