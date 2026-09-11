import { describe, expect, it } from "vitest";
import { buildItemRoster, buildUserPrompt, systemPrompt } from "./prompt";
import { buildBoardContext } from "./board-context";
import type { BoardPayload } from "@/lib/boards/queries";
import type { BoardSnapshot } from "@/lib/ai/board-snapshot";
import type { Signal } from "@/lib/boards/intelligence/types";

const payload = {
  board: { id: "b1", org_id: "o1", name: "Launch <x>" },
  groups: [{ id: "g1", name: "Sprint" }],
  columns: [
    {
      id: "c-status",
      name: "Status",
      kind: "status",
      settings: { options: [{ id: "o-done", label: "Done", color: "green" }] },
    },
    { id: "c-date", name: "Due", kind: "date", settings: {} },
    { id: "c-people", name: "Owner", kind: "people", settings: {} },
  ],
  items: [
    {
      id: "i1",
      name: "Ship\nit",
      group_id: "g1",
      parent_id: null,
      updated_at: "2026-09-10T00:00:00.000Z",
    },
    {
      id: "i2",
      name: "Test",
      group_id: "g1",
      parent_id: null,
      updated_at: "2026-09-11T00:00:00.000Z",
    },
    {
      id: "i3",
      name: "Docs",
      group_id: "g1",
      parent_id: null,
      updated_at: "2026-09-01T00:00:00.000Z",
    },
  ],
  cellValues: [
    { item_id: "i1", column_id: "c-status", value: { optionId: "o-done" } },
    { item_id: "i1", column_id: "c-date", value: { date: "2026-09-01" } },
    { item_id: "i1", column_id: "c-people", value: { userIds: ["u-ana"] } },
  ],
  dependencies: [],
  views: [],
  attachments: [],
  timeEntries: [],
  relationLinks: [],
  mirrorTargetCells: [],
  mirrorTargetColumns: [],
} as unknown as BoardPayload;
const ctx = buildBoardContext(payload, [{ userId: "u-ana", fullName: "Ana" }]);
const signals = [
  {
    kind: "overdue" as const,
    count: 1,
    label: "overdue",
    tone: "red" as const,
    itemIds: ["i3"],
  },
];
const snapshot = {
  board: { id: "b1", name: "Launch <x>" },
  rowCount: 3,
  groups: [{ id: "g1", name: "Sprint" }],
  columns: [],
  columnStats: {},
  meta: { rowCount: 3, columnCount: 3, estimatedTokens: 10 },
} as BoardSnapshot;
const input = {
  snapshot,
  ctx,
  signals,
  transcript: "[t] (Ship) Ana: hi",
  now: "2026-09-11T12:00:00.000Z",
  timezone: "Europe/Berlin",
  cellValues: payload.cellValues,
  itemsByRecency: payload.items,
};

describe("prompt", () => {
  it("system prompt forbids markdown and invented ids", () => {
    const s = systemPrompt();
    expect(s).toMatch(/plain prose/i);
    expect(s).toMatch(/only ids that appear/i);
    expect(s).toMatch(/at most 5 suggestions/i);
    // The size caps are enforced by truncation, so the model is TOLD them —
    // otherwise every brief gets silently cut mid-sentence.
    expect(s).toMatch(/under 700 characters/i);
    expect(s).toMatch(/at most 8 items/i);
  });
  it("roster puts signal items first, then by recency, capped", () => {
    const rows = buildItemRoster(input, 2);
    expect(rows[0]).toContain("i3"); // the overdue item leads
    expect(rows[1]).toContain("i2"); // most recently edited next
    expect(rows).toHaveLength(2);
  });
  it("roster lines carry status label, date and owner names, sanitized", () => {
    const rows = buildItemRoster(input, 10);
    const ship = rows.find((r) => r.includes("i1"))!;
    expect(ship).toContain("Ship it");
    expect(ship).toContain("Status: Done");
    expect(ship).toContain("Due: 2026-09-01");
    expect(ship).toContain("Owner: Ana");
  });
  it("user prompt has the delimited sections and sanitized board name", () => {
    const u = buildUserPrompt(input);
    for (const h of [
      "=== SIGNALS ===",
      "=== COLUMNS ===",
      "=== MEMBERS ===",
      "=== ITEMS ===",
      "=== RECENT ACTIVITY (7 days) ===",
      "=== END ===",
    ])
      expect(u).toContain(h);
    expect(u).toContain("Launch x");
    expect(u).not.toContain("<x>");
    expect(u).toContain("u-ana | Ana");
    expect(u).toContain("c-status | Status | status | options: o-done=Done");
  });
  it("caps the SIGNALS block at ten lines", () => {
    // `computeSignals` emits one `overloaded` row PER PERSON, so a busy board
    // easily runs past ten — one line each would crowd out the roster.
    const many: Signal[] = Array.from({ length: 12 }, (_, i) => ({
      kind: "overloaded",
      count: i,
      label: `overloaded · P${i}`,
      tone: "yellow",
      itemIds: ["i1"],
      subjectUserId: `u${i}`,
    }));
    const block = buildUserPrompt({ ...input, signals: many })
      .split("=== SIGNALS ===")[1]!
      .split("=== GROUPS ===")[0]!
      .trim()
      .split("\n");
    expect(block).toHaveLength(10);
    expect(block[0]).toContain("overloaded · P0");
    expect(block.some((l) => l.includes("P10"))).toBe(false);
  });
  it("lists at most 50 options per column and marks the rest", () => {
    const wide = {
      ...payload,
      columns: [
        {
          id: "c-many",
          name: "Stage",
          kind: "status",
          settings: {
            options: Array.from({ length: 60 }, (_, i) => ({
              id: `o${i}`,
              label: `S${i}`,
              color: "green",
            })),
          },
        },
      ],
    } as unknown as BoardPayload;
    const line = buildUserPrompt({
      ...input,
      ctx: buildBoardContext(wide, []),
    })
      .split("=== COLUMNS ===")[1]!
      .split("=== MEMBERS ===")[0]!
      .trim();
    expect(line.match(/o\d+=S\d+/g)).toHaveLength(50);
    expect(line).toContain("o49=S49, …");
    expect(line).not.toContain("o50=S50");
  });
});
