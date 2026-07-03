import { it, expect } from "vitest";
import {
  recipeCompletedSetsPercent,
  recipePercentSetsCompleted,
  recipeStatusChangedWebhook,
} from "@/components/boards/automations/recipes";
import { createAutomationSchema } from "@/lib/validations/automations";

const BOARD = "00000000-0000-4000-8000-00000000000b";
const STATUS_COL = "00000000-0000-4000-8000-000000000001";
const PERCENT_COL = "00000000-0000-4000-8000-000000000002";
const DONE_OPT = "done-opt";

it("builds the completed -> 100% draft and round-trips the create schema", () => {
  const d = recipeCompletedSetsPercent(STATUS_COL, DONE_OPT, PERCENT_COL);
  expect(d).toEqual({
    name: "Completed sets 100%",
    trigger: {
      type: "status_changed",
      columnId: STATUS_COL,
      toOptionId: DONE_OPT,
    },
    actions: [{ type: "set_percent", columnId: PERCENT_COL, percent: 100 }],
  });
  expect(
    createAutomationSchema.safeParse({ boardId: BOARD, ...d }).success,
  ).toBe(true);
});

it("builds the 100% -> completed draft and round-trips the create schema", () => {
  const d = recipePercentSetsCompleted(PERCENT_COL, STATUS_COL, DONE_OPT);
  expect(d).toEqual({
    name: "100% sets Completed",
    trigger: { type: "percent_reached", columnId: PERCENT_COL, percent: 100 },
    actions: [{ type: "set_option", columnId: STATUS_COL, optionId: DONE_OPT }],
  });
  expect(
    createAutomationSchema.safeParse({ boardId: BOARD, ...d }).success,
  ).toBe(true);
});

it("builds a status-changed -> webhook draft", () => {
  const d = recipeStatusChangedWebhook(
    "col-1",
    null,
    "https://hooks.example.com/x",
  );
  expect(d).toEqual({
    trigger: { type: "status_changed", columnId: "col-1", toOptionId: null },
    actions: [{ type: "call_webhook", url: "https://hooks.example.com/x" }],
  });
});
