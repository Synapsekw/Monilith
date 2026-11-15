import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  guessDueColumn,
  guessStatusColumn,
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
  ])("start-like %s -> %s", (name, expected) => {
    expect(looksStartName(name)).toBe(expected);
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
// view cannot import TypeScript). These tests fail when either side drifts:
// the patterns must appear verbatim in the latest item_facts migration, and
// every case below must be one the SQL fixture script also asserts.
// ---------------------------------------------------------------------------
const ROOT = path.resolve(__dirname, "../../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const VERIFY_SQL = readFileSync(
  path.join(ROOT, "scripts/sql/verify-item-facts.sql"),
  "utf8",
);

function latestItemFactsMigration(): string {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const hits = files.filter((f) =>
    readFileSync(path.join(MIGRATIONS, f), "utf8").includes(
      "create or replace view public.item_facts",
    ),
  );
  const last = hits.at(-1);
  if (!last) throw new Error("no item_facts view migration found");
  return readFileSync(path.join(MIGRATIONS, last), "utf8");
}

/** Labels and column names the verify script inserts and asserts on. */
const PARITY = {
  doneLabels: [
    ["Done", true],
    ["Completed", true],
    ["Cancelled", true],
    ["Working", false],
    ["Shipped", false],
    ["Incomplete", false],
    ["Not done", false],
  ] as const,
  /** Date columns on one fixture board, and the column the guess must pick. */
  dueBoard: {
    columns: [
      date("start", "Start", 1),
      date("calendar", "Calendar", 2),
      date("due", "Due date", 6),
    ],
    expected: "due",
  },
  /** A board whose only date columns are Start and Calendar. */
  noDueBoard: {
    columns: [date("start", "Start", 1), date("calendar", "Calendar", 2)],
    expected: "calendar",
  },
  /** A board whose only date column is Start. */
  startOnlyBoard: { columns: [date("start", "Start", 1)], expected: "start" },
};

describe("parity with public.item_facts", () => {
  it("the view uses exactly these patterns", () => {
    const sql = latestItemFactsMigration();
    for (const pattern of Object.values(WORK_GUESS_SQL)) {
      expect(sql).toContain(`'${pattern}'`);
    }
  });

  it.each(PARITY.doneLabels)(
    "done label %s -> %s (asserted in verify-item-facts.sql)",
    (label, expected) => {
      expect(VERIFY_SQL).toContain(`"label":"${label}"`);
      expect(looksDoneLabel(label)).toBe(expected);
    },
  );

  it.each([PARITY.dueBoard, PARITY.noDueBoard, PARITY.startOnlyBoard])(
    "due column guess on $expected board (asserted in verify-item-facts.sql)",
    ({ columns, expected }) => {
      for (const c of columns)
        expect(VERIFY_SQL).toContain(`'${c.name}', 'date'`);
      expect(guessDueColumn(columns)?.id).toBe(expected);
    },
  );
});
