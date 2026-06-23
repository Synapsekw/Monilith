import { describe, it, expect } from "vitest";
import { submitFeedbackSchema, adminUpdateFeedbackSchema } from "./feedback";

const UUID = "00000000-0000-4000-8000-000000000001";

describe("submitFeedbackSchema", () => {
  it("accepts a valid bug", () => {
    const r = submitFeedbackSchema.safeParse({
      kind: "bug",
      title: "Export crashes",
      body: "Clicking export throws.",
    });
    expect(r.success).toBe(true);
  });
  it("rejects an unknown kind", () => {
    const r = submitFeedbackSchema.safeParse({
      kind: "question",
      title: "x",
      body: "y",
    });
    expect(r.success).toBe(false);
  });
  it("rejects an empty title", () => {
    const r = submitFeedbackSchema.safeParse({
      kind: "bug",
      title: "",
      body: "y",
    });
    expect(r.success).toBe(false);
  });
  it("rejects an over-long title (>120)", () => {
    const r = submitFeedbackSchema.safeParse({
      kind: "feature_request",
      title: "a".repeat(121),
      body: "y",
    });
    expect(r.success).toBe(false);
  });
});

describe("adminUpdateFeedbackSchema", () => {
  it("accepts a status with an optional response", () => {
    const r = adminUpdateFeedbackSchema.safeParse({
      id: UUID,
      status: "in_progress",
      adminResponse: "Working on it.",
    });
    expect(r.success).toBe(true);
  });
  it("accepts a status with no response", () => {
    const r = adminUpdateFeedbackSchema.safeParse({
      id: UUID,
      status: "resolved",
    });
    expect(r.success).toBe(true);
  });
  it("rejects an unknown status", () => {
    const r = adminUpdateFeedbackSchema.safeParse({
      id: UUID,
      status: "wontfix",
    });
    expect(r.success).toBe(false);
  });
});
