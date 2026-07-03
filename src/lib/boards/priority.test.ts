import { describe, expect, it } from "vitest";
import {
  AUTO_CRITICAL_MIN_DEPENDENTS,
  buildDependentsCountMap,
  effectivePriority,
} from "./priority";

const dep = (predecessor_id: string) => ({ predecessor_id });

describe("buildDependentsCountMap", () => {
  it("counts direct dependents per predecessor", () => {
    const map = buildDependentsCountMap([dep("a"), dep("a"), dep("b")]);
    expect(map.get("a")).toBe(2);
    expect(map.get("b")).toBe(1);
    expect(map.get("zzz")).toBeUndefined();
  });
  it("is empty for no edges", () => {
    expect(buildDependentsCountMap([]).size).toBe(0);
  });
});

describe("effectivePriority", () => {
  it("threshold is 2", () => {
    expect(AUTO_CRITICAL_MIN_DEPENDENTS).toBe(2);
  });
  it("is normal by default (unset, 0/1 dependents)", () => {
    expect(effectivePriority(null, 0)).toEqual({
      level: "normal",
      auto: false,
    });
    expect(effectivePriority(null, 1)).toEqual({
      level: "normal",
      auto: false,
    });
  });
  it("auto-escalates at 2+ dependents", () => {
    expect(effectivePriority(null, 2)).toEqual({
      level: "critical",
      auto: true,
    });
    expect(effectivePriority(null, 3)).toEqual({
      level: "critical",
      auto: true,
    });
  });
  it("manual critical wins and is not marked auto", () => {
    expect(effectivePriority({ level: "critical" }, 0)).toEqual({
      level: "critical",
      auto: false,
    });
    expect(effectivePriority({ level: "critical" }, 5)).toEqual({
      level: "critical",
      auto: false,
    });
  });
  it("auto overrides manual normal for display", () => {
    expect(effectivePriority({ level: "normal" }, 2)).toEqual({
      level: "critical",
      auto: true,
    });
  });
  it("self-clears back to the stored value when dependents drop", () => {
    expect(effectivePriority({ level: "normal" }, 1)).toEqual({
      level: "normal",
      auto: false,
    });
  });
  it("treats malformed values as unset", () => {
    expect(effectivePriority({ level: "urgent" }, 0)).toEqual({
      level: "normal",
      auto: false,
    });
    expect(effectivePriority("critical", 0)).toEqual({
      level: "normal",
      auto: false,
    });
  });
});
