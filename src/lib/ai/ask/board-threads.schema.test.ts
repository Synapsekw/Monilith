import { describe, it, expect } from "vitest";
import { readMigrationSources } from "@/test/anon-conformance";

describe("board threads migration", () => {
  const sql = readMigrationSources().join("\n");

  it("defaults visibility to private so no existing row can match the new policy", () => {
    expect(sql).toMatch(/visibility\s+text\s+not null\s+default\s+'private'/);
  });

  it("constrains visibility to the two known values", () => {
    expect(sql).toMatch(
      /check\s*\(\s*visibility\s+in\s*\(\s*'private'\s*,\s*'board'\s*\)\s*\)/,
    );
  });

  it("adds the shared-read policies additively — nothing is dropped", () => {
    expect(sql).toContain(
      'create policy "ai_conversations_select_board_shared"',
    );
    expect(sql).toContain('create policy "ai_messages_select_board_shared"');
    expect(sql).not.toMatch(/drop policy .*ai_conversations_select_own/);
  });

  it("keys briefing threads by a unique run_id", () => {
    expect(sql).toContain("ai_conversations_run_id_key");
  });
});
