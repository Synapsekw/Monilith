import { describe, expect, it } from "vitest";
import {
  upsertMemberCapacitySchema,
  setWorkloadDefaultsSchema,
  workloadWindowSchema,
} from "@/lib/validations/workload";

describe("upsertMemberCapacitySchema", () => {
  it("accepts valid capacity", () => {
    const r = upsertMemberCapacitySchema.safeParse({
      userId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      hoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
    });
    expect(r.success).toBe(true);
  });
  it("rejects hours over 24", () => {
    const r = upsertMemberCapacitySchema.safeParse({
      userId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      hoursPerDay: 30,
      workingDays: [1],
    });
    expect(r.success).toBe(false);
  });
  it("rejects an out-of-range weekday", () => {
    const r = upsertMemberCapacitySchema.safeParse({
      userId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      hoursPerDay: 8,
      workingDays: [0, 8],
    });
    expect(r.success).toBe(false);
  });
});

describe("setWorkloadDefaultsSchema", () => {
  it("accepts valid defaults", () => {
    const r = setWorkloadDefaultsSchema.safeParse({
      defaultHoursPerDay: 8,
      defaultPerItemHours: 4,
      defaultWorkingDays: [1, 2, 3, 4, 5],
    });
    expect(r.success).toBe(true);
  });
  it("rejects negative per-item hours", () => {
    const r = setWorkloadDefaultsSchema.safeParse({
      defaultHoursPerDay: 8,
      defaultPerItemHours: -1,
      defaultWorkingDays: [1],
    });
    expect(r.success).toBe(false);
  });
});

describe("workloadWindowSchema", () => {
  it("accepts an ISO from/to pair", () => {
    const r = workloadWindowSchema.safeParse({
      from: "2026-06-01",
      to: "2026-08-31",
    });
    expect(r.success).toBe(true);
  });
  it("rejects a non-ISO date", () => {
    const r = workloadWindowSchema.safeParse({
      from: "June 1",
      to: "2026-08-31",
    });
    expect(r.success).toBe(false);
  });
});
