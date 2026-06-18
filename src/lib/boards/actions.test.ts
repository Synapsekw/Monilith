import { describe, it, expect, vi, beforeEach } from "vitest";

const from = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from, auth: { getUser } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { upsertCell } from "@/lib/boards/actions";

const ITEM = "11111111-1111-4111-8111-111111111111";
const COL = "22222222-2222-4222-8222-222222222222";
const USER = "99999999-9999-4999-8999-999999999999";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  from.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
});

describe("upsertCell people-cell assignment fan-out", () => {
  it("notifies only the newly-added member, excluding the actor", async () => {
    const notifInsert = vi.fn().mockResolvedValue({ error: null });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    from.mockImplementation((table: string) => {
      if (table === "columns")
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { org_id: "org", board_id: "board", kind: "people" },
                error: null,
              }),
            }),
          }),
        } as never;
      if (table === "items")
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { board_id: "board" },
                error: null,
              }),
            }),
          }),
        } as never;
      if (table === "cell_values")
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { value: { userIds: [A] } },
                  error: null,
                }),
              }),
            }),
          }),
          upsert,
        } as never;
      if (table === "notifications") return { insert: notifInsert } as never;
      return {} as never;
    });

    // prior = [A]; new = [A, B, USER] → only B is a fresh non-actor recipient.
    const res = await upsertCell({
      itemId: ITEM,
      columnId: COL,
      value: { userIds: [A, B, USER] },
    });

    expect(res).toEqual({ ok: true, data: undefined });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(notifInsert).toHaveBeenCalledTimes(1);
    expect(notifInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        org_id: "org",
        recipient_id: B,
        actor_id: USER,
        kind: "assigned",
        board_id: "board",
        item_id: ITEM,
      }),
    ]);
  });
});

import { buildTemplatePayload } from "@/lib/boards/template-payload";
import { getTemplate } from "@/lib/boards/templates";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("buildTemplatePayload", () => {
  it("blank: 1 group, 3 columns, 0 items; all ids are uuids", () => {
    const p = buildTemplatePayload(getTemplate("blank")!);
    expect(p.groups).toHaveLength(1);
    expect(p.columns).toHaveLength(3);
    expect(p.items).toHaveLength(0);
    expect(p.groups[0].id).toMatch(UUID_RE);
    expect(p.columns.every((c) => UUID_RE.test(c.id))).toBe(true);
    expect(p.groups[0].position).toBe(0);
  });

  it("status column carries options with minted uuid ids", () => {
    const p = buildTemplatePayload(getTemplate("blank")!);
    const status = p.columns.find((c) => c.kind === "status")!;
    const opts = (status.settings as { options: { id: string }[] }).options;
    expect(opts).toHaveLength(4);
    expect(opts.every((o) => UUID_RE.test(o.id))).toBe(true);
  });

  it("resolves a status cell to the matching minted optionId", () => {
    const p = buildTemplatePayload(getTemplate("sprints")!);
    const status = p.columns.find((c) => c.name === "Status")!;
    const doneId = (
      status.settings as { options: { id: string; label: string }[] }
    ).options.find((o) => o.label === "Done")!.id;
    const shipItem = p.items.find((i) => i.name === "Ship settings page")!;
    const statusCell = shipItem.cells.find((c) => c.columnId === status.id)!;
    expect(statusCell.value).toEqual({ optionId: doneId });
  });

  it("resolves a date range cell to ISO start + end", () => {
    const p = buildTemplatePayload(getTemplate("sprints")!);
    const sprintCol = p.columns.find((c) => c.name === "Sprint")!;
    const item = p.items.find((i) => i.name === "Build onboarding flow")!;
    const cell = item.cells.find((c) => c.columnId === sprintCol.id)!;
    const v = cell.value as { date: string; end: string };
    expect(v.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(v.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(v.end > v.date).toBe(true);
  });

  it("resolves dropdown, numbers and text cells", () => {
    const p = buildTemplatePayload(getTemplate("content")!);
    const channel = p.columns.find((c) => c.name === "Channel")!;
    const item = p.items.find((i) => i.name === "Launch thread")!;
    const cell = item.cells.find((c) => c.columnId === channel.id)!;
    const ids = (cell.value as { optionIds: string[] }).optionIds;
    expect(ids).toHaveLength(1);
    expect(UUID_RE.test(ids[0])).toBe(true);
  });
});

import { createBoardFromTemplate } from "@/lib/boards/actions";

describe("createBoardFromTemplate", () => {
  it("rejects an unknown templateId before touching Supabase", async () => {
    const res = await createBoardFromTemplate({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      templateId: "does-not-exist",
      name: "My board",
    });
    expect(res).toEqual({ ok: false, error: "Unknown template." });
  });
});
