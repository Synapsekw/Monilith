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

/**
 * Drop `--` line comments, so an assertion binds to the DDL and not to the
 * prose above it.
 *
 * These migrations explain the delete actions they did NOT choose, by name:
 * the fk-fix file's header says "ON DELETE CASCADE" while its SQL says SET
 * NULL, and the coupling file's header names both SET NULL forms. A regex over
 * the raw text therefore reads the argument instead of the conclusion —
 * failing on correct SQL, or passing vacuously on a comment. Same precedent as
 * account-deletion-rpc-coverage.test.ts.
 */
function sqlOnly(migration: string): string {
  return migration.replace(/--[^\n]*/g, "");
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

    it("leaves the LAST word on the OLD FK as set null before it is superseded", () => {
      // Scoped to the fk-fix migration itself. The corpus-wide ordering claim
      // now belongs to ai_conversations_board_org_fkey (next describe block):
      // the board_org_coupling migration DROPS this constraint, so a corpus-wide
      // regex for it would match the drop statement and mean nothing.
      expect(fkFix).toMatch(
        /add constraint\s+ai_conversations_board_id_fkey[\s\S]{0,200}?on delete set null/i,
      );
      expect(sqlOnly(fkFix)).not.toMatch(/on delete cascade/i);
    });
  });

  // ── the board's org IS the thread's org ─────────────────────────────────
  describe("board_id is coupled to org_id by a composite foreign key", () => {
    // Bind to the DDL, not to the prose — see sqlOnly(). The bare-SET-NULL
    // guard below is the case that makes this mandatory: this migration's
    // header argues about the bare form by name, so scanning the raw file
    // would fail the guard on perfectly correct SQL.
    const coupling = sqlOnly(
      readMigrationNamed("_board_thread_org_coupling.sql"),
    );

    it("makes boards (id, org_id) addressable by a foreign key", () => {
      // A foreign key must reference a UNIQUE INDEX over exactly its referenced
      // column list. boards.id is already unique, but (id, org_id) is not
      // addressable without this.
      expect(coupling).toMatch(
        /add constraint\s+boards_id_org_key\s+unique\s*\(\s*id\s*,\s*org_id\s*\)/i,
      );
    });

    it("replaces the single-column board FK rather than adding a second one", () => {
      // Two FKs from ai_conversations to boards would make PostgREST embeds
      // ambiguous and fire two RI actions per board delete for one guarantee.
      expect(coupling).toMatch(
        /drop constraint\s+ai_conversations_board_id_fkey/i,
      );
      expect(coupling).toMatch(
        /add constraint\s+ai_conversations_board_org_fkey[\s\S]{0,240}?foreign key\s*\(\s*board_id\s*,\s*org_id\s*\)\s*references\s+public\.boards\s*\(\s*id\s*,\s*org_id\s*\)/i,
      );
    });

    it("nulls ONLY board_id on board delete, never the NOT NULL org_id", () => {
      expect(coupling).toMatch(/on delete set null\s*\(\s*board_id\s*\)/i);
    });

    it("never uses the bare SET NULL form, which would null org_id", () => {
      // THE failure this file exists to prevent: a bare `on delete set null` on
      // a COMPOSITE key nulls every referencing column. org_id is NOT NULL, so
      // purgeBoard would start failing with a not-null violation on every purge
      // of a board that has docked threads.
      const bare = [...coupling.matchAll(/on delete set null(?!\s*\()/gi)];
      expect(
        bare.map((m) => m[0]),
        "a bare `on delete set null` on the composite FK would null org_id",
      ).toEqual([]);
    });

    it("never lets a later migration drop the coupling", () => {
      expect(corpus).not.toMatch(
        /drop constraint\s+ai_conversations_board_org_fkey/i,
      );
      expect(corpus).not.toMatch(/drop constraint\s+boards_id_org_key/i);
    });

    it("never re-adds a single-column boards(id) FK afterwards", () => {
      // Ordering, not presence: what protects the invariant is that nothing
      // after this migration re-weakens it back to board_id alone.
      const idx = corpus.indexOf("ai_conversations_board_org_fkey");
      expect(idx).toBeGreaterThan(-1);
      expect(corpus.slice(idx)).not.toMatch(
        /add constraint\s+ai_conversations_board_id_fkey[\s\S]{0,240}?foreign key\s*\(\s*board_id\s*\)/i,
      );
    });
  });
});
