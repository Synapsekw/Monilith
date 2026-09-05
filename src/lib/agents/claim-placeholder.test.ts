import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLAIM_PLACEHOLDER } from "./run-status";

/**
 * A byte-identical contract between SQL and TypeScript, guarded because
 * nothing else can guard it.
 *
 * `agent_run_claim` writes the placeholder into `user_agent_runs.error` as the
 * claim itself: the row exists, consumes its budget and cannot be
 * double-claimed, and only `finalizeRun` rewrites it. The UI decodes "claimed
 * but never finalised" by comparing that column with `CLAIM_PLACEHOLDER` using
 * `===`. So a drifted byte on either side does NOT fail a typecheck, a lint or
 * any behavioural test — it silently reclassifies every crashed run as an
 * ordinary model error, which is a different thing to tell an owner and a
 * different thing to do about it.
 *
 * The test reads the migration FILE rather than the database on purpose: it
 * has to run in the ordinary `pnpm test` gate, with no credentials and no
 * network, on the same commit that carries both sides of the contract.
 */
describe("agent_run_claim", () => {
  it("inserts the exact CLAIM_PLACEHOLDER string the UI decodes", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    const file = readdirSync(dir).find((f) =>
      f.endsWith("_agent_run_graph.sql"),
    );
    expect(file, "the run-graph migration must exist").toBeDefined();

    const sql = readFileSync(join(dir, file!), "utf8");
    expect(sql).toContain("create or replace function public.agent_run_claim(");
    expect(sql).toContain(`'${CLAIM_PLACEHOLDER}'`);
  });
});
