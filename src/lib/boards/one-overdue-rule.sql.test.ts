import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { WORK_GUESS_SQL } from "./work-guess";

// ---------------------------------------------------------------------------
// One rule, one place. The done / due rule text lives in the public.item_facts
// view (twinned by work-guess.ts, pinned by work-guess.test.ts). The health
// widget, the weekly digest and every folder RPC must READ that view through
// public._work_item_flags, never restate the rule. These tests turn red when
// a later migration:
//   * redefines one of those functions without going through the view,
//   * copies the rule text (the guess regexes) into a function again,
//   * brings back bare current_date (the database's zone) for "today",
//   * or lets the dry-run script drift from the migration it previews.
// They also pin the explicit-settings half of the view to `resolveWorkRule`.
// ---------------------------------------------------------------------------
const ROOT = path.resolve(__dirname, "../../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const MIGRATION_FILE = "20261115173751_one_overdue_rule.sql";
const DRY_RUN = path.join(ROOT, "scripts/sql/dry-run-one-overdue-rule.sql");

const stripSqlComments = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
const squash = (sql: string) => sql.replace(/\s+/g, " ").trim();

const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const read = (f: string) => readFileSync(path.join(MIGRATIONS, f), "utf8");

/**
 * Body of the LATEST definition of `public.<name>` across all migrations: a
 * function's dollar-quoted body, or a view's query up to its semicolon.
 */
function latestBody(name: string, kind: "function" | "view" = "function") {
  const re =
    kind === "function"
      ? new RegExp(
          `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\([^$]*?\\$(\\w*)\\$([\\s\\S]*?)\\$\\1\\$`,
          "gi",
        )
      : new RegExp(
          `create\\s+(?:or\\s+replace\\s+)?view\\s+public\\.${name}\\b()([^;]*);`,
          "gi",
        );
  let last: string | null = null;
  for (const f of files) {
    for (const m of stripSqlComments(read(f)).matchAll(re)) last = m[2] ?? "";
  }
  if (last === null) throw new Error(`no definition of public.${name} found`);
  return squash(last);
}

/** The rule text: any of the guess patterns the view owns. */
const RULE_TEXT = [
  WORK_GUESS_SQL.doneLabel,
  "done|complete",
  "due|deadline",
  "work_done_option_ids",
  "work_due_column_id",
  "work_status_column_id",
];

describe("one overdue rule: SQL", () => {
  it("latestBody really returns bodies (the checks below are not vacuous)", () => {
    expect(latestBody("_work_item_flags").length).toBeGreaterThan(500);
    expect(latestBody("folder_burn")).toContain("generate_series");
    expect(latestBody("_org_health_digest")).toContain("return next");
    // The view DOES hold the rule text; the functions must not.
    const view = latestBody("item_facts", "view");
    for (const text of RULE_TEXT) expect(view).toContain(text);
  });

  it("_work_item_flags reads done and the due date from item_facts", () => {
    const body = latestBody("_work_item_flags");
    expect(body).toContain("from public.item_facts f");
    // overdue = open and due before today: the SQL twin of isOverdueOn.
    expect(body).toContain(
      "(not b.is_done and b.due_date is not null and b.due_date < p_today)",
    );
  });

  it("counts top-level items only, so a parent and its subitems never double count", () => {
    expect(latestBody("_work_item_flags")).toContain(
      "join public.items i on i.id = f.item_id and i.parent_id is null",
    );
  });

  it.each(["_board_health_flags", "_folder_item_flags"])(
    "%s is based on _work_item_flags",
    (name) => {
      expect(latestBody(name)).toContain("public._work_item_flags(");
    },
  );

  it.each([
    "_work_item_flags",
    "_board_health_flags",
    "_folder_item_flags",
    "_board_health_counts",
    "_org_health_digest",
    "folder_rollup",
    "folder_attention",
    "folder_workload",
    "folder_gallery",
    "folder_burn",
    "folder_burn_packed",
    "folder_load",
  ])("%s does not restate the rule text", (name) => {
    const body = latestBody(name);
    for (const text of RULE_TEXT) expect(body).not.toContain(text);
  });

  it.each([
    "_work_item_flags",
    "_board_health_flags",
    "_folder_item_flags",
    "folder_rollup",
    "folder_attention",
    "folder_burn",
    "folder_load",
  ])("%s has no bare current_date", (name) => {
    expect(latestBody(name)).not.toMatch(/\bcurrent_date\b/i);
  });

  it("folder due_on and planned_on are the same date: the item's due date", () => {
    const body = latestBody("_folder_item_flags");
    expect(body).toContain("f.due_date as due_on, f.due_date as planned_on");
  });

  it("gap to plan compares dated items on both sides", () => {
    expect(latestBody("folder_rollup")).toContain(
      "count(f.item_id) filter (where f.is_done and f.planned_on is not null)::int",
    );
    expect(latestBody("folder_burn")).toContain(
      "where f.is_done and f.done_on is not null and f.planned_on is not null",
    );
  });

  it("the view's explicit-settings half is what resolveWorkRule mirrors", () => {
    const view = latestBody("item_facts", "view");
    // Done options apply only while a status column is configured too.
    expect(view).toContain(
      squash(`when b.work_status_column_id is not null
               and b.work_done_option_ids is not null
              then (scv.value ->> 'optionId') = any (b.work_done_option_ids)`),
    );
    // A configured column leaves ONE candidate and no fallback to the guess.
    expect(view).toContain(
      "and (b.work_status_column_id is null or c.id = b.work_status_column_id)",
    );
    expect(view).toContain(
      "and (b.work_due_column_id is null or c.id = b.work_due_column_id)",
    );
    // dueDateOf: end when non-empty, else date, cut to the day.
    expect(view).toContain(
      "left(coalesce(nullif(dcv.value ->> 'end', ''), dcv.value ->> 'date'), 10)",
    );
  });

  it("folder_burn is documented as not droppable (folder_burn_packed calls it)", () => {
    expect(latestBody("folder_burn_packed")).toContain(
      "from public.folder_burn(p_folder_id)",
    );
    expect(squash(read(MIGRATION_FILE))).toContain(
      "comment on function public.folder_burn(uuid) is 'Do not drop: folder_burn_packed",
    );
  });
});

describe("dry-run script", () => {
  const script = readFileSync(DRY_RUN, "utf8");
  const BEGIN = "-- >>> MIGRATION BODY BEGIN\n";
  const END = "-- <<< MIGRATION BODY END\n";

  it("includes the migration verbatim between its two measurement halves", () => {
    const from = script.indexOf(BEGIN);
    const to = script.indexOf(END);
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    // Re-copy the migration into the script when this fails.
    expect(script.slice(from + BEGIN.length, to)).toBe(read(MIGRATION_FILE));
  });

  it("measures before the body and again after it, and always ends by raising", () => {
    const before = script.indexOf("select pg_temp._oor_measure('old');");
    const after = script.indexOf("select pg_temp._oor_measure('new');");
    expect(before).toBeGreaterThan(-1);
    expect(before).toBeLessThan(script.indexOf(BEGIN));
    expect(after).toBeGreaterThan(script.indexOf(END));
    expect(script.trimEnd().endsWith("$report$;")).toBe(true);
    expect(script).toContain("raise exception 'ONE_OVERDUE_RULE %'");
  });

  it("has no transaction control of its own", () => {
    const outside = stripSqlComments(script).replace(
      /\$(\w*)\$[\s\S]*?\$\1\$/g,
      " ",
    );
    expect(outside).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });
});
