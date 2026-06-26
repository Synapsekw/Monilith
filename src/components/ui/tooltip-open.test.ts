import { expect, test } from "vitest";
import { resolveTooltipOpen } from "./tooltip-open";

test("suppresses hover tooltips on a coarse pointer", () => {
  expect(resolveTooltipOpen(true, undefined)).toBe(false);
});

test("leaves tooltips uncontrolled on a fine pointer", () => {
  expect(resolveTooltipOpen(false, undefined)).toBeUndefined();
});

test("always respects an explicit controlled `open`", () => {
  expect(resolveTooltipOpen(true, true)).toBe(true);
  expect(resolveTooltipOpen(true, false)).toBe(false);
  expect(resolveTooltipOpen(false, true)).toBe(true);
});
