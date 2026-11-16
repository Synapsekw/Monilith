import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { KPI_ITEM_KINDS } from "./types";

// ---------------------------------------------------------------------------
// The drill-down's number equals the card's number BY CONSTRUCTION: both read
// public._folder_item_flags (which reads public._work_item_flags, the one
// rule), and each list's predicate in folder_kpi_items is the SAME TEXT as
// folder_rollup's filter for that column. These tests turn red when a later
// migration changes one side and not the other, restates the done / due rule,
// drops a permission check, or lets the dry-run script drift from the
// migration it previews. The numbers on live data are checked by
// scripts/sql/dry-run-folder-drilldown.sql.
// ---------------------------------------------------------------------------
const ROOT = path.resolve(__dirname, "../../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const MIGRATION_FILE = "20261116112338_folder_drilldown.sql";
const DRY_RUN = path.join(ROOT, "scripts/sql/dry-run-folder-drilldown.sql");

const stripSqlComments = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
const squash = (sql: string) => sql.replace(/\s+/g, " ").trim();

const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const read = (f: string) => readFileSync(path.join(MIGRATIONS, f), "utf8");

/** Body of the LATEST definition of `public.<name>` across all migrations. */
function latestBody(name: string) {
  const re = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\([^$]*?\\$(\\w*)\\$([\\s\\S]*?)\\$\\1\\$`,
    "gi",
  );
  let last: string | null = null;
  for (const f of files) {
    for (const m of stripSqlComments(read(f)).matchAll(re)) last = m[2] ?? "";
  }
  if (last === null) throw new Error(`no definition of public.${name} found`);
  return squash(last);
}

const NEW_FUNCTIONS = [
  "folder_kpi_items",
  "folder_attention_page",
  "folder_rollup_packed",
  "folder_workload_packed",
] as const;

/** `when '<kind>' then (<predicate>)` branches of folder_kpi_items. */
function drillPredicates(): Map<string, string> {
  const body = latestBody("folder_kpi_items");
  const from = body.indexOf("case p_kpi");
  const to = body.indexOf(" end ), ranked as", from);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  const out = new Map<string, string>();
  const branches = body
    .slice(from, to)
    .split(/\bwhen '/)
    .slice(1);
  for (const b of branches) {
    const m = /^(\w+)' then (.*)$/.exec(b.trim());
    if (!m) throw new Error(`unreadable branch: ${b}`);
    out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

describe("folder drill-down: SQL", () => {
  it("the helpers really read bodies (the checks below are not vacuous)", () => {
    expect(latestBody("folder_kpi_items").length).toBeGreaterThan(800);
    expect(latestBody("folder_rollup")).toContain("count(f.item_id) filter");
    expect(drillPredicates().size).toBe(KPI_ITEM_KINDS.length);
  });

  it("offers exactly the lists the app can ask for", () => {
    expect([...drillPredicates().keys()].sort()).toEqual(
      [...KPI_ITEM_KINDS].sort(),
    );
    const body = latestBody("folder_kpi_items");
    for (const k of KPI_ITEM_KINDS) expect(body).toContain(`'${k}'`);
  });

  it.each(KPI_ITEM_KINDS.filter((k) => k !== "total"))(
    "%s: the list's predicate is folder_rollup's filter for that column, word for word",
    (kind) => {
      const pred = drillPredicates().get(kind)!;
      expect(pred.startsWith("(") && pred.endsWith(")")).toBe(true);
      const inner = pred.slice(1, -1);
      // The same text, as a count filter, in the latest folder_rollup.
      expect(latestBody("folder_rollup")).toContain(
        `count(f.item_id) filter (where ${inner})::int`,
      );
    },
  );

  it("every rollup count column has a list, and 'total' takes every item", () => {
    const filters = latestBody("folder_rollup").match(
      /count\(f\.item_id\) filter \(where /g,
    );
    // 12 filtered counts + the unfiltered total = the 13 lists.
    expect(filters).toHaveLength(KPI_ITEM_KINDS.length - 1);
    expect(drillPredicates().get("total")).toBe("true");
  });

  it("both sides count the same per-item flags", () => {
    for (const name of ["folder_kpi_items", "folder_attention_page"])
      expect(latestBody(name)).toContain(
        "public._folder_item_flags(p_folder_id)",
      );
    expect(latestBody("folder_rollup")).toContain(
      "public._folder_item_flags(p_folder_id)",
    );
    expect(latestBody("_folder_item_flags")).toContain(
      "public._work_item_flags(",
    );
  });

  it("the attention page classifies exactly as folder_attention does, and filters BEFORE the limit", () => {
    const page = latestBody("folder_attention_page");
    const old = latestBody("folder_attention");
    const reasons = (b: string) => {
      const from = b.indexOf("reasons as (");
      const to = b.indexOf(
        "or f.last_touched < now() - interval '14 days' ) )",
      );
      expect(from).toBeGreaterThan(-1);
      expect(to).toBeGreaterThan(from);
      return b.slice(from, to);
    };
    expect(reasons(page)).toBe(reasons(old));
    // Same order as the old function.
    expect(page).toContain(
      "order by h.severity desc, h.age_days desc, h.item_name asc, h.item_id asc",
    );
    expect(old).toContain(
      "order by r.severity desc, r.age_days desc, r.item_name asc, r.item_id asc",
    );
    // The three filters sit in `hit`; the rows are cut from `ranked`, after.
    const hit = page.indexOf("hit as materialized");
    const cut = page.indexOf(
      "r.ord > v_offset and r.ord <= v_offset + v_limit",
    );
    for (const f of [
      "(p_board_id is null or r.board_id = p_board_id)",
      "(p_stage_key is null or lower(trim(r.group_name)) = p_stage_key)",
      "(p_reason is null or r.reason = p_reason)",
    ]) {
      const at = page.indexOf(f);
      expect(at).toBeGreaterThan(hit);
      expect(at).toBeLessThan(cut);
    }
    // The total counts every match, not the page.
    expect(page).toContain("'total', (select count(*) from hit)");
  });

  it("pages are bounded and deterministic", () => {
    for (const name of ["folder_kpi_items", "folder_attention_page"]) {
      const body = latestBody(name);
      expect(body).toMatch(
        /v_limit integer := least\(greatest\(coalesce\(p_limit, \d+\), 1\), 100\)/,
      );
      expect(body).toContain("greatest(coalesce(p_offset, 0), 0)");
      // The order ends in the item id, so two pages never share a row.
      expect(body).toMatch(/h\.item_id asc \) as ord/);
    }
    for (const name of ["folder_rollup_packed", "folder_workload_packed"])
      expect(latestBody(name)).toContain("r.ord <= 5000");
  });

  it.each(NEW_FUNCTIONS)(
    "%s: definer with an empty search_path, folder check first, not for anon or public",
    (name) => {
      const sql = squash(stripSqlComments(read(MIGRATION_FILE)));
      const def = new RegExp(
        `create function public\\.${name}\\(([^$]*?)\\) returns jsonb language plpgsql stable security definer set search_path = '' as \\$\\$`,
      ).exec(sql);
      expect(def).not.toBeNull();
      const body = latestBody(name);
      const begin = body.indexOf("begin ");
      expect(
        body
          .slice(begin)
          .startsWith(
            "begin perform public._assert_folder_member(p_folder_id);",
          ),
      ).toBe(true);
      const args = def![1]!
        .split(",")
        .map((a) => a.trim().split(/\s+/)[1])
        .join(", ");
      expect(sql).toContain(
        `revoke execute on function public.${name}(${args}) from public, anon;`,
      );
      expect(sql).toContain(
        `grant execute on function public.${name}(${args}) to authenticated, service_role;`,
      );
    },
  );

  it.each(NEW_FUNCTIONS)(
    "%s does not restate the done / due rule or use the database's date",
    (name) => {
      const body = latestBody(name);
      for (const text of [
        "done|complete",
        "due|deadline",
        "work_done_option_ids",
        "work_due_column_id",
        "work_status_column_id",
      ])
        expect(body).not.toContain(text);
      expect(body).not.toMatch(/\bcurrent_date\b/i);
    },
  );

  it("changes nothing that exists: only CREATE FUNCTION, REVOKE and GRANT", () => {
    const sql = stripSqlComments(read(MIGRATION_FILE)).replace(
      /\$(\w*)\$[\s\S]*?\$\1\$/g,
      "$$body$$",
    );
    const statements = sql
      .split(";")
      .map((s) => squash(s))
      .filter((s) => s.length > 0);
    for (const s of statements)
      expect(s).toMatch(
        /^(create function public\.\w+|revoke execute on function public\.\w+|grant execute on function public\.\w+)/,
      );
    expect(
      statements.filter((s) => s.startsWith("create function")),
    ).toHaveLength(NEW_FUNCTIONS.length);
    expect(sql).not.toMatch(/\b(drop|alter|create or replace)\b/i);
  });
});

describe("dry-run script", () => {
  const script = readFileSync(DRY_RUN, "utf8");
  const BEGIN = "-- >>> MIGRATION BODY BEGIN\n";
  const END = "-- <<< MIGRATION BODY END\n";

  it("includes the migration verbatim", () => {
    const from = script.indexOf(BEGIN);
    const to = script.indexOf(END);
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    // Re-copy the migration into the script when this fails.
    expect(script.slice(from + BEGIN.length, to)).toBe(read(MIGRATION_FILE));
  });

  it("checks every list, and always ends by raising (so nothing is kept)", () => {
    for (const k of KPI_ITEM_KINDS) expect(script).toContain(`'${k}'`);
    expect(script.trimEnd().endsWith("$report$;")).toBe(true);
    expect(script).toContain("raise exception 'FOLDER_DRILLDOWN %'");
    expect(script.indexOf("do $report$")).toBeGreaterThan(script.indexOf(END));
  });

  it("has no transaction control of its own", () => {
    const outside = stripSqlComments(script).replace(
      /\$(\w*)\$[\s\S]*?\$\1\$/g,
      " ",
    );
    expect(outside).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });
});
