import { describe, it, expect } from "vitest";
import {
  AUTOMATION_DRAFT_JSON_SCHEMA,
  validateAutomationDraft,
} from "@/lib/ai/automation-gen-schema";
import type { AutomationContext } from "@/lib/ai/automation-context";

// UUID-format ids — the canonical automation schema requires uuid columnIds/etc.
const STATUS = "aaaaaaaa-0000-4000-8000-000000000001";
const PEOPLE = "aaaaaaaa-0000-4000-8000-000000000002";
const DATE = "aaaaaaaa-0000-4000-8000-000000000003";
const PERCENT = "aaaaaaaa-0000-4000-8000-000000000004";
const GROUP = "bbbbbbbb-0000-4000-8000-000000000001";
const MEMBER = "cccccccc-0000-4000-8000-000000000001";

const ctx: AutomationContext = {
  columns: [
    {
      id: STATUS,
      name: "Status",
      kind: "status",
      options: [
        { id: "opt-done", label: "Done" },
        { id: "opt-stuck", label: "Stuck" },
      ],
    },
    { id: PEOPLE, name: "Owner", kind: "people", options: [] },
    { id: DATE, name: "Due", kind: "date", options: [] },
    { id: PERCENT, name: "Progress", kind: "percent", options: [] },
  ],
  groups: [{ id: GROUP, name: "Done" }],
  members: [{ id: MEMBER, name: "Ada" }],
};

describe("AUTOMATION_DRAFT_JSON_SCHEMA", () => {
  it("excludes call_webhook from the action union", () => {
    const json = JSON.stringify(AUTOMATION_DRAFT_JSON_SCHEMA);
    expect(json).not.toContain("call_webhook");
    expect(json).toContain("status_changed");
    expect(json).toContain("set_option");
  });
});

describe("validateAutomationDraft — happy paths", () => {
  it("keeps a valid status_changed → notify owner draft", () => {
    const { draft, warnings } = validateAutomationDraft(
      {
        trigger: {
          type: "status_changed",
          columnId: STATUS,
          toOptionId: "opt-done",
        },
        actions: [
          {
            type: "notify",
            recipient: { kind: "owner", peopleColumnId: PEOPLE },
          },
        ],
      },
      ctx,
    );
    expect(warnings).toHaveLength(0);
    expect(draft).toEqual({
      name: undefined,
      trigger: {
        type: "status_changed",
        columnId: STATUS,
        toOptionId: "opt-done",
      },
      actions: [
        {
          type: "notify",
          recipient: { kind: "owner", peopleColumnId: PEOPLE },
        },
      ],
      condition: null,
    });
  });

  it("keeps a set_option action whose optionId is in the target column", () => {
    const { draft } = validateAutomationDraft(
      {
        trigger: { type: "item_created" },
        actions: [
          { type: "set_option", columnId: STATUS, optionId: "opt-stuck" },
        ],
      },
      ctx,
    );
    expect(draft?.actions[0]).toEqual({
      type: "set_option",
      columnId: STATUS,
      optionId: "opt-stuck",
    });
  });

  it("keeps date_reached / percent_reached / move_to_group / notify member", () => {
    expect(
      validateAutomationDraft(
        {
          trigger: { type: "date_reached", columnId: DATE, offsetDays: -3 },
          actions: [{ type: "move_to_group", groupId: GROUP }],
        },
        ctx,
      ).draft?.trigger,
    ).toEqual({ type: "date_reached", columnId: DATE, offsetDays: -3 });

    expect(
      validateAutomationDraft(
        {
          trigger: { type: "percent_reached", columnId: PERCENT, percent: 100 },
          actions: [
            { type: "notify", recipient: { kind: "member", userId: MEMBER } },
          ],
        },
        ctx,
      ).draft?.actions[0],
    ).toEqual({
      type: "notify",
      recipient: { kind: "member", userId: MEMBER },
    });
  });
});

describe("validateAutomationDraft — referential drops", () => {
  it("(a) drops the whole draft when status_changed.columnId is not a status/dropdown column", () => {
    const { draft, warnings } = validateAutomationDraft(
      {
        trigger: { type: "status_changed", columnId: PEOPLE, toOptionId: null },
        actions: [{ type: "move_to_group", groupId: GROUP }],
      },
      ctx,
    );
    expect(draft).toBeNull();
    expect(warnings.join(" ")).toMatch(/status column not found/i);
  });

  it("(b) drops set_option whose optionId is not in the column's options", () => {
    const { draft, warnings } = validateAutomationDraft(
      {
        trigger: { type: "item_created" },
        actions: [
          { type: "set_option", columnId: STATUS, optionId: "opt-ghost" },
          { type: "move_to_group", groupId: GROUP },
        ],
      },
      ctx,
    );
    expect(draft?.actions).toEqual([{ type: "move_to_group", groupId: GROUP }]);
    expect(warnings.join(" ")).toMatch(/unknown option/i);
  });

  it("(c) drops move_to_group whose groupId is not on the board", () => {
    const { draft } = validateAutomationDraft(
      {
        trigger: { type: "item_created" },
        actions: [
          {
            type: "move_to_group",
            groupId: "dddddddd-0000-4000-8000-000000000001",
          },
          { type: "set_option", columnId: STATUS, optionId: "opt-done" },
        ],
      },
      ctx,
    );
    expect(draft?.actions).toEqual([
      { type: "set_option", columnId: STATUS, optionId: "opt-done" },
    ]);
  });

  it("(d) drops notify member/owner referencing unknown ids", () => {
    const { draft } = validateAutomationDraft(
      {
        trigger: { type: "item_created" },
        actions: [
          {
            type: "notify",
            recipient: {
              kind: "member",
              userId: "eeeeeeee-0000-4000-8000-000000000001",
            },
          },
          { type: "set_option", columnId: STATUS, optionId: "opt-done" },
        ],
      },
      ctx,
    );
    expect(draft?.actions).toEqual([
      { type: "set_option", columnId: STATUS, optionId: "opt-done" },
    ]);
  });

  it("(e) drops date_reached / percent_reached on the wrong kind of column", () => {
    expect(
      validateAutomationDraft(
        {
          trigger: { type: "date_reached", columnId: STATUS, offsetDays: 0 },
          actions: [{ type: "move_to_group", groupId: GROUP }],
        },
        ctx,
      ).draft,
    ).toBeNull();
    expect(
      validateAutomationDraft(
        {
          trigger: { type: "percent_reached", columnId: DATE, percent: 100 },
          actions: [{ type: "move_to_group", groupId: GROUP }],
        },
        ctx,
      ).draft,
    ).toBeNull();
  });

  it("(f) returns draft:null with a warning when 0 actions survive", () => {
    const { draft, warnings } = validateAutomationDraft(
      {
        trigger: { type: "item_created" },
        actions: [
          { type: "set_option", columnId: STATUS, optionId: "opt-ghost" },
        ],
      },
      ctx,
    );
    expect(draft).toBeNull();
    expect(warnings.join(" ")).toMatch(/no usable actions/i);
  });

  it("(g) drops call_webhook actions with a warning", () => {
    const { draft, warnings } = validateAutomationDraft(
      {
        trigger: { type: "item_created" },
        actions: [
          { type: "call_webhook", url: "https://example.com/hook" },
          { type: "set_option", columnId: STATUS, optionId: "opt-done" },
        ],
      },
      ctx,
    );
    expect(draft?.actions).toEqual([
      { type: "set_option", columnId: STATUS, optionId: "opt-done" },
    ]);
    expect(warnings.join(" ")).toMatch(/webhook/i);
  });

  it("coerces an unknown toOptionId to null (fires on any change) with a warning", () => {
    const { draft, warnings } = validateAutomationDraft(
      {
        trigger: {
          type: "status_changed",
          columnId: STATUS,
          toOptionId: "opt-ghost",
        },
        actions: [{ type: "move_to_group", groupId: GROUP }],
      },
      ctx,
    );
    expect(draft?.trigger).toEqual({
      type: "status_changed",
      columnId: STATUS,
      toOptionId: null,
    });
    expect(warnings.join(" ")).toMatch(/unknown status value/i);
  });
});
