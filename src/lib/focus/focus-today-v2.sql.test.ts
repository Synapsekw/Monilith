import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Pins the SQL side of the Today list's order and row actions:
//   * the dry-run script previews exactly the migration that will be applied;
//   * the order (due today first, overdue most recent first) is in the SQL,
//     before the limit, so the app never has to classify rows after a cut;
//   * the new function is not left executable by logged-out visitors;
//   * the older function is not redefined, so the build already deployed
//     keeps working until it is replaced.
// ---------------------------------------------------------------------------
const ROOT = path.resolve(__dirname, "../../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const FILE = "20261116112326_focus_today_v2.sql";
const migration = readFileSync(path.join(MIGRATIONS, FILE), "utf8");
const dryRun = readFileSync(
  path.join(ROOT, "scripts/sql/dry-run-focus-today-v2.sql"),
  "utf8",
);

const body = migration.slice(migration.indexOf("create or replace function"));
const squash = (sql: string) =>
  sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const sql = squash(body);

describe("focus_today_v2 migration", () => {
  it("is previewed verbatim by the dry-run script", () => {
    expect(body.length).toBeGreaterThan(1000);
    expect(dryRun).toContain(body);
  });

  it("the dry-run ends by raising its tagged report, so nothing is kept", () => {
    const tail = squash(dryRun.slice(dryRun.indexOf(body) + body.length));
    expect(tail).toMatch(
      /raise exception 'FOCUS_TODAY_V2 %', jsonb_build_object\(/,
    );
    expect(tail).toMatch(/end; \$report\$;$/);
    expect(dryRun).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });

  it("puts due today first and overdue most recent first, before the limit", () => {
    expect(sql).toContain("when c.assigned and c.due_date = p_today then 0");
    expect(sql).toContain("when c.assigned and c.due_date < p_today then 1");
    expect(sql).toContain(
      "when 1 then -(t.due_date - date '2000-01-01')::double precision",
    );
    const order = sql.indexOf("order by t.tier, sk, t.item_id");
    const limit = sql.indexOf(
      "limit least(greatest(coalesce(p_limit, 20), 1), 50)",
    );
    expect(order).toBeGreaterThan(-1);
    expect(limit).toBeGreaterThan(order);
  });

  it("counts every tier before the limit and checks access once per board", () => {
    const counts = sql.indexOf("tier_counts as (");
    const limit = sql.indexOf("limit least(");
    expect(counts).toBeGreaterThan(-1);
    expect(counts).toBeLessThan(limit);
    expect(sql).toContain(
      "select d.board_id, public.can_edit_board(d.board_id) as can_edit from (select distinct r.board_id from ranked r) d",
    );
  });

  it("is security invoker, pins search_path, and is closed to public and anon", () => {
    expect(sql).toContain("security invoker");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain(
      "revoke execute on function public.get_focus_today_v2(uuid, date, uuid, int, int) from public, anon;",
    );
    expect(sql).toContain(
      "grant execute on function public.get_focus_today_v2(uuid, date, uuid, int, int) to authenticated, service_role;",
    );
  });

  it("leaves get_focus_today alone: no migration from this one on redefines or drops it", () => {
    const later = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql") && f >= FILE)
      .map((f) => squash(readFileSync(path.join(MIGRATIONS, f), "utf8")));
    for (const text of later) {
      expect(text).not.toMatch(
        /function (if exists )?public\.get_focus_today\s*\(/,
      );
    }
  });
});
