import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { readMigrationSources } from "@/test/anon-conformance";

/**
 * The column/check assertions must bind to THIS migration's own source, not
 * the whole concatenated corpus — otherwise an unrelated table declaring the
 * same column shape would satisfy the assertion even if ai_conversations
 * never got it.
 */
function readMigrationNamed(
  filenameSuffix: string,
  repoRoot = process.cwd(),
): string {
  const dir = resolve(repoRoot, "supabase/migrations");
  const file = readdirSync(dir).find((f) => f.endsWith(filenameSuffix));
  if (!file) {
    throw new Error(`No migration file ending in "${filenameSuffix}" found`);
  }
  return readFileSync(resolve(dir, file), "utf8");
}

describe("board threads migration", () => {
  const corpus = readMigrationSources().join("\n");
  const boardThreadsSql = readMigrationNamed("_board_threads.sql");

  it("defaults visibility to private on ai_conversations so no existing row can match the new policy", () => {
    expect(boardThreadsSql).toMatch(
      /visibility\s+text\s+not null\s+default\s+'private'/,
    );
  });

  it("constrains visibility to the two known values", () => {
    expect(boardThreadsSql).toMatch(
      /check\s*\(\s*visibility\s+in\s*\(\s*'private'\s*,\s*'board'\s*\)\s*\)/,
    );
  });

  it("adds the shared-read policies additively — nothing is dropped", () => {
    expect(corpus).toContain(
      'create policy "ai_conversations_select_board_shared"',
    );
    expect(corpus).toContain('create policy "ai_messages_select_board_shared"');
    expect(corpus).not.toMatch(/drop policy .*ai_conversations_select_own/);
  });

  it("never lets a later migration drop the new shared-read policies", () => {
    expect(corpus).not.toMatch(
      /drop policy .*ai_conversations_select_board_shared/,
    );
    expect(corpus).not.toMatch(/drop policy .*ai_messages_select_board_shared/);
  });

  it("keys briefing threads by a unique run_id", () => {
    expect(corpus).toContain("ai_conversations_run_id_key");
  });
});
