import { describe, it, expect } from "vitest";
import { localTodayISO } from "@/lib/boards/overdue";
import {
  computeBoardIntel,
  computeSignals,
  formatSince,
  latestActivityISO,
  narrowItemsToSignal,
  stripSignals,
  findActiveSignal,
  signalSelection,
  selectionEquals,
  type SignalsInput,
} from "./signals";
import { MAX_CHIPS } from "./constants";
import type { Signal } from "./types";

// Fri 11 Sep 2026 12:00 LOCAL. Weekday-dependent labels ("changed since Tue")
// are computed in local time, so the fixture clock is local too.
export const NOW = new Date(2026, 8, 11, 12, 0, 0);
const DAY = 86_400_000;
export const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const iso = (d: Date) => d.toISOString();
/** Viewer-local YYYY-MM-DD `n` days before NOW (negative = future). */
export const dateISO = (n: number) => localTodayISO(daysAgo(n));

export const STATUS = "c-status";
export const DATE = "c-date";
export const PEOPLE = "c-people";
export const EFFORT = "c-effort";
export const OPEN = "opt-open";
export const STUCK = "opt-stuck";
export const DONE = "opt-done";

export function column(
  id: string,
  kind: string,
  name: string,
  position: number,
  settings: unknown = {},
): SignalsInput["columns"][number] {
  return {
    id,
    board_id: "b1",
    org_id: "o1",
    name,
    kind,
    position,
    settings,
    width: null,
  } as unknown as SignalsInput["columns"][number];
}

export function item(
  id: string,
  over: Partial<{
    group_id: string;
    parent_id: string | null;
    updated_at: string;
  }> = {},
): SignalsInput["items"][number] {
  return {
    id,
    board_id: "b1",
    org_id: "o1",
    group_id: "g1",
    parent_id: null,
    name: id,
    position: 0,
    created_by: "u0",
    created_at: iso(daysAgo(30)),
    updated_at: iso(daysAgo(30)),
    archived_at: null,
    archived_by: null,
    ...over,
  };
}

export function group(id: string): SignalsInput["groups"][number] {
  return {
    id,
    board_id: "b1",
    org_id: "o1",
    name: id,
    color: "#0073ea",
    position: 0,
  } as unknown as SignalsInput["groups"][number];
}

export function cell(
  item_id: string,
  column_id: string,
  value: unknown,
  updated_at = iso(daysAgo(30)),
): SignalsInput["cellValues"][number] {
  return {
    item_id,
    column_id,
    value,
    updated_at,
  } as SignalsInput["cellValues"][number];
}

export function dep(
  predecessor_id: string,
  successor_id: string,
): SignalsInput["dependencies"][number] {
  return {
    id: `${predecessor_id}->${successor_id}`,
    board_id: "b1",
    org_id: "o1",
    predecessor_id,
    successor_id,
    type: "finish_to_start",
    created_at: iso(daysAgo(30)),
  };
}

/** A board with the four column kinds the engine reads; override per test. */
export function board(over: Partial<SignalsInput> = {}): SignalsInput {
  return {
    columns: [
      column(STATUS, "status", "Status", 0, {
        options: [
          { id: OPEN, label: "Working on it", color: "#fdab3d" },
          { id: STUCK, label: "Stuck", color: "#e2445c" },
          { id: DONE, label: "Done", color: "#00c875" },
        ],
      }),
      column(DATE, "date", "Due", 1),
      column(PEOPLE, "people", "Owner", 2),
      column(EFFORT, "numbers", "Effort", 3),
    ],
    groups: [group("g1")],
    items: [],
    cellValues: [],
    dependencies: [],
    ...over,
  };
}

export const opts = (
  over: Partial<Parameters<typeof computeSignals>[1]> = {},
): Parameters<typeof computeSignals>[1] => ({
  now: NOW,
  lastSeenAt: null,
  currentUserId: "me",
  ...over,
});

export const ofKind = (signals: Signal[], kind: Signal["kind"]) =>
  signals.filter((s) => s.kind === kind);

describe("computeSignals — overdue", () => {
  it("yields no signals for an empty board", () => {
    expect(computeSignals(board(), opts())).toEqual([]);
  });

  it("counts open items whose date is past; done and future items are excluded", () => {
    const input = board({
      items: [item("late"), item("late-done"), item("future"), item("no-date")],
      cellValues: [
        cell("late", STATUS, { optionId: OPEN }),
        cell("late", DATE, { date: dateISO(1) }),
        cell("late-done", STATUS, { optionId: DONE }),
        cell("late-done", DATE, { date: dateISO(1) }),
        cell("future", STATUS, { optionId: OPEN }),
        cell("future", DATE, { date: dateISO(-1) }),
        cell("no-date", STATUS, { optionId: OPEN }),
      ],
    });
    const [overdue] = ofKind(computeSignals(input, opts()), "overdue");
    expect(overdue).toMatchObject({
      kind: "overdue",
      count: 1,
      label: "overdue",
      tone: "red",
      itemIds: ["late"],
    });
  });

  it("uses the range end when a date cell carries one", () => {
    const input = board({
      items: [item("span")],
      cellValues: [
        cell("span", STATUS, { optionId: OPEN }),
        cell("span", DATE, { date: dateISO(5), end: dateISO(2) }),
      ],
    });
    expect(ofKind(computeSignals(input, opts()), "overdue")[0].count).toBe(1);
  });

  it("emits nothing (not a zero-count chip) when no item is overdue", () => {
    const input = board({
      items: [item("a")],
      cellValues: [cell("a", DATE, { date: dateISO(-3) })],
    });
    expect(ofKind(computeSignals(input, opts()), "overdue")).toEqual([]);
  });

  it("treats every item as open when the board has no status column", () => {
    const input = board({
      columns: [column(DATE, "date", "Due", 0)],
      items: [item("a")],
      cellValues: [cell("a", DATE, { date: dateISO(1) })],
    });
    expect(ofKind(computeSignals(input, opts()), "overdue")[0].itemIds).toEqual(
      ["a"],
    );
  });
});

describe("computeSignals — blocked", () => {
  it("includes the stuck blocker and its transitive dependents; count = blockers", () => {
    const input = board({
      items: [item("a"), item("b"), item("c"), item("lone")],
      cellValues: [
        cell("a", STATUS, { optionId: STUCK }),
        cell("lone", STATUS, { optionId: STUCK }),
      ],
      dependencies: [dep("a", "b"), dep("b", "c")],
    });
    const [blocked] = ofKind(computeSignals(input, opts()), "blocked");
    expect(blocked).toMatchObject({
      kind: "blocked",
      count: 1,
      label: "blocked chain",
      tone: "orange",
    });
    expect([...blocked.itemIds].sort()).toEqual(["a", "b", "c"]);
  });

  it("ignores stuck items without dependents and open items with dependents", () => {
    const input = board({
      items: [item("stuck-alone"), item("working"), item("dep")],
      cellValues: [
        cell("stuck-alone", STATUS, { optionId: STUCK }),
        cell("working", STATUS, { optionId: OPEN }),
      ],
      dependencies: [dep("working", "dep")],
    });
    expect(ofKind(computeSignals(input, opts()), "blocked")).toEqual([]);
  });

  it("recognises a 'Blocked' label, not only 'Stuck'", () => {
    const input = board({
      columns: [
        column(STATUS, "status", "Status", 0, {
          options: [{ id: "opt-b", label: "Blocked", color: "#e2445c" }],
        }),
      ],
      items: [item("a"), item("b")],
      cellValues: [cell("a", STATUS, { optionId: "opt-b" })],
      dependencies: [dep("a", "b")],
    });
    expect(ofKind(computeSignals(input, opts()), "blocked")[0].count).toBe(1);
  });

  it("does not match 'Unstuck' — the label regex is word-bounded", () => {
    const input = board({
      columns: [
        column(STATUS, "status", "Status", 0, {
          options: [{ id: "opt-u", label: "Unstuck", color: "#00c875" }],
        }),
      ],
      items: [item("a"), item("b")],
      cellValues: [cell("a", STATUS, { optionId: "opt-u" })],
      dependencies: [dep("a", "b")],
    });
    expect(ofKind(computeSignals(input, opts()), "blocked")).toEqual([]);
  });

  it("follows a dependency cycle without looping forever", () => {
    const input = board({
      items: [item("a"), item("b")],
      cellValues: [cell("a", STATUS, { optionId: STUCK })],
      dependencies: [dep("a", "b"), dep("b", "a")],
    });
    const [blocked] = ofKind(computeSignals(input, opts()), "blocked");
    expect(blocked.count).toBe(1);
    expect([...blocked.itemIds].sort()).toEqual(["a", "b"]);
  });

  it("ignores a dependency edge pointing at an item that no longer exists", () => {
    const input = board({
      items: [item("a")],
      cellValues: [cell("a", STATUS, { optionId: STUCK })],
      dependencies: [dep("a", "ghost")],
    });
    const [blocked] = ofKind(computeSignals(input, opts()), "blocked");
    expect(blocked.count).toBe(1);
    expect(blocked.itemIds).toEqual(["a"]);
  });
});

describe("computeSignals — stalled", () => {
  it("flags a group whose latest activity is older than STALL_DAYS and that has an open item", () => {
    const input = board({
      groups: [group("g1"), group("g2"), group("g3")],
      items: [
        item("old-open", {
          group_id: "g1",
          updated_at: daysAgo(10).toISOString(),
        }),
        item("fresh", { group_id: "g2", updated_at: daysAgo(2).toISOString() }),
        item("old-done", {
          group_id: "g3",
          updated_at: daysAgo(10).toISOString(),
        }),
        item("old-done-2", {
          group_id: "g1",
          updated_at: daysAgo(12).toISOString(),
        }),
      ],
      cellValues: [
        cell("old-open", STATUS, { optionId: OPEN }),
        cell("fresh", STATUS, { optionId: OPEN }),
        cell("old-done", STATUS, { optionId: DONE }),
        cell("old-done-2", STATUS, { optionId: DONE }),
      ],
    });
    const [stalled] = ofKind(computeSignals(input, opts()), "stalled");
    expect(stalled).toMatchObject({
      kind: "stalled",
      count: 1,
      label: "stalled group",
      tone: "gray",
      groupIds: ["g1"],
      itemIds: ["old-open"],
    });
  });

  it("a recent cell edit rescues a group whose items.updated_at is stale", () => {
    const input = board({
      items: [item("a", { updated_at: daysAgo(10).toISOString() })],
      cellValues: [
        cell("a", STATUS, { optionId: OPEN }, daysAgo(1).toISOString()),
      ],
    });
    expect(ofKind(computeSignals(input, opts()), "stalled")).toEqual([]);
  });

  it("pluralises the label for several stalled groups", () => {
    const input = board({
      groups: [group("g1"), group("g2")],
      items: [
        item("a", { group_id: "g1", updated_at: daysAgo(6).toISOString() }),
        item("b", { group_id: "g2", updated_at: daysAgo(6).toISOString() }),
      ],
    });
    const [stalled] = ofKind(computeSignals(input, opts()), "stalled");
    expect(stalled.count).toBe(2);
    expect(stalled.label).toBe("stalled groups");
  });

  it("exactly STALL_DAYS old is not yet stalled (strictly older)", () => {
    const input = board({
      items: [item("a", { updated_at: daysAgo(5).toISOString() })],
    });
    expect(ofKind(computeSignals(input, opts()), "stalled")).toEqual([]);
  });
});

describe("computeSignals — overloaded", () => {
  const names = new Map([
    ["u1", "Ana Lovelace"],
    ["u2", "Ben"],
  ]);
  const assign = (id: string, ...users: string[]) => [
    cell(id, STATUS, { optionId: OPEN }),
    cell(id, PEOPLE, { userIds: users }),
  ];

  it("flags the person above OVERLOAD_RATIO × median, named by first name", () => {
    const input = board({
      items: [item("a"), item("b"), item("c"), item("d"), item("e"), item("f")],
      cellValues: [
        ...assign("a", "u1"),
        ...assign("b", "u1"),
        ...assign("c", "u1"),
        ...assign("d", "u1"),
        ...assign("e", "u2"),
        ...assign("f", "u3"),
      ],
    });
    const over = ofKind(
      computeSignals(input, opts({ memberNames: names })),
      "overloaded",
    );
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({
      kind: "overloaded",
      count: 4,
      label: "overloaded · Ana",
      tone: "yellow",
      subjectUserId: "u1",
    });
    expect([...over[0].itemIds].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("emits one signal per overloaded person, highest load first", () => {
    const cells = [
      ...["a1", "a2", "a3", "a4"].flatMap((id) => assign(id, "u1")),
      ...["b1", "b2", "b3", "b4", "b5", "b6"].flatMap((id) => assign(id, "u2")),
      ...assign("c1", "u3"),
      ...assign("d1", "u4"),
    ];
    const input = board({
      items: cells
        .filter((c) => c.column_id === STATUS)
        .map((c) => item(c.item_id)),
      cellValues: cells,
    });
    const over = ofKind(
      computeSignals(input, opts({ memberNames: names })),
      "overloaded",
    );
    expect(over.map((s) => s.subjectUserId)).toEqual(["u2", "u1"]);
    expect(over[0].label).toBe("overloaded · Ben");
  });

  it("weights items by the effort column and excludes done items", () => {
    const input = board({
      items: [item("big"), item("s1"), item("s2"), item("t1"), item("done")],
      cellValues: [
        ...assign("big", "u1"),
        cell("big", EFFORT, { n: 5 }),
        ...assign("s1", "u2"),
        ...assign("s2", "u2"),
        ...assign("t1", "u3"),
        cell("done", STATUS, { optionId: DONE }),
        cell("done", PEOPLE, { userIds: ["u3"] }),
        cell("done", EFFORT, { n: 50 }),
      ],
    });
    const over = ofKind(computeSignals(input, opts()), "overloaded");
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({
      subjectUserId: "u1",
      count: 1,
      label: "overloaded · someone",
    });
  });

  it("needs at least two loaded people (a lone assignee is never overloaded)", () => {
    const input = board({
      items: [item("a"), item("b")],
      cellValues: [...assign("a", "u1"), ...assign("b", "u1")],
    });
    expect(ofKind(computeSignals(input, opts()), "overloaded")).toEqual([]);
  });
});

describe("computeSignals — changed", () => {
  it("is hidden on a first visit (lastSeenAt null)", () => {
    const input = board({
      items: [item("a", { updated_at: NOW.toISOString() })],
    });
    expect(ofKind(computeSignals(input, opts()), "changed")).toEqual([]);
  });

  it("counts items whose item or cell activity is after lastSeenAt", () => {
    const lastSeenAt = new Date(2026, 8, 8, 10, 0, 0); // Tue 8 Sep, local
    const input = board({
      items: [
        item("item-touched", { updated_at: daysAgo(1).toISOString() }),
        item("cell-touched"),
        item("untouched"),
      ],
      cellValues: [
        cell(
          "cell-touched",
          DATE,
          { date: dateISO(0) },
          daysAgo(2).toISOString(),
        ),
      ],
    });
    const [changed] = ofKind(
      computeSignals(input, opts({ lastSeenAt })),
      "changed",
    );
    expect(changed).toMatchObject({
      kind: "changed",
      count: 2,
      label: "changed since Tue",
      tone: "accent",
    });
    expect([...changed.itemIds].sort()).toEqual([
      "cell-touched",
      "item-touched",
    ]);
  });
});

describe("formatSince", () => {
  it("same day → clock time; within the week → weekday; older → month day", () => {
    expect(formatSince(new Date(2026, 8, 11, 14, 5), NOW)).toBe("2:05 PM");
    expect(formatSince(new Date(2026, 8, 8, 10, 0), NOW)).toBe("Tue");
    expect(formatSince(new Date(2026, 8, 3, 10, 0), NOW)).toBe("Sep 3");
  });
});

describe("ordering, truncation and helpers", () => {
  function busyBoard(): SignalsInput {
    const cells = [
      // overdue + stuck blocker with a dependent
      cell("late", STATUS, { optionId: STUCK }),
      cell("late", DATE, { date: dateISO(3) }),
      // overloaded u1 (4) vs u2/u3 (1 each) → u1 over; u4 (6) also over
      ...["a1", "a2", "a3", "a4"].flatMap((id) => [
        cell(id, STATUS, { optionId: OPEN }),
        cell(id, PEOPLE, { userIds: ["u1"] }),
      ]),
      ...["b1", "b2", "b3", "b4", "b5", "b6"].flatMap((id) => [
        cell(id, STATUS, { optionId: OPEN }),
        cell(id, PEOPLE, { userIds: ["u4"] }),
      ]),
      cell("c1", STATUS, { optionId: OPEN }),
      cell("c1", PEOPLE, { userIds: ["u2"] }),
      cell("d1", STATUS, { optionId: OPEN }),
      cell("d1", PEOPLE, { userIds: ["u3"] }),
    ];
    const ids = [...new Set(cells.map((c) => c.item_id)), "dep", "quiet"];
    return board({
      groups: [group("g1"), group("g-quiet")],
      items: ids.map((id) =>
        id === "quiet"
          ? item(id, {
              group_id: "g-quiet",
              updated_at: daysAgo(9).toISOString(),
            })
          : item(id, { updated_at: daysAgo(1).toISOString() }),
      ),
      cellValues: cells,
      dependencies: [dep("late", "dep")],
    });
  }

  it("orders kinds overdue, blocked, overloaded, stalled, changed", () => {
    const signals = computeSignals(
      busyBoard(),
      opts({ lastSeenAt: daysAgo(2) }),
    );
    expect(signals.map((s) => s.kind)).toEqual([
      "overdue",
      "blocked",
      "overloaded",
      "overloaded",
      "stalled",
      "changed",
    ]);
  });

  it("stripSignals keeps the first MAX_CHIPS in order", () => {
    const signals = computeSignals(
      busyBoard(),
      opts({ lastSeenAt: daysAgo(2) }),
    );
    expect(signals.length).toBeGreaterThan(MAX_CHIPS);
    const strip = stripSignals(signals);
    expect(strip).toHaveLength(MAX_CHIPS);
    expect(strip.map((s) => s.kind)).toEqual([
      "overdue",
      "blocked",
      "overloaded",
      "overloaded",
      "stalled",
    ]);
  });

  it("narrowItemsToSignal returns the same array when no chip is active", () => {
    const items = [item("a")];
    expect(narrowItemsToSignal(items, null)).toBe(items);
  });

  it("narrowItemsToSignal keeps matches plus the parents of matching sub-items", () => {
    const items = [
      item("p"),
      item("child", { parent_id: "p" }),
      item("other"),
      item("orphan-child", { parent_id: "other" }),
    ];
    const kept = narrowItemsToSignal(items, new Set(["child"]));
    expect(kept.map((i) => i.id)).toEqual(["p", "child"]);
  });

  it("signalSelection / selectionEquals / findActiveSignal round-trip a subject", () => {
    const signals = computeSignals(busyBoard(), opts());
    const u4 = signals.find((s) => s.subjectUserId === "u4") as Signal;
    const sel = signalSelection(u4);
    expect(sel).toEqual({ kind: "overloaded", subject: "u4" });
    expect(selectionEquals(sel, { kind: "overloaded", subject: "u4" })).toBe(
      true,
    );
    expect(selectionEquals(sel, { kind: "overloaded" })).toBe(false);
    expect(selectionEquals(null, null)).toBe(true);
    expect(findActiveSignal(signals, sel)).toBe(u4);
    expect(findActiveSignal(signals, { kind: "overdue" })?.kind).toBe(
      "overdue",
    );
    expect(findActiveSignal(signals, { kind: "changed" })).toBeNull();
    expect(findActiveSignal(signals, null)).toBeNull();
  });

  it("computeBoardIntel returns computeSignals AND latestActivityISO in one pass", () => {
    // The provider needs both on every cache change; the folded call must be
    // indistinguishable from calling the two narrower functions separately.
    const input = board({
      items: [item("a", { updated_at: daysAgo(4).toISOString() })],
      cellValues: [
        cell("a", DATE, { date: dateISO(1) }, daysAgo(1).toISOString()),
      ],
    });
    const o = opts();
    const intel = computeBoardIntel(input, o);
    expect(intel.signals).toEqual(computeSignals(input, o));
    expect(intel.latestActivityISO).toBe(latestActivityISO(input));
    expect(intel.signals.map((s) => s.kind)).toContain("overdue");
    expect(intel.latestActivityISO).toBe(daysAgo(1).toISOString());
  });

  it("latestActivityISO is the newest item/cell timestamp, or null for an empty board", () => {
    expect(latestActivityISO(board())).toBeNull();
    const input = board({
      items: [item("a", { updated_at: daysAgo(4).toISOString() })],
      cellValues: [
        cell("a", DATE, { date: dateISO(0) }, daysAgo(1).toISOString()),
      ],
    });
    expect(latestActivityISO(input)).toBe(daysAgo(1).toISOString());
  });
});
