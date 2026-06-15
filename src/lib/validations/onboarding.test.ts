import { describe, expect, it } from "vitest";
import { onboardingSchema } from "./onboarding";

describe("onboardingSchema", () => {
  it("accepts a valid org and workspace name", () => {
    const result = onboardingSchema.safeParse({
      orgName: "Acme Inc",
      workspaceName: "Engineering",
    });
    expect(result.success).toBe(true);
  });

  it("trims whitespace around names", () => {
    const result = onboardingSchema.safeParse({
      orgName: "  Acme Inc  ",
      workspaceName: "  Engineering  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.orgName).toBe("Acme Inc");
      expect(result.data.workspaceName).toBe("Engineering");
    }
  });

  it("rejects an empty org name", () => {
    const result = onboardingSchema.safeParse({
      orgName: "",
      workspaceName: "Engineering",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty workspace name", () => {
    const result = onboardingSchema.safeParse({
      orgName: "Acme Inc",
      workspaceName: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a whitespace-only org name", () => {
    const result = onboardingSchema.safeParse({
      orgName: "   ",
      workspaceName: "Engineering",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an org name longer than 100 characters", () => {
    const result = onboardingSchema.safeParse({
      orgName: "a".repeat(101),
      workspaceName: "Engineering",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a workspace name longer than 100 characters", () => {
    const result = onboardingSchema.safeParse({
      orgName: "Acme Inc",
      workspaceName: "a".repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it("accepts names exactly 100 characters long", () => {
    const result = onboardingSchema.safeParse({
      orgName: "a".repeat(100),
      workspaceName: "b".repeat(100),
    });
    expect(result.success).toBe(true);
  });
});
