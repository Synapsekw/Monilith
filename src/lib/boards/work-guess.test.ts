import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  guessDueColumn,
  guessStatusColumn,
  looksBaselineName,
  looksDueName,
  looksDoneLabel,
  looksStartName,
  WORK_GUESS_SQL,
} from "./work-guess";

type Col = { id: string; name: string; kind: string; position: number };

const date = (id: string, name: string, position: number): Col => ({
  id,
  name,
  kind: "date",
  position,
});

describe("looksDoneLabel", () => {
  it.each([
    ["Done", true],
    ["done", true],
    ["Completed", true],
    ["Complete", true],
    ["Cancelled", true],
    ["Canceled", true],
    ["Done (approved)", true],
    ["Working", false],
    ["Shipped", false],
    ["Stuck", false],
    ["Incomplete", false],
    ["In-complete", false],
    ["Not done", false],
    ["not  done", false],
    ["Not-done", false],
    ["Not complete", false],
    ["Not completed", false],
    ["Undone", false],
    ["Un-done", false],
    ["Uncomplete", false],
    ["Uncompleted", false],
    ["In complete", false],
    ["in  complete", false],
    ["Notdone", false],
    ["Rerun done", true],
  ])("%s -> %s", (label, expected) => {
    expect(looksDoneLabel(label)).toBe(expected);
  });

  it("treats a missing label as open", () => {
    expect(looksDoneLabel(null)).toBe(false);
    expect(looksDoneLabel(undefined)).toBe(false);
    expect(looksDoneLabel("")).toBe(false);
  });
});

describe("looksDueName / looksStartName", () => {
  it.each([
    ["Due", true],
    ["Due date", true],
    ["due", true],
    ["End date", true],
    ["Deadline", true],
    ["Target date", true],
    ["Finish", true],
    ["Calendar", false],
    ["Pending", false],
    ["Vendor", false],
    ["Weekend", false],
    ["Start", false],
    ["Date", false],
    ["due_date", true],
    ["end_date", true],
    ["Due2", true],
    ["(due)", true],
    ["Backend", false],
    ["Friend", false],
    ["Trend", false],
    ["édue", false],
  ])("due-like %s -> %s", (name, expected) => {
    expect(looksDueName(name)).toBe(expected);
  });

  it.each([
    ["Start", true],
    ["Start date", true],
    ["Begin", true],
    ["Kickoff", true],
    ["Created", true],
    ["Restart", false],
    ["Due", false],
    ["start_date", true],
  ])("start-like %s -> %s", (name, expected) => {
    expect(looksStartName(name)).toBe(expected);
  });

  it.each([
    ["Original due", true],
    ["Baseline end", true],
    ["Planned finish", true],
    ["Initial deadline", true],
    ["Previous due", true],
    ["Old due", true],
    ["original_due", true],
    ["Due", false],
    ["Golden", false],
    ["Bold due", false],
    ["Replanned", false],
  ])("baseline-like %s -> %s", (name, expected) => {
    expect(looksBaselineName(name)).toBe(expected);
  });
});

describe("guessDueColumn", () => {
  it("prefers a due-like name over a lower-position start column", () => {
    const cols = [date("a", "Start", 1), date("b", "Due date", 5)];
    expect(guessDueColumn(cols)?.id).toBe("b");
  });

  it("does not prefer a Calendar column just because it contains 'end'", () => {
    const cols = [date("a", "Calendar", 1), date("b", "Deadline", 7)];
    expect(guessDueColumn(cols)?.id).toBe("b");
    const noDue = [date("a", "Start", 1), date("b", "Calendar", 7)];
    expect(guessDueColumn(noDue)?.id).toBe("b");
  });

  it("puts start-like names after neutral ones", () => {
    const cols = [date("a", "Kickoff", 1), date("b", "Milestone", 9)];
    expect(guessDueColumn(cols)?.id).toBe("b");
  });

  it("ranks a baseline due date after the live one, whatever the position", () => {
    const cols = [date("a", "Original due", 1), date("b", "Due", 3)];
    expect(guessDueColumn(cols)?.id).toBe("b");
  });

  it("ranks a baseline due date after a neutral date but before Start", () => {
    const cols = [
      date("s", "Start", 0),
      date("o", "Original due", 1),
      date("m", "Milestone", 5),
    ];
    expect(guessDueColumn(cols)?.id).toBe("m");
    expect(guessDueColumn([cols[0], cols[1]])?.id).toBe("o");
  });

  it("falls back to a lone Original due column", () => {
    expect(guessDueColumn([date("a", "Original due", 4)])?.id).toBe("a");
  });

  it("matches snake_case names", () => {
    const cols = [date("a", "Calendar", 1), date("b", "due_date", 5)];
    expect(guessDueColumn(cols)?.id).toBe("b");
  });

  it("falls back to a lone Start column", () => {
    expect(guessDueColumn([date("a", "Start", 3)])?.id).toBe("a");
  });

  it("breaks ties by position, then id", () => {
    const cols = [
      date("c", "Due 2", 4),
      date("b", "Due", 2),
      date("a", "End", 2),
    ];
    expect(guessDueColumn(cols)?.id).toBe("a");
  });

  it("ignores columns that are not date columns", () => {
    const cols: Col[] = [
      { id: "s", name: "Due", kind: "status", position: 0 },
      date("d", "Start", 3),
    ];
    expect(guessDueColumn(cols)?.id).toBe("d");
    expect(guessDueColumn([cols[0]])).toBeUndefined();
  });
});

describe("guessStatusColumn", () => {
  it("takes the lowest-position status column, then id", () => {
    const cols: Col[] = [
      { id: "z", name: "Priority", kind: "status", position: 2 },
      { id: "y", name: "Status", kind: "status", position: 1 },
      { id: "x", name: "Review", kind: "status", position: 1 },
      date("d", "Due", 0),
    ];
    expect(guessStatusColumn(cols)?.id).toBe("x");
  });
});

// ---------------------------------------------------------------------------
// Parity with SQL. public.item_facts carries its own copy of these rules (the
// view cannot import TypeScript). Two ties, both of which turn red on drift:
//  1. the latest item_facts migration (comments stripped) contains the exact
//     done expression and the exact due-column ORDER BY built from
//     WORK_GUESS_SQL, operators and asc/desc included;
//  2. PARITY below is the one table of expected outcomes. The TS guess must
//     produce each one, and scripts/sql/verify-item-facts.sql must carry a
//     `-- parity:` marker for each case whose next IF asserts that same
//     outcome. Due cases are recomputed from the script's own column inserts.
// ---------------------------------------------------------------------------
const ROOT = path.resolve(__dirname, "../../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const VERIFY_PATH = path.join(ROOT, "scripts/sql/verify-item-facts.sql");

/** Expected outcomes, shared by the TS assertions and the verify script. */
const PARITY = {
  labels: [
    ["Done", "done"],
    ["Completed", "done"],
    ["Cancelled", "done"],
    ["Working", "open"],
    ["Shipped", "open"],
    ["Incomplete", "open"],
    ["Not done", "open"],
    ["In complete", "open"],
  ],
  /** Fixture board variable -> name of the date column the guess must pick. */
  due: [
    ["v_board", "Due"],
    ["v_board3", "Due date"],
    ["v_board4", "Calendar"],
    ["v_board5", "Start"],
    ["v_board6", "Due"],
    ["v_board7", "Original due"],
    ["v_board8", "due_date"],
  ],
} as const;

const stripSqlComments = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
const squash = (sql: string) => sql.replace(/\s+/g, " ").trim();

function latestItemFactsMigration(): string {
  const defines = /create\s+(or\s+replace\s+)?view\s+public\.item_facts\b/i;
  const hits = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) =>
      stripSqlComments(readFileSync(path.join(MIGRATIONS, f), "utf8")),
    )
    .filter((sql) => defines.test(sql));
  const last = hits.at(-1);
  if (!last) throw new Error("no item_facts view migration found");
  return squash(last);
}

/** The IF condition that follows a `-- parity:` marker line. */
function assertionAfter(sql: string, marker: string): string {
  const at = sql.indexOf(marker);
  if (at < 0) throw new Error(`verify script lacks marker: ${marker}`);
  const rest = stripSqlComments(sql.slice(at + marker.length));
  const m = /\bif\b([\s\S]*?)\bthen\b/i.exec(rest);
  if (!m) throw new Error(`no IF after marker: ${marker}`);
  return squash(m[1]);
}

/** Date columns per fixture board, read from the verify script's inserts. */
function dateColumnsByBoard(sql: string) {
  const re = /\((v_\w+), v_org, (v_\w+), '([^']*)', 'date', (\d+), '\{\}'\)/g;
  const out = new Map<string, Col[]>();
  for (const [, id, board, name, pos] of sql.matchAll(re)) {
    const list = out.get(board) ?? [];
    list.push(date(id, name, Number(pos)));
    out.set(board, list);
  }
  return out;
}

function markers(sql: string, kind: "label" | "due"): string[] {
  const re = new RegExp(`^\\s*-- parity: ${kind} .*$`, "gm");
  return [...sql.matchAll(re)].map((m) => m[0].trim()).sort();
}

describe("parity with public.item_facts", () => {
  const VERIFY_SQL = readFileSync(VERIFY_PATH, "utf8");
  const S = WORK_GUESS_SQL;

  it("the view's done expression is exactly the shared patterns", () => {
    expect(latestItemFactsMigration()).toContain(
      squash(`else so.label ~* '${S.doneLabel}'
               and so.label !~* '${S.notDoneLabel}'
             end, false ) as is_done`),
    );
  });

  it("the view's due-column order is exactly the shared ranking", () => {
    expect(latestItemFactsMigration()).toContain(
      squash(`and c.kind = 'date'
        and (b.work_due_column_id is null or c.id = b.work_due_column_id)
        order by
          coalesce(c.name ~* '${S.dueName}' and c.name !~* '${S.baselineName}', false) desc,
          coalesce(c.name ~* '${S.startName}', false) asc,
          coalesce(c.name ~* '${S.baselineName}', false) asc,
          c.position asc, c.id asc
        limit 1`),
    );
  });

  it("the verify script carries exactly the shared label cases", () => {
    expect(markers(VERIFY_SQL, "label")).toEqual(
      PARITY.labels
        .map(([label, outcome]) => `-- parity: label "${label}" => ${outcome}`)
        .sort(),
    );
  });

  it.each(PARITY.labels)("label %s => %s", (label, outcome) => {
    expect(looksDoneLabel(label)).toBe(outcome === "done");
    expect(VERIFY_SQL).toContain(`"label":"${label}"`);
    const cond = assertionAfter(
      VERIFY_SQL,
      `-- parity: label "${label}" => ${outcome}`,
    );
    expect(cond).toContain(`r.status_label is distinct from '${label}'`);
    expect(cond).toContain(`r.is_done is distinct from ${outcome === "done"}`);
  });

  it("the verify script carries exactly the shared due cases", () => {
    expect(markers(VERIFY_SQL, "due")).toEqual(
      PARITY.due
        .map(([board, name]) => `-- parity: due ${board} => "${name}"`)
        .sort(),
    );
  });

  it.each(PARITY.due)("due guess on %s => %s", (board, name) => {
    const columns = dateColumnsByBoard(VERIFY_SQL).get(board) ?? [];
    const picked = guessDueColumn(columns);
    expect(picked?.name).toBe(name);
    const cond = assertionAfter(
      VERIFY_SQL,
      `-- parity: due ${board} => "${name}"`,
    );
    expect(cond).toContain(`r.due_column_id is distinct from ${picked?.id}`);
  });
});
