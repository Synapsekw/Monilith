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

  // ── I3: purging a board must not destroy other people's conversations ────
  describe("board_id degrades rather than cascades", () => {
    const fkFix = readMigrationNamed("_board_thread_board_fk_set_null.sql");

    it("re-points the board_id FK at ON DELETE SET NULL", () => {
      // purgeBoard is an OWNER-ONLY hard delete of an archived board, and every
      // member's docked threads hang off it — including private ones the board
      // owner has never been able to read. CASCADE would delete those
      // conversations and their messages, performed by someone else entirely.
      expect(fkFix).toMatch(
        /drop constraint\s+ai_conversations_board_id_fkey/i,
      );
      expect(fkFix).toMatch(
        /foreign key\s*\(\s*board_id\s*\)\s*references\s+public\.boards\s*\(\s*id\s*\)\s*on delete set null/i,
      );
    });

    it("leaves the LAST word on that FK as set null across the whole corpus", () => {
      // Ordering matters more than presence: the board_threads migration
      // created it as CASCADE, so what protects the data is that nothing after
      // this one re-hardens it.
      const decls = [
        ...corpus.matchAll(
          /board_id\s+uuid\s+references\s+public\.boards[^,;]*|constraint\s+ai_conversations_board_id_fkey[\s\S]{0,160}?on delete \w+(\s+\w+)?/gi,
        ),
      ].map((m) => m[0]);
      expect(decls.length).toBeGreaterThan(1);
      expect(decls.at(-1)!.toLowerCase()).toContain("on delete set null");
    });
  });
});
